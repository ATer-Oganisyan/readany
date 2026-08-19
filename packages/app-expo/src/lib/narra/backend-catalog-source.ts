import * as FileSystem from "expo-file-system/legacy";
import type { BackendCatalogBook } from "./backend-catalog-api";
import { downloadVerifiedBackendFile } from "./backend-file-download";

const IMPORT_CACHE_ROOT = `${FileSystem.cacheDirectory}narra-catalog-import`;

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

function safeExtension(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "") || "epub";
}

export async function downloadBackendCatalogSource(
  book: BackendCatalogBook,
  signal?: AbortSignal,
): Promise<string> {
  const cacheInfo = await FileSystem.getInfoAsync(IMPORT_CACHE_ROOT);
  if (!cacheInfo.exists) {
    await FileSystem.makeDirectoryAsync(IMPORT_CACHE_ROOT, { intermediates: true });
  }
  const filePath = `${IMPORT_CACHE_ROOT}/${safePart(book.catalogKey)}-${safePart(
    book.bookEditionId,
  )}.${safeExtension(book.format)}`;
  await FileSystem.deleteAsync(filePath, { idempotent: true });

  await downloadVerifiedBackendFile({
    downloadPath: book.sourceDownloadPath,
    destinationPath: filePath,
    expectedSha256: book.contentSha256,
    label: "Backend catalog source",
    signal,
  });
  return filePath;
}

export async function cleanupBackendCatalogSource(filePath: string | null): Promise<void> {
  if (!filePath || !filePath.startsWith(IMPORT_CACHE_ROOT)) return;
  await FileSystem.deleteAsync(filePath, { idempotent: true });
}
