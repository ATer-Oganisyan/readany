import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import {
  type BackendCatalogBook,
  CONTENT_VERSION_CHANGED,
  fetchBackendBookContentChunk,
  isContentVersionChanged,
} from "./backend-catalog-api";
import { isBackendDownloadAbort } from "./backend-file-download";
import { sha256BackendFile } from "./backend-file-hash";
import { NarraServiceError } from "./errors";

const CONTENT_CACHE_ROOT = `${FileSystem.cacheDirectory}narra-catalog-content`;
const PROGRESS_VERSION = 1;
const MAX_CONTENT_ATTEMPTS = 3;

export interface BackendBookContentDownload {
  filePath: string;
  representation: string;
  contentHash: string;
  textLength: number;
  byteSize: number;
}

export interface BackendBookContentDownloadOptions {
  signal?: AbortSignal;
  /** Вызывается после каждого записанного чанка. */
  onProgress?: (writtenBytes: number, totalBytes: number) => void;
}

/**
 * Что уже лежит в файле и с какого места продолжать. Пишется после каждого
 * чанка, поэтому оборванная загрузка возобновляется с последнего целого куска,
 * а не с нуля.
 */
interface StoredContentProgress {
  version: number;
  representation: string;
  contentHash: string;
  byteSize: number;
  textLength: number;
  writtenBytes: number;
  nextCursor: string | null;
}

type ContentMeta = Pick<
  StoredContentProgress,
  "representation" | "contentHash" | "byteSize" | "textLength"
>;

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

function contentPaths(book: Pick<BackendCatalogBook, "bookEditionId" | "catalogKey">): {
  textPath: string;
  progressPath: string;
} {
  const base = `${CONTENT_CACHE_ROOT}/${safePart(book.catalogKey)}-${safePart(book.bookEditionId)}`;
  return { textPath: `${base}.txt`, progressPath: `${base}.progress.json` };
}

function abortError(): Error {
  const error = new Error("Backend book content download was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function retryDelay(attempt: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, attempt * 350);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function versionChangedError(): NarraServiceError {
  return new NarraServiceError(
    "SERVICE",
    "Версия текста книги изменилась во время загрузки",
    undefined,
    undefined,
    CONTENT_VERSION_CHANGED,
  );
}

async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureContentDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CONTENT_CACHE_ROOT);
  if (!info.exists)
    await FileSystem.makeDirectoryAsync(CONTENT_CACHE_ROOT, { intermediates: true });
}

async function readProgress(progressPath: string): Promise<StoredContentProgress | null> {
  try {
    const value = JSON.parse(
      await FileSystem.readAsStringAsync(progressPath),
    ) as StoredContentProgress;
    if (
      value.version !== PROGRESS_VERSION ||
      typeof value.representation !== "string" ||
      typeof value.contentHash !== "string" ||
      !Number.isSafeInteger(value.byteSize) ||
      !Number.isSafeInteger(value.textLength) ||
      !Number.isSafeInteger(value.writtenBytes) ||
      value.writtenBytes < 0 ||
      value.writtenBytes > value.byteSize ||
      (value.nextCursor !== null && (typeof value.nextCursor !== "string" || !value.nextCursor))
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function writeProgress(progressPath: string, value: StoredContentProgress): Promise<void> {
  await FileSystem.writeAsStringAsync(progressPath, JSON.stringify(value));
}

async function resetDownload(textPath: string, progressPath: string): Promise<void> {
  await FileSystem.deleteAsync(textPath, { idempotent: true });
  await FileSystem.deleteAsync(progressPath, { idempotent: true });
  await FileSystem.writeAsStringAsync(textPath, "");
}

async function appendText(textPath: string, text: string): Promise<void> {
  const { appendFile } = await import("@dr.pogodin/react-native-fs");
  await appendFile(textPath, text, "utf8");
}

async function verifyAssembledText(textPath: string, meta: ContentMeta): Promise<void> {
  const info = await FileSystem.getInfoAsync(textPath);
  if (!info.exists || info.isDirectory || info.size !== meta.byteSize) {
    throw new NarraServiceError("SERVICE", "Текст книги собрался не полностью");
  }
  if ((await sha256BackendFile(textPath)).toLowerCase() !== meta.contentHash) {
    throw new NarraServiceError("SERVICE", "Текст книги не сошёлся по контрольной сумме");
  }
}

/**
 * Один проход по чанкам. `allowResume` выключается на повторе после
 * CONTENT_VERSION_CHANGED: продолжать по курсору прошлой версии текста нельзя.
 */
async function runDownload(
  book: Pick<BackendCatalogBook, "bookEditionId" | "catalogKey">,
  { signal, onProgress }: BackendBookContentDownloadOptions,
  allowResume: boolean,
): Promise<BackendBookContentDownload> {
  const { textPath, progressPath } = contentPaths(book);
  let progress = allowResume ? await readProgress(progressPath) : null;

  if (progress) {
    // Файл и учёт обязаны сойтись байт в байт: иначе прошлый запуск умер между
    // дописыванием куска и сохранением прогресса, и место продолжения неизвестно.
    const info = await FileSystem.getInfoAsync(textPath);
    if (!info.exists || info.isDirectory || info.size !== progress.writtenBytes) progress = null;
  }

  if (progress && progress.nextCursor === null) {
    if (progress.writtenBytes === progress.byteSize) {
      await verifyAssembledText(textPath, progress);
      onProgress?.(progress.writtenBytes, progress.byteSize);
      return {
        filePath: textPath,
        representation: progress.representation,
        contentHash: progress.contentHash,
        textLength: progress.textLength,
        byteSize: progress.byteSize,
      };
    }
    progress = null;
  }

  if (!progress) await resetDownload(textPath, progressPath);

  let meta: ContentMeta | null = progress
    ? {
        representation: progress.representation,
        contentHash: progress.contentHash,
        byteSize: progress.byteSize,
        textLength: progress.textLength,
      }
    : null;
  let writtenBytes = progress?.writtenBytes ?? 0;
  let cursor = progress?.nextCursor ?? undefined;
  const seenCursors = new Set<string>(cursor ? [cursor] : []);

  while (true) {
    throwIfAborted(signal);
    const response = await fetchBackendBookContentChunk(book.bookEditionId, cursor);
    if (!meta) {
      meta = {
        representation: response.representation,
        contentHash: response.contentHash,
        byteSize: response.byteSize,
        textLength: response.textLength,
      };
    } else if (
      response.contentHash !== meta.contentHash ||
      response.representation !== meta.representation ||
      response.byteSize !== meta.byteSize ||
      response.textLength !== meta.textLength
    ) {
      throw versionChangedError();
    }

    const bytes = new TextEncoder().encode(response.chunk.text);
    if (
      response.chunk.startByte !== writtenBytes ||
      response.chunk.endByteExclusive - response.chunk.startByte !== bytes.byteLength
    ) {
      throw new NarraServiceError("SERVICE", "Backend вернул несвязные чанки книги");
    }
    // Контракт даёт хэш каждого куска — единственная защита от подменённого или
    // побитого чанка нужной длины. Проверяем до записи в файл.
    if ((await sha256Bytes(bytes)) !== response.chunk.contentHash) {
      throw new NarraServiceError("SERVICE", "Чанк книги не сошёлся по контрольной сумме");
    }

    await appendText(textPath, response.chunk.text);
    writtenBytes = response.chunk.endByteExclusive;
    await writeProgress(progressPath, {
      version: PROGRESS_VERSION,
      ...meta,
      writtenBytes,
      nextCursor: response.nextCursor,
    });
    onProgress?.(writtenBytes, meta.byteSize);

    if (!response.nextCursor) break;
    if (seenCursors.has(response.nextCursor)) {
      throw new NarraServiceError("SERVICE", "Backend повторил cursor чанка книги");
    }
    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  if (!meta || writtenBytes !== meta.byteSize) {
    throw new NarraServiceError("SERVICE", "Backend вернул неполный текст книги");
  }
  await verifyAssembledText(textPath, meta);
  await FileSystem.deleteAsync(progressPath, { idempotent: true });
  return {
    filePath: textPath,
    representation: meta.representation,
    contentHash: meta.contentHash,
    textLength: meta.textLength,
    byteSize: meta.byteSize,
  };
}

/**
 * Собирает нормализованный текст книги из чанков в файл на диске.
 *
 * Прерванная загрузка возобновляется с последнего целого чанка: и файл, и
 * курсор переживают перезапуск приложения. Каждый кусок проверяется по своему
 * хэшу, собранный текст — по хэшу всей книги.
 */
export async function downloadBackendBookContent(
  book: Pick<BackendCatalogBook, "bookEditionId" | "catalogKey">,
  options: BackendBookContentDownloadOptions = {},
): Promise<BackendBookContentDownload> {
  await ensureContentDirectory();
  let allowResume = true;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CONTENT_ATTEMPTS; attempt += 1) {
    try {
      return await runDownload(book, options, allowResume);
    } catch (error) {
      if (options.signal?.aborted || isBackendDownloadAbort(error)) throw abortError();
      lastError = error;
      // Текст обновился прямо во время загрузки: накопленное относится к прошлой
      // версии, поэтому следующая попытка обязана начаться с чистого листа.
      // Все остальные сбои — сеть, побитый чанк — продолжают с последнего
      // целого куска: ради этого прогресс и пишется на диск.
      allowResume = !isContentVersionChanged(error);
      if (attempt < MAX_CONTENT_ATTEMPTS) await retryDelay(attempt, options.signal);
    }
  }
  throw lastError;
}

export async function cleanupBackendBookContent(filePath: string | null): Promise<void> {
  if (!filePath || !filePath.startsWith(CONTENT_CACHE_ROOT)) return;
  await FileSystem.deleteAsync(filePath, { idempotent: true });
  await FileSystem.deleteAsync(filePath.replace(/\.txt$/, ".progress.json"), { idempotent: true });
}
