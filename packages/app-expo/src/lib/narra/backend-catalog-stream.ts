import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import { TxtToEpubConverter } from "@readany/core/utils/txt-to-epub";
import * as FileSystem from "expo-file-system/legacy";
import {
  type BackendCatalogContentBook,
  type BackendCatalogSourceState,
  appendBackendCatalogSource,
} from "./backend-catalog-source";
import { backendCatalogLoadedFraction } from "./backend-catalog-stream-progress";

export {
  CATALOG_CHUNK_PREFETCH_FRACTION,
  backendCatalogLoadedFraction,
  backendCatalogReaderProgress,
  estimateBackendCatalogLocations,
  shouldPrefetchBackendCatalogChunk,
} from "./backend-catalog-stream-progress";

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function txtFileShim(bytes: Uint8Array, name: string): File {
  return {
    name,
    size: bytes.byteLength,
    type: "text/plain",
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    slice: (start?: number, end?: number) => {
      const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
      return {
        arrayBuffer: () =>
          Promise.resolve(
            sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength),
          ),
        size: sliced.byteLength,
      };
    },
    stream: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  } as unknown as File;
}

export interface RefreshedBackendCatalogEpub {
  state: BackendCatalogSourceState;
  filePath: string;
  replacedFilePath: string;
}

/** Appends one network chunk and creates a new immutable EPUB snapshot for a safe reader reload. */
export async function appendBackendCatalogChunkToEpub(
  book: Book,
  catalog: BackendCatalogContentBook,
  minimumLoadedFraction?: number,
): Promise<RefreshedBackendCatalogEpub> {
  let prepared = await appendBackendCatalogSource(catalog);
  const target = clampFraction(minimumLoadedFraction ?? 0);
  while (prepared.state.nextCursor && backendCatalogLoadedFraction(prepared.state) < target) {
    prepared = await appendBackendCatalogSource(catalog);
  }
  const platform = getPlatformService();
  const bytes = await platform.readFile(prepared.filePath);
  const converter = new TxtToEpubConverter();
  const conversion = await converter.convertToBytes({
    file: txtFileShim(bytes, `${catalog.catalogKey}.txt`),
  });

  const appData = await platform.getAppDataDir();
  const booksDirectory = await platform.joinPath(appData, "books");
  await platform.mkdir(booksDirectory);
  const relativePath = `books/${book.id}-catalog-${prepared.state.receivedBytes}.epub`;
  const absolutePath = await platform.joinPath(appData, relativePath);
  const temporaryPath = `${absolutePath}.${Date.now()}.tmp`;
  await platform.writeFile(temporaryPath, conversion.epubBytes);
  await FileSystem.deleteAsync(absolutePath, { idempotent: true });
  await FileSystem.moveAsync({ from: temporaryPath, to: absolutePath });

  return {
    state: prepared.state,
    filePath: relativePath,
    replacedFilePath: book.filePath,
  };
}

/** Removes an obsolete EPUB snapshot after the WebView has switched to the new immutable file. */
export async function cleanupReplacedBackendCatalogEpub(
  bookId: string,
  relativePath: string,
): Promise<void> {
  const expectedPrefix = `books/${bookId}`;
  if (!relativePath.startsWith(expectedPrefix) || !relativePath.endsWith(".epub")) return;
  const platform = getPlatformService();
  const absolutePath = await platform.joinPath(await platform.getAppDataDir(), relativePath);
  await platform.deleteFile(absolutePath);
}
