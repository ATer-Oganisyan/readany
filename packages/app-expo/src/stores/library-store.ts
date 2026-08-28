import { isLegacyGeneratedBookCover } from "@/lib/book/cover-display";
import { deleteLocalCoverJob, getLocalCoverJob } from "@/lib/book/cover-job-repository";
import { persistCoverFile, verifyCoverPersistence } from "@/lib/book/cover-persistence";
import { acknowledgeGeneratedBookCover, generateBookCover } from "@/lib/book/generate-book-cover";
import {
  generateBookIdentityWithGemini,
  isSuspiciousBookTitle,
  isTechnicalBookTitle,
} from "@/lib/book/generate-book-title";
import {
  createRangeReadableFile,
  extractBookMetadata,
  extractBookMetadataFromFile,
} from "@/lib/book/metadata-extractor";
import { shouldRefreshBundledCatalogCover } from "@/lib/catalog/bundled-book-definitions";
import {
  findBundledCatalogBookByTitle,
  installBundledCatalogCover,
} from "@/lib/catalog/bundled-books";
import {
  preserveBackendOriginalSource,
  startImportedBackendBook,
} from "@/lib/narra/backend-book-sync";
import { queueBook as queueAutoVectorize } from "@/lib/rag/auto-vectorize-service";
import {
  type ImportBooksResult,
  createEmptyImportBooksResult,
  createImportDuplicateIndex,
  findDuplicateBookByHash,
} from "@readany/core";
import * as db from "@readany/core/db/database";
import { runWithDbRetry } from "@readany/core/db/write-retry";
import { getPlatformService } from "@readany/core/services";
import type { Book, BookGroup, LibraryFilter, SortField, SortOrder } from "@readany/core/types";
import { generateId } from "@readany/core/utils";
import { AppState } from "react-native";
import { create } from "zustand";
import { debouncedSave, loadFromFS } from "./persist";
import { useVectorModelStore } from "./vector-model-store";

// Hermes (React Native) only supports UTF-8 in TextDecoder.
// text-encoding polyfill detects the native TextDecoder and skips installing
// its own full-encoding version. Workaround: temporarily hide the native
// TextDecoder so the polyfill installs unconditionally, then restore native.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _nativeTD = globalThis.TextDecoder;
const _nativeTE = globalThis.TextEncoder;
// @ts-expect-error — temporarily remove native TextDecoder/TextEncoder
globalThis.TextDecoder = undefined;
// @ts-expect-error
globalThis.TextEncoder = undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TextDecoder: PolyfillTextDecoder } = require("text-encoding") as {
  TextDecoder: typeof TextDecoder;
};
// Restore native TextDecoder/TextEncoder for rest of the app
globalThis.TextDecoder = _nativeTD;
globalThis.TextEncoder = _nativeTE;

// Verify polyfill can decode non-UTF-8 at module load time
try {
  new PolyfillTextDecoder("gb18030");
} catch (e) {
  console.error("[text-encoding] Polyfill BROKEN: gb18030 not supported!", e);
}

export type LibraryViewMode = "grid" | "list";
export interface RemoveBookOptions {
  preserveData?: boolean;
}

export interface KnownBookImport {
  title: string;
  author: string;
  sourceKind: NonNullable<Book["sourceKind"]>;
  bookEditionId: string;
  contentHash: string;
  revisionId: string;
}

export interface LibraryImportFile {
  uri: string;
  name?: string;
  knownBook?: KnownBookImport;
}

function keepActiveGroupId(activeGroupId: string, groups: BookGroup[]): string {
  if (!activeGroupId) return "";
  return groups.some((group) => group.id === activeGroupId) ? activeGroupId : "";
}

export interface LibraryState {
  books: Book[];
  groups: BookGroup[];
  filter: LibraryFilter;
  viewMode: LibraryViewMode;
  isGroupView: boolean;
  isImporting: boolean;
  generatingCoverBookIds: string[];
  isLoaded: boolean;
  allTags: string[];
  activeTag: string;
  activeGroupId: string;

  loadBooks: (deletedTags?: string[]) => Promise<void>;
  loadGroups: () => Promise<void>;
  setBooks: (books: Book[]) => void;
  setGroupView: (enabled: boolean) => void;
  setActiveGroupId: (groupId: string) => void;
  addBook: (book: Book) => Promise<void>;
  removeBook: (bookId: string, options?: RemoveBookOptions) => Promise<void>;
  updateBook: (bookId: string, updates: Partial<Book>) => Promise<void>;
  setFilter: (filter: Partial<LibraryFilter>) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  importBooks: (files: LibraryImportFile[]) => Promise<ImportBooksResult>;
  inspectDeletedBookCandidate: (
    bookId: string,
    file: { uri: string; name?: string },
  ) => Promise<{
    title: string;
    author: string;
    format: Book["format"];
    fileHash?: string;
  } | null>;
  reimportDeletedBook: (
    bookId: string,
    file: { uri: string; name?: string },
  ) => Promise<Book | null>;
  setActiveTag: (tag: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  renameTag: (oldName: string, newName: string) => void;
  addGroup: (name: string) => Promise<BookGroup | null>;
  renameGroup: (groupId: string, name: string) => void;
  removeGroup: (groupId: string) => Promise<void>;
  moveBookToGroup: (bookId: string, groupId?: string) => void;
  moveBooksToGroup: (bookIds: string[], groupId?: string) => void;
  removeBookFromGroup: (bookId: string) => void;
  addTagToBook: (bookId: string, tag: string) => void;
  removeTagFromBook: (bookId: string, tag: string) => void;
}

async function resolveAppPath(relativePath: string): Promise<string> {
  const platform = getPlatformService();
  const appData = await platform.getAppDataDir();
  return platform.joinPath(appData, relativePath);
}

function isRelativeAppPath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.startsWith("file://") &&
    !path.startsWith("asset://") &&
    !path.startsWith("http")
  );
}

async function ensureAppSubDir(subDir: string): Promise<void> {
  const platform = getPlatformService();
  const absDir = await resolveAppPath(subDir);
  try {
    await platform.mkdir(absDir);
  } catch {
    /* may exist */
  }
}

async function saveGeneratedCoverBytesToAppData(
  bookId: string,
  bytes: Uint8Array,
  mimeType: string,
  kind: "generated" | "original" = "generated",
): Promise<string> {
  const platform = getPlatformService();
  await ensureAppSubDir("covers");
  const ext = mimeType.includes("webp") ? "webp" : mimeType.includes("jpeg") ? "jpg" : "png";
  // A fresh destination makes the rename atomic without deleting an old cover.
  const relativePath = `covers/${bookId}-${kind}-${generateId()}.${ext}`;
  const absolutePath = await resolveAppPath(relativePath);
  const temporaryPath = `${absolutePath}.${Date.now()}.tmp`;
  const FileSystem = await import("expo-file-system/legacy");
  await persistCoverFile({
    bytes,
    mimeType,
    temporaryPath,
    destinationPath: absolutePath,
    write: (path, data) => platform.writeFile(path, data),
    move: (from, to) => FileSystem.moveAsync({ from, to }),
    read: (path) => platform.readFile(path),
  });
  return relativePath;
}

async function verifyPersistedBookCover(bookId: string, expectedUrl: string): Promise<void> {
  const absolutePath = isRelativeAppPath(expectedUrl)
    ? await resolveAppPath(expectedUrl)
    : expectedUrl;
  await verifyCoverPersistence({
    expectedUrl,
    readSavedUrl: async () => (await db.getBook(bookId))?.meta.coverUrl,
    readImage: () => getPlatformService().readFile(absolutePath),
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

const MOBILE_IMPORT_METADATA_MAX_BYTES = 32 * 1024 * 1024;

async function getMobileFileStat(
  path: string,
): Promise<{ size: number; md5?: string; modificationTime?: number }> {
  const LegacyFileSystem = await import("expo-file-system/legacy");
  const info = await LegacyFileSystem.getInfoAsync(path);
  return {
    size: info.exists && !info.isDirectory ? (info.size ?? 0) : 0,
    md5: undefined,
    modificationTime:
      info.exists && !info.isDirectory && typeof info.modificationTime === "number"
        ? info.modificationTime * 1000
        : undefined,
  };
}

async function extractMobileImportMetadata(params: {
  filePath: string;
  format: Book["format"];
  fileName: string;
  fileSize: number;
  sourceBytes?: Uint8Array;
}) {
  const { filePath, format, fileName, fileSize, sourceBytes } = params;

  if (format === "epub" || format === "fb2") {
    if (sourceBytes) {
      return extractBookMetadata(sourceBytes, format, fileName);
    }
    if (fileSize > 0 && fileSize <= MOBILE_IMPORT_METADATA_MAX_BYTES) {
      return extractBookMetadata(await getPlatformService().readFile(filePath), format, fileName);
    }

    const rangeReadable = await createRangeReadableFile(filePath, fileSize);
    return extractBookMetadataFromFile(rangeReadable, format, fileName);
  }

  if (format === "mobi" || format === "azw" || format === "azw3") {
    const rangeReadable = await createRangeReadableFile(filePath, fileSize);
    return extractBookMetadataFromFile(rangeReadable, format, fileName);
  }

  return {
    title: fileName.replace(/\.\w+$/i, "") || "Untitled",
    author: "",
    coverBytes: null,
    coverMimeType: null,
  };
}

async function resolveImportedBookIdentity(params: {
  fileName: string;
  title: string;
  author: string;
  description?: string;
  textSample?: string;
  forceGemini?: boolean;
}): Promise<{ title: string; author: string }> {
  if (!params.forceGemini && !isSuspiciousBookTitle(params.title, params.fileName)) {
    return { title: params.title, author: params.author };
  }

  try {
    const generated = await generateBookIdentityWithGemini({
      fileName: params.fileName,
      detectedTitle: params.title,
      detectedAuthor: params.author,
      excerpt: params.textSample || params.description,
    });
    if (generated) {
      console.log(
        `[Library] Gemini identified "${params.fileName}" as "${generated.title}" (${generated.author || params.author || "автор не указан"})`,
      );
      return {
        title: generated.title,
        author: generated.author || params.author,
      };
    }
  } catch (error) {
    console.warn("[Library] Gemini could not identify the book; using embedded metadata:", error);
  }

  return { title: params.title, author: params.author };
}

const titleRepairAttempted = new Set<string>();
const coverGenerationInFlight = new Set<string>();
let coverGenerationQueue: Promise<void> = Promise.resolve();
let coverResumeSubscription: ReturnType<typeof AppState.addEventListener> | undefined;

function watchCoverRecovery(): void {
  if (coverResumeSubscription) return;
  coverResumeSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active" && useLibraryStore.getState().isLoaded) {
      void repairMissingBookCovers(useLibraryStore.getState().books).catch((error) =>
        console.warn("[Library] Cover recovery deferred:", error),
      );
    }
  });
}

function setCoverGenerationActive(bookId: string, active: boolean): void {
  useLibraryStore.setState((state) => ({
    generatingCoverBookIds: active
      ? state.generatingCoverBookIds.includes(bookId)
        ? state.generatingCoverBookIds
        : [...state.generatingCoverBookIds, bookId]
      : state.generatingCoverBookIds.filter((id) => id !== bookId),
  }));
}

async function repairSuspiciousBookTitles(books: Book[]): Promise<void> {
  for (const book of books) {
    const fileName = book.filePath.split("/").pop() || `${book.meta.title}.${book.format}`;
    if (
      titleRepairAttempted.has(book.id) ||
      !isSuspiciousBookTitle(book.meta.title, fileName) ||
      (book.format !== "fb2" && book.format !== "epub")
    ) {
      continue;
    }
    titleRepairAttempted.add(book.id);

    try {
      const filePath = isRelativeAppPath(book.filePath)
        ? await resolveAppPath(book.filePath)
        : book.filePath;
      const { size } = await getMobileFileStat(filePath);
      const meta = await extractMobileImportMetadata({
        filePath,
        format: book.format,
        fileName,
        fileSize: size,
      });
      const identity = await resolveImportedBookIdentity({
        fileName,
        title: meta.title,
        author: meta.author,
        description: meta.description,
        textSample: meta.textSample,
        forceGemini: true,
      });
      if (!isSuspiciousBookTitle(identity.title, fileName)) {
        await useLibraryStore.getState().updateBook(book.id, {
          meta: {
            ...book.meta,
            title: identity.title,
            author: identity.author || book.meta.author,
          },
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      console.warn(`[Library] Failed to repair title for ${book.id}:`, error);
    }
  }
}

async function ensureGeneratedBookCover(
  queuedBook: Book,
  queuedContext?: { description?: string; textSample?: string; subjects?: string[] },
): Promise<void> {
  // The queue may have waited while another action saved/deleted this book.
  const book = await db.getBook(queuedBook.id);
  if (!book) return;
  let context = queuedContext;
  if (book.meta.coverUrl) return;
  if (book.sourceKind === "catalog") return;

  // Do not infer "no embedded cover" from an earlier failed import save.
  if (["epub", "fb2", "mobi", "azw", "azw3"].includes(book.format)) {
    const filePath = isRelativeAppPath(book.filePath)
      ? await resolveAppPath(book.filePath)
      : book.filePath;
    const { size } = await getMobileFileStat(filePath);
    if (size <= 0) throw new Error("Cannot check embedded cover: book file is unavailable");
    const metadata = await extractMobileImportMetadata({
      filePath,
      format: book.format,
      fileName: filePath.split("/").pop() || `${book.meta.title}.${book.format}`,
      fileSize: size,
    });
    context = {
      description: metadata.description || context?.description,
      textSample: metadata.textSample || context?.textSample,
      subjects: metadata.subjects || context?.subjects,
    };
    if (metadata.coverBytes?.length) {
      const coverUrl = await saveGeneratedCoverBytesToAppData(
        book.id,
        metadata.coverBytes,
        metadata.coverMimeType || "image/jpeg",
        "original",
      );
      const current = useLibraryStore.getState().books.find((item) => item.id === book.id);
      if (!current || current.meta.coverUrl) return;
      await useLibraryStore
        .getState()
        .updateBook(book.id, { meta: { ...current.meta, coverUrl }, updatedAt: Date.now() });
      await verifyPersistedBookCover(book.id, coverUrl);
      // Any obsolete server job expires normally; never submit another one.
      await deleteLocalCoverJob(book.id);
      return;
    }
  }
  const existingJob = await getLocalCoverJob(book.id);
  if (existingJob?.status === "failed") return;
  const catalogBook = findBundledCatalogBookByTitle(book.meta.title);
  if (catalogBook && !existingJob) {
    const coverUrl = await installBundledCatalogCover(book.id, catalogBook);
    const currentBook = useLibraryStore.getState().books.find((item) => item.id === book.id);
    if (!currentBook || currentBook.meta.coverUrl) return;
    await useLibraryStore.getState().updateBook(book.id, {
      meta: { ...currentBook.meta, coverUrl },
      updatedAt: Date.now(),
    });
    return;
  }
  const generated = await generateBookCover({
    bookId: book.id,
    title: book.meta.title,
    author: book.meta.author,
    description: context?.description || book.meta.description,
    excerpt: context?.textSample,
    subjects: context?.subjects || book.meta.subjects,
  });

  const coverUrl = await saveGeneratedCoverBytesToAppData(
    book.id,
    generated.bytes,
    generated.mimeType,
  );
  const currentBook = useLibraryStore.getState().books.find((item) => item.id === book.id);
  if (!currentBook || currentBook.meta.coverUrl) {
    if (currentBook?.meta.coverUrl) {
      const existingUrl = currentBook.meta.coverUrl;
      await acknowledgeGeneratedBookCover(
        book.id,
        () => verifyPersistedBookCover(book.id, existingUrl),
        generated.jobId,
      );
    }
    return;
  }
  await useLibraryStore.getState().updateBook(book.id, {
    meta: { ...currentBook.meta, coverUrl },
    updatedAt: Date.now(),
  });
  await acknowledgeGeneratedBookCover(
    book.id,
    () => verifyPersistedBookCover(book.id, coverUrl),
    generated.jobId,
  );
  console.log(`[Library] Saved generated cover for "${currentBook.meta.title}"`);
}

function queueGeneratedBookCover(
  book: Book,
  context?: { description?: string; textSample?: string; subjects?: string[] },
): Promise<void> {
  if (book.meta.coverUrl || coverGenerationInFlight.has(book.id)) return Promise.resolve();
  coverGenerationInFlight.add(book.id);
  setCoverGenerationActive(book.id, true);

  const task = coverGenerationQueue
    .then(() => ensureGeneratedBookCover(book, context))
    .catch((error) => {
      console.warn(`[Library] OpenRouter could not generate a cover for ${book.id}:`, error);
    })
    .finally(() => {
      coverGenerationInFlight.delete(book.id);
      setCoverGenerationActive(book.id, false);
    });
  coverGenerationQueue = task.catch(() => undefined);
  return task;
}

async function repairMissingBookCovers(books: Book[]): Promise<void> {
  for (const originalBook of books) {
    const book =
      useLibraryStore.getState().books.find((item) => item.id === originalBook.id) || originalBook;
    if (book.meta.coverUrl) {
      const localJob = await getLocalCoverJob(book.id).catch(() => null);
      if (localJob) {
        const persistedBook = await db.getBook(book.id).catch(() => null);
        if (persistedBook?.meta.coverUrl === book.meta.coverUrl) {
          const savedUrl = book.meta.coverUrl;
          if (localJob.status === "completed" || localJob.status === "failed") {
            await acknowledgeGeneratedBookCover(
              book.id,
              () => verifyPersistedBookCover(book.id, savedUrl),
              localJob.jobId,
            ).catch((error) =>
              console.warn(`[Library] Could not acknowledge cover job ${book.id}:`, error),
            );
          } else {
            // An original or catalog cover won the race. Stop polling the now
            // irrelevant remote job; the gateway will remove its result by TTL.
            await deleteLocalCoverJob(book.id);
          }
        }
      }
      continue;
    }
    if (coverGenerationInFlight.has(book.id)) continue;
    // Resume existing user jobs only. Missing catalog metadata must never launch generation.
    if (book.sourceKind === "catalog" || !(await getLocalCoverJob(book.id))) continue;

    await queueGeneratedBookCover(book);
  }
}

async function migrateLegacyGeneratedBookCovers(books: Book[]): Promise<void> {
  for (const originalBook of books) {
    const coverUrl = originalBook.meta.coverUrl;
    if (!coverUrl) continue;

    try {
      const platform = getPlatformService();
      const absolutePath = await resolveAppPath(coverUrl);
      const { modificationTime } = await getMobileFileStat(absolutePath);
      if (
        !isLegacyGeneratedBookCover({
          bookId: originalBook.id,
          coverUrl,
          bookAddedAt: originalBook.addedAt,
          coverModifiedAt: modificationTime,
        })
      ) {
        continue;
      }

      const extension = coverUrl.split(".").pop()?.toLowerCase() || "jpg";
      const generatedCoverUrl = `covers/${originalBook.id}-generated.${extension}`;
      await platform.writeFile(
        await resolveAppPath(generatedCoverUrl),
        await platform.readFile(absolutePath),
      );

      const latestBook = useLibraryStore
        .getState()
        .books.find((book) => book.id === originalBook.id);
      if (!latestBook || latestBook.meta.coverUrl !== coverUrl) continue;
      await useLibraryStore.getState().updateBook(originalBook.id, {
        meta: { ...latestBook.meta, coverUrl: generatedCoverUrl },
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.warn(`[Library] Could not migrate legacy generated cover ${originalBook.id}:`, error);
    }
  }
}

async function repairBundledCatalogCovers(books: Book[]): Promise<void> {
  for (const originalBook of books) {
    const book =
      useLibraryStore.getState().books.find((item) => item.id === originalBook.id) || originalBook;
    const catalogBook = findBundledCatalogBookByTitle(book.meta.title);
    if (!catalogBook) continue;

    const previousCoverUrl = book.meta.coverUrl;
    if (!shouldRefreshBundledCatalogCover(book.id, previousCoverUrl)) continue;

    try {
      const installedCoverUrl = await installBundledCatalogCover(book.id, catalogBook);
      const latestBook = useLibraryStore.getState().books.find((item) => item.id === book.id);
      if (!latestBook || latestBook.meta.coverUrl !== previousCoverUrl) continue;
      await useLibraryStore.getState().updateBook(book.id, {
        meta: { ...latestBook.meta, coverUrl: installedCoverUrl },
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.warn(`[Catalog] Failed to refresh cover ${catalogBook.id}:`, error);
    }
  }
}

async function repairImportedBookMetadata(books: Book[]): Promise<void> {
  await repairSuspiciousBookTitles(books);
  await repairBundledCatalogCovers(books);
  await migrateLegacyGeneratedBookCovers(books);
  await repairMissingBookCovers(books);
}

function shouldAutoVectorizeMobile(format: Book["format"]): boolean {
  return format === "epub" || format === "txt" || format === "umd";
}

/**
 * Ensure raw bytes are UTF-8 encoded. Hermes (React Native) only supports
 * UTF-8 in TextDecoder — GBK/GB18030/Shift-JIS etc. are NOT supported.
 * If the bytes are not UTF-8, use text-encoding polyfill to convert to UTF-8.
 */
function ensureUtf8Bytes(bytes: Uint8Array): Uint8Array {
  // Check BOM markers
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes; // UTF-8 with BOM
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new PolyfillTextDecoder("utf-16le").decode(bytes);
    return new TextEncoder().encode(text);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new PolyfillTextDecoder("utf-16be").decode(bytes);
    return new TextEncoder().encode(text);
  }

  // Try strict UTF-8 validation on a sample.
  // IMPORTANT: must align the sample end to a UTF-8 character boundary,
  // otherwise a multi-byte char split at the boundary causes a false failure.
  let sampleEnd = Math.min(bytes.length, 64 * 1024);
  // Back up past any UTF-8 continuation bytes (10xxxxxx = 0x80-0xBF) at the end
  while (sampleEnd > 0 && sampleEnd < bytes.length && ((bytes[sampleEnd] ?? 0) & 0xc0) === 0x80) {
    sampleEnd--;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, sampleEnd));
    if (bytes.length > sampleEnd * 2) {
      let midStart = Math.floor(bytes.length / 2);
      // Align mid-sample start to a UTF-8 character boundary
      while (midStart < bytes.length && ((bytes[midStart] ?? 0) & 0xc0) === 0x80) {
        midStart++;
      }
      let midEnd = Math.min(midStart + 8192, bytes.length);
      while (midEnd > midStart && midEnd < bytes.length && ((bytes[midEnd] ?? 0) & 0xc0) === 0x80) {
        midEnd--;
      }
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(midStart, midEnd));
    }
    console.log("[ensureUtf8Bytes] passed UTF-8 validation");
    return bytes; // Valid UTF-8
  } catch {
    // Not valid UTF-8 — detect which encoding it is
  }

  // Disambiguate GBK/GB18030 vs Shift-JIS by counting distinctive byte patterns.
  // GBK double-byte: lead 0xA1-0xFE, trail 0xA1-0xFE (dominant in Chinese text)
  // Shift-JIS distinctive: lead 0x81-0x9F (below GBK lead range)
  const sample = bytes.subarray(0, Math.min(4096, bytes.length));
  let highBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    if ((sample[i] ?? 0) >= 0x80) highBytes++;
  }
  const highRatio = sample.length > 0 ? highBytes / sample.length : 0;

  let gbkPairs = 0;
  let sjisDistinctPairs = 0;
  for (let i = 0; i < sample.length - 1; i++) {
    const b1 = sample[i] ?? 0;
    const b2 = sample[i + 1] ?? 0;
    if (b1 >= 0xa1 && b1 <= 0xfe && b2 >= 0xa1 && b2 <= 0xfe) {
      gbkPairs++;
      i++;
    } else if (
      b1 >= 0x81 &&
      b1 <= 0x9f &&
      ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc))
    ) {
      sjisDistinctPairs++;
      i++;
    }
  }

  const isShiftJIS = sjisDistinctPairs > 0 && sjisDistinctPairs > gbkPairs;
  const encoding = isShiftJIS ? "shift_jis" : highRatio > 0.1 ? "gb18030" : "gbk";
  console.log(`[ensureUtf8Bytes] Detected non-UTF-8 encoding: ${encoding}, converting to UTF-8`);

  try {
    const text = new PolyfillTextDecoder(encoding).decode(bytes);
    return new TextEncoder().encode(text);
  } catch (err) {
    console.warn("[ensureUtf8Bytes] Polyfill decode failed, returning raw bytes:", err);
    return bytes;
  }
}

/**
 * Copy book to app data directory. Uses OS-level file copy when possible
 * to avoid loading the full file into JS memory.
 * Falls back to readFile+writeFile only when sourceBytes are already available.
 */
async function copyBookToAppData(
  bookId: string,
  ext: string,
  srcPath: string,
  sourceBytes?: Uint8Array,
): Promise<{ relativePath: string; absPath: string }> {
  const platform = getPlatformService();
  await ensureAppSubDir("books");
  const relativePath = `books/${bookId}.${ext}`;
  const absPath = await resolveAppPath(relativePath);

  if (sourceBytes) {
    // If bytes are already in memory (e.g. from hash calculation), just write them
    await platform.writeFile(absPath, sourceBytes);
  } else {
    // Use expo-file-system File.copy() for OS-level copy (no JS memory)
    const ExpoFS = await import("expo-file-system");
    const srcFile = new ExpoFS.File(srcPath);
    const destFile = new ExpoFS.File(absPath);
    if (destFile.exists) {
      destFile.delete();
    }
    await srcFile.copy(destFile);
    const copiedFile = destFile.info();
    if (!copiedFile.exists || !copiedFile.size) {
      throw new Error(`Book copy failed: ${relativePath}`);
    }
  }
  return { relativePath, absPath };
}

async function persistBookUpdate(bookId: string, updates: Partial<Book>): Promise<void> {
  await runWithDbRetry(() => db.updateBook(bookId, updates));
}

async function restoreDeletedMobileBook(
  bookId: string,
  fileInfo: { uri: string; name?: string },
): Promise<Book | null> {
  await db.initDatabase();
  const originalBook = await db.getBook(bookId, { includeDeleted: true });
  if (!originalBook) return null;

  const filePath = fileInfo.uri;
  const originalName = fileInfo.name
    ? decodeURIComponent(fileInfo.name)
    : decodeURIComponent(filePath.split("/").pop() || "book");
  const ext = originalName.split(".").pop()?.toLowerCase();
  const formatMap: Record<string, Book["format"]> = {
    epub: "epub",
    pdf: "pdf",
    mobi: "mobi",
    azw: "azw",
    azw3: "azw3",
    cbz: "cbz",
    cbr: "cbz",
    fb2: "fb2",
    fbz: "fbz",
    txt: "txt",
    umd: "umd",
  };
  const format: Book["format"] = formatMap[ext || ""] || "epub";
  const fileName = originalName;
  const platform = getPlatformService();
  const { size: fileSize, md5: fileHash } = await getMobileFileStat(filePath);

  if (ext === "txt") {
    const sourceBytes = await platform.readFile(filePath);
    const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
    const bytes = ensureUtf8Bytes(sourceBytes);
    const txtFile = {
      name: fileName,
      size: bytes.byteLength,
      type: "text/plain",
      arrayBuffer: () =>
        Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      slice: (start?: number, end?: number) => {
        const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
        return {
          arrayBuffer: () =>
            Promise.resolve(
              sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength),
            ),
          size: sliced.byteLength,
        };
      },
      stream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    } as unknown as File;

    const conversion = await new TxtToEpubConverter().convertToBytes({ file: txtFile });
    await ensureAppSubDir("books");
    const relativePath = `books/${bookId}.epub`;
    await platform.writeFile(await resolveAppPath(relativePath), conversion.epubBytes);

    return {
      ...originalBook,
      filePath: relativePath,
      format: "epub",
      meta: {
        ...originalBook.meta,
        title: conversion.bookTitle || originalBook.meta.title || fileName.replace(/\.\w+$/i, ""),
        author: originalBook.meta.author || "",
        coverUrl: originalBook.meta.coverUrl,
      },
      deletedAt: undefined,
      fileHash,
      syncStatus: "local",
      isVectorized: false,
      vectorizeProgress: 0,
      updatedAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
  }

  if (ext === "umd") {
    const sourceBytes = await platform.readFile(filePath);
    const [{ UmdToEpubConverter }, pakoMod] = await Promise.all([
      import("@readany/core/utils/umd-to-epub"),
      import("pako"),
    ]);
    const pako = pakoMod.default || pakoMod;
    const umdFile = {
      name: fileName,
      size: sourceBytes.byteLength,
      type: "application/octet-stream",
      arrayBuffer: () =>
        Promise.resolve(
          sourceBytes.buffer.slice(
            sourceBytes.byteOffset,
            sourceBytes.byteOffset + sourceBytes.byteLength,
          ),
        ),
    } as unknown as File;

    const conversion = await new UmdToEpubConverter((b) => pako.inflate(b)).convertToBytes({
      file: umdFile,
    });
    await ensureAppSubDir("books");
    const relativePath = `books/${bookId}.epub`;
    await platform.writeFile(await resolveAppPath(relativePath), conversion.epubBytes);

    let coverUrl = originalBook.meta.coverUrl;
    if (conversion.coverBytes && conversion.coverBytes.length > 0) {
      try {
        await ensureAppSubDir("covers");
        const coverRelPath = `covers/${bookId}-original.jpg`;
        await platform.writeFile(await resolveAppPath(coverRelPath), conversion.coverBytes);
        coverUrl = coverRelPath;
      } catch (coverErr) {
        console.warn(`[restoreDeletedMobileBook] UMD cover save failed: ${coverErr}`);
      }
    }

    return {
      ...originalBook,
      filePath: relativePath,
      format: "umd",
      meta: {
        ...originalBook.meta,
        title: conversion.bookTitle || originalBook.meta.title || fileName.replace(/\.\w+$/i, ""),
        author: conversion.author || originalBook.meta.author || "",
        coverUrl,
      },
      deletedAt: undefined,
      fileHash,
      syncStatus: "local",
      isVectorized: false,
      vectorizeProgress: 0,
      updatedAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
  }

  const { relativePath } = await copyBookToAppData(bookId, ext || "epub", filePath);

  let title = originalBook.meta.title || fileName.replace(/\.\w+$/i, "") || "Untitled";
  let author = originalBook.meta.author || "";
  let coverUrl = originalBook.meta.coverUrl;
  let description = originalBook.meta.description;
  let subjects = originalBook.meta.subjects;

  try {
    const meta = await extractMobileImportMetadata({
      filePath,
      format,
      fileName,
      fileSize,
    });
    if (meta.title) title = meta.title;
    if (meta.author) author = meta.author;
    if (meta.description) description = meta.description;
    if (meta.subjects?.length) subjects = meta.subjects;

    if (meta.coverBytes && meta.coverBytes.length > 0) {
      const mimeType = meta.coverMimeType || "image/jpeg";
      const coverExt = mimeType.includes("png") ? "png" : "jpg";
      await ensureAppSubDir("covers");
      const coverRelPath = `covers/${bookId}-original.${coverExt}`;
      await platform.writeFile(await resolveAppPath(coverRelPath), meta.coverBytes);
      coverUrl = coverRelPath;
    }
  } catch (metaErr) {
    console.warn(`[restoreDeletedMobileBook] Metadata extraction failed for ${fileName}:`, metaErr);
  }

  return {
    ...originalBook,
    filePath: relativePath,
    format,
    meta: {
      ...originalBook.meta,
      title,
      author,
      description,
      subjects,
      coverUrl,
    },
    deletedAt: undefined,
    fileHash,
    syncStatus: "local",
    isVectorized: false,
    vectorizeProgress: 0,
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
}

async function inspectDeletedMobileBookCandidate(
  bookId: string,
  fileInfo: { uri: string; name?: string },
): Promise<{
  title: string;
  author: string;
  format: Book["format"];
  fileHash?: string;
} | null> {
  await db.initDatabase();
  const originalBook = await db.getBook(bookId, { includeDeleted: true });
  if (!originalBook) return null;

  const filePath = fileInfo.uri;
  const originalName = fileInfo.name
    ? decodeURIComponent(fileInfo.name)
    : decodeURIComponent(filePath.split("/").pop() || "book");
  const ext = originalName.split(".").pop()?.toLowerCase();
  const formatMap: Record<string, Book["format"]> = {
    epub: "epub",
    pdf: "pdf",
    mobi: "mobi",
    azw: "azw",
    azw3: "azw3",
    cbz: "cbz",
    cbr: "cbz",
    fb2: "fb2",
    fbz: "fbz",
    txt: "txt",
    umd: "umd",
  };
  const format: Book["format"] = formatMap[ext || ""] || "epub";
  const fileName = originalName;
  const { size: fileSize, md5: fileHash } = await getMobileFileStat(filePath);

  if (ext === "txt") {
    try {
      const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
      const platform = getPlatformService();
      const sourceBytes = await platform.readFile(filePath);
      const bytes = ensureUtf8Bytes(sourceBytes);
      const txtFile = {
        name: fileName,
        size: bytes.byteLength,
        type: "text/plain",
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          ),
        slice: (start?: number, end?: number) => {
          const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
          return {
            arrayBuffer: () =>
              Promise.resolve(
                sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength),
              ),
            size: sliced.byteLength,
          };
        },
        stream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      } as unknown as File;
      const conversion = await new TxtToEpubConverter().convertToBytes({ file: txtFile });
      return {
        title: conversion.bookTitle || fileName.replace(/\.\w+$/i, "") || originalBook.meta.title,
        author: "",
        format: "epub",
        fileHash,
      };
    } catch (err) {
      console.warn("[Library] TXT conversion failed during reimport inspection:", err);
      return {
        title: fileName.replace(/\.\w+$/i, "") || originalBook.meta.title,
        author: "",
        format: "epub",
        fileHash,
      };
    }
  }

  if (ext === "umd") {
    try {
      const [{ UmdToEpubConverter }, pakoMod] = await Promise.all([
        import("@readany/core/utils/umd-to-epub"),
        import("pako"),
      ]);
      const pako = pakoMod.default || pakoMod;
      const platform = getPlatformService();
      const sourceBytes = await platform.readFile(filePath);
      const umdFile = {
        name: fileName,
        size: sourceBytes.byteLength,
        type: "application/octet-stream",
        arrayBuffer: () =>
          Promise.resolve(
            sourceBytes.buffer.slice(
              sourceBytes.byteOffset,
              sourceBytes.byteOffset + sourceBytes.byteLength,
            ),
          ),
      } as unknown as File;
      const conversion = await new UmdToEpubConverter((b) => pako.inflate(b)).convertToBytes({
        file: umdFile,
      });
      return {
        title: conversion.bookTitle || fileName.replace(/\.\w+$/i, "") || originalBook.meta.title,
        author: conversion.author || "",
        format: "umd",
        fileHash,
      };
    } catch (err) {
      console.warn("[Library] UMD inspection failed during reimport:", err);
      return {
        title: fileName.replace(/\.\w+$/i, "") || originalBook.meta.title,
        author: "",
        format: "umd",
        fileHash,
      };
    }
  }

  let title = fileName.replace(/\.\w+$/i, "") || originalBook.meta.title || "Untitled";
  let author = "";
  try {
    const meta = await extractMobileImportMetadata({
      filePath,
      format,
      fileName,
      fileSize,
    });
    if (meta.title) title = meta.title;
    if (meta.author) author = meta.author;
  } catch (err) {
    console.warn("[Library] Failed to extract metadata during reimport inspection:", err);
  }

  return { title, author, format, fileHash };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  groups: [],
  filter: {
    search: "",
    tags: [],
    sortField: "addedAt",
    sortOrder: "desc",
  },
  viewMode: "grid",
  isGroupView: true,
  isImporting: false,
  generatingCoverBookIds: [],
  isLoaded: false,
  allTags: [],
  activeTag: "",
  activeGroupId: "",

  loadBooks: async (deletedTags?: string[]) => {
    const computeTags = (books: Book[]) => {
      const tagSet = new Set<string>();
      for (const b of books) for (const t of b.tags) tagSet.add(t);
      return [...tagSet].sort();
    };

    try {
      const cached = await loadFromFS<Book[]>("library-books");
      const cachedGroups = await loadFromFS<BookGroup[]>("library-groups");
      if (cached && cached.length > 0) {
        const groups = cachedGroups ?? get().groups;
        set((state) => ({
          books: cached,
          groups,
          isLoaded: true,
          allTags: computeTags(cached),
          activeGroupId: keepActiveGroupId(state.activeGroupId, groups),
        }));
      }
    } catch (err) {
      console.warn("[Library] Failed to load cached books:", err);
    }

    try {
      await db.initDatabase();
      const [books, groups] = await Promise.all([db.getBooks(), db.getGroups()]);
      const dbTags = computeTags(books);

      // Load saved tags from FS (may include empty tags not assigned to any book)
      let savedTags: string[] = [];
      try {
        const loaded = await loadFromFS<string[]>("library-tags");
        if (loaded) savedTags = loaded;
      } catch (err) {
        console.warn("[Library] Failed to load saved tags:", err);
      }

      // Remove deleted tags from savedTags
      const deletedSet = new Set(deletedTags || []);
      savedTags = savedTags.filter((t) => !deletedSet.has(t));

      // Merge: dbTags (from books) + empty tags from FS (not in dbTags and not deleted)
      const dbTagSet = new Set(dbTags);
      const emptyTags = savedTags.filter((t) => !dbTagSet.has(t) && !deletedSet.has(t));
      const allTags = [...dbTags, ...emptyTags].sort();

      set((state) => ({
        books,
        groups,
        isLoaded: true,
        allTags,
        activeGroupId: keepActiveGroupId(state.activeGroupId, groups),
      }));
      debouncedSave("library-books", books);
      debouncedSave("library-groups", groups);
      debouncedSave("library-tags", allTags);
      watchCoverRecovery();
      void repairImportedBookMetadata(books);
    } catch (err) {
      console.error("Failed to load books from database:", err);
      set({ isLoaded: true });
    }
  },

  loadGroups: async () => {
    try {
      await db.initDatabase();
      const groups = await db.getGroups();
      set((state) => ({
        groups,
        activeGroupId: keepActiveGroupId(state.activeGroupId, groups),
      }));
      debouncedSave("library-groups", groups);
    } catch (err) {
      console.error("Failed to load groups from database:", err);
    }
  },

  setBooks: (books) => set({ books }),

  setGroupView: (enabled) =>
    set((state) => ({
      isGroupView: enabled,
      activeGroupId: enabled ? state.activeGroupId : "",
    })),

  setActiveGroupId: (groupId) =>
    set({
      activeGroupId: groupId,
      activeTag: "",
      isGroupView: Boolean(groupId) || get().isGroupView,
    }),

  addBook: async (book) => {
    set((state) => ({ books: [...state.books, book] }));
    try {
      await db.initDatabase();
      await db.insertBook(book);
    } catch (err) {
      console.error("Failed to insert book into database:", err);
    }
    debouncedSave("library-books", get().books);
  },

  removeBook: async (bookId, options = {}) => {
    const preserveData = options.preserveData ?? false;
    const bookToRemove = get().books.find((b) => b.id === bookId);
    set((state) => ({ books: state.books.filter((b) => b.id !== bookId) }));
    try {
      await db.initDatabase();
      await db.deleteBook(bookId, { preserveData });
      await deleteLocalCoverJob(bookId);
    } catch (err) {
      console.error("Failed to delete book from database:", err);
    }
    if (bookToRemove) {
      try {
        const platform = getPlatformService();
        if (bookToRemove.filePath && isRelativeAppPath(bookToRemove.filePath)) {
          const absPath = await resolveAppPath(bookToRemove.filePath);
          await platform.deleteFile(absPath);
        }
        if (
          !preserveData &&
          bookToRemove.meta.coverUrl &&
          isRelativeAppPath(bookToRemove.meta.coverUrl)
        ) {
          const coverAbsPath = await resolveAppPath(bookToRemove.meta.coverUrl);
          await platform.deleteFile(coverAbsPath);
        }
      } catch {
        /* file may not exist */
      }
    }
    debouncedSave("library-books", get().books);
  },

  updateBook: async (bookId, updates) => {
    set((state) => ({
      books: state.books.map((b) => (b.id === bookId ? { ...b, ...updates } : b)),
      allTags:
        updates.tags !== undefined
          ? Array.from(new Set([...state.allTags, ...updates.tags])).sort()
          : state.allTags,
    }));
    debouncedSave("library-books", get().books);
    await persistBookUpdate(bookId, updates).catch((err) =>
      console.error("Failed to update book in database:", err),
    );
  },

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSortField: (field) => set((state) => ({ filter: { ...state.filter, sortField: field } })),
  setSortOrder: (order) => set((state) => ({ filter: { ...state.filter, sortOrder: order } })),

  importBooks: async (files) => {
    set({ isImporting: true });
    const result = createEmptyImportBooksResult();
    const duplicateIndex = createImportDuplicateIndex(get().books);
    try {
      await db.initDatabase();
      for (const fileInfo of files) {
        const filePath = fileInfo.uri;
        const knownBook = fileInfo.knownBook;
        const originalName = fileInfo.name
          ? decodeURIComponent(fileInfo.name)
          : decodeURIComponent(filePath.split("/").pop() || "book");
        try {
          const ext = originalName.split(".").pop()?.toLowerCase();
          const formatMap: Record<string, Book["format"]> = {
            epub: "epub",
            pdf: "pdf",
            mobi: "mobi",
            azw: "azw",
            azw3: "azw3",
            cbz: "cbz",
            cbr: "cbz",
            fb2: "fb2",
            fbz: "fbz",
            txt: "txt",
            umd: "umd",
          };
          const format: Book["format"] = formatMap[ext || ""] || "epub";
          const fileName = originalName;
          const platform = getPlatformService();
          const { size: fileSize, md5: fileHash } = await getMobileFileStat(filePath);

          const existingDuplicate = findDuplicateBookByHash(duplicateIndex, fileHash);
          const existingKnownBook = knownBook
            ? get().books.find(
                (candidate) =>
                  !candidate.deletedAt &&
                  candidate.sourceKind === knownBook.sourceKind &&
                  candidate.bookEditionId === knownBook.bookEditionId &&
                  (candidate.syncStatus !== "local" ||
                    candidate.revisionId === knownBook.revisionId ||
                    candidate.contentHash === knownBook.contentHash),
              )
            : undefined;
          if (existingDuplicate?.syncStatus === "local" && !existingKnownBook) {
            result.skippedDuplicates.push({
              name: fileName,
              existingBook: existingDuplicate,
            });
            continue;
          }

          const deletedMatch = fileHash
            ? await db.getDeletedBookByFileHash(fileHash).catch((err) => {
                console.warn("[Library] Failed to check deleted book by hash:", err);
                return null;
              })
            : null;
          const importTarget =
            existingKnownBook ??
            deletedMatch ??
            (existingDuplicate?.syncStatus === "remote" ? existingDuplicate : null);
          const bookId = importTarget?.id ?? generateId();
          if (!knownBook && (ext === "txt" || ext === "umd")) {
            await preserveBackendOriginalSource(bookId, filePath, ext);
          }
          const retainedSourceIdentity = knownBook
            ? {
                sourceKind: knownBook.sourceKind,
                bookEditionId: knownBook.bookEditionId,
                contentHash: knownBook.contentHash,
                revisionId: knownBook.revisionId,
              }
            : importTarget
              ? {
                  sourceKind: importTarget.sourceKind,
                  bookEditionId: importTarget.bookEditionId,
                  contentHash: importTarget.contentHash,
                  revisionId: importTarget.revisionId,
                }
              : {};

          console.log(
            `[importBooks] Importing: name=${fileName}, format=${format}, uri=${filePath}`,
          );

          // For TXT files: convert to EPUB bytes directly, skip Blob/File (slow in RN)
          if (ext === "txt") {
            try {
              const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
              const sourceBytes = await platform.readFile(filePath);

              // Hermes only supports UTF-8 in TextDecoder. Convert GBK/GB18030
              // etc. to UTF-8 using text-encoding polyfill before passing to converter.
              const bytes = ensureUtf8Bytes(sourceBytes);

              // React Native Blob/File constructor doesn't support ArrayBuffer/Uint8Array.
              // Create a File-like shim that provides the methods TxtToEpubConverter needs.
              const txtFile = {
                name: fileName,
                size: bytes.byteLength,
                type: "text/plain",
                arrayBuffer: () =>
                  Promise.resolve(
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                  ),
                slice: (start?: number, end?: number) => {
                  const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
                  return {
                    arrayBuffer: () =>
                      Promise.resolve(
                        sliced.buffer.slice(
                          sliced.byteOffset,
                          sliced.byteOffset + sliced.byteLength,
                        ),
                      ),
                    size: sliced.byteLength,
                  };
                },
                stream: () =>
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(bytes);
                      controller.close();
                    },
                  }),
              } as unknown as File;

              // Use convertToBytes: pure-JS ZIP builder, no Blob bridge
              const converter = new TxtToEpubConverter();
              const conversion = await converter.convertToBytes({ file: txtFile });

              // Write EPUB bytes directly to final app data location
              await ensureAppSubDir("books");
              const relativePath = `books/${bookId}.epub`;
              const absPath = await resolveAppPath(relativePath);
              await platform.writeFile(absPath, conversion.epubBytes);

              // TXT-converted EPUBs have no cover, and title is already known from converter.
              // Skip metadata extraction entirely — saves a full EPUB re-parse.
              const title =
                knownBook?.title ||
                conversion.bookTitle ||
                fileName.replace(/\.\w+$/i, "") ||
                "Untitled";
              const book: Book = {
                id: bookId,
                filePath: relativePath,
                format: "epub",
                meta: {
                  ...(importTarget?.meta ?? {}),
                  title,
                  author: knownBook?.author || "",
                  coverUrl: importTarget?.meta.coverUrl,
                },
                groupId: importTarget?.groupId,
                progress: importTarget?.progress ?? 0,
                currentCfi: importTarget?.currentCfi,
                isVectorized: false,
                vectorizeProgress: 0,
                tags: importTarget?.tags ?? [],
                fileHash,
                syncStatus: "local",
                addedAt: importTarget?.addedAt ?? Date.now(),
                updatedAt: Date.now(),
                lastOpenedAt: importTarget?.lastOpenedAt ?? Date.now(),
                ...retainedSourceIdentity,
              };

              if (importTarget) {
                set((state) => ({
                  books: state.books.some((candidate) => candidate.id === book.id)
                    ? state.books.map((candidate) => (candidate.id === book.id ? book : candidate))
                    : [...state.books, book],
                }));
                await db.updateBook(book.id, {
                  filePath: book.filePath,
                  format: book.format,
                  meta: book.meta,
                  deletedAt: undefined,
                  progress: book.progress,
                  currentCfi: book.currentCfi,
                  isVectorized: false,
                  vectorizeProgress: 0,
                  tags: book.tags,
                  fileHash: book.fileHash,
                  syncStatus: "local",
                  lastOpenedAt: Date.now(),
                });
                debouncedSave("library-books", get().books);
              } else {
                await get().addBook(book);
              }
              result.imported.push(book);
              if (!knownBook) startImportedBackendBook(book);

              if (fileHash) {
                duplicateIndex.byHash.set(fileHash, book);
              }
              console.log(`[importBooks] TXT imported as EPUB: ${title}`);

              // Auto-vectorize if enabled. Keep failures isolated so a
              // successful import doesn't get reported as a failed import.
              try {
                if (knownBook) continue;
                const vmState = useVectorModelStore.getState();
                if (
                  vmState.autoVectorizeOnImport &&
                  vmState.vectorModelEnabled &&
                  vmState.hasVectorCapability() &&
                  shouldAutoVectorizeMobile("txt")
                ) {
                  const base64 = bytesToBase64(conversion.epubBytes);
                  queueAutoVectorize(book, base64, "application/epub+zip");
                }
              } catch (autoVectorizeErr) {
                console.warn(
                  `[importBooks] Auto-vectorize enqueue failed for ${fileName}:`,
                  autoVectorizeErr,
                );
              }
              continue;
            } catch (convErr) {
              console.error("[importBooks] TXT conversion failed:", convErr);
              throw convErr;
            }
          }

          // For UMD files: parse + convert to EPUB bytes inline (Chinese mobile ebook format)
          if (ext === "umd") {
            try {
              const [{ UmdToEpubConverter }, pakoMod] = await Promise.all([
                import("@readany/core/utils/umd-to-epub"),
                import("pako"),
              ]);
              const pako = pakoMod.default || pakoMod;
              const sourceBytes = await platform.readFile(filePath);

              // File-like shim — same approach as TXT branch (RN Blob/File
              // constructors don't accept ArrayBuffer/Uint8Array).
              const umdFile = {
                name: fileName,
                size: sourceBytes.byteLength,
                type: "application/octet-stream",
                arrayBuffer: () =>
                  Promise.resolve(
                    sourceBytes.buffer.slice(
                      sourceBytes.byteOffset,
                      sourceBytes.byteOffset + sourceBytes.byteLength,
                    ),
                  ),
              } as unknown as File;

              const converter = new UmdToEpubConverter((b) => pako.inflate(b));
              const conversion = await converter.convertToBytes({ file: umdFile });

              await ensureAppSubDir("books");
              const relativePath = `books/${bookId}.epub`;
              const absPath = await resolveAppPath(relativePath);
              await platform.writeFile(absPath, conversion.epubBytes);

              let coverUrl: string | undefined;
              if (conversion.coverBytes && conversion.coverBytes.length > 0) {
                try {
                  await ensureAppSubDir("covers");
                  const coverRelPath = `covers/${bookId}-original.jpg`;
                  const coverAbsPath = await resolveAppPath(coverRelPath);
                  await platform.writeFile(coverAbsPath, conversion.coverBytes);
                  coverUrl = coverRelPath;
                } catch (coverErr) {
                  console.warn(`[importBooks] Failed to save UMD cover for ${fileName}:`, coverErr);
                }
              }

              const title = conversion.bookTitle || fileName.replace(/\.\w+$/i, "") || "Untitled";
              const author = conversion.author || "";
              const book: Book = {
                id: bookId,
                filePath: relativePath,
                format: "umd",
                meta: {
                  ...(importTarget?.meta ?? {}),
                  title,
                  author,
                  coverUrl: coverUrl || importTarget?.meta.coverUrl,
                },
                groupId: importTarget?.groupId,
                progress: importTarget?.progress ?? 0,
                currentCfi: importTarget?.currentCfi,
                isVectorized: false,
                vectorizeProgress: 0,
                tags: importTarget?.tags ?? [],
                fileHash,
                syncStatus: "local",
                addedAt: importTarget?.addedAt ?? Date.now(),
                updatedAt: Date.now(),
                lastOpenedAt: importTarget?.lastOpenedAt ?? Date.now(),
                ...retainedSourceIdentity,
              };

              if (importTarget) {
                set((state) => ({
                  books: state.books.some((candidate) => candidate.id === book.id)
                    ? state.books.map((candidate) => (candidate.id === book.id ? book : candidate))
                    : [...state.books, book],
                }));
                await db.updateBook(book.id, {
                  filePath: book.filePath,
                  format: book.format,
                  meta: book.meta,
                  deletedAt: undefined,
                  progress: book.progress,
                  currentCfi: book.currentCfi,
                  isVectorized: false,
                  vectorizeProgress: 0,
                  tags: book.tags,
                  fileHash: book.fileHash,
                  syncStatus: "local",
                  lastOpenedAt: Date.now(),
                });
                debouncedSave("library-books", get().books);
              } else {
                await get().addBook(book);
              }
              result.imported.push(book);
              if (!knownBook) startImportedBackendBook(book);
              if (fileHash) {
                duplicateIndex.byHash.set(fileHash, book);
              }
              console.log(`[importBooks] UMD imported as EPUB: ${title}`);

              try {
                const vmState = useVectorModelStore.getState();
                if (
                  vmState.autoVectorizeOnImport &&
                  vmState.vectorModelEnabled &&
                  vmState.hasVectorCapability() &&
                  shouldAutoVectorizeMobile("umd")
                ) {
                  const base64 = bytesToBase64(conversion.epubBytes);
                  queueAutoVectorize(book, base64, "application/epub+zip");
                }
              } catch (autoVectorizeErr) {
                console.warn(
                  `[importBooks] Auto-vectorize enqueue failed for ${fileName}:`,
                  autoVectorizeErr,
                );
              }
              continue;
            } catch (convErr) {
              console.error("[importBooks] UMD conversion failed:", convErr);
              throw convErr;
            }
          }

          const { relativePath } = await copyBookToAppData(bookId, ext || "epub", filePath);
          console.log(`[importBooks] File copied. relativePath: ${relativePath}`);

          // Extract metadata (title, author, cover) from book content
          let title = knownBook?.title || fileName.replace(/\.\w+$/i, "") || "Untitled";
          let author = knownBook?.author || "";
          let coverUrl: string | undefined;
          let coverContext:
            | { description?: string; textSample?: string; subjects?: string[] }
            | undefined;
          const shouldGenerateIdentity = isTechnicalBookTitle(title);

          if (!knownBook) {
            try {
              console.log(`[importBooks] Extracting metadata for format=${format}...`);
              const meta = await extractMobileImportMetadata({
                filePath,
                format,
                fileName,
                fileSize,
              });
              console.log(
                `[importBooks] Metadata result: title="${meta.title}", author="${meta.author}", hasCover=${!!meta.coverBytes}, coverSize=${meta.coverBytes?.length ?? 0}`,
              );
              if (meta.title) title = meta.title;
              if (meta.author) author = meta.author;
              coverContext = {
                description: meta.description,
                textSample: meta.textSample,
                subjects: meta.subjects,
              };

              const identity = await resolveImportedBookIdentity({
                fileName,
                title,
                author,
                description: meta.description,
                textSample: meta.textSample,
                forceGemini: shouldGenerateIdentity,
              });
              title = identity.title;
              author = identity.author;

              // Save cover image to app data
              if (meta.coverBytes && meta.coverBytes.length > 0) {
                try {
                  const mimeType = meta.coverMimeType || "image/jpeg";
                  const coverExt = mimeType.includes("png") ? "png" : "jpg";
                  await ensureAppSubDir("covers");
                  const coverRelPath = `covers/${bookId}-original.${coverExt}`;
                  const coverAbsPath = await resolveAppPath(coverRelPath);
                  console.log(`[importBooks] Saving cover to: ${coverAbsPath}`);
                  const platform = getPlatformService();
                  await platform.writeFile(coverAbsPath, meta.coverBytes);
                  coverUrl = coverRelPath;
                  console.log(`[importBooks] Cover saved. coverUrl=${coverUrl}`);
                } catch (coverErr) {
                  console.warn(`[importBooks] Failed to save cover for ${fileName}:`, coverErr);
                }
              }
            } catch (metaErr) {
              console.warn(`[importBooks] Metadata extraction failed for ${fileName}:`, metaErr);
            }
          }

          console.log(
            `[importBooks] Final book: title="${title}", author="${author}", coverUrl="${coverUrl}"`,
          );
          const book: Book = {
            id: bookId,
            filePath: relativePath,
            format,
            meta: {
              ...(importTarget?.meta ?? {}),
              title,
              author,
              description: coverContext?.description || importTarget?.meta.description,
              subjects: coverContext?.subjects?.length
                ? coverContext.subjects
                : importTarget?.meta.subjects,
              coverUrl: coverUrl || importTarget?.meta.coverUrl,
            },
            groupId: importTarget?.groupId,
            progress: importTarget?.progress ?? 0,
            currentCfi: importTarget?.currentCfi,
            isVectorized: false,
            vectorizeProgress: 0,
            tags: importTarget?.tags ?? [],
            fileHash,
            syncStatus: "local",
            addedAt: importTarget?.addedAt ?? Date.now(),
            updatedAt: Date.now(),
            lastOpenedAt: importTarget?.lastOpenedAt ?? Date.now(),
            ...retainedSourceIdentity,
          };
          if (importTarget) {
            set((state) => ({
              books: state.books.some((candidate) => candidate.id === book.id)
                ? state.books.map((candidate) => (candidate.id === book.id ? book : candidate))
                : [...state.books, book],
            }));
            await db.updateBook(book.id, {
              filePath: book.filePath,
              format: book.format,
              meta: book.meta,
              deletedAt: undefined,
              progress: book.progress,
              currentCfi: book.currentCfi,
              isVectorized: false,
              vectorizeProgress: 0,
              tags: book.tags,
              fileHash: book.fileHash,
              syncStatus: "local",
              lastOpenedAt: Date.now(),
            });
            debouncedSave("library-books", get().books);
          } else {
            await get().addBook(book);
          }
          result.imported.push(book);
          if (!knownBook) startImportedBackendBook(book);

          if (fileHash) {
            duplicateIndex.byHash.set(fileHash, book);
          }

          // Auto-vectorize if enabled. Keep failures isolated so a
          // successful import doesn't get reported as a failed import.
          try {
            if (knownBook) continue;
            const vmState = useVectorModelStore.getState();
            if (
              vmState.autoVectorizeOnImport &&
              vmState.vectorModelEnabled &&
              vmState.hasVectorCapability() &&
              shouldAutoVectorizeMobile(format)
            ) {
              const sourceBytes = await platform.readFile(filePath);
              const base64 = bytesToBase64(sourceBytes);
              const mimeTypes: Record<string, string> = {
                epub: "application/epub+zip",
                pdf: "application/pdf",
                mobi: "application/x-mobipocket-ebook",
                azw: "application/vnd.amazon.ebook",
                azw3: "application/vnd.amazon.ebook",
                cbz: "application/vnd.comicbook+zip",
                cbr: "application/vnd.comicbook+zip",
                fb2: "application/x-fictionbook+xml",
                fbz: "application/x-zip-compressed-fb2",
                txt: "text/plain",
              };
              const mimeType = mimeTypes[format] || "application/epub+zip";
              queueAutoVectorize(book, base64, mimeType);
            } else if (vmState.autoVectorizeOnImport && vmState.vectorModelEnabled) {
              console.warn(
                `[importBooks] Skip auto-vectorize for unsupported mobile import: ${fileName} (${fileSize} bytes, format=${format})`,
              );
            }
          } catch (autoVectorizeErr) {
            console.warn(
              `[importBooks] Auto-vectorize enqueue failed for ${fileName}:`,
              autoVectorizeErr,
            );
          }
        } catch (err) {
          console.error(`Failed to import ${fileInfo.uri}:`, err);
          result.failures.push({
            name: originalName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      set({ isImporting: false });
    }
    return result;
  },

  inspectDeletedBookCandidate: async (bookId, file) =>
    inspectDeletedMobileBookCandidate(bookId, file),

  reimportDeletedBook: async (bookId, file) => {
    const restoredBook = await restoreDeletedMobileBook(bookId, file);
    if (!restoredBook) return null;

    set((state) => {
      const exists = state.books.some((book) => book.id === restoredBook.id);
      return {
        books: exists
          ? state.books.map((book) => (book.id === restoredBook.id ? restoredBook : book))
          : [...state.books, restoredBook],
      };
    });

    try {
      await db.updateBook(restoredBook.id, {
        filePath: restoredBook.filePath,
        format: restoredBook.format,
        meta: restoredBook.meta,
        deletedAt: undefined,
        progress: restoredBook.progress,
        currentCfi: restoredBook.currentCfi,
        isVectorized: false,
        vectorizeProgress: 0,
        tags: restoredBook.tags,
        fileHash: restoredBook.fileHash,
        syncStatus: "local",
        lastOpenedAt: restoredBook.lastOpenedAt,
      });
      debouncedSave("library-books", get().books);
    } catch (err) {
      console.error("Failed to restore deleted book from database:", err);
      return null;
    }

    return restoredBook;
  },

  setActiveTag: (tag) => set({ activeTag: tag, activeGroupId: "" }),

  addTag: (tag) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    set((state) => {
      if (state.allTags.includes(trimmed)) return state;
      const allTags = [...state.allTags, trimmed].sort();
      debouncedSave("library-tags", allTags);
      return { allTags };
    });
  },

  addGroup: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = get().groups.find((group) => group.name === trimmed);
    if (existing) return existing;

    try {
      await db.initDatabase();
      const group = await db.insertGroup({
        name: trimmed,
        sortOrder: get().groups.length,
      });
      const groups = [...get().groups, group].sort((a, b) => a.sortOrder - b.sortOrder);
      set({ groups });
      debouncedSave("library-groups", groups);
      return group;
    } catch (err) {
      console.error("Failed to create group:", err);
      return null;
    }
  },

  renameGroup: (groupId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      const groups = state.groups.map((group) =>
        group.id === groupId ? { ...group, name: trimmed, updatedAt: Date.now() } : group,
      );
      debouncedSave("library-groups", groups);
      return { groups };
    });
    db.updateGroup(groupId, { name: trimmed }).catch((err) =>
      console.error("Failed to rename group:", err),
    );
  },

  removeGroup: async (groupId) => {
    set((state) => {
      const groups = state.groups.filter((group) => group.id !== groupId);
      const books = state.books.map((book) =>
        book.groupId === groupId ? { ...book, groupId: undefined } : book,
      );
      debouncedSave("library-groups", groups);
      debouncedSave("library-books", books);
      return {
        groups,
        books,
        activeGroupId: state.activeGroupId === groupId ? "" : state.activeGroupId,
        isGroupView: state.activeGroupId === groupId ? true : state.isGroupView,
      };
    });
    try {
      await db.deleteGroup(groupId);
      const [books, groups] = await Promise.all([db.getBooks(), db.getGroups()]);
      set((state) => ({
        books,
        groups,
        activeGroupId: keepActiveGroupId(state.activeGroupId, groups),
      }));
      debouncedSave("library-groups", groups);
      debouncedSave("library-books", books);
    } catch (err) {
      console.error("Failed to delete group:", err);
    }
  },

  moveBookToGroup: (bookId, groupId) => {
    get().moveBooksToGroup([bookId], groupId);
  },

  moveBooksToGroup: (bookIds, groupId) => {
    const targetIds = new Set(bookIds);
    set((state) => {
      const books = state.books.map((book) =>
        targetIds.has(book.id) ? { ...book, groupId } : book,
      );
      debouncedSave("library-books", books);
      return { books };
    });
    for (const bookId of bookIds) {
      db.updateBook(bookId, { groupId }).catch((err) =>
        console.error("Failed to move book to group:", err),
      );
    }
  },

  removeBookFromGroup: (bookId) => {
    get().moveBookToGroup(bookId, undefined);
  },

  removeTag: (tag) => {
    set((state) => {
      const allTags = state.allTags.filter((t) => t !== tag);
      const books = state.books.map((b) =>
        b.tags.includes(tag) ? { ...b, tags: b.tags.filter((t) => t !== tag) } : b,
      );
      debouncedSave("library-tags", allTags);
      debouncedSave("library-books", books);
      return { allTags, books, activeTag: state.activeTag === tag ? "" : state.activeTag };
    });
    const books = get().books;
    for (const b of books) {
      db.updateBook(b.id, { tags: b.tags }).catch((err) =>
        console.warn("[Library] Failed to update book tags:", err),
      );
    }
  },

  renameTag: (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    set((state) => {
      const allTags = state.allTags.map((t) => (t === oldName ? trimmed : t)).sort();
      const books = state.books.map((b) =>
        b.tags.includes(oldName)
          ? { ...b, tags: b.tags.map((t) => (t === oldName ? trimmed : t)) }
          : b,
      );
      debouncedSave("library-tags", allTags);
      debouncedSave("library-books", books);
      return { allTags, books, activeTag: state.activeTag === oldName ? trimmed : state.activeTag };
    });
    for (const b of get().books) {
      if (b.tags.includes(trimmed)) {
        db.updateBook(b.id, { tags: b.tags }).catch((err) =>
          console.warn("[Library] Failed to update book tags:", err),
        );
      }
    }
  },

  addTagToBook: (bookId, tag) => {
    set((state) => {
      const books = state.books.map((b) =>
        b.id === bookId && !b.tags.includes(tag) ? { ...b, tags: [...b.tags, tag] } : b,
      );
      const allTags = state.allTags.includes(tag) ? state.allTags : [...state.allTags, tag].sort();
      debouncedSave("library-books", books);
      debouncedSave("library-tags", allTags);
      return { books, allTags };
    });
    const book = get().books.find((b) => b.id === bookId);
    if (book) db.updateBook(bookId, { tags: book.tags }).catch(() => {});
  },

  removeTagFromBook: (bookId, tag) => {
    set((state) => {
      const books = state.books.map((b) =>
        b.id === bookId ? { ...b, tags: b.tags.filter((t) => t !== tag) } : b,
      );
      debouncedSave("library-books", books);
      return { books };
    });
    const book = get().books.find((b) => b.id === bookId);
    if (book) db.updateBook(bookId, { tags: book.tags }).catch(() => {});
  },
}));
