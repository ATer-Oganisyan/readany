import { getPlatformService } from "@readany/core/services";
import * as FileSystem from "expo-file-system/legacy";
import { type BackendCatalogBook, fetchBackendCatalogBooks } from "./backend-catalog-api";
import { downloadVerifiedBackendFile } from "./backend-file-download";

const CACHE_VERSION = 1;
const CACHE_ROOT = `${FileSystem.documentDirectory}narra-backend-catalog`;
const COVER_ROOT = `${CACHE_ROOT}/covers`;
const CATALOG_PATH = `${CACHE_ROOT}/catalog.json`;
let coverTemporarySequence = 0;

export interface CachedBackendCatalogBook extends BackendCatalogBook {
  coverUri?: string;
}

interface StoredCatalog {
  version: number;
  books: BackendCatalogBook[];
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

async function writeCatalog(books: BackendCatalogBook[]): Promise<void> {
  const temporaryPath = `${CATALOG_PATH}.${Date.now()}.tmp`;
  const value: StoredCatalog = { version: CACHE_VERSION, books };
  await FileSystem.writeAsStringAsync(temporaryPath, JSON.stringify(value));
  await FileSystem.deleteAsync(CATALOG_PATH, { idempotent: true });
  await FileSystem.moveAsync({ from: temporaryPath, to: CATALOG_PATH });
}

export async function loadCachedBackendCatalog(): Promise<CachedBackendCatalogBook[]> {
  try {
    await ensureCacheDirectories();
    const value = JSON.parse(await FileSystem.readAsStringAsync(CATALOG_PATH)) as StoredCatalog;
    if (value.version !== CACHE_VERSION || !Array.isArray(value.books)) return [];
    return Promise.all(value.books.map(cachedBook));
  } catch {
    return [];
  }
}

export async function refreshBackendCatalog(): Promise<CachedBackendCatalogBook[]> {
  await ensureCacheDirectories();
  const books = await fetchBackendCatalogBooks();
  await writeCatalog(books);
  return Promise.all(books.map(cachedBook));
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
