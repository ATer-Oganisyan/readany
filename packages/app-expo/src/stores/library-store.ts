import { isLegacyGeneratedBookCover } from "@/lib/book/cover-display";
import { deleteLocalCoverJob, getLocalCoverJob } from "@/lib/book/cover-job-repository";
import { persistCoverFile, verifyCoverPersistence } from "@/lib/book/cover-persistence";
import { acknowledgeGeneratedBookCover, generateBookCover } from "@/lib/book/generate-book-cover";
import {
  generateBookIdentityWithGemini,
  isSuspiciousBookTitle,
  isTechnicalBookTitle,
} from "@/lib/book/generate-book-title";
import { bookImportFormat, importFileName } from "@/lib/book/import-format";
import {
  createRangeReadableFile,
  extractBookMetadata,
  extractBookMetadataFromFile,
  validateBookImportSource,
} from "@/lib/book/metadata-extractor";
import {
  type ReadingProgressCheckpoint,
  acknowledgeReadingProgress,
  getReadingProgressCheckpoint,
  preserveReadingProgressCheckpoint,
  restoreReadingProgress,
  withReadingProgressCheckpoint,
} from "@/lib/book/reading-progress-checkpoint";
import { ensureTxtUtf8Bytes } from "@/lib/book/txt-encoding";
import { shouldRefreshBundledCatalogCover } from "@/lib/catalog/bundled-book-definitions";
import {
  findBundledCatalogBookByTitle,
  installBundledCatalogCover,
} from "@/lib/catalog/bundled-books";
import {
  preserveBackendOriginalSource,
  startImportedBackendBook,
} from "@/lib/narra/backend-book-sync";
import { trySha256BackendFile } from "@/lib/narra/backend-file-hash";
import { normalizeBookLanguage } from "@/lib/narra/book-language";
import { BANNED_IMPORT_MESSAGE, findBannedImport } from "@/lib/narra/import-blocklist";
import { queueBook as queueAutoVectorize } from "@/lib/rag/auto-vectorize-service";
import {
  type ImportBooksResult,
  createEmptyImportBooksResult,
  createImportDuplicateIndex,
  findDuplicateBookByHash,
} from "@readany/core";
import * as db from "@readany/core/db/database";
import { runWithDbRetry } from "@readany/core/db/write-retry";
import {
  BookImportError,
  type BookImportFailureCode,
  getBookImportFailureCode,
} from "@readany/core/import/import-errors";
import { getPlatformService } from "@readany/core/services";
import type {
  Book,
  BookGroup,
  BookUpdate,
  LibraryFilter,
  SortField,
  SortOrder,
} from "@readany/core/types";
import { generateId } from "@readany/core/utils";
import { AppState } from "react-native";
import { create } from "zustand";
import { useNarraStore } from "./narra-store";
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
  language?: string;
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
  updateBook: (bookId: string, updates: BookUpdate) => Promise<void>;
  checkpointReadingProgress: (
    bookId: string,
    position: { progress: number; currentCfi: string },
  ) => void;
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

  if (format === "fbz" || format === "mobi" || format === "azw" || format === "azw3") {
    // FB2 archives use the bounded directory/entry reader too; routing them to
    // the filename fallback silently discarded the parsed title and author.
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

async function validateMobileImportFile(
  filePath: string,
  format: Book["format"],
  size: number,
): Promise<void> {
  if (format === "txt" || format === "umd") return;
  await validateBookImportSource(await createRangeReadableFile(filePath, size), format);
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
let backendImportResumeSubscription: (() => void) | undefined;
let importQueue: Promise<void> = Promise.resolve();
let pendingImports = 0;
const activeImportTargets = new Map<string, { removed: boolean }>();
// Invocation-scoped invalidation includes imports waiting for the serial queue.
// Entries disappear when that invocation settles, rather than retaining tombstones forever.
const importRemovalScopes = new Set<Map<string, Book | undefined>>();
const activeImportWrites = new Map<string, Promise<void>>();
interface PendingBookRemoval {
  book: Book | undefined;
  done: Promise<void>;
  invalidate: () => void;
  failed: boolean;
  error?: unknown;
}
const pendingBookRemovals = new Map<string, PendingBookRemoval>();
const activeBookReloads = new Set<Set<string>>();

function invalidateBookReloads(bookId: string): void {
  for (const scope of activeBookReloads) scope.add(bookId);
}

function reconcileDeletedBookReload(
  snapshot: Book[],
  invalidated: Set<string>,
  current: Book[],
): Book[] {
  const books = snapshot.filter(
    (book) => !invalidated.has(book.id) && !pendingBookRemovals.has(book.id),
  );
  // A newer explicit restore wins over both an old row and an old deletion.
  for (const book of current) {
    if (invalidated.has(book.id) && !pendingBookRemovals.has(book.id)) books.push(book);
  }
  return books;
}

async function waitForPendingBookRemoval(bookId: string): Promise<void> {
  // Removal only waits for the DB write, never for this import continuation.
  // A failed delete rolls back its invalidation before releasing this signal.
  let removal = pendingBookRemovals.get(bookId);
  while (removal) {
    await removal.done;
    removal = pendingBookRemovals.get(bookId);
  }
}

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
    // Imported books always get a durable cover job, including books imported
    // before the enqueue regression was fixed. Catalog metadata never launches generation.
    if (book.sourceKind === "catalog") continue;

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

function resumeInterruptedBackendImports(books: Book[]): void {
  const resume = (): boolean => {
    const narra = useNarraStore.getState();
    if (!narra._hasHydrated) return false;
    const resumedSources = new Set<string>();
    for (const book of [...books].sort((a, b) => b.addedAt - a.addedAt)) {
      const backendBook = narra.books[book.id];
      const binding = backendBook?.backendBinding;
      if (binding?.resolution !== "private") continue;
      // A source upload and the markup job are separate stages. Keep polling
      // after a relaunch when the bytes are already stored but the manifest
      // has not reached its terminal ready state yet.
      if (binding.sourceUploaded && backendBook.backendManifest?.availability === "ready") continue;
      const sourceKey = binding.contentSha256 || binding.bookEditionId;
      if (resumedSources.has(sourceKey)) continue;
      resumedSources.add(sourceKey);
      startImportedBackendBook(book);
    }
    return true;
  };

  if (resume() || backendImportResumeSubscription) return;
  backendImportResumeSubscription = useNarraStore.subscribe((state) => {
    if (!state._hasHydrated) return;
    backendImportResumeSubscription?.();
    backendImportResumeSubscription = undefined;
    resume();
  });
}

async function repairImportedBookMetadata(books: Book[]): Promise<void> {
  resumeInterruptedBackendImports(books);
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
  return ensureTxtUtf8Bytes(bytes, PolyfillTextDecoder);
}

async function removeImportArtifacts(relativePaths: Array<string | undefined>): Promise<void> {
  const platform = getPlatformService();
  for (const relativePath of relativePaths) {
    if (!relativePath) continue;
    try {
      await platform.deleteFile(await resolveAppPath(relativePath));
    } catch (error) {
      console.warn("[importBooks] Failed to remove blocked import artifact:", relativePath, error);
    }
  }
}

/**
 * L0-модерация по метаданным: проверяется и новая книга, и повторный импорт
 * (восстановление удалённой, обновление дубля). Файлы, записанные текущей
 * итерацией импорта, стираются — запрещённый материал не остаётся на
 * устройстве. Файлы живой существующей книги не трогаем.
 */
async function assertImportNotBanned(
  book: Book,
  fileName: string,
  importTarget: { deletedAt?: number | null } | null,
  createdRelativePaths: Array<string | undefined>,
): Promise<void> {
  if (!findBannedImport(book.meta?.title, book.meta?.author, fileName)) return;
  if (!importTarget || importTarget.deletedAt) {
    await removeImportArtifacts(createdRelativePaths);
  }
  throw new BookImportError("CONTENT_BLOCKED", BANNED_IMPORT_MESSAGE);
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

async function persistBookUpdate(bookId: string, updates: BookUpdate): Promise<void> {
  await runWithDbRetry(() => db.updateBook(bookId, updates));
}

function acknowledgeSavedProgress(bookId: string, checkpoint: ReadingProgressCheckpoint): void {
  const books = useLibraryStore.getState().books;
  const next = books.map((book) =>
    book.id === bookId ? acknowledgeReadingProgress(book, checkpoint) : book,
  );
  if (next.every((book, index) => book === books[index])) return;
  useLibraryStore.setState({ books: next });
  debouncedSave("library-books", next);
}

async function restoreDeletedMobileBook(
  bookId: string,
  fileInfo: { uri: string; name?: string },
  createdPaths: string[],
): Promise<Book | null> {
  await db.initDatabase();
  const originalBook = await db.getBook(bookId, { includeDeleted: true });
  if (!originalBook) return null;

  const filePath = fileInfo.uri;
  const originalName = importFileName(fileInfo);
  const ext = originalName.split(".").pop()?.toLowerCase();
  const format = bookImportFormat(originalName);
  const fileName = originalName;
  const platform = getPlatformService();
  const { size: fileSize, md5 } = await getMobileFileStat(filePath);
  if (!fileSize) throw new Error("Файл книги пуст или недоступен. Выберите его ещё раз.");
  await validateMobileImportFile(filePath, format, fileSize);
  const fileHash = md5 || (await trySha256BackendFile(filePath));
  const artifactId = `${bookId}-${generateId()}`;

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
    const relativePath = `books/${artifactId}.epub`;
    createdPaths.push(relativePath);
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
    const relativePath = `books/${artifactId}.epub`;
    createdPaths.push(relativePath);
    await platform.writeFile(await resolveAppPath(relativePath), conversion.epubBytes);

    let coverUrl = originalBook.meta.coverUrl;
    if (conversion.coverBytes && conversion.coverBytes.length > 0) {
      try {
        await ensureAppSubDir("covers");
        const coverRelPath = `covers/${artifactId}-original.jpg`;
        createdPaths.push(coverRelPath);
        await platform.writeFile(await resolveAppPath(coverRelPath), conversion.coverBytes);
        coverUrl = coverRelPath;
      } catch (coverErr) {
        console.warn(`[restoreDeletedMobileBook] UMD cover save failed: ${coverErr}`);
      }
    }

    return {
      ...originalBook,
      filePath: relativePath,
      format: "epub",
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

  createdPaths.push(`books/${artifactId}.${ext}`);
  const { relativePath } = await copyBookToAppData(artifactId, ext || "epub", filePath);

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
      const coverRelPath = `covers/${artifactId}-original.${coverExt}`;
      createdPaths.push(coverRelPath);
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
  const originalName = importFileName(fileInfo);
  const ext = originalName.split(".").pop()?.toLowerCase();
  const format = bookImportFormat(originalName);
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
    const invalidated = new Set<string>();
    activeBookReloads.add(invalidated);
    try {
      const computeTags = (books: Book[]) => {
        const tagSet = new Set<string>();
        for (const b of books) for (const t of b.tags) tagSet.add(t);
        return [...tagSet].sort();
      };

      try {
        const cachedSnapshot = await loadFromFS<Book[]>("library-books");
        const cachedGroups = await loadFromFS<BookGroup[]>("library-groups");
        const cached =
          cachedSnapshot && reconcileDeletedBookReload(cachedSnapshot, invalidated, get().books);
        if (!get().isLoaded && cached && cached.length > 0) {
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
        const atQuery = new Map(
          get().books.map((book) => [book.id, getReadingProgressCheckpoint(book)]),
        );
        const [databaseBooks, groups] = await Promise.all([db.getBooks(), db.getGroups()]);

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

        const visibleDatabaseBooks = reconcileDeletedBookReload(
          databaseBooks,
          invalidated,
          get().books,
        );
        const dbTags = computeTags(visibleDatabaseBooks);

        // Merge: dbTags (from books) + empty tags from FS (not in dbTags and not deleted)
        const dbTagSet = new Set(dbTags);
        const emptyTags = savedTags.filter((t) => !dbTagSet.has(t) && !deletedSet.has(t));
        const allTags = [...dbTags, ...emptyTags].sort();

        // Reading can start from the JSON cache before SQLite finishes loading.
        // Use current state, not the cache snapshot from before the awaits.
        const currentBooks = new Map(get().books.map((book) => [book.id, book]));
        const restored = visibleDatabaseBooks.map((book) => {
          const current = currentBooks.get(book.id);
          return restoreReadingProgress(
            book,
            current,
            getReadingProgressCheckpoint(current) !== atQuery.get(book.id),
          );
        });
        const books = restored.map((result) => result.book);

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
        for (const { book, repair } of restored) {
          if (!repair) continue;
          // Do not hold the local reader behind sync/SQLite retries.
          void persistBookUpdate(book.id, {
            progress: repair.progress,
            currentCfi: repair.currentCfi,
          })
            .then(() => acknowledgeSavedProgress(book.id, repair))
            .catch((error) => {
              console.warn("[Library] Reading checkpoint remains pending:", error);
            });
        }
        watchCoverRecovery();
        void repairImportedBookMetadata(books);
      } catch (err) {
        console.error("Failed to load books from database:", err);
        set({ isLoaded: true });
      }
    } finally {
      activeBookReloads.delete(invalidated);
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
    await db.initDatabase();
    await runWithDbRetry(() => db.insertBook(book));
    set((state) => ({ books: [...state.books, book] }));
    debouncedSave("library-books", get().books);
  },

  removeBook: async (bookId, options = {}) => {
    const previousRemoval = pendingBookRemovals.get(bookId);
    if (previousRemoval) {
      previousRemoval.invalidate();
      await previousRemoval.done;
      if (previousRemoval.failed) throw previousRemoval.error;
      return;
    }
    const bookToRemove = get().books.find((b) => b.id === bookId);
    const priorScopes = new Map<Map<string, Book | undefined>, { had: boolean; book?: Book }>();
    const priorTargets = new Map<{ removed: boolean }, boolean>();
    const invalidate = () => {
      invalidateBookReloads(bookId);
      for (const scope of importRemovalScopes) {
        if (!priorScopes.has(scope))
          priorScopes.set(scope, { had: scope.has(bookId), book: scope.get(bookId) });
        scope.set(bookId, bookToRemove ?? scope.get(bookId));
      }
      const target = activeImportTargets.get(bookId);
      if (target) {
        if (!priorTargets.has(target)) priorTargets.set(target, target.removed);
        target.removed = true;
      }
    };
    invalidate();
    const preserveData = options.preserveData ?? false;
    const pendingWrite = activeImportWrites.get(bookId);
    let finishRemoval!: () => void;
    const done = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    const removal: PendingBookRemoval = { book: bookToRemove, done, invalidate, failed: false };
    pendingBookRemovals.set(bookId, removal);
    set((state) => ({ books: state.books.filter((b) => b.id !== bookId) }));
    try {
      // Only an already-started write to this book must settle before its DELETE.
      // Unrelated imports/conversions must not postpone the durable tombstone.
      await pendingWrite?.catch(() => {});
      try {
        await db.initDatabase();
        await db.deleteBook(bookId, { preserveData });
      } catch (err) {
        removal.failed = true;
        removal.error = err;
        // Preserve earlier successful deletion intents; undo only this failed one.
        for (const [scope, previous] of priorScopes) {
          if (!importRemovalScopes.has(scope)) continue;
          if (previous.had) scope.set(bookId, previous.book);
          else scope.delete(bookId);
        }
        for (const [target, previous] of priorTargets) target.removed = previous;
        if (bookToRemove) {
          set((state) => ({
            books: state.books.some((book) => book.id === bookId)
              ? state.books
              : [...state.books, bookToRemove],
          }));
          debouncedSave("library-books", get().books);
        }
        invalidateBookReloads(bookId);
        console.error("Failed to delete book from database:", err);
        throw err;
      }
      // A reload may have returned the pre-delete row while SQLite was busy.
      set((state) => ({ books: state.books.filter((book) => book.id !== bookId) }));
      invalidateBookReloads(bookId);
      try {
        await deleteLocalCoverJob(bookId);
      } catch (err) {
        // The durable deletion already succeeded; cleanup must not undo it in UI.
        console.warn("Failed to clean deleted book cover job:", err);
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
    } finally {
      pendingBookRemovals.delete(bookId);
      finishRemoval();
    }
  },

  checkpointReadingProgress: (bookId, position) => {
    if (
      !Number.isFinite(position.progress) ||
      position.progress < 0 ||
      position.progress > 1 ||
      !position.currentCfi ||
      position.currentCfi.length > 65_536
    )
      return;
    const current = get().books.find((book) => book.id === bookId);
    if (
      !current ||
      (current.progress === position.progress && current.currentCfi === position.currentCfi)
    )
      return;
    const updated = withReadingProgressCheckpoint({ ...current, ...position });
    const books = get().books.map((book) => (book.id === bookId ? updated : book));
    set({ books });
    // Page changes must reach the local journal before the five-second DB throttle.
    // The existing short debounce coalesces animation relocates; background flush
    // still commits immediately. No DB work runs on this interaction path.
    debouncedSave("library-books", books);
  },

  updateBook: async (bookId, updates) => {
    set((state) => ({
      books: state.books.map((b) => {
        if (b.id !== bookId) return b;
        const book = {
          ...b,
          ...updates,
          meta: updates.meta ? { ...b.meta, ...updates.meta } : b.meta,
        };
        return updates.progress !== undefined || updates.currentCfi !== undefined
          ? withReadingProgressCheckpoint(book)
          : book;
      }),
      allTags:
        updates.tags !== undefined
          ? Array.from(new Set([...state.allTags, ...updates.tags])).sort()
          : state.allTags,
    }));
    const checkpoint =
      updates.progress !== undefined || updates.currentCfi !== undefined
        ? getReadingProgressCheckpoint(get().books.find((book) => book.id === bookId))
        : undefined;
    debouncedSave("library-books", get().books);
    try {
      await persistBookUpdate(
        bookId,
        checkpoint
          ? { ...updates, progress: checkpoint.progress, currentCfi: checkpoint.currentCfi }
          : updates,
      );
      if (checkpoint) acknowledgeSavedProgress(bookId, checkpoint);
    } catch (err) {
      console.error("Failed to update book in database:", err);
    }
  },

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSortField: (field) => set((state) => ({ filter: { ...state.filter, sortField: field } })),
  setSortOrder: (order) => set((state) => ({ filter: { ...state.filter, sortOrder: order } })),

  importBooks: async (files) => {
    const booksAtImportStart = get().books;
    const duplicateIndex = createImportDuplicateIndex(booksAtImportStart);
    const removedDuringImport = new Map<string, Book | undefined>();
    importRemovalScopes.add(removedDuringImport);
    const previousImport = importQueue;
    let releaseImport!: () => void;
    importQueue = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    pendingImports++;
    set({ isImporting: true });
    await previousImport;
    const result = createEmptyImportBooksResult();
    try {
      try {
        await db.initDatabase();
      } catch (cause) {
        throw new BookImportError("STORAGE_FAILED", "Import database unavailable", { cause });
      }
      for (const fileInfo of files) {
        const filePath = fileInfo.uri;
        const knownBook = fileInfo.knownBook;
        const originalName = importFileName(fileInfo);
        const createdPaths: string[] = [];
        let committed = false;
        let failureCode: BookImportFailureCode = "UNKNOWN";
        let targetScope: { removed: boolean } | undefined;
        let targetId: string | undefined;
        try {
          // L0-модерация: запрещённые в РФ материалы не импортируются вовсе.
          if (findBannedImport(undefined, undefined, originalName)) {
            result.failures.push({
              name: originalName,
              error: BANNED_IMPORT_MESSAGE,
              code: "CONTENT_BLOCKED",
            });
            continue;
          }
          const ext = originalName.split(".").pop()?.toLowerCase();
          const format = bookImportFormat(originalName);
          const fileName = originalName;
          const platform = getPlatformService();
          failureCode = "SOURCE_UNAVAILABLE";
          const { size: fileSize, md5 } = await getMobileFileStat(filePath);
          if (!fileSize)
            throw new BookImportError("EMPTY_SOURCE", "Book source is empty or unavailable");
          await validateMobileImportFile(filePath, format, fileSize);
          failureCode = "UNKNOWN";
          // MD5 is unavailable for some iOS document-provider URLs. Try the
          // backend SHA-256 identity, but never block import if that provider
          // does not expose the temporary URL to the hashing module.
          const fileHash = md5 || (await trySha256BackendFile(filePath));
          const matchesKnownBook = (candidate: Book) =>
            Boolean(
              knownBook &&
                !candidate.deletedAt &&
                candidate.sourceKind === knownBook.sourceKind &&
                candidate.bookEditionId === knownBook.bookEditionId &&
                (candidate.syncStatus !== "local" ||
                  candidate.revisionId === knownBook.revisionId ||
                  candidate.contentHash === knownBook.contentHash),
            );
          if (
            [...removedDuringImport.values()].some(
              (book) =>
                book && ((fileHash && book.fileHash === fileHash) || matchesKnownBook(book)),
            )
          ) {
            throw new BookImportError(
              "SOURCE_UNAVAILABLE",
              "Book was removed while import was pending",
            );
          }
          const initialTarget =
            booksAtImportStart.find(matchesKnownBook) ??
            findDuplicateBookByHash(duplicateIndex, fileHash);

          // A later explicit import may restore a deleted book, but must wait
          // for that book's deletion, not race its tombstone/file cleanup.
          for (const removal of pendingBookRemovals.values()) {
            if (
              (fileHash && removal.book?.fileHash === fileHash) ||
              (knownBook && removal.book?.bookEditionId === knownBook.bookEditionId)
            ) {
              await removal.done;
            }
          }
          if (
            initialTarget &&
            !get().books.some((book) => book.id === initialTarget.id && !book.deletedAt)
          ) {
            throw new BookImportError(
              "SOURCE_UNAVAILABLE",
              "Book was removed while import was pending",
            );
          }
          const existingDuplicate = findDuplicateBookByHash(
            createImportDuplicateIndex(get().books),
            fileHash,
          );
          const existingKnownBook = get().books.find(matchesKnownBook);
          const observedActiveTarget = existingKnownBook ?? existingDuplicate;
          const deletedMatch = fileHash
            ? await db.getDeletedBookByFileHash(fileHash).catch((err) => {
                console.warn("[Library] Failed to check deleted book by hash:", err);
                return null;
              })
            : null;
          // Reimporting the same local file refreshes the existing book instead
          // of failing as a duplicate or adding a second library row.
          const importTarget = existingKnownBook ?? deletedMatch ?? existingDuplicate ?? null;
          const bookId = importTarget?.id ?? generateId();
          targetId = importTarget?.id;
          if (targetId) {
            targetScope = { removed: false };
            activeImportTargets.set(targetId, targetScope);
          }
          const assertTargetPresent = () => {
            if (
              targetScope?.removed ||
              (targetId && removedDuringImport.has(targetId)) ||
              (targetId &&
                (initialTarget?.id === targetId || observedActiveTarget?.id === targetId) &&
                !get().books.some((book) => book.id === targetId && !book.deletedAt))
            ) {
              throw new BookImportError(
                "SOURCE_UNAVAILABLE",
                "Book was removed while import was pending",
              );
            }
          };
          assertTargetPresent();
          // Each attempt owns fresh paths. Existing reader files remain valid
          // until the new bytes and metadata have both been saved successfully.
          const artifactId = importTarget ? `${bookId}-${generateId()}` : bookId;
          const preservedSourcePath =
            !knownBook && ext === "txt"
              ? `narra-backend-sources/${encodeURIComponent(artifactId)}.${ext}`
              : undefined;
          let preparedOriginal:
            | Awaited<ReturnType<typeof preserveBackendOriginalSource>>
            | undefined;
          if (preservedSourcePath) {
            createdPaths.push(preservedSourcePath);
            try {
              preparedOriginal = await preserveBackendOriginalSource(bookId, filePath, ext ?? "", {
                artifactId,
                publish: false,
                sourceHash: fileHash,
              });
            } catch (error) {
              // The converted EPUB remains sufficient for reading and backend
              // analysis when the document provider cannot preserve its source.
              console.warn(
                "[importBooks] Original source unavailable; using converted EPUB:",
                error,
              );
            }
          }
          const commitBook = async (book: Book) => {
            assertTargetPresent();
            failureCode = "STORAGE_FAILED";
            if (!knownBook && existingDuplicate?.id === book.id) {
              const current = get().books.find((candidate) => candidate.id === book.id);
              if (current && current.fileHash === fileHash) {
                // Re-reading identical bytes may repair an earlier charset bug,
                // but must not discard a reader's valid custom title/author.
                for (const key of ["title", "author"] as const) {
                  const value = current.meta[key];
                  if (value?.trim() && !value.includes("\ufffd")) book.meta[key] = value;
                }
              }
            }
            if (importTarget) {
              const {
                progress,
                currentCfi,
                nativeLocator,
                totalCharacters,
                tags,
                groupId,
                lastOpenedAt,
                ...updates
              } = book;
              // Reading and organization may change while the provider copies
              // bytes. Import updates only its own fields in the persisted row.
              const write = persistBookUpdate(book.id, { ...updates, deletedAt: undefined });
              activeImportWrites.set(book.id, write);
              try {
                await write;
              } finally {
                if (activeImportWrites.get(book.id) === write) activeImportWrites.delete(book.id);
              }
              await waitForPendingBookRemoval(book.id);
              assertTargetPresent();
              const current = get().books.find((candidate) => candidate.id === book.id);
              if (current)
                Object.assign(book, {
                  progress: current.progress,
                  currentCfi: current.currentCfi,
                  nativeLocator: current.nativeLocator,
                  totalCharacters: current.totalCharacters,
                  tags: current.tags,
                  groupId: current.groupId,
                  lastOpenedAt: current.lastOpenedAt,
                });
              if (current) Object.assign(book, preserveReadingProgressCheckpoint(book, current));
              set((state) => ({
                books: state.books.some((candidate) => candidate.id === book.id)
                  ? state.books.map((candidate) => (candidate.id === book.id ? book : candidate))
                  : [...state.books, book],
              }));
              debouncedSave("library-books", get().books);
            } else {
              await get().addBook(book);
            }
            committed = true;
            failureCode = "UNKNOWN";
            if (preparedOriginal)
              useNarraStore.getState().setBackendOriginalSource(book.id, preparedOriginal);
            // Keep imported inclusive for catalog callers, but distinguish a
            // refreshed active record from a new/restored library entry in UI.
            if (importTarget && !importTarget.deletedAt)
              result.refreshedCount = (result.refreshedCount ?? 0) + 1;
          };
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

          console.log(`[importBooks] Importing: name=${fileName}, format=${format}`);

          // For TXT files: convert to EPUB bytes directly, skip Blob/File (slow in RN)
          if (ext === "txt") {
            const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
            failureCode = "SOURCE_UNAVAILABLE";
            const sourceBytes = await platform.readFile(filePath);
            failureCode = "CORRUPT_SOURCE";

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

            // Use convertToBytes: pure-JS ZIP builder, no Blob bridge
            const converter = new TxtToEpubConverter();
            const conversion = await converter.convertToBytes({ file: txtFile });

            // Write EPUB bytes directly to final app data location
            failureCode = "STORAGE_FAILED";
            await ensureAppSubDir("books");
            const relativePath = `books/${artifactId}.epub`;
            createdPaths.push(relativePath);
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
              ...importTarget,
              deletedAt: undefined,
              id: bookId,
              filePath: relativePath,
              format: "epub",
              meta: {
                ...(importTarget?.meta ?? {}),
                title,
                author: knownBook?.author || importTarget?.meta.author || "",
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

            await assertImportNotBanned(book, fileName, importTarget, [
              relativePath,
              preservedSourcePath,
            ]);

            await commitBook(book);
            result.imported.push(book);
            if (!knownBook) {
              startImportedBackendBook(book);
              void queueGeneratedBookCover(book);
            }

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
          }

          // For UMD files: parse + convert to EPUB bytes inline (Chinese mobile ebook format)
          if (ext === "umd") {
            const [{ UmdToEpubConverter }, pakoMod] = await Promise.all([
              import("@readany/core/utils/umd-to-epub"),
              import("pako"),
            ]);
            const pako = pakoMod.default || pakoMod;
            failureCode = "SOURCE_UNAVAILABLE";
            const sourceBytes = await platform.readFile(filePath);
            failureCode = "CORRUPT_SOURCE";

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

            failureCode = "STORAGE_FAILED";
            await ensureAppSubDir("books");
            const relativePath = `books/${artifactId}.epub`;
            createdPaths.push(relativePath);
            const absPath = await resolveAppPath(relativePath);
            await platform.writeFile(absPath, conversion.epubBytes);

            let coverUrl: string | undefined;
            if (conversion.coverBytes && conversion.coverBytes.length > 0) {
              try {
                await ensureAppSubDir("covers");
                const coverRelPath = `covers/${artifactId}-original.jpg`;
                createdPaths.push(coverRelPath);
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
              ...importTarget,
              deletedAt: undefined,
              id: bookId,
              filePath: relativePath,
              format: "epub",
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

            await assertImportNotBanned(book, fileName, importTarget, [
              relativePath,
              coverUrl,
              preservedSourcePath,
            ]);

            await commitBook(book);
            result.imported.push(book);
            if (!knownBook) {
              startImportedBackendBook(book);
              void queueGeneratedBookCover(book);
            }
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
          }

          let relativePath: string | undefined;
          if (importTarget?.filePath && fileHash) {
            const existingPath = isRelativeAppPath(importTarget.filePath)
              ? await resolveAppPath(importTarget.filePath)
              : importTarget.filePath;
            // Reuse verified identical bytes. A damaged/missing local file still
            // gets replaced from the selected source, without touching it early.
            if (
              (await getMobileFileStat(existingPath).catch(() => ({ size: 0 }))).size > 0 &&
              (await trySha256BackendFile(existingPath)) === fileHash
            ) {
              relativePath = importTarget.filePath;
            }
          }
          if (!relativePath) {
            failureCode = "STORAGE_FAILED";
            createdPaths.push(`books/${artifactId}.${ext}`);
            relativePath = (await copyBookToAppData(artifactId, ext || "epub", filePath))
              .relativePath;
            failureCode = "UNKNOWN";
          }
          console.log(`[importBooks] File copied. relativePath: ${relativePath}`);

          // Extract metadata (title, author, cover) from book content
          let title = knownBook?.title || fileName.replace(/\.\w+$/i, "") || "Untitled";
          let author = knownBook?.author || "";
          let language = normalizeBookLanguage(knownBook?.language);
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
              language = normalizeBookLanguage(meta.language);
              coverContext = {
                description: meta.description,
                textSample: meta.textSample,
                subjects: meta.subjects,
              };

              // Save cover image to app data
              if (meta.coverBytes && meta.coverBytes.length > 0) {
                try {
                  const mimeType = meta.coverMimeType || "image/jpeg";
                  const coverExt = mimeType.includes("png") ? "png" : "jpg";
                  await ensureAppSubDir("covers");
                  const coverRelPath = `covers/${artifactId}-original.${coverExt}`;
                  createdPaths.push(coverRelPath);
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
            ...importTarget,
            deletedAt: undefined,
            id: bookId,
            filePath: relativePath,
            format,
            meta: {
              ...(importTarget?.meta ?? {}),
              title,
              author,
              language: language ?? importTarget?.meta.language,
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
          await assertImportNotBanned(book, fileName, importTarget, createdPaths);
          await commitBook(book);
          result.imported.push(book);
          if (!knownBook) {
            startImportedBackendBook(book);
            void queueGeneratedBookCover(book, coverContext);
            if (shouldGenerateIdentity || isSuspiciousBookTitle(title, fileName)) {
              void repairSuspiciousBookTitles([book]);
            }
          }

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
          if (!committed) await removeImportArtifacts(createdPaths);
          const code = getBookImportFailureCode(err) ?? failureCode;
          const filename = originalName.replace(/\\/g, "/").split("/").pop();
          if (
            code === "UNSUPPORTED_FORMAT" ||
            code === "EMPTY_SOURCE" ||
            code === "CORRUPT_SOURCE" ||
            code === "SOURCE_TOO_LARGE" ||
            code === "CONTENT_BLOCKED"
          ) {
            // Expected validation rejection is not an application crash/LogBox error.
            console.info("[importBooks] Source rejected:", { filename, code });
          } else {
            console.error("[importBooks] Import failed:", { filename, code }, err);
          }
          result.failures.push({
            name: originalName,
            error: err instanceof Error ? err.message : String(err),
            code,
          });
        } finally {
          if (targetId && activeImportTargets.get(targetId) === targetScope)
            activeImportTargets.delete(targetId);
        }
      }
    } finally {
      pendingImports--;
      importRemovalScopes.delete(removedDuringImport);
      set({ isImporting: pendingImports > 0 });
      releaseImport();
    }
    return result;
  },

  inspectDeletedBookCandidate: async (bookId, file) =>
    inspectDeletedMobileBookCandidate(bookId, file),

  reimportDeletedBook: async (bookId, file) => {
    const removedDuringImport = new Map<string, Book | undefined>();
    importRemovalScopes.add(removedDuringImport);
    const previousImport = importQueue;
    let releaseImport!: () => void;
    importQueue = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    pendingImports++;
    set({ isImporting: true });
    await previousImport;
    const createdPaths: string[] = [];
    const targetScope = { removed: false };
    try {
      const assertNotRemoved = () => {
        if (targetScope.removed || removedDuringImport.has(bookId))
          throw new BookImportError(
            "SOURCE_UNAVAILABLE",
            "Book was removed while import was pending",
          );
      };
      const removal = pendingBookRemovals.get(bookId);
      if (removal) await removal.done;
      assertNotRemoved();
      activeImportTargets.set(bookId, targetScope);
      const restoredBook = await restoreDeletedMobileBook(bookId, file, createdPaths);
      if (!restoredBook) return null;
      await assertImportNotBanned(restoredBook, importFileName(file), null, createdPaths);
      assertNotRemoved();
      const write = persistBookUpdate(restoredBook.id, restoredBook);
      activeImportWrites.set(bookId, write);
      try {
        await write;
      } finally {
        if (activeImportWrites.get(bookId) === write) activeImportWrites.delete(bookId);
      }
      await waitForPendingBookRemoval(bookId);
      assertNotRemoved();
      set((state) => ({
        books: state.books.some((book) => book.id === restoredBook.id)
          ? state.books.map((book) => (book.id === restoredBook.id ? restoredBook : book))
          : [...state.books, restoredBook],
      }));
      debouncedSave("library-books", get().books);
      return restoredBook;
    } catch (err) {
      await removeImportArtifacts(createdPaths);
      console.error("Failed to restore deleted book from database:", err);
      return null;
    } finally {
      if (activeImportTargets.get(bookId) === targetScope) activeImportTargets.delete(bookId);
      pendingImports--;
      importRemovalScopes.delete(removedDuringImport);
      set({ isImporting: pendingImports > 0 });
      releaseImport();
    }
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
