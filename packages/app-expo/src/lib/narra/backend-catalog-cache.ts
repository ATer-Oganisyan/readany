import { getPlatformService } from "@readany/core/services";
import * as FileSystem from "expo-file-system/legacy";
import {
  type BackendCatalogBook,
  type BackendCatalogGenre,
  fetchBackendCatalogGenres,
  fetchBackendCatalogPage,
  mergeBackendCatalogBooks,
} from "./backend-catalog-api";
import { downloadVerifiedBackendFile } from "./backend-file-download";

const CACHE_VERSION = 2;
const CACHE_ROOT = `${FileSystem.documentDirectory}narra-backend-catalog`;
const COVER_ROOT = `${CACHE_ROOT}/covers`;
const CATALOG_PATH = `${CACHE_ROOT}/catalog.json`;
let coverTemporarySequence = 0;
let catalogTemporarySequence = 0;
let catalogRefreshPromise: Promise<CachedBackendCatalog> | null = null;

export interface CachedBackendCatalogBook extends BackendCatalogBook {
  coverUri?: string;
}

export interface CachedBackendCatalog {
  books: CachedBackendCatalogBook[];
  nextCursor: string | null;
  genres: BackendCatalogGenre[];
  genreVersion: string | null;
}

interface StoredCatalog {
  version: number;
  books: BackendCatalogBook[];
  nextCursor: string | null;
  genres: BackendCatalogGenre[];
  genreVersion: string | null;
}

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

async function ensureCacheDirectories(): Promise<void> {
  for (const directory of [CACHE_ROOT, COVER_ROOT]) {
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
}

async function cachedBook(book: BackendCatalogBook): Promise<CachedBackendCatalogBook> {
  const path = coverPath(book);
  if (!path || !book.cover) return book;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.isDirectory || info.size !== book.cover.byteSize) return book;
  return { ...book, coverUri: path };
}

function storableBook(book: CachedBackendCatalogBook): BackendCatalogBook {
  const { coverUri: _coverUri, ...value } = book;
  return value;
}

async function writeCatalog(
  catalog: Omit<CachedBackendCatalog, "books"> & { books: BackendCatalogBook[] },
): Promise<void> {
  catalogTemporarySequence += 1;
  const temporaryPath = `${CATALOG_PATH}.${Date.now()}-${catalogTemporarySequence}.tmp`;
  const value: StoredCatalog = {
    version: CACHE_VERSION,
    books: catalog.books.map(storableBook),
    nextCursor: catalog.nextCursor,
    genres: catalog.genres,
    genreVersion: catalog.genreVersion,
  };
  await FileSystem.writeAsStringAsync(temporaryPath, JSON.stringify(value));
  await FileSystem.deleteAsync(CATALOG_PATH, { idempotent: true });
  await FileSystem.moveAsync({ from: temporaryPath, to: CATALOG_PATH });
}

async function hydrateCatalog(value: StoredCatalog): Promise<CachedBackendCatalog> {
  return {
    books: await Promise.all(value.books.map(cachedBook)),
    nextCursor: value.nextCursor,
    genres: value.genres,
    genreVersion: value.genreVersion,
  };
}

function migrateLegacyCatalog(value: StoredCatalog): StoredCatalog | null {
  if (value.version !== 1 || !Array.isArray(value.books)) return null;
  const books = value.books.flatMap((book) => {
    if (
      !book ||
      typeof book !== "object" ||
      typeof book.bookEditionId !== "string" ||
      typeof book.catalogKey !== "string"
    ) {
      return [];
    }
    return [{ ...book, genres: [], generationStatus: "legacy-cache", ready: true }];
  });
  return {
    version: CACHE_VERSION,
    books,
    nextCursor: null,
    genres: [],
    genreVersion: null,
  };
}

export async function loadCachedBackendCatalog(): Promise<CachedBackendCatalog> {
  try {
    await ensureCacheDirectories();
    const value = JSON.parse(await FileSystem.readAsStringAsync(CATALOG_PATH)) as StoredCatalog;
    const migrated = migrateLegacyCatalog(value);
    if (migrated) return hydrateCatalog(migrated);
    if (
      value.version !== CACHE_VERSION ||
      !Array.isArray(value.books) ||
      (value.nextCursor !== null && typeof value.nextCursor !== "string") ||
      !Array.isArray(value.genres)
    ) {
      return { books: [], nextCursor: null, genres: [], genreVersion: null };
    }
    return hydrateCatalog(value);
  } catch {
    return { books: [], nextCursor: null, genres: [], genreVersion: null };
  }
}

export function refreshBackendCatalog(): Promise<CachedBackendCatalog> {
  if (catalogRefreshPromise) return catalogRefreshPromise;
  catalogRefreshPromise = (async () => {
    await ensureCacheDirectories();
    const [page, genreResult] = await Promise.all([
      fetchBackendCatalogPage(),
      fetchBackendCatalogGenres().catch((error) => {
        console.warn("[Catalog] Failed to refresh genres:", error);
        return null;
      }),
    ]);
    const previous = await loadCachedBackendCatalog();
    const catalog = {
      books: page.items,
      nextCursor: page.nextCursor,
      genres: genreResult?.items ?? previous.genres,
      genreVersion: genreResult?.version ?? previous.genreVersion,
    };
    await writeCatalog(catalog);
    return hydrateCatalog({ version: CACHE_VERSION, ...catalog });
  })().finally(() => {
    catalogRefreshPromise = null;
  });
  return catalogRefreshPromise;
}

export async function loadMoreCachedBackendCatalog(
  current: CachedBackendCatalog,
): Promise<CachedBackendCatalog> {
  if (!current.nextCursor) return current;
  const requestedCursor = current.nextCursor;
  const page = await fetchBackendCatalogPage(requestedCursor);
  const catalog = {
    books: mergeBackendCatalogBooks(current.books, page.items),
    // Повтор cursor означает сломанный цикл backend. Останавливаемся, чтобы
    // один экран не создавал бесконечный поток одинаковых запросов.
    nextCursor: page.nextCursor === requestedCursor ? null : page.nextCursor,
    genres: current.genres,
    genreVersion: current.genreVersion,
  };
  await writeCatalog(catalog);
  return hydrateCatalog({ version: CACHE_VERSION, ...catalog });
}

export async function materializeBackendCatalogCover(
  book: BackendCatalogBook,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const path = coverPath(book);
  if (!path || !book.cover) return undefined;
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
