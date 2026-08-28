import { readGatewayResponseText } from "@/lib/ai/narra-gateway-consumer";
import { consumeNarraGatewayResponse } from "@/lib/ai/narra-gateway-fetch";
import {
  BOOK_CATALOG_LANGUAGE_CONTRACT,
  type CatalogLanguage,
  isCatalogLanguage,
  normalizeBookLanguage,
} from "./book-language";
import { type NarraErrorCode, NarraServiceError } from "./errors";

export interface BackendCatalogBook {
  resolution: "catalog";
  bookEditionId: string;
  catalogKey: string;
  title: string;
  author: string;
  genres: string[];
  /** Missing in older caches/responses; null and undefined both mean unknown. */
  language?: string | null;
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

type JsonRecord = Record<string, unknown>;
type BackendCoverMimeType = NonNullable<BackendCatalogBook["cover"]>["mimeType"];

function isBackendCoverMimeType(value: unknown): value is BackendCoverMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

async function gatewayJson(path: string, signal?: AbortSignal): Promise<JsonRecord> {
  return consumeNarraGatewayResponse(path, signal ? { signal } : {}, async (response, scope) => {
    const text = await readGatewayResponseText(response, scope);
    let payload: JsonRecord;
    try {
      payload = text ? (JSON.parse(text) as JsonRecord) : {};
    } catch {
      throw new NarraServiceError("SERVICE", "Backend вернул некорректный JSON");
    }
    if (!response.ok) {
      const backendCode = typeof payload.code === "string" ? payload.code : undefined;
      // Preserve backend machine codes independently from the user-facing error.
      throw new NarraServiceError(
        backendErrorCodeToNarraCode(response.status, backendCode),
        String(payload.error || backendCode || `HTTP ${response.status}`),
        undefined,
        undefined,
        backendCode,
      );
    }
    return payload;
  });
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
    (generationStatus !== "base_ready" && generationStatus !== "published") ||
    ready !== true ||
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
    language: normalizeBookLanguage(raw.language),
    format,
    contentSha256: contentSha256.toLowerCase(),
    generationStatus,
    ready,
    sourceDownloadPath,
    cover,
  };
}

export const BACKEND_CATALOG_PAGE_LIMIT = 24;

export async function fetchBackendCatalogPage(
  cursor?: string,
  limit = BACKEND_CATALOG_PAGE_LIMIT,
  signal?: AbortSignal,
): Promise<BackendCatalogPage> {
  return fetchCatalogPageAt("/v2/books/catalog", cursor, limit, signal);
}

export async function fetchBackendLanguageCatalogPage(
  language: CatalogLanguage,
  cursor?: string,
  limit = BACKEND_CATALOG_PAGE_LIMIT,
  signal?: AbortSignal,
): Promise<BackendCatalogPage> {
  if (!isCatalogLanguage(language))
    throw new NarraServiceError("REQUEST", "Языковой каталог поддерживает только ru и en");
  return fetchCatalogPageAt(
    `/v2/books/catalog/languages/${language}`,
    cursor,
    limit,
    signal,
    language,
  );
}

async function fetchCatalogPageAt(
  path: string,
  cursor: string | undefined,
  limit: number,
  signal?: AbortSignal,
  language?: CatalogLanguage,
): Promise<BackendCatalogPage> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new NarraServiceError("REQUEST", "Некорректный размер страницы каталога");
  }
  const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const payload = await gatewayJson(`${path}?limit=${limit}${cursorQuery}`, signal);
  if (!Array.isArray(payload.items)) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный каталог");
  }
  if (
    language &&
    (payload.contract_version !== BOOK_CATALOG_LANGUAGE_CONTRACT || payload.language !== language)
  )
    throw new NarraServiceError("SERVICE", "Backend вернул несовместимый языковой каталог");
  const books = payload.items.flatMap((value) => {
    const book = parseCatalogBook(value);
    // A language page is an atomic contract: never publish a mixed/truncated page.
    if (language && (!book || (value as JsonRecord).language !== language))
      throw new NarraServiceError("SERVICE", "Backend вернул книгу вне языкового каталога");
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

export async function fetchBackendCatalogGenres(
  signal?: AbortSignal,
): Promise<BackendGenreCatalog> {
  const payload = await gatewayJson("/v2/books/genres", signal);
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

export async function requestBackendDownloadUrl(
  downloadPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const payload = await gatewayJson(downloadPath, signal);
  if (typeof payload.download_url !== "string" || !payload.download_url) {
    throw new NarraServiceError("SERVICE", "Backend не вернул ссылку на файл");
  }
  return payload.download_url;
}
