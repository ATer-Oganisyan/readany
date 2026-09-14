import { getPlatformService } from "@readany/core/services";
import * as FileSystem from "expo-file-system/legacy";
import { requestBackendDownloadUrl } from "./backend-catalog-api";
import { sha256BackendFile } from "./backend-file-hash";
import { NarraServiceError } from "./errors";

const MAX_DOWNLOAD_ATTEMPTS = 4;
/** Обложка не держит экран: ей выгоднее быстро сдаться и вернуться при прокрутке. */
export const COVER_DOWNLOAD_RETRY = Object.freeze({
  maxAttempts: 2,
  retryDelaysMs: Object.freeze([350]) as readonly number[],
});
const DOWNLOAD_ATTEMPT_TIMEOUT_MS = 135_000;
/**
 * Паузы между попытками. Прежние 350 мс укладывались в одно и то же минутное
 * окно лимита запросов гейтвея: подряд идущие попытки получали тот же 429, и
 * книга открывалась только с третьего-четвёртого касания — уже после сброса
 * окна. Ждём ощутимо дольше, а сервер может назвать свой срок сам.
 */
const RETRY_DELAYS_MS = [1_000, 4_000, 12_000];
const MAX_RETRY_DELAY_MS = 30_000;

interface VerifiedBackendDownload {
  downloadPath: string;
  destinationPath: string;
  expectedSha256: string;
  expectedByteSize?: number;
  label: string;
  signal?: AbortSignal;
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  retryDelaysMs?: readonly number[];
}

function abortError(): Error {
  const error = new Error("Backend file download was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Сервер называет срок сам (Retry-After / RateLimit-Reset) — он точнее шкалы. */
function retryDelayMs(attempt: number, error: unknown, delays: readonly number[]): number {
  const hinted = error instanceof NarraServiceError ? error.retryAfterMs : undefined;
  const planned = delays[attempt - 1] ?? delays[delays.length - 1] ?? 0;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(planned, hinted ?? 0));
}

function retryDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isBackendDownloadAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function verifyDownloadedFile({
  destinationPath,
  expectedSha256,
  expectedByteSize,
  label,
}: Omit<VerifiedBackendDownload, "downloadPath">): Promise<void> {
  const info = await FileSystem.getInfoAsync(destinationPath);
  if (!info.exists || info.isDirectory) throw new Error(`${label} download is missing`);
  if (expectedByteSize !== undefined && info.size !== expectedByteSize) {
    throw new Error(`${label} size mismatch`);
  }
  if ((await sha256BackendFile(destinationPath)).toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`${label} checksum mismatch`);
  }
}

/**
 * Downloads through the foreground NSURLSession used by the rest of the app.
 * A fresh signed URL is requested for every attempt: iOS background sessions
 * can cache a transient DNS failure for the lifetime of a task.
 */
export async function downloadVerifiedBackendFile(options: VerifiedBackendDownload): Promise<void> {
  const platform = getPlatformService();
  if (!platform.downloadFile) throw new Error("Platform file downloader is unavailable");
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_DOWNLOAD_ATTEMPTS);
  const retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    await FileSystem.deleteAsync(options.destinationPath, { idempotent: true });
    try {
      const url = await requestBackendDownloadUrl(options.downloadPath, options.signal);
      throwIfAborted(options.signal);
      await platform.downloadFile(url, options.destinationPath, {
        signal: options.signal,
        timeoutMs: options.attemptTimeoutMs ?? DOWNLOAD_ATTEMPT_TIMEOUT_MS,
      });
      throwIfAborted(options.signal);
      await verifyDownloadedFile(options);
      return;
    } catch (error) {
      lastError = error;
      await FileSystem.deleteAsync(options.destinationPath, { idempotent: true });
      if (options.signal?.aborted || isBackendDownloadAbort(error)) throw abortError();
      if (attempt < maxAttempts) {
        await retryDelay(retryDelayMs(attempt, error, retryDelaysMs), options.signal);
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${options.label} download failed after ${maxAttempts} attempts: ${detail}`);
}
