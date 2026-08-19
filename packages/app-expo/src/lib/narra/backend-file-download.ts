import { getPlatformService } from "@readany/core/services";
import * as FileSystem from "expo-file-system/legacy";
import { requestBackendDownloadUrl } from "./backend-catalog-api";
import { sha256BackendFile } from "./backend-file-hash";

const MAX_DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_ATTEMPT_TIMEOUT_MS = 135_000;

interface VerifiedBackendDownload {
  downloadPath: string;
  destinationPath: string;
  expectedSha256: string;
  expectedByteSize?: number;
  label: string;
  signal?: AbortSignal;
  attemptTimeoutMs?: number;
}

function abortError(): Error {
  const error = new Error("Backend file download was cancelled");
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
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.signal);
    await FileSystem.deleteAsync(options.destinationPath, { idempotent: true });
    try {
      const url = await requestBackendDownloadUrl(options.downloadPath);
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
      if (attempt < MAX_DOWNLOAD_ATTEMPTS) await retryDelay(attempt, options.signal);
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${options.label} download failed after ${MAX_DOWNLOAD_ATTEMPTS} attempts: ${detail}`,
  );
}
