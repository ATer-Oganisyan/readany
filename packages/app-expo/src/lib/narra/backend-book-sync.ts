import { useLibraryStore } from "@/stores/library-store";
import { useNarraStore } from "@/stores/narra-store";
import { flushAllWrites } from "@/stores/persist";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
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
import type { BackendExplicitImportPayload, BackendImportOperation } from "./types";

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
const explicitImportStarts = new Map<string, Promise<void>>();
const bindings = new Map<
  string,
  Promise<NonNullable<ReturnType<typeof useNarraStore.getState>["books"][string]["backendBinding"]>>
>();

/** Kept as a direct Expo env access so the build can eliminate the disabled path. */
export function privateBookReimportEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PRIVATE_BOOK_REIMPORT_ENABLED === "true";
}

async function sourcePath(book: Book) {
  const original = useNarraStore.getState().books[book.id]?.backendOriginalSource;
  if (original && original.format !== "umd")
    return `${FileSystem.documentDirectory}${original.path}`;
  const path = book.filePath;
  if (path.startsWith("/") || path.startsWith("file://")) return path;
  const platform = getPlatformService();
  return platform.joinPath(await platform.getAppDataDir(), path);
}

/** Keep original bytes before a local TXT/UMD conversion changes the file identity. */
export async function preserveBackendOriginalSource(
  bookId: string,
  source: string,
  format: string,
) {
  const directory = `${FileSystem.documentDirectory}narra-backend-sources`;
  const path = `narra-backend-sources/${encodeURIComponent(bookId)}.${format}`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.copyAsync({ from: source, to: `${FileSystem.documentDirectory}${path}` });
  const hash = await sha256BackendFile(`${FileSystem.documentDirectory}${path}`);
  useNarraStore.getState().setBackendOriginalSource(bookId, { path, format, hash });
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

function backendSourceFormat(book: Book): string {
  const preserved = useNarraStore.getState().books[book.id]?.backendOriginalSource;
  return preserved?.format === "umd" ? "epub" : (preserved?.format ?? book.format);
}

async function explicitImportPayload(book: Book): Promise<BackendExplicitImportPayload> {
  const path = await sourcePath(book);
  const contentSha256 = await sha256BackendFile(path);
  const language = normalizeBookLanguage(book.meta.language);
  if (book.contentHash !== contentSha256) {
    await useLibraryStore.getState().updateBook(book.id, { contentHash: contentSha256 });
  }
  return {
    content_sha256: contentSha256,
    title: book.meta.title,
    author: book.meta.author,
    format: backendSourceFormat(book),
    ...(language ? { language } : {}),
    intent: "explicit_import",
  };
}

async function ensureExplicitImportOperation(book: Book): Promise<BackendImportOperation> {
  const current = useNarraStore.getState().books[book.id]?.backendImportOperation;
  if (current && current.phase !== "completed" && current.phase !== "expired") return current;
  const operation: BackendImportOperation = {
    requestId: Crypto.randomUUID(),
    phase: "registration_pending",
    payload: await explicitImportPayload(book),
  };
  useNarraStore.getState().setBackendImportOperation(book.id, operation);
  // The operation identity must survive a process death after the request leaves the device.
  await flushAllWrites();
  return operation;
}

function resetBackendStatus(bookId: string) {
  useBackendBookStatus.setState((state) => {
    const books = { ...state.books };
    delete books[bookId];
    return { books };
  });
}

async function bindExplicitImport(
  book: Book,
  initialOperation: BackendImportOperation,
  signal: AbortSignal,
) {
  const store = useNarraStore.getState();
  let operation = initialOperation;
  let binding = operation.binding;
  if (operation.phase === "registration_pending") {
    try {
      const response = await backendBookRequest("/v2/books/local", {
        ...backendJsonPost(operation.payload, signal),
        headers: {
          "content-type": "application/json",
          "idempotency-key": operation.requestId,
        },
      });
      if (signal.aborted) throw new Error("Book binding cancelled");
      binding = parseBackendBinding(response, operation.payload.content_sha256);
      store.setBackendBinding(book.id, binding);
      resetBackendStatus(book.id);
      operation = {
        ...operation,
        phase: binding.resolution === "catalog" ? "completed" : "source_pending",
        binding,
      };
      store.setBackendImportOperation(book.id, operation);
      await flushAllWrites();
    } catch (error) {
      if (
        error instanceof BackendBookError &&
        error.status === 410 &&
        error.backendCode === "IMPORT_OPERATION_EXPIRED"
      ) {
        store.setBackendImportOperation(book.id, { ...operation, phase: "expired" });
        await flushAllWrites();
      }
      throw error;
    }
  }
  if (!binding) throw new Error("Explicit import has no backend binding");
  await applyBookLanguage(book.id, binding.language);
  if (binding.resolution === "catalog") {
    if (book.sourceKind !== "catalog" || book.bookEditionId !== binding.bookEditionId) {
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
  if (operation.phase === "source_pending") {
    const sourceFile = new File(await sourcePath(book));
    const sourceBytes = await sourceFile.bytes();
    if (sourceBytes.byteLength === 0) throw new Error("Book source is empty");
    const response = await backendBookRequest(backendBookPath(binding.bookEditionId, "source"), {
      method: "PUT",
      headers: {
        "content-type": mimeTypes[operation.payload.format] ?? "application/octet-stream",
      },
      body: sourceBytes,
      signal,
    });
    if (signal.aborted) throw new Error("Source upload cancelled");
    binding = {
      ...binding,
      sourceUploaded: true,
      expiresAt: typeof response.expires_at === "string" ? response.expires_at : binding.expiresAt,
    };
    store.setBackendBinding(book.id, binding);
    store.setBackendImportOperation(book.id, {
      ...operation,
      phase: "completed",
      binding,
    });
    await flushAllWrites();
  }
  return binding;
}

async function bindBook(book: Book, signal: AbortSignal) {
  const store = useNarraStore.getState();
  const importOperation = store.books[book.id]?.backendImportOperation;
  if (importOperation?.phase === "expired") {
    throw new BackendBookError(410, {
      code: "IMPORT_OPERATION_EXPIRED",
      error: "Import operation is no longer available",
    });
  }
  if (
    importOperation &&
    (importOperation.phase === "registration_pending" || importOperation.phase === "source_pending")
  ) {
    return bindExplicitImport(book, importOperation, signal);
  }
  const preserved = store.books[book.id]?.backendOriginalSource;
  // UMD is converted locally; the backend accepts the resulting EPUB.
  const original = preserved?.format === "umd" ? undefined : preserved;
  let binding = store.books[book.id]?.backendBinding;
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
    const path = await sourcePath(book);
    const hash =
      original?.hash ??
      (preserved?.format === "umd" ? undefined : book.contentHash) ??
      (await sha256BackendFile(path));
    if (signal.aborted) throw new Error("Book binding cancelled");
    // Persist once; subsequent resolve/open never hashes unchanged bytes again.
    if (book.contentHash !== hash)
      await useLibraryStore.getState().updateBook(book.id, { contentHash: hash });
    let response = await backendBookRequest(
      "/v2/books/resolve",
      backendJsonPost({ source: "local", content_sha256: hash }, signal),
    );
    if (response.resolution === "local_registration_required") {
      response = await backendBookRequest(
        "/v2/books/local",
        backendJsonPost(
          {
            content_sha256: hash,
            title: book.meta.title,
            author: book.meta.author,
            format: backendSourceFormat(book),
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
  if (signal.aborted) throw new Error("Book binding cancelled");
  store.setBackendBinding(book.id, binding);
  await applyBookLanguage(book.id, binding.language);
  if (binding.resolution === "private" && !binding.sourceUploaded) {
    // Passing expo-file-system's File directly makes expo/fetch normalize the
    // Blob before it creates the native request. On iOS that conversion can
    // stall, leaving the private edition registered but with no source bytes.
    // Read the file explicitly so fetch receives an unambiguous binary body.
    const sourceFile = new File(await sourcePath(book));
    const sourceBytes = await sourceFile.bytes();
    if (sourceBytes.byteLength === 0) throw new Error("Book source is empty");
    const response = await backendBookRequest(backendBookPath(binding.bookEditionId, "source"), {
      method: "PUT",
      headers: {
        "content-type": mimeTypes[backendSourceFormat(book)] ?? "application/octet-stream",
      },
      body: sourceBytes,
      signal,
    });
    if (signal.aborted) throw new Error("Source upload cancelled");
    binding = {
      ...binding,
      sourceUploaded: true,
      expiresAt: typeof response.expires_at === "string" ? response.expires_at : binding.expiresAt,
    };
    store.setBackendBinding(book.id, binding);
  }
  if (binding.resolution === "catalog" && book.sourceKind !== "catalog") {
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
      manifest: async (binding, signal) =>
        parseBackendManifest(
          await backendBookRequest(backendBookPath(binding.bookEditionId, "manifest"), { signal }),
        ),
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
        const result = await backendBookRequest(
          backendBookPath(binding.bookEditionId, "identity"),
          { signal },
        );
        if (signal.aborted) return { pending: false, delay: 5000 };
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
      media: (_manifest, value, signal) => loadBackendCharacterMedia(book.id, value, signal),
      error: (error) =>
        status(book.id, {
          error:
            error instanceof BackendBookError
              ? (error.backendCode ?? `HTTP_${error.status}`)
              : "CONNECTION",
        }),
      expired: (binding) => expiredEditions.add(binding.bookEditionId),
      isNotFound: (error) => error instanceof BackendBookError && error.status === 404,
    },
    progress,
  );
}

export function stopBackendBookSync(bookId: string) {
  sessions.get(bookId)?.session.stop();
  sessions.delete(bookId);
  useBackendBookStatus.setState((state) => {
    const books = { ...state.books };
    delete books[bookId];
    return { books };
  });
}

export function retainBackendBookSync(book: Book, progress = book.progress): () => void {
  let entry = sessions.get(book.id);
  if (!entry) {
    const session = createSession(book, progress);
    entry = { session, consumers: 0 };
    sessions.set(book.id, entry);
    session.start();
  }
  entry.consumers++;
  return () => {
    if (sessions.get(book.id) !== entry) return;
    if (--entry.consumers === 0) {
      stopBackendBookSync(book.id);
    }
  };
}
export function updateBackendBookProgress(bookId: string, progress: number) {
  sessions.get(bookId)?.session.update(progress);
}
export function retryBackendBookSync(bookId: string) {
  sessions.get(bookId)?.session.retry();
}

export async function retryBackendBookAnalysis(bookId: string): Promise<void> {
  const binding = useNarraStore.getState().books[bookId]?.backendBinding;
  if (!binding || binding.resolution !== "private") {
    status(bookId, { error: "ANALYSIS_RETRY_UNAVAILABLE", analysisRetrying: false });
    throw new Error("ANALYSIS_RETRY_UNAVAILABLE");
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
export function startImportedBackendBook(
  book: Book,
  { explicitImport = false }: { explicitImport?: boolean } = {},
): void {
  if (explicitImport && privateBookReimportEnabled()) {
    if (explicitImportStarts.has(book.id)) return;
    // An open reader may still own the old edition. Stop it before the persisted
    // operation can replace the binding so late callbacks cannot republish old data.
    stopBackendBookSync(book.id);
    const start = ensureExplicitImportOperation(book)
      .then(() => startImportedBackendBook(book))
      .catch((error) => {
        status(book.id, {
          error:
            error instanceof BackendBookError
              ? (error.backendCode ?? `HTTP_${error.status}`)
              : "CONNECTION",
        });
      })
      .finally(() => {
        if (explicitImportStarts.get(book.id) === start) explicitImportStarts.delete(book.id);
      });
    explicitImportStarts.set(book.id, start);
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
