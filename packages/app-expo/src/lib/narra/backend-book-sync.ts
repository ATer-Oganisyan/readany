import { extractFbzSourceBytes } from "@/lib/book/metadata-extractor";
import { useLibraryStore } from "@/stores/library-store";
import { useNarraStore } from "@/stores/narra-store";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import { fromByteArray } from "base64-js";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";
import {
  BackendBookError,
  backendBookPath,
  backendBookRequest,
  backendJsonPost,
  postBackendAnalysisRetry,
  postBackendProgress,
} from "./backend-book-api";
import { supportsPrivateBookAnalysis } from "./backend-book-capabilities";
import {
  type BackendBookManifest,
  type BackendCharactersPreview,
  parseBackendBinding,
  parseBackendCharactersPreview,
  parseBackendManifest,
} from "./backend-book-contract";
import { BackendBookSession } from "./backend-book-session";
import { loadBackendCharacterMedia } from "./backend-character-media";
import { sha256BackendFile } from "./backend-file-hash";
import { normalizeBookLanguage } from "./book-language";

interface SyncStatus {
  manifest?: BackendBookManifest;
  preview?: BackendCharactersPreview;
  error?: string;
  identityError?: string;
  analysisRetrying?: boolean;
}
/** Provisional rows are deliberately never written to the persisted Narra store. */
export const useBackendBookStatus = create<{ books: Record<string, SyncStatus> }>(() => ({
  books: {},
}));
function status(bookId: string, update: Partial<SyncStatus>) {
  useBackendBookStatus.setState((state) => ({
    books: { ...state.books, [bookId]: { ...state.books[bookId], ...update } },
  }));
}

const sessions = new Map<string, { session: BackendBookSession; consumers: number }>();
const expiredEditions = new Set<string>();
const bindings = new Map<
  string,
  Promise<NonNullable<ReturnType<typeof useNarraStore.getState>["books"][string]["backendBinding"]>>
>();

function analysisSource(book: Book) {
  const saved = useNarraStore.getState().books[book.id]?.backendOriginalSource;
  // Older UMD imports retained raw UMD, although the reader already uses EPUB.
  const convertedUmd = book.format === "umd" && /\.epub$/i.test(book.filePath);
  const staleArchive =
    book.format === "fbz" &&
    saved?.format === "fb2" &&
    (saved.derivedFrom?.filePath !== book.filePath ||
      saved.derivedFrom?.contentHash !== (book.fileHash ?? book.contentHash));
  return { original: saved?.format === "umd" || staleArchive ? undefined : saved, convertedUmd };
}

function supportsBackendAnalysis(book: Book): boolean {
  const { original, convertedUmd } = analysisSource(book);
  const format = original?.format ?? (convertedUmd ? "epub" : book.format);
  return book.sourceKind === "catalog" || supportsPrivateBookAnalysis(format);
}

async function sourcePath(
  book: Book,
  original: ReturnType<typeof analysisSource>["original"] | null = analysisSource(book).original,
) {
  if (original) return `${FileSystem.documentDirectory}${original.path}`;
  const path = book.filePath;
  if (path.startsWith("/") || path.startsWith("file://")) return path;
  const platform = getPlatformService();
  return platform.joinPath(await platform.getAppDataDir(), path);
}

/** Keep original TXT bytes before conversion changes the file identity. */
export async function preserveBackendOriginalSource(
  bookId: string,
  source: string,
  format: string,
  options: { artifactId?: string; publish?: boolean; sourceHash?: string } = {},
) {
  const directory = `${FileSystem.documentDirectory}narra-backend-sources`;
  const hash =
    options.sourceHash && /^[a-f\d]{64}$/i.test(options.sourceHash)
      ? options.sourceHash
      : await sha256BackendFile(source);
  const path = `narra-backend-sources/${encodeURIComponent(options.artifactId ?? bookId)}.${format}`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.copyAsync({ from: source, to: `${FileSystem.documentDirectory}${path}` });
  const original = { path, format, hash };
  if (options.publish !== false)
    useNarraStore.getState().setBackendOriginalSource(bookId, original);
  return original;
}

const mimeTypes: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  txt: "text/plain",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/zip",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip",
  umd: "application/octet-stream",
};

async function bindBook(book: Book, signal: AbortSignal) {
  const store = useNarraStore.getState();
  let expectedBinding = store.books[book.id]?.backendBinding;
  let expectedHash = book.contentHash;
  const assertCurrent = () => {
    const current = useLibraryStore.getState().books.find((item) => item.id === book.id);
    if (signal.aborted || !current || current.deletedAt ||
      current.filePath !== book.filePath || current.fileHash !== book.fileHash ||
      current.contentHash !== expectedHash ||
      useNarraStore.getState().books[book.id]?.backendBinding !== expectedBinding)
      throw Object.assign(new Error("Book source replaced during binding"), { name: "StaleBookBindingError" });
  };
  assertCurrent();
  let { original, convertedUmd } = analysisSource(book);
  if (book.format === "fbz" && original?.format === "fb2") {
    const derived = new File(await sourcePath(book, original));
    // Persisted metadata can outlive the derived file. Recover from the retained
    // archive instead of retrying an unavailable FB2 forever.
    if (!derived.exists || derived.size === 0) original = undefined;
  }
  if ((original?.format ?? book.format) === "fbz") {
    // Explicit null bypasses stale persisted metadata when the cache was lost.
    const bytes = await extractFbzSourceBytes(new File(await sourcePath(book, original ?? null)));
    assertCurrent();
    const path = `narra-backend-sources/${Crypto.randomUUID()}.fb2`;
    const uri = `${FileSystem.documentDirectory}${path}`;
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}narra-backend-sources`, {
      intermediates: true,
    });
    try {
      await FileSystem.writeAsStringAsync(uri, fromByteArray(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      const hash = await sha256BackendFile(uri);
      assertCurrent();
      original = {
        path,
        hash,
        format: "fb2",
        derivedFrom: {
          filePath: book.filePath,
          contentHash: book.fileHash ?? book.contentHash,
        },
      };
      store.setBackendOriginalSource(book.id, original);
    } catch (error) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw error;
    }
  }
  const format = original?.format ?? (convertedUmd ? "epub" : book.format);
  const derivedArchive = book.format === "fbz" && original?.format === "fb2";
  let binding = store.books[book.id]?.backendBinding;
  if (derivedArchive && binding?.contentSha256 !== original?.hash) binding = undefined;
  if (binding && expiredEditions.has(binding.bookEditionId)) binding = undefined;
  // A cancelled upload can have reached the server without its response reaching
  // the client. Resolve again before repeating PUT for a retained uncertain binding.
  if (binding?.resolution === "private" && !binding.sourceUploaded) binding = undefined;
  if (!binding && book.sourceKind === "catalog") {
    if (!book.bookEditionId || !book.contentHash)
      throw new Error("Catalog book has no server identity");
    binding = {
      bookEditionId: book.bookEditionId,
      resolution: "catalog" as const,
      language: normalizeBookLanguage(book.meta.language),
      catalogKey: book.catalogKey,
      contentSha256: book.contentHash,
      sourceUploaded: true,
    };
  }
  if (!binding) {
    const path = await sourcePath(book, original ?? null);
    const hash =
      original?.hash ??
      (convertedUmd ? undefined : book.contentHash) ??
      (await sha256BackendFile(path));
    assertCurrent();
    // Persist once; subsequent resolve/open never hashes unchanged bytes again.
    if ((!book.contentHash || convertedUmd) && !derivedArchive) {
      expectedHash = hash;
      await useLibraryStore
        .getState()
        .updateBook(book.id, { contentHash: hash, ...(convertedUmd ? { format: "epub" } : {}) });
    }
    assertCurrent();
    let response = await backendBookRequest(
      "/v2/books/resolve",
      backendJsonPost({ source: "local", content_sha256: hash }, signal),
    );
    assertCurrent();
    if (response.resolution === "local_registration_required") {
      response = await backendBookRequest(
        "/v2/books/local",
        backendJsonPost(
          {
            content_sha256: hash,
            title: book.meta.title,
            author: book.meta.author,
            format,
            ...(normalizeBookLanguage(book.meta.language)
              ? { language: normalizeBookLanguage(book.meta.language) }
              : {}),
          },
          signal,
        ),
      );
    }
    binding = parseBackendBinding(response, hash);
  }
  assertCurrent();
  store.setBackendBinding(book.id, binding);
  expectedBinding = useNarraStore.getState().books[book.id]?.backendBinding;
  await applyBookLanguage(book.id, binding.language);
  assertCurrent();
  if (binding.resolution === "private" && !binding.sourceUploaded) {
    // Passing expo-file-system's File directly makes expo/fetch normalize the
    // Blob before it creates the native request. On iOS that conversion can
    // stall, leaving the private edition registered but with no source bytes.
    // Read the file explicitly so fetch receives an unambiguous binary body.
    const sourceFile = new File(await sourcePath(book, original ?? null));
    const sourceBytes = await sourceFile.bytes();
    assertCurrent();
    if (sourceBytes.byteLength === 0) throw new Error("Book source is empty");
    const response = await backendBookRequest(backendBookPath(binding.bookEditionId, "source"), {
      method: "PUT",
      headers: {
        "content-type": mimeTypes[format] ?? "application/octet-stream",
      },
      body: sourceBytes,
      signal,
    });
    assertCurrent();
    binding = {
      ...binding,
      sourceUploaded: true,
      expiresAt: typeof response.expires_at === "string" ? response.expires_at : binding.expiresAt,
    };
    store.setBackendBinding(book.id, binding);
    expectedBinding = useNarraStore.getState().books[book.id]?.backendBinding;
  }
  if (binding.resolution === "catalog" && book.sourceKind !== "catalog" && !derivedArchive) {
    await useLibraryStore.getState().updateBook(book.id, {
      sourceKind: "catalog",
      bookEditionId: binding.bookEditionId,
      catalogKey: binding.catalogKey,
      contentHash: binding.contentSha256,
      revisionId: binding.contentSha256,
    });
  }
  return binding;
}

async function applyBookLanguage(bookId: string, language: unknown) {
  const normalized = normalizeBookLanguage(language);
  const current = useLibraryStore.getState().books.find((item) => item.id === bookId);
  // Old/null responses must not erase a language read from the local file.
  if (normalized && current && !current.deletedAt && current.meta.language !== normalized)
    await useLibraryStore
      .getState()
      .updateBook(bookId, { meta: { ...current.meta, language: normalized } });
}

function createSession(book: Book, progress: number) {
  const belongsToCurrentBinding = (manifest: BackendBookManifest) => {
    const current = useNarraStore.getState().books[book.id]?.backendBinding;
    return Boolean(
      current &&
        manifest.requestIdentity &&
        current.bookEditionId === manifest.requestIdentity.bookEditionId &&
        current.contentSha256.toLowerCase() ===
          manifest.requestIdentity.contentSha256.toLowerCase(),
    );
  };
  return new BackendBookSession(
    {
      bind: async (signal) => {
        // All screens for a book share one upload and one request sequence.
        let active = bindings.get(book.id);
        if (active) {
          try {
            await active;
          } catch {
            /* A previous session may have been cancelled. */
          }
        }
        if (signal.aborted) throw new Error("Book binding cancelled");
        const current =
          useLibraryStore.getState().books.find((item) => item.id === book.id) ?? book;
        active = bindBook(current, signal);
        bindings.set(book.id, active);
        try {
          return await active;
        } finally {
          if (bindings.get(book.id) === active) bindings.delete(book.id);
        }
      },
      progress: (binding, value, signal) =>
        postBackendProgress(binding.bookEditionId, value, signal),
      manifest: async (binding, signal) => {
        const identity = {
          bookEditionId: binding.bookEditionId,
          contentSha256: binding.contentSha256,
        };
        return parseBackendManifest(
          await backendBookRequest(backendBookPath(identity.bookEditionId, "manifest"), { signal }),
          identity,
        );
      },
      preview: async (binding, signal) => {
        const preview = parseBackendCharactersPreview(
          await backendBookRequest(backendBookPath(binding.bookEditionId, "characters/preview"), {
            signal,
          }),
        );
        if (preview.bookEditionId !== binding.bookEditionId)
          throw new Error("Invalid backend characters preview identity");
        return preview;
      },
      identity: async (binding, signal) => {
        const edition = binding.bookEditionId;
        const sourceHash = binding.contentSha256.toLowerCase();
        const isCurrent = () => {
          const current = useNarraStore.getState().books[book.id]?.backendBinding;
          return !signal.aborted && current?.bookEditionId === edition &&
            current.contentSha256.toLowerCase() === sourceHash &&
            useLibraryStore.getState().books.some((item) => item.id === book.id && !item.deletedAt);
        };
        if (!isCurrent()) return { pending: false, delay: 5000 };
        const result = await backendBookRequest(
          backendBookPath(edition, "identity"),
          { signal },
        ).catch((error) => {
          if (isCurrent()) throw error;
          return null;
        });
        if (!result || !isCurrent()) return { pending: false, delay: 5000 };
        if (
          result.status === "ready" &&
          typeof result.title === "string" &&
          typeof result.author === "string"
        ) {
          const current = useLibraryStore.getState().books.find((item) => item.id === book.id);
          if (
            current &&
            !current.deletedAt &&
            (current.meta.title !== result.title || current.meta.author !== result.author)
          )
            await useLibraryStore.getState().updateBook(book.id, {
              meta: { ...current.meta, title: result.title, author: result.author },
            });
        }
        if (result.status === "failed")
          status(book.id, { identityError: String(result.error_code ?? "IDENTITY_FAILED") });
        return {
          pending: result.status === "processing",
          delay: typeof result.poll_after_ms === "number" ? result.poll_after_ms : 5000,
        };
      },
      publish: (manifest, value) => {
        if (!belongsToCurrentBinding(manifest)) return;
        const current = useLibraryStore.getState().books.find((item) => item.id === book.id);
        if (!current || current.deletedAt) return;
        void applyBookLanguage(book.id, manifest.language).catch(() => {
          console.warn("[Backend books] Could not persist book language");
        });
        useNarraStore
          .getState()
          .applyBackendManifest(book.id, manifest, value, current.meta?.title ?? book.meta?.title);
        const previousPreview = useBackendBookStatus.getState().books[book.id]?.preview;
        status(book.id, {
          manifest,
          preview:
            manifest.charactersStatus === "preview_ready" &&
            (!manifest.analysis?.runId || previousPreview?.runId === manifest.analysis.runId)
              ? previousPreview
              : undefined,
          error:
            manifest.availability === "unknown"
              ? "UNKNOWN_MANIFEST_STATE"
              : manifest.availability === "failed" || manifest.availability === "cancelled"
                ? (manifest.analysis?.errorCode ??
                  `ANALYSIS_${manifest.availability.toUpperCase()}`)
                : undefined,
        });
        if (current.sourceKind === "catalog" && manifest.availability === "processing")
          console.warn("[Backend books] Catalog manifest is unexpectedly processing");
      },
      publishPreview: (preview) => status(book.id, { preview, error: undefined }),
      media: async (manifest, value, signal) => {
        if (belongsToCurrentBinding(manifest))
          await loadBackendCharacterMedia(book.id, value, signal);
      },
      error: (error) => {
        if (error instanceof Error && error.name === "StaleBookBindingError") return;
        status(book.id, {
          error:
            error instanceof BackendBookError
              ? (error.backendCode ?? `HTTP_${error.status}`)
              : "CONNECTION",
        });
      },
      expired: (binding) => expiredEditions.add(binding.bookEditionId),
      isNotFound: (error) => error instanceof BackendBookError && error.status === 404,
    },
    progress,
  );
}

export function retainBackendBookSync(book: Book, progress = book.progress): () => void {
  if (!supportsBackendAnalysis(book)) {
    status(book.id, { error: "BOOK_FORMAT_UNSUPPORTED" });
    return () => {};
  }
  let entry = sessions.get(book.id);
  if (!entry) {
    const session = createSession(book, progress);
    entry = { session, consumers: 0 };
    sessions.set(book.id, entry);
    session.start();
  }
  entry.consumers++;
  return () => {
    if (--entry.consumers === 0) {
      entry.session.stop();
      if (sessions.get(book.id) === entry) sessions.delete(book.id);
      useBackendBookStatus.setState((state) => {
        const books = { ...state.books };
        delete books[book.id];
        return { books };
      });
    }
  };
}
export function updateBackendBookProgress(bookId: string, progress: number) {
  sessions.get(bookId)?.session.update(progress);
}
export function retryBackendBookSync(bookId: string): Promise<void> {
  return sessions.get(bookId)?.session.retry() ?? Promise.resolve();
}

export async function retryBackendBookAnalysis(bookId: string): Promise<void> {
  const binding = useNarraStore.getState().books[bookId]?.backendBinding;
  if (!binding || binding.resolution !== "private") {
    status(bookId, { error: "ANALYSIS_RETRY_UNAVAILABLE", analysisRetrying: false });
    return;
  }
  status(bookId, { error: undefined, analysisRetrying: true });
  try {
    await postBackendAnalysisRetry(binding.bookEditionId, Crypto.randomUUID());
    status(bookId, { error: undefined, analysisRetrying: false });
    sessions.get(bookId)?.session.retry();
  } catch (error) {
    status(bookId, {
      error:
        error instanceof BackendBookError
          ? (error.backendCode ?? `HTTP_${error.status}`)
          : "CONNECTION",
      analysisRetrying: false,
    });
    throw error;
  }
}

const IMPORTED_BOOK_SYNC_DEADLINE_MS = 5 * 60_000;

/** Start server work for an explicitly imported file without blocking its local reader. */
export function startImportedBackendBook(book: Book): void {
  if (!supportsBackendAnalysis(book)) {
    status(book.id, { error: "BOOK_FORMAT_UNSUPPORTED" });
    return;
  }
  const stop = () => {
    clearTimeout(deadline);
    unsubscribe?.();
    release?.();
  };
  const deadline = setTimeout(stop, IMPORTED_BOOK_SYNC_DEADLINE_MS);
  const release = retainBackendBookSync(book);
  const unsubscribe = useBackendBookStatus.subscribe((state) => {
    const current = state.books[book.id];
    if (current?.manifest?.availability === "ready") stop();
  });
}
