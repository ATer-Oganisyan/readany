import { useLibraryStore } from "@/stores/library-store";
import { useNarraStore } from "@/stores/narra-store";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import {
  type BackendBookBinding,
  type BackendBookManifest,
  advanceBackendReaderProgress,
  fetchBackendBookManifest,
  publishLocalBackendMarkup,
  registerLocalBackendBook,
  resolveLocalBackendBook,
} from "./backend-book-api";
import { loadCachedBackendCharacters, materializeBackendManifest } from "./backend-book-cache";
import { sha256BackendFile } from "./backend-file-hash";
import type { NarraCharacter } from "./types";

const SHA256 = /^[0-9a-f]{64}$/;
const SUPPORTED_FORMATS = new Set(["epub", "fb2", "txt", "pdf"]);

export interface BackendBookCoordinatorApi {
  resolve(contentSha256: string): Promise<BackendBookBinding>;
  register(book: Book, contentSha256: string): Promise<BackendBookBinding>;
  publish(bookEditionId: string, characters: NarraCharacter[]): Promise<BackendBookBinding>;
  advance(bookEditionId: string, progressFraction: number, chapterKey?: string): Promise<void>;
  manifest(bookEditionId: string): Promise<BackendBookManifest>;
}

export interface BackendBookCoordinatorFiles {
  describe(book: Book): Promise<{ contentSha256: string }>;
  loadCached(bookId: string): Promise<NarraCharacter[]>;
  materialize(bookId: string, manifest: BackendBookManifest): Promise<NarraCharacter[]>;
}

export interface BackendBookCoordinatorState {
  getBinding(bookId: string): BackendBookBinding | undefined;
  getCharacters(bookId: string): NarraCharacter[];
  setBinding(bookId: string, binding: BackendBookBinding): void;
  setCharacters(bookId: string, characters: NarraCharacter[]): void;
  updateBookHash(bookId: string, contentSha256: string): Promise<void>;
  reportError(scope: string, error: unknown): void;
}

interface PendingProgress {
  book: Book;
  progressFraction: number;
  chapterKey?: string;
  timer?: ReturnType<typeof setTimeout>;
}

export function createBackendBookCoordinator({
  api,
  files,
  state,
  debounceMs = 1_500,
}: {
  api: BackendBookCoordinatorApi;
  files: BackendBookCoordinatorFiles;
  state: BackendBookCoordinatorState;
  debounceMs?: number;
}) {
  const bindingPromises = new Map<string, Promise<BackendBookBinding>>();
  const pending = new Map<string, PendingProgress>();
  const syncChains = new Map<string, Promise<void>>();

  async function ensureBinding(book: Book): Promise<BackendBookBinding> {
    const current = state.getBinding(book.id);
    if (
      current?.bookEditionId &&
      SHA256.test(current.contentSha256) &&
      book.fileHash === current.contentSha256 &&
      (current.resolution === "catalog" ||
        !current.expiresAt ||
        Date.parse(current.expiresAt) > Date.now())
    ) {
      return current;
    }
    const existing = bindingPromises.get(book.id);
    if (existing) return existing;

    const operation = (async () => {
      if (!SUPPORTED_FORMATS.has(book.format)) {
        throw new Error(`Backend markup does not support ${book.format}`);
      }
      const file = await files.describe(book);
      if (book.fileHash !== file.contentSha256) {
        await state.updateBookHash(book.id, file.contentSha256);
      }
      let resolved = await api.resolve(file.contentSha256);
      if (resolved.resolution === "local_registration_required") {
        resolved = await api.register(book, file.contentSha256);
      }
      if (!resolved.bookEditionId) throw new Error("Backend resolve returned no edition id");
      state.setBinding(book.id, resolved);
      return resolved;
    })().finally(() => bindingPromises.delete(book.id));
    bindingPromises.set(book.id, operation);
    return operation;
  }

  async function applyManifest(bookId: string, manifest: BackendBookManifest): Promise<void> {
    if (manifest.availability === "processing" && manifest.characters.length === 0) return;
    const characters = await files.materialize(bookId, manifest);
    state.setCharacters(bookId, characters);
  }

  async function open(book: Book): Promise<void> {
    const cached = await files.loadCached(book.id);
    if (cached.length) state.setCharacters(book.id, cached);
    try {
      const binding = await ensureBinding(book);
      const bookEditionId = binding.bookEditionId;
      if (!bookEditionId) throw new Error("Backend binding has no edition id");
      const localCharacters = state.getCharacters(book.id);
      if (binding.resolution === "private" && localCharacters.length) {
        state.setBinding(book.id, await api.publish(bookEditionId, localCharacters));
      }
      await applyManifest(book.id, await api.manifest(bookEditionId));
    } catch (error) {
      state.reportError("book_open", error);
    }
  }

  async function syncProgress(
    book: Book,
    progressFraction: number,
    chapterKey?: string,
  ): Promise<void> {
    const binding = await ensureBinding(book);
    const bookEditionId = binding.bookEditionId;
    if (!bookEditionId) throw new Error("Backend binding has no edition id");
    await api.advance(bookEditionId, progressFraction, chapterKey);
    await applyManifest(book.id, await api.manifest(bookEditionId));
  }

  async function syncLocalMarkup(book: Book, characters: NarraCharacter[]): Promise<void> {
    if (!characters.length) return;
    const binding = await ensureBinding(book);
    if (binding.resolution !== "private") return;
    if (!binding.bookEditionId) throw new Error("Backend binding has no edition id");
    state.setBinding(book.id, await api.publish(binding.bookEditionId, characters));
  }

  function flush(bookId: string): Promise<void> {
    const queued = pending.get(bookId);
    if (!queued) return syncChains.get(bookId) ?? Promise.resolve();
    if (queued.timer) clearTimeout(queued.timer);
    pending.delete(bookId);
    const previous = syncChains.get(bookId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => syncProgress(queued.book, queued.progressFraction, queued.chapterKey))
      .catch((error) => state.reportError("reader_progress", error))
      .finally(() => {
        if (syncChains.get(bookId) === next) syncChains.delete(bookId);
      });
    syncChains.set(bookId, next);
    return next;
  }

  function queueProgress(book: Book, progressFraction: number, chapterKey?: string): void {
    if (!SUPPORTED_FORMATS.has(book.format)) return;
    if (!Number.isFinite(progressFraction) || progressFraction < 0 || progressFraction > 1) return;
    const previous = pending.get(book.id);
    if (previous?.timer) clearTimeout(previous.timer);
    const next: PendingProgress = {
      book,
      progressFraction: Math.max(previous?.progressFraction ?? 0, progressFraction),
      chapterKey:
        progressFraction >= (previous?.progressFraction ?? -1) ? chapterKey : previous?.chapterKey,
    };
    next.timer = setTimeout(() => void flush(book.id), debounceMs);
    pending.set(book.id, next);
  }

  return { ensureBinding, open, syncLocalMarkup, syncProgress, queueProgress, flush };
}

const defaultApi: BackendBookCoordinatorApi = {
  resolve: resolveLocalBackendBook,
  register: registerLocalBackendBook,
  publish: publishLocalBackendMarkup,
  advance: advanceBackendReaderProgress,
  manifest: fetchBackendBookManifest,
};

const defaultFiles: BackendBookCoordinatorFiles = {
  async describe(book) {
    const platform = getPlatformService();
    const root = await platform.getAppDataDir();
    const path = /^(file|content):\/\//.test(book.filePath)
      ? book.filePath
      : await platform.joinPath(root, book.filePath);
    const LegacyFileSystem = await import("expo-file-system/legacy");
    const info = await LegacyFileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory || !info.size) throw new Error("Book file is unavailable");
    return { contentSha256: await sha256BackendFile(path) };
  },
  loadCached: loadCachedBackendCharacters,
  materialize: materializeBackendManifest,
};

const defaultState: BackendBookCoordinatorState = {
  getBinding(bookId) {
    return useNarraStore.getState().books[bookId]?.backendBinding;
  },
  getCharacters(bookId) {
    return useNarraStore.getState().books[bookId]?.characters ?? [];
  },
  setBinding(bookId, binding) {
    useNarraStore.getState().setBackendBinding(bookId, binding);
  },
  setCharacters(bookId, characters) {
    useNarraStore.getState().setCharacters(bookId, characters);
  },
  async updateBookHash(bookId, contentSha256) {
    await useLibraryStore.getState().updateBook(bookId, { fileHash: contentSha256 });
  },
  reportError(scope, error) {
    console.warn("[NarraBackend] Background sync failed", {
      scope,
      error: error instanceof Error ? error.message : String(error),
    });
  },
};

const coordinator = createBackendBookCoordinator({
  api: defaultApi,
  files: defaultFiles,
  state: defaultState,
});

export function openBackendBookSync(book: Book): Promise<void> {
  return coordinator.open(book);
}

export function syncLocalBookMarkup(book: Book, characters: NarraCharacter[]): Promise<void> {
  return coordinator.syncLocalMarkup(book, characters);
}

export function queueBackendReaderProgress(
  book: Book,
  progressFraction: number,
  chapterKey?: string,
): void {
  coordinator.queueProgress(book, progressFraction, chapterKey);
}
