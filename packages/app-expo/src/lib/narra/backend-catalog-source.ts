import * as FileSystem from "expo-file-system/legacy";
import { type BackendCatalogBook, requestBackendDownloadUrl } from "./backend-book-api";
import { sha256BackendFile } from "./backend-file-hash";

const IMPORT_CACHE_ROOT = `${FileSystem.cacheDirectory}narra-catalog-import`;

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

function safeExtension(value: string): string {
  const extension = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return extension || "epub";
}

async function ensureImportCache(): Promise<void> {
  const info = await FileSystem.getInfoAsync(IMPORT_CACHE_ROOT);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMPORT_CACHE_ROOT, { intermediates: true });
  }
}

/** Downloads a catalog source to an absolute file:// URI suitable for the mobile importer. */
export async function downloadBackendCatalogSource(book: BackendCatalogBook): Promise<string> {
  await ensureImportCache();
  const filePath = `${IMPORT_CACHE_ROOT}/${safePart(book.catalogKey)}-${safePart(
    book.bookEditionId,
  )}.${safeExtension(book.format)}`;
  await FileSystem.deleteAsync(filePath, { idempotent: true });

  const downloadUrl = await requestBackendDownloadUrl(book.sourceDownloadPath);
  const task = FileSystem.createDownloadResumable(downloadUrl, filePath, {
    sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
  });
  const result = await task.downloadAsync();
  if (!result) throw new Error("Backend catalog download was cancelled");
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
    throw new Error(`Backend catalog download failed (${result.status})`);
  }

  const contentHash = await sha256BackendFile(filePath);
  if (contentHash.toLowerCase() !== book.contentSha256.toLowerCase()) {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
    throw new Error("Backend catalog checksum mismatch");
  }
  return filePath;
}

export async function cleanupBackendCatalogSource(filePath: string | null): Promise<void> {
  if (!filePath || !filePath.startsWith(IMPORT_CACHE_ROOT)) return;
  await FileSystem.deleteAsync(filePath, { idempotent: true });
}
