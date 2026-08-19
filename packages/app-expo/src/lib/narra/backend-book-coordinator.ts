import { useNarraStore } from "@/stores/narra-store";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import {
  type BackendBookBinding,
  type BackendBookManifest,
  type BackendReaderSectionPosition,
  advanceBackendReaderProgress,
  fetchBackendBookManifest,
  publishLocalBackendMarkup,
  registerLocalBackendBook,
  resolveLocalBackendBook,
  uploadLocalBackendSource,
} from "./backend-book-api";
import {
  isBackendManifestCharacterReached,
  loadCachedBackendCharacters,
  materializeBackendManifest,
  persistBackendManifestCharacters,
  projectBackendManifestCharacters,
} from "./backend-book-cache";
import { sha256BackendFile } from "./backend-file-hash";
import type { NarraCharacter } from "./types";

const SHA256 = /^[0-9a-f]{64}$/;
const SUPPORTED_FORMATS = new Set(["epub", "fb2", "txt", "pdf"]);
const BOOK_MIME_TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  fb2: "application/x-fictionbook+xml",
  txt: "text/plain",
  pdf: "application/pdf",
};

export function supportsBackendBookMarkup(format: string): boolean {
  return SUPPORTED_FORMATS.has(format);
}

export function shouldRefreshBackendManifest(
  manifest: BackendBookManifest | undefined,
  progressFraction = manifest?.readingFraction ?? 0,
): boolean {
  if (!manifest) return false;
  return (
    manifest.availability === "processing" ||
    manifest.characters.some(
      (character) =>
        isBackendManifestCharacterReached(character, manifest.textLength, progressFraction) &&
        character.state === "preparing",
    )
  );
}

export interface BackendBookCoordinatorApi {
  resolve(contentSha256: string): Promise<BackendBookBinding>;
  register(book: Book, contentSha256: string): Promise<BackendBookBinding>;
  publish(bookEditionId: string, characters: NarraCharacter[]): Promise<BackendBookBinding>;
  uploadSource(
    bookEditionId: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<BackendBookBinding>;
  advance(
    bookEditionId: string,
    progressFraction: number,
    chapterKey?: string,
    sectionPosition?: BackendReaderSectionPosition,
  ): Promise<void>;
  manifest(bookEditionId: string): Promise<BackendBookManifest>;
}

export interface BackendBookCoordinatorFiles {
  describe(book: Book): Promise<{ contentSha256: string }>;
  readSource(book: Book): Promise<{ bytes: Uint8Array; mimeType: string }>;
  loadCached(bookId: string): Promise<NarraCharacter[]>;
  project(manifest: BackendBookManifest, previousCharacters?: NarraCharacter[]): NarraCharacter[];
  persist(
    bookId: string,
    manifest: BackendBookManifest,
    characters: NarraCharacter[],
  ): Promise<void>;
  materialize(
    bookId: string,
    manifest: BackendBookManifest,
    progressFraction: number,
    onCharacter?: (character: NarraCharacter) => void,
  ): Promise<NarraCharacter[]>;
}

export interface BackendBookCoordinatorState {
  getBinding(bookId: string): BackendBookBinding | undefined;
  getCharacters(bookId: string): NarraCharacter[];
  setBinding(bookId: string, binding: BackendBookBinding): void;
  setCharacters(bookId: string, characters: NarraCharacter[]): void;
  updateCharacterMedia(
    bookId: string,
    characterId: string,
    updates: Pick<
      NarraCharacter,
      "portraitUri" | "greetingAudioUri" | "idleAnimationUri" | "mediaState"
    >,
  ): void;
  setManifestSource(bookId: string, source: BackendBookManifest["source"]): void;
  updateBookHash(bookId: string, contentSha256: string): Promise<void>;
  reportError(scope: string, error: unknown): void;
}

interface PendingProgress {
  book: Book;
  progressFraction: number;
  chapterKey?: string;
  sectionPosition?: BackendReaderSectionPosition;
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
  const mediaMaterializations = new Map<string, { key: string; promise: Promise<void> }>();
  const latestMediaKeys = new Map<string, string>();

  function mediaKey(manifest: BackendBookManifest, progressFraction: number): string {
    const characters = manifest.characters
      .filter((character) =>
        isBackendManifestCharacterReached(character, manifest.textLength, progressFraction),
      )
      .map((character) => [
        character.characterKey,
        character.state,
        character.bundle?.version ?? "",
        character.bundle?.assets.map((asset) => `${asset.type}:${asset.contentHash}`).join(",") ??
          "",
      ]);
    return JSON.stringify([
      manifest.source,
      manifest.publicationId ?? "",
      manifest.revision ?? 0,
      characters,
    ]);
  }

  async function ensureBinding(book: Book): Promise<BackendBookBinding> {
    const current = state.getBinding(book.id);
    if (
      current?.bookEditionId &&
      SHA256.test(current.contentSha256) &&
      book.fileHash === current.contentSha256 &&
      (current.resolution === "catalog" ||
        (current.sourceUploaded === true &&
          (!current.expiresAt || Date.parse(current.expiresAt) > Date.now())))
    ) {
      return current;
    }
    const existing = bindingPromises.get(book.id);
    if (existing) return existing;

    const operation = (async () => {
      if (!supportsBackendBookMarkup(book.format)) {
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
      if (resolved.resolution === "private" && resolved.sourceUploaded !== true) {
        const source = await files.readSource(book);
        resolved = await api.uploadSource(resolved.bookEditionId, source.bytes, source.mimeType);
      }
      state.setBinding(book.id, resolved);
      return resolved;
    })().finally(() => bindingPromises.delete(book.id));
    bindingPromises.set(book.id, operation);
    return operation;
  }

  async function applyManifest(
    bookId: string,
    manifest: BackendBookManifest,
    progressFraction: number,
  ): Promise<void> {
    state.setManifestSource(bookId, manifest.source);
    // Provisional scan findings are screen-local. Keeping them out of the
    // persisted Narra store prevents temporary IDs from reaching chat, reader
    // name markup, scenes, memories, or the offline manifest cache.
    if (manifest.availability === "processing") return;
    const key = mediaKey(manifest, progressFraction);
    latestMediaKeys.set(bookId, key);
    const characters = files.project(manifest, state.getCharacters(bookId));
    state.setCharacters(bookId, characters);
    try {
      await files.persist(bookId, manifest, characters);
    } catch (error) {
      state.reportError("book_manifest_cache", error);
    }

    const active = mediaMaterializations.get(bookId);
    if (active?.key === key) return;

    const operation: Promise<void> = files
      .materialize(bookId, manifest, progressFraction, (character) => {
        if (latestMediaKeys.get(bookId) !== key || character.mediaState !== "ready") return;
        state.updateCharacterMedia(bookId, character.id, {
          portraitUri: character.portraitUri,
          greetingAudioUri: character.greetingAudioUri,
          idleAnimationUri: character.idleAnimationUri,
          mediaState: character.mediaState,
        });
      })
      .then(async (materialized) => {
        if (latestMediaKeys.get(bookId) !== key) return;
        state.setCharacters(bookId, materialized);
        await files.persist(bookId, manifest, materialized);
      })
      .catch((error) => {
        if (latestMediaKeys.get(bookId) === key) state.reportError("book_media", error);
      })
      .finally(() => {
        if (mediaMaterializations.get(bookId)?.promise === operation) {
          mediaMaterializations.delete(bookId);
        }
      });
    mediaMaterializations.set(bookId, { key, promise: operation });
  }

  async function open(book: Book): Promise<BackendBookManifest | undefined> {
    const cached = await files.loadCached(book.id);
    if (cached.length) state.setCharacters(book.id, cached);
    try {
      const binding = await ensureBinding(book);
      const bookEditionId = binding.bookEditionId;
      if (!bookEditionId) throw new Error("Backend binding has no edition id");
      const localCharacters = state.getCharacters(book.id);
      if (localCharacters.some((character) => character.mediaSource !== "backend")) {
        state.setCharacters(book.id, []);
      }
      const progressFraction = Math.min(1, Math.max(0, Number(book.progress) || 0));
      try {
        await api.advance(bookEditionId, progressFraction);
      } catch (error) {
        state.reportError("reader_progress", error);
      }
      const manifest = await api.manifest(bookEditionId);
      await applyManifest(book.id, manifest, progressFraction);
      return manifest;
    } catch (error) {
      state.reportError("book_open", error);
      return undefined;
    }
  }

  async function syncProgress(
    book: Book,
    progressFraction: number,
    chapterKey?: string,
    sectionPosition?: BackendReaderSectionPosition,
  ): Promise<void> {
    const binding = await ensureBinding(book);
    const bookEditionId = binding.bookEditionId;
    if (!bookEditionId) throw new Error("Backend binding has no edition id");
    await api.advance(bookEditionId, progressFraction, chapterKey, sectionPosition);
    await applyManifest(book.id, await api.manifest(bookEditionId), progressFraction);
  }

  async function syncLocalMarkup(book: Book, characters: NarraCharacter[]): Promise<void> {
    // Compatibility hook retained for callers on the legacy client analyzer.
    // Canonical private markup is produced exclusively by the backend v3 pipeline.
    void book;
    void characters;
  }

  function flush(bookId: string): Promise<void> {
    const queued = pending.get(bookId);
    if (!queued) return syncChains.get(bookId) ?? Promise.resolve();
    if (queued.timer) clearTimeout(queued.timer);
    pending.delete(bookId);
    const previous = syncChains.get(bookId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() =>
        syncProgress(
          queued.book,
          queued.progressFraction,
          queued.chapterKey,
          queued.sectionPosition,
        ),
      )
      .catch((error) => state.reportError("reader_progress", error))
      .finally(() => {
        if (syncChains.get(bookId) === next) syncChains.delete(bookId);
      });
    syncChains.set(bookId, next);
    return next;
  }

  function queueProgress(
    book: Book,
    progressFraction: number,
    chapterKey?: string,
    sectionPosition?: BackendReaderSectionPosition,
  ): void {
    if (!supportsBackendBookMarkup(book.format)) return;
    if (!Number.isFinite(progressFraction) || progressFraction < 0 || progressFraction > 1) return;
    const previous = pending.get(book.id);
    if (previous?.timer) clearTimeout(previous.timer);
    const next: PendingProgress = {
      book,
      progressFraction: Math.max(previous?.progressFraction ?? 0, progressFraction),
      chapterKey:
        progressFraction >= (previous?.progressFraction ?? -1) ? chapterKey : previous?.chapterKey,
      sectionPosition:
        progressFraction >= (previous?.progressFraction ?? -1)
          ? sectionPosition
          : previous?.sectionPosition,
    };
    next.timer = setTimeout(() => void flush(book.id), debounceMs);
    pending.set(book.id, next);
  }

  return {
    ensureBinding,
    open,
    syncLocalMarkup,
    syncProgress,
    queueProgress,
    flush,
  };
}

const defaultApi: BackendBookCoordinatorApi = {
  resolve: resolveLocalBackendBook,
  register: registerLocalBackendBook,
  publish: publishLocalBackendMarkup,
  uploadSource: uploadLocalBackendSource,
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
  async readSource(book) {
    const platform = getPlatformService();
    const root = await platform.getAppDataDir();
    const path = /^(file|content):\/\//.test(book.filePath)
      ? book.filePath
      : await platform.joinPath(root, book.filePath);
    const mimeType = BOOK_MIME_TYPES[book.format];
    if (!mimeType) throw new Error(`Backend markup does not support ${book.format}`);
    return { bytes: await platform.readFile(path), mimeType };
  },
  loadCached: loadCachedBackendCharacters,
  project: projectBackendManifestCharacters,
  persist: persistBackendManifestCharacters,
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
  updateCharacterMedia(bookId, characterId, updates) {
    useNarraStore.getState().updateCharacter(bookId, characterId, updates);
  },
  setManifestSource(bookId, source) {
    useNarraStore.getState().setBackendManifestSource(bookId, source);
  },
  async updateBookHash(bookId, contentSha256) {
    const { useLibraryStore } = await import("@/stores/library-store");
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

export function openBackendBookSync(book: Book): Promise<BackendBookManifest | undefined> {
  return coordinator.open(book);
}

export function syncLocalBookMarkup(book: Book, characters: NarraCharacter[]): Promise<void> {
  return coordinator.syncLocalMarkup(book, characters);
}

export function queueBackendReaderProgress(
  book: Book,
  progressFraction: number,
  chapterKey?: string,
  sectionPosition?: BackendReaderSectionPosition,
): void {
  coordinator.queueProgress(book, progressFraction, chapterKey, sectionPosition);
}
