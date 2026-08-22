import { getPlatformService } from "@readany/core/services";
import * as FileSystem from "expo-file-system/legacy";
import {
  type BackendCatalogBook,
  fetchBackendCatalogBooksPage,
  requestBackendDownloadUrl,
} from "./backend-book-api";
import { sha256BackendFile } from "./backend-file-hash";

const CACHE_VERSION = 2;
const CACHE_ROOT = `${FileSystem.documentDirectory}narra-backend-catalog`;
const COVER_ROOT = `${CACHE_ROOT}/covers`;
const PAGE_ROOT = `${CACHE_ROOT}/pages`;
const MAX_CONCURRENT_COVER_DOWNLOADS = 3;

let activeCoverDownloads = 0;
const coverDownloadWaiters: Array<() => void> = [];
const coverDownloads = new Map<string, Promise<string | undefined>>();

export interface CachedBackendCatalogBook extends BackendCatalogBook {
  coverUri?: string;
}

export interface CachedBackendCatalogPage {
  books: CachedBackendCatalogBook[];
  nextCursor: string | null;
}

interface StoredCatalogPage {
  version: number;
  requestCursor: string | null;
  books: BackendCatalogBook[];
  nextCursor: string | null;
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
  for (const directory of [CACHE_ROOT, COVER_ROOT, PAGE_ROOT]) {
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
}

function pagePath(cursor: string | null): string {
  if (cursor === null) return `${PAGE_ROOT}/first.json`;
  let hash = 2_166_136_261;
  for (let index = 0; index < cursor.length; index += 1) {
    hash ^= cursor.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${PAGE_ROOT}/cursor-${(hash >>> 0).toString(16)}-${cursor.length}.json`;
}

async function validCachedCover(book: BackendCatalogBook, path: string): Promise<boolean> {
  if (!book.cover) return false;
  const info = await FileSystem.getInfoAsync(path);
  return Boolean(info.exists && !info.isDirectory && info.size === book.cover.byteSize);
}

async function withCoverDownloadSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeCoverDownloads >= MAX_CONCURRENT_COVER_DOWNLOADS) {
    await new Promise<void>((resolve) => coverDownloadWaiters.push(resolve));
  } else {
    activeCoverDownloads += 1;
  }
  try {
    return await operation();
  } finally {
    const next = coverDownloadWaiters.shift();
    if (next) next();
    else activeCoverDownloads -= 1;
  }
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

async function writeCatalogPage(
  requestCursor: string | null,
  books: BackendCatalogBook[],
  nextCursor: string | null,
): Promise<void> {
  const path = pagePath(requestCursor);
  const temporary = `${path}.${Date.now()}.tmp`;
  const value: StoredCatalogPage = { version: CACHE_VERSION, requestCursor, books, nextCursor };
  await FileSystem.writeAsStringAsync(temporary, JSON.stringify(value));
  await FileSystem.deleteAsync(path, { idempotent: true });
  await FileSystem.moveAsync({ from: temporary, to: path });
}

async function readCatalogPage(cursor: string | null): Promise<StoredCatalogPage | null> {
  try {
    await ensureCacheDirectories();
    const value = JSON.parse(
      await FileSystem.readAsStringAsync(pagePath(cursor)),
    ) as StoredCatalogPage;
    if (
      value.version !== CACHE_VERSION ||
      value.requestCursor !== cursor ||
      !Array.isArray(value.books) ||
      (value.nextCursor !== null && typeof value.nextCursor !== "string")
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function loadCachedBackendCatalogPage(
  cursor: string | null = null,
): Promise<CachedBackendCatalogPage> {
  const page = await readCatalogPage(cursor);
  if (!page) return { books: [], nextCursor: null };
  return {
    books: await Promise.all(page.books.map(cachedBook)),
    nextCursor: page.nextCursor,
  };
}

export async function refreshBackendCatalogPage({
  limit = 24,
  cursor = null,
  reset = false,
}: {
  limit?: number;
  cursor?: string | null;
  reset?: boolean;
} = {}): Promise<CachedBackendCatalogPage> {
  await ensureCacheDirectories();
  const page = await fetchBackendCatalogBooksPage({ limit, cursor });
  if (reset) {
    if (cursor !== null) throw new Error("Catalog cache can only reset from the first page");
    await FileSystem.deleteAsync(PAGE_ROOT, { idempotent: true });
    await FileSystem.makeDirectoryAsync(PAGE_ROOT, { intermediates: true });
  }
  await writeCatalogPage(cursor, page.books, page.nextCursor);
  return {
    books: await Promise.all(page.books.map(cachedBook)),
    nextCursor: page.nextCursor,
  };
}

export async function loadCachedBackendCatalog(): Promise<CachedBackendCatalogBook[]> {
  const books: CachedBackendCatalogBook[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await readCatalogPage(cursor);
    if (!page) break;
    books.push(...(await Promise.all(page.books.map(cachedBook))));
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) break;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return books;
}

export async function refreshBackendCatalog(): Promise<CachedBackendCatalogBook[]> {
  const books: CachedBackendCatalogBook[] = [];
  const bookIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let reset = true;
  do {
    const page = await refreshBackendCatalogPage({ limit: 100, cursor, reset });
    reset = false;
    for (const book of page.books) {
      if (bookIds.has(book.bookEditionId)) continue;
      bookIds.add(book.bookEditionId);
      books.push(book);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) break;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return books;
}

/** Downloads one requested cover. Callers decide which cards are visible. */
export function materializeBackendCatalogCover(
  book: BackendCatalogBook,
): Promise<string | undefined> {
  const path = coverPath(book);
  if (!path) return Promise.resolve(undefined);
  const existing = coverDownloads.get(path);
  if (existing) return existing;

  const download = withCoverDownloadSlot(() => materializeCover(book)).finally(() => {
    coverDownloads.delete(path);
  });
  coverDownloads.set(path, download);
  return download;
}

export async function installBackendCatalogCover(
  bookId: string,
  catalogBook: CachedBackendCatalogBook,
): Promise<string | undefined> {
  if (!catalogBook.cover) return undefined;
  const coverUri = catalogBook.coverUri ?? (await materializeBackendCatalogCover(catalogBook));
  if (!coverUri) return undefined;
  const platform = getPlatformService();
  const bytes = await platform.readFile(coverUri);
  const appData = await platform.getAppDataDir();
  const coversDirectory = await platform.joinPath(appData, "covers");
  await platform.mkdir(coversDirectory);
  const relativePath = `covers/${safeKey(bookId)}-catalog.${coverExtension(
    catalogBook.cover.mimeType,
  )}`;
  await platform.writeFile(await platform.joinPath(appData, relativePath), bytes);
  return relativePath;
}
