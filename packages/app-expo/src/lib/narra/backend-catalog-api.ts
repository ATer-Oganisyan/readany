import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { type NarraErrorCode, NarraServiceError, narraBackendCode } from "./errors";

export interface BackendCatalogBook {
  resolution: "catalog";
  bookEditionId: string;
  catalogKey: string;
  title: string;
  author: string;
  genres: string[];
  format: string;
  contentSha256: string;
  generationStatus: string;
  ready: boolean;
  sourceDownloadPath: string;
  cover?: {
    contentHash: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    byteSize: number;
    downloadPath: string;
  };
}

export interface BackendCatalogPage {
  items: BackendCatalogBook[];
  nextCursor: string | null;
}

export interface BackendCatalogGenre {
  id: string;
  labelRu: string;
  labelEn: string;
  order: number;
}

export interface BackendGenreCatalog {
  version: string;
  items: BackendCatalogGenre[];
}

export interface BackendBookContentChunk {
  contractVersion: "book-content-v1";
  representation: string;
  bookEditionId: string;
  contentHash: string;
  textLength: number;
  byteSize: number;
  chunk: {
    startByte: number;
    endByteExclusive: number;
    contentHash: string;
    text: string;
  };
  nextCursor: string | null;
}

export interface BackendBookContent {
  contractVersion: "book-content-v1";
  representation: string;
  bookEditionId: string;
  contentHash: string;
  textLength: number;
  byteSize: number;
  text: string;
}

type JsonRecord = Record<string, unknown>;
type BackendCoverMimeType = NonNullable<BackendCatalogBook["cover"]>["mimeType"];

function isBackendCoverMimeType(value: unknown): value is BackendCoverMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

async function gatewayJson(path: string): Promise<JsonRecord> {
  const response = await narraGatewayRequest(path, {});
  const text = await response.text();
  let payload: JsonRecord;
  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный JSON");
  }
  if (!response.ok) {
    const backendCode = typeof payload.code === "string" ? payload.code : undefined;
    // Бэкенд различает VALIDATION / NOT_FOUND / CONTENT_VERSION_CHANGED /
    // DOWNLOAD_UNAVAILABLE. Раньше всё это схлопывалось в одну «ошибку
    // сервиса», и вызывающий код не мог отличить «книги нет» от «хранилище
    // временно недоступно». Код едет отдельным полем, текст остаётся текстом.
    throw new NarraServiceError(
      backendErrorCodeToNarraCode(response.status, backendCode),
      String(payload.error || backendCode || `HTTP ${response.status}`),
      undefined,
      undefined,
      backendCode,
    );
  }
  return payload;
}

function backendErrorCodeToNarraCode(status: number, backendCode?: string): NarraErrorCode {
  if (status === 401 || status === 403 || backendCode === "AUTH") return "AUTH";
  if (status === 400 || backendCode === "VALIDATION") return "REQUEST";
  if (status === 429) return "RATE";
  return "SERVICE";
}

function parseCatalogBook(value: unknown): BackendCatalogBook | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as JsonRecord;
  const resolution = raw.resolution;
  const bookEditionId = raw.book_edition_id;
  const catalogKey = raw.catalog_key;
  const title = raw.title;
  const author = raw.author;
  const genres = raw.genres;
  const format = raw.format;
  const contentSha256 = raw.content_sha256;
  const generationStatus = raw.generation_status;
  const ready = raw.ready;
  const sourceDownloadPath = raw.source_download_path;

  if (
    resolution !== "catalog" ||
    typeof bookEditionId !== "string" ||
    typeof catalogKey !== "string" ||
    typeof title !== "string" ||
    typeof author !== "string" ||
    !Array.isArray(genres) ||
    !genres.every((genre) => typeof genre === "string" && genre.length > 0) ||
    typeof format !== "string" ||
    typeof contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(contentSha256) ||
    typeof generationStatus !== "string" ||
    typeof ready !== "boolean" ||
    typeof sourceDownloadPath !== "string" ||
    !sourceDownloadPath.startsWith("/v2/books/")
  ) {
    return null;
  }

  const rawCover = raw.cover;
  const coverRecord =
    rawCover && typeof rawCover === "object" ? (rawCover as JsonRecord) : undefined;
  const coverMimeType = coverRecord?.mime_type;
  const cover =
    coverRecord &&
    typeof coverRecord.content_hash === "string" &&
    /^[a-f0-9]{64}$/i.test(coverRecord.content_hash) &&
    isBackendCoverMimeType(coverMimeType) &&
    Number.isSafeInteger(coverRecord.byte_size) &&
    Number(coverRecord.byte_size) > 0 &&
    typeof coverRecord.download_path === "string" &&
    coverRecord.download_path.startsWith("/v2/books/")
      ? {
          contentHash: coverRecord.content_hash,
          mimeType: coverMimeType,
          byteSize: Number(coverRecord.byte_size),
          downloadPath: coverRecord.download_path,
        }
      : undefined;

  return {
    resolution: "catalog",
    bookEditionId,
    catalogKey,
    title,
    author,
    genres,
    format,
    contentSha256: contentSha256.toLowerCase(),
    generationStatus,
    ready,
    sourceDownloadPath,
    cover,
  };
}

export const BACKEND_CATALOG_PAGE_LIMIT = 24;
export const CONTENT_VERSION_CHANGED = "CONTENT_VERSION_CHANGED";

export async function fetchBackendCatalogPage(
  cursor?: string,
  limit = BACKEND_CATALOG_PAGE_LIMIT,
): Promise<BackendCatalogPage> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new NarraServiceError("REQUEST", "Некорректный размер страницы каталога");
  }
  const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const payload = await gatewayJson(`/v2/books/catalog?limit=${limit}${cursorQuery}`);
  if (!Array.isArray(payload.items)) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный каталог");
  }
  const books = payload.items.flatMap((value) => {
    const book = parseCatalogBook(value);
    return book ? [book] : [];
  });

  // Запись, не прошедшую проверку, мы пропускаем — иначе одна кривая книга
  // ломала бы весь каталог. Но пропуск обязан быть виден: иначе «пришло не всё»
  // выглядит как пустой каталог без причины.
  const skipped = payload.items.length - books.length;
  if (skipped > 0) {
    console.warn(
      `[Catalog] Backend вернул ${payload.items.length} записей, принято ${books.length}, пропущено ${skipped}`,
    );
  }
  const withoutCover = books.filter((book) => !book.cover).length;
  if (withoutCover > 0) {
    console.warn(`[Catalog] Книг без обложки: ${withoutCover} из ${books.length}`);
  }
  const nextCursor = payload.next_cursor;
  if (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor)) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный cursor каталога");
  }
  return { items: books, nextCursor };
}

export function mergeBackendCatalogBooks(
  current: BackendCatalogBook[],
  next: BackendCatalogBook[],
): BackendCatalogBook[] {
  const merged = new Map(current.map((book) => [book.bookEditionId, book]));
  for (const book of next) merged.set(book.bookEditionId, book);
  return Array.from(merged.values());
}

function parseGenre(value: unknown): BackendCatalogGenre | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as JsonRecord;
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.label_ru !== "string" ||
    typeof raw.label_en !== "string" ||
    !Number.isSafeInteger(raw.order)
  ) {
    return null;
  }
  return {
    id: raw.id,
    labelRu: raw.label_ru,
    labelEn: raw.label_en,
    order: Number(raw.order),
  };
}

export async function fetchBackendCatalogGenres(): Promise<BackendGenreCatalog> {
  const payload = await gatewayJson("/v2/books/genres");
  if (typeof payload.version !== "string" || !Array.isArray(payload.items)) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный справочник жанров");
  }
  const genres = payload.items.flatMap((value) => {
    const genre = parseGenre(value);
    return genre ? [genre] : [];
  });
  const unique = new Map<string, BackendCatalogGenre>();
  for (const genre of genres) unique.set(genre.id, genre);
  return {
    version: payload.version,
    items: Array.from(unique.values()).sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    ),
  };
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseBookContentChunk(value: JsonRecord): BackendBookContentChunk | null {
  const rawChunk = value.chunk;
  if (!rawChunk || typeof rawChunk !== "object") return null;
  const chunk = rawChunk as JsonRecord;
  const nextCursor = value.next_cursor;
  if (
    value.contract_version !== "book-content-v1" ||
    typeof value.representation !== "string" ||
    typeof value.book_edition_id !== "string" ||
    typeof value.content_hash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(value.content_hash) ||
    !nonNegativeInteger(value.text_length) ||
    !nonNegativeInteger(value.byte_size) ||
    !nonNegativeInteger(chunk.start_byte) ||
    !nonNegativeInteger(chunk.end_byte_exclusive) ||
    Number(chunk.end_byte_exclusive) < Number(chunk.start_byte) ||
    typeof chunk.content_hash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(chunk.content_hash) ||
    typeof chunk.text !== "string" ||
    (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor))
  ) {
    return null;
  }
  return {
    contractVersion: "book-content-v1",
    representation: value.representation,
    bookEditionId: value.book_edition_id,
    contentHash: value.content_hash.toLowerCase(),
    textLength: Number(value.text_length),
    byteSize: Number(value.byte_size),
    chunk: {
      startByte: Number(chunk.start_byte),
      endByteExclusive: Number(chunk.end_byte_exclusive),
      contentHash: chunk.content_hash.toLowerCase(),
      text: chunk.text,
    },
    nextCursor,
  };
}

export async function fetchBackendBookContentChunk(
  bookEditionId: string,
  cursor?: string,
): Promise<BackendBookContentChunk> {
  const cursorQuery = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const payload = await gatewayJson(
    `/v2/books/${encodeURIComponent(bookEditionId)}/content/chunks${cursorQuery}`,
  );
  const chunk = parseBookContentChunk(payload);
  if (!chunk || chunk.bookEditionId !== bookEditionId) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный чанк книги");
  }
  return chunk;
}

async function fetchCompleteBackendBookContentOnce(
  bookEditionId: string,
): Promise<BackendBookContent> {
  let cursor: string | undefined;
  let expectedStartByte = 0;
  let firstChunk: BackendBookContentChunk | null = null;
  const seenCursors = new Set<string>();
  const textParts: string[] = [];

  while (true) {
    const response = await fetchBackendBookContentChunk(bookEditionId, cursor);
    if (!firstChunk) firstChunk = response;
    if (
      response.contentHash !== firstChunk.contentHash ||
      response.representation !== firstChunk.representation ||
      response.byteSize !== firstChunk.byteSize ||
      response.textLength !== firstChunk.textLength
    ) {
      throw new NarraServiceError(
        "SERVICE",
        "Версия текста книги изменилась во время загрузки",
        undefined,
        undefined,
        CONTENT_VERSION_CHANGED,
      );
    }
    const chunkByteSize = new TextEncoder().encode(response.chunk.text).byteLength;
    if (
      response.chunk.startByte !== expectedStartByte ||
      response.chunk.endByteExclusive - response.chunk.startByte !== chunkByteSize
    ) {
      throw new NarraServiceError("SERVICE", "Backend вернул несвязные чанки книги");
    }
    textParts.push(response.chunk.text);
    expectedStartByte = response.chunk.endByteExclusive;

    if (!response.nextCursor) break;
    if (seenCursors.has(response.nextCursor)) {
      throw new NarraServiceError("SERVICE", "Backend повторил cursor чанка книги");
    }
    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  if (!firstChunk || expectedStartByte !== firstChunk.byteSize) {
    throw new NarraServiceError("SERVICE", "Backend вернул неполный текст книги");
  }
  return {
    contractVersion: firstChunk.contractVersion,
    representation: firstChunk.representation,
    bookEditionId: firstChunk.bookEditionId,
    contentHash: firstChunk.contentHash,
    textLength: firstChunk.textLength,
    byteSize: firstChunk.byteSize,
    text: textParts.join(""),
  };
}

export function isContentVersionChanged(error: unknown): boolean {
  return narraBackendCode(error) === CONTENT_VERSION_CHANGED;
}

export async function fetchCompleteBackendBookContent(
  bookEditionId: string,
): Promise<BackendBookContent> {
  try {
    return await fetchCompleteBackendBookContentOnce(bookEditionId);
  } catch (error) {
    // Cursor привязан к версии текста. Один чистый перезапуск с первого чанка
    // выполняет контракт и не превращает постоянно меняющуюся книгу в цикл.
    if (isContentVersionChanged(error)) {
      return fetchCompleteBackendBookContentOnce(bookEditionId);
    }
    throw error;
  }
}

export async function requestBackendDownloadUrl(downloadPath: string): Promise<string> {
  const payload = await gatewayJson(downloadPath);
  if (typeof payload.download_url !== "string" || !payload.download_url) {
    throw new NarraServiceError("SERVICE", "Backend не вернул ссылку на файл");
  }
  return payload.download_url;
}
