import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import {
  type BackendBookContentChunk,
  type BackendCatalogBook,
  fetchBackendBookContentChunk,
} from "./backend-book-api";
import { sha256BackendFile } from "./backend-file-hash";
import { NarraServiceError } from "./errors";

const IMPORT_CACHE_ROOT = `${FileSystem.cacheDirectory}narra-catalog-import`;
const MAX_CONTENT_VERSION_RESTARTS = 1;

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

async function ensureImportCache(): Promise<void> {
  const info = await FileSystem.getInfoAsync(IMPORT_CACHE_ROOT);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMPORT_CACHE_ROOT, { intermediates: true });
  }
}

class ContentVersionChangedError extends Error {}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateChunk(
  response: BackendBookContentChunk,
  expectedOffset: number,
): Promise<Uint8Array> {
  const { chunk } = response;
  const bytes = new TextEncoder().encode(chunk.text);
  if (
    chunk.startByte !== expectedOffset ||
    chunk.endByteExclusive !== expectedOffset + bytes.byteLength ||
    chunk.endByteExclusive > response.byteSize
  ) {
    throw new Error("Backend catalog chunk offsets are not continuous");
  }
  const digest = bytesToHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  if (digest !== chunk.contentHash) {
    throw new Error("Backend catalog chunk checksum mismatch");
  }
  return bytes;
}

function sameContentVersion(
  first: BackendBookContentChunk,
  current: BackendBookContentChunk,
): boolean {
  return (
    current.contractVersion === first.contractVersion &&
    current.representation === first.representation &&
    current.bookEditionId === first.bookEditionId &&
    current.contentHash === first.contentHash &&
    current.textLength === first.textLength &&
    current.byteSize === first.byteSize
  );
}

function isContentVersionChanged(error: unknown): boolean {
  return (
    error instanceof ContentVersionChangedError ||
    (error instanceof NarraServiceError && error.backendCode === "CONTENT_VERSION_CHANGED")
  );
}

async function receiveBackendCatalogContent(
  book: BackendCatalogBook,
  temporaryPath: string,
  finalPath: string,
): Promise<string> {
  await FileSystem.deleteAsync(temporaryPath, { idempotent: true });
  let cursor: string | null = null;
  let expectedOffset = 0;
  let first: BackendBookContentChunk | null = null;
  const cursors = new Set<string>();

  do {
    const response = await fetchBackendBookContentChunk(book.bookEditionId, cursor);
    if (first && !sameContentVersion(first, response)) throw new ContentVersionChangedError();
    first ??= response;

    const bytes = await validateChunk(response, expectedOffset);
    await FileSystem.writeAsStringAsync(temporaryPath, response.chunk.text, {
      encoding: FileSystem.EncodingType.UTF8,
      append: expectedOffset > 0,
    });
    expectedOffset += bytes.byteLength;

    const nextCursor = response.nextCursor;
    if (nextCursor) {
      if (cursors.has(nextCursor)) throw new Error("Backend catalog content cursor loop");
      if (expectedOffset >= response.byteSize) {
        throw new Error("Backend catalog content has a cursor past the end of the book");
      }
      cursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor);

  if (!first || expectedOffset !== first.byteSize) {
    throw new Error("Backend catalog content ended before the declared byte size");
  }
  const info = await FileSystem.getInfoAsync(temporaryPath);
  if (!info.exists || info.isDirectory || info.size !== first.byteSize) {
    throw new Error("Backend catalog content byte size mismatch");
  }
  if ((await sha256BackendFile(temporaryPath)) !== first.contentHash) {
    throw new Error("Backend catalog content checksum mismatch");
  }

  await FileSystem.deleteAsync(finalPath, { idempotent: true });
  await FileSystem.moveAsync({ from: temporaryPath, to: finalPath });
  return finalPath;
}

/** Receives normalized catalog text in verified book-content-v1 chunks for the mobile importer. */
export async function downloadBackendCatalogSource(book: BackendCatalogBook): Promise<string> {
  await ensureImportCache();
  const filePath = `${IMPORT_CACHE_ROOT}/${safePart(book.catalogKey)}-${safePart(
    book.bookEditionId,
  )}.txt`;
  const temporaryPath = `${filePath}.part`;
  await FileSystem.deleteAsync(filePath, { idempotent: true });

  for (let restart = 0; restart <= MAX_CONTENT_VERSION_RESTARTS; restart += 1) {
    try {
      return await receiveBackendCatalogContent(book, temporaryPath, filePath);
    } catch (error) {
      await FileSystem.deleteAsync(temporaryPath, { idempotent: true });
      if (restart < MAX_CONTENT_VERSION_RESTARTS && isContentVersionChanged(error)) continue;
      throw error;
    }
  }
  throw new Error("Backend catalog content version changed repeatedly");
}

export async function cleanupBackendCatalogSource(filePath: string | null): Promise<void> {
  if (!filePath || !filePath.startsWith(IMPORT_CACHE_ROOT)) return;
  await FileSystem.deleteAsync(filePath, { idempotent: true });
}
