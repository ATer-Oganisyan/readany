import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { NarraServiceError } from "./errors";

export interface BackendCatalogBook {
  resolution: "catalog";
  bookEditionId: string;
  catalogKey: string;
  title: string;
  author: string;
  format: string;
  contentSha256: string;
  sourceDownloadPath: string;
  cover?: {
    contentHash: string;
    mimeType: string;
    byteSize: number;
    downloadPath: string;
  };
}

type JsonRecord = Record<string, unknown>;

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
    throw new NarraServiceError(
      response.status === 401 || response.status === 403 ? "AUTH" : "SERVICE",
      String(payload.error || payload.code || `HTTP ${response.status}`),
    );
  }
  return payload;
}

function parseCatalogBook(value: unknown): BackendCatalogBook | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as JsonRecord;
  const resolution = raw.resolution;
  const bookEditionId = raw.book_edition_id;
  const catalogKey = raw.catalog_key;
  const title = raw.title;
  const author = raw.author;
  const format = raw.format;
  const contentSha256 = raw.content_sha256;
  const sourceDownloadPath = raw.source_download_path;

  if (
    resolution !== "catalog" ||
    typeof bookEditionId !== "string" ||
    typeof catalogKey !== "string" ||
    typeof title !== "string" ||
    typeof format !== "string" ||
    typeof contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(contentSha256) ||
    typeof sourceDownloadPath !== "string" ||
    !sourceDownloadPath.startsWith("/v2/books/")
  ) {
    return null;
  }

  const rawCover = raw.cover;
  const coverRecord =
    rawCover && typeof rawCover === "object" ? (rawCover as JsonRecord) : undefined;
  const cover =
    coverRecord &&
    typeof coverRecord.content_hash === "string" &&
    /^[a-f0-9]{64}$/i.test(coverRecord.content_hash) &&
    typeof coverRecord.mime_type === "string" &&
    Number.isSafeInteger(coverRecord.byte_size) &&
    Number(coverRecord.byte_size) > 0 &&
    typeof coverRecord.download_path === "string" &&
    coverRecord.download_path.startsWith("/v2/books/")
      ? {
          contentHash: coverRecord.content_hash,
          mimeType: coverRecord.mime_type,
          byteSize: Number(coverRecord.byte_size),
          downloadPath: coverRecord.download_path,
        }
      : undefined;

  return {
    resolution: "catalog",
    bookEditionId,
    catalogKey,
    title,
    author: typeof author === "string" ? author : "",
    format,
    contentSha256: contentSha256.toLowerCase(),
    sourceDownloadPath,
    cover,
  };
}

const CATALOG_PAGE_LIMIT = 100;

export async function fetchBackendCatalogBooks(): Promise<BackendCatalogBook[]> {
  const payload = await gatewayJson(`/v2/books/catalog?limit=${CATALOG_PAGE_LIMIT}`);
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
  // Пагинации здесь нет. Если бэкенд отдал ровно страницу или прислал курсор,
  // остальные книги не появятся, и это надо знать, а не угадывать.
  const cursor = payload.next_cursor ?? payload.nextCursor;
  if (payload.items.length >= CATALOG_PAGE_LIMIT || (typeof cursor === "string" && cursor)) {
    console.warn(
      `[Catalog] Каталог обрезан лимитом ${CATALOG_PAGE_LIMIT}: получено ${payload.items.length}, курсор ${cursor ? "есть" : "нет"}. Пагинация не реализована.`,
    );
  }
  return books;
}

export async function requestBackendDownloadUrl(downloadPath: string): Promise<string> {
  const payload = await gatewayJson(downloadPath);
  if (typeof payload.download_url !== "string" || !payload.download_url) {
    throw new NarraServiceError("SERVICE", "Backend не вернул ссылку на файл");
  }
  return payload.download_url;
}
