import { getPlatformService } from "@readany/core/services";
import * as FileSystem from "expo-file-system/legacy";
import {
  type BackendCatalogBook,
  fetchBackendCatalogBooks,
  requestBackendDownloadUrl,
} from "./backend-book-api";
import { sha256BackendFile } from "./backend-file-hash";

const CACHE_VERSION = 1;
const CACHE_ROOT = `${FileSystem.documentDirectory}narra-backend-catalog`;
const COVER_ROOT = `${CACHE_ROOT}/covers`;
const CATALOG_PATH = `${CACHE_ROOT}/catalog.json`;

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

async function validCachedCover(book: BackendCatalogBook, path: string): Promise<boolean> {
  if (!book.cover) return false;
  const info = await FileSystem.getInfoAsync(path);
  return Boolean(
    info.exists &&
      !info.isDirectory &&
      info.size === book.cover.byteSize &&
      (await sha256BackendFile(path)) === book.cover.contentHash,
  );
}

async function materializeCover(book: BackendCatalogBook): Promise<string | undefined> {
  const path = coverPath(book);
  if (!path || !book.cover) return undefined;
  if (await validCachedCover(book, path)) return path;

  await FileSystem.deleteAsync(path, { idempotent: true });
  const temporary = `${path}.${Date.now()}.tmp`;
  const url = await requestBackendDownloadUrl(book.cover.downloadPath);
  const task = FileSystem.createDownloadResumable(url, temporary, {
    sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
  });
  const result = await task.downloadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error(`Backend cover download failed (${result?.status ?? "cancelled"})`);
  }
  const info = await FileSystem.getInfoAsync(temporary);
  if (!info.exists || info.isDirectory || info.size !== book.cover.byteSize) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error("Backend cover size mismatch");
  }
  if ((await sha256BackendFile(temporary)) !== book.cover.contentHash) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error("Backend cover checksum mismatch");
  }
  await FileSystem.moveAsync({ from: temporary, to: path });
  return path;
}

async function cachedBook(book: BackendCatalogBook): Promise<CachedBackendCatalogBook> {
  const path = coverPath(book);
  if (!path || !(await validCachedCover(book, path))) return book;
  return { ...book, coverUri: path };
}

async function writeCatalog(books: BackendCatalogBook[]): Promise<void> {
  const temporary = `${CATALOG_PATH}.${Date.now()}.tmp`;
  const value: StoredCatalog = { version: CACHE_VERSION, books };
  await FileSystem.writeAsStringAsync(temporary, JSON.stringify(value));
  await FileSystem.deleteAsync(CATALOG_PATH, { idempotent: true });
  await FileSystem.moveAsync({ from: temporary, to: CATALOG_PATH });
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
  const cached = await Promise.all(
    books.map(async (book) => {
      try {
        const coverUri = await materializeCover(book);
        return coverUri ? { ...book, coverUri } : book;
      } catch (error) {
        console.warn("[Catalog] Failed to cache backend cover", {
          catalogKey: book.catalogKey,
          error: error instanceof Error ? error.message : String(error),
        });
        return book;
      }
    }),
  );
  await writeCatalog(books);
  return cached;
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
