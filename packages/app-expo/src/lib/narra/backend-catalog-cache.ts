import { markInteraction } from "@/lib/diagnostics/interaction-performance";
import { getPlatformService } from "@readany/core/services";
import * as FileSystem from "expo-file-system/legacy";
import type { BackendCatalogBook, BackendCatalogGenre } from "./backend-catalog-api";
import { downloadVerifiedBackendFile } from "./backend-file-download";
import { createCatalogFileStorage } from "./catalog-storage";

const CACHE_ROOT = `${FileSystem.documentDirectory}narra-backend-catalog`;
const COVER_ROOT = `${CACHE_ROOT}/covers`;
let coverTemporarySequence = 0;
let coverDirectories: Promise<void> | null = null;

export interface CachedBackendCatalogBook extends BackendCatalogBook {
  coverUri?: string;
  /** Transient failure: retry when the screen is reopened, never persist it. */
  coverLoadFailed?: boolean;
}

export interface CachedBackendCatalog {
  books: CachedBackendCatalogBook[];
  nextCursor: string | null;
  genres: BackendCatalogGenre[];
  genreVersion: string | null;
}

/** Metadata storage is independent of the visible-cover download cache. */
export const backendCatalogStorage = createCatalogFileStorage(
  {
    read: (path) => {
      if (path.endsWith("/catalog.json") || path.endsWith("/catalog.json.previous"))
        markInteraction("catalog.metadata.read");
      return FileSystem.readAsStringAsync(path);
    },
    write: (path, value) => FileSystem.writeAsStringAsync(path, value),
    move: (from, to) => FileSystem.moveAsync({ from, to }),
    remove: (path) => FileSystem.deleteAsync(path, { idempotent: true }),
    exists: async (path) => (await FileSystem.getInfoAsync(path)).exists,
    mkdir: async (path) => {
      if (!(await FileSystem.getInfoAsync(path)).exists)
        await FileSystem.makeDirectoryAsync(path, { intermediates: true });
    },
    list: (path) => FileSystem.readDirectoryAsync(path),
  },
  CACHE_ROOT,
);

function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 160);
}

function coverExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function coverPath(book: BackendCatalogBook): string | undefined {
  if (!book.cover) return undefined;
  return `${COVER_ROOT}/${safeKey(book.catalogKey)}-${book.cover.contentHash}.${coverExtension(
    book.cover.mimeType,
  )}`;
}

function ensureCacheDirectories(): Promise<void> {
  if (!coverDirectories) {
    coverDirectories = (async () => {
      for (const directory of [CACHE_ROOT, COVER_ROOT]) {
        const info = await FileSystem.getInfoAsync(directory);
        if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      }
    })().catch((error) => {
      coverDirectories = null;
      throw error;
    });
  }
  return coverDirectories;
}

/** Compatibility for non-screen callers; active screens use the shared store. */
export async function loadCachedBackendCatalog(): Promise<CachedBackendCatalog> {
  try {
    const stored = await backendCatalogStorage.read();
    return (
      stored.complete ??
      stored.progress ?? { books: [], nextCursor: null, genres: [], genreVersion: null }
    );
  } catch {
    return { books: [], nextCursor: null, genres: [], genreVersion: null };
  }
}

export async function materializeBackendCatalogCover(
  book: BackendCatalogBook,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const path = coverPath(book);
  if (!path || !book.cover) return undefined;
  await ensureCacheDirectories();
  const existing = await FileSystem.getInfoAsync(path);
  if (existing.exists && !existing.isDirectory && existing.size === book.cover.byteSize)
    return path;

  await FileSystem.deleteAsync(path, { idempotent: true });
  coverTemporarySequence += 1;
  const temporaryPath = `${path}.${Date.now()}-${coverTemporarySequence}.tmp`;
  await downloadVerifiedBackendFile({
    downloadPath: book.cover.downloadPath,
    destinationPath: temporaryPath,
    expectedSha256: book.cover.contentHash,
    expectedByteSize: book.cover.byteSize,
    label: "Backend catalog cover",
    signal,
  });
  await FileSystem.moveAsync({ from: temporaryPath, to: path });
  return path;
}

export async function installBackendCatalogCover(
  bookId: string,
  catalogBook: CachedBackendCatalogBook,
): Promise<string | undefined> {
  if (!catalogBook.coverUri || !catalogBook.cover) return undefined;
  const platform = getPlatformService();
  const bytes = await platform.readFile(catalogBook.coverUri);
  const appData = await platform.getAppDataDir();
  const coversDirectory = await platform.joinPath(appData, "covers");
  await platform.mkdir(coversDirectory);
  const relativePath = `covers/${safeKey(bookId)}-catalog.${coverExtension(
    catalogBook.cover.mimeType,
  )}`;
  await platform.writeFile(await platform.joinPath(appData, relativePath), bytes);
  return relativePath;
}
