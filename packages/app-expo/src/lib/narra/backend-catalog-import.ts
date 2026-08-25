import type { LibraryState } from "@/stores/library-store";
import type { Book } from "@readany/core/types";
import {
  cleanupBackendBookContent,
  downloadBackendBookContent,
} from "./backend-book-content-download";
import {
  type CachedBackendCatalogBook,
  installBackendCatalogCover,
  materializeBackendCatalogCover,
} from "./backend-catalog-cache";
import {
  cleanupBackendCatalogSource,
  downloadBackendCatalogSource,
} from "./backend-catalog-source";
import { isBackendDownloadAbort } from "./backend-file-download";
import { narraBackendCode } from "./errors";

interface ImportBackendCatalogBookOptions extends Pick<LibraryState, "importBooks" | "updateBook"> {
  signal?: AbortSignal;
  /** Доля загруженного от 0 до 1. Известна только на пути чанков. */
  onProgress?: (fraction: number) => void;
}

interface PreparedCatalogSource {
  uri: string;
  name: string;
  cleanup: () => Promise<void>;
}

/**
 * Выключатель на случай, если у чанков найдётся проблема уже в проде: сборка с
 * `EXPO_PUBLIC_NARRA_BOOK_CHUNKS=0` возвращается на загрузку epub целиком.
 */
function chunkedContentEnabled(): boolean {
  const value = process.env.EXPO_PUBLIC_NARRA_BOOK_CHUNKS?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

async function prepareEpubSource(
  catalogBook: CachedBackendCatalogBook,
  signal?: AbortSignal,
): Promise<PreparedCatalogSource> {
  const path = await downloadBackendCatalogSource(catalogBook, signal);
  return {
    uri: path,
    name: `${catalogBook.catalogKey}.${catalogBook.format}`,
    cleanup: () => cleanupBackendCatalogSource(path),
  };
}

/**
 * Текст книги приезжает чанками: это даёт докачку после обрыва и проверку
 * хэшей, которых у загрузки epub целиком нет. Собранный текст уходит в тот же
 * импорт, что и обычный txt-файл, — конвертер в epub у приложения уже есть.
 *
 * Подготовленного текста у книги может не быть вовсе (backend отвечает
 * `NOT_FOUND`) — тогда откатываемся на исходный файл. Остальные сбои
 * пробрасываем: молчаливый откат на каждую ошибку удвоил бы трафик и спрятал
 * бы поломку чанков от нас.
 */
async function prepareCatalogSource(
  catalogBook: CachedBackendCatalogBook,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<PreparedCatalogSource> {
  if (!chunkedContentEnabled()) return prepareEpubSource(catalogBook, signal);
  try {
    const content = await downloadBackendBookContent(catalogBook, {
      signal,
      onProgress: (written, total) => {
        if (total > 0) onProgress?.(Math.min(1, written / total));
      },
    });
    return {
      uri: content.filePath,
      name: `${catalogBook.catalogKey}.txt`,
      cleanup: () => cleanupBackendBookContent(content.filePath),
    };
  } catch (error) {
    if (isBackendDownloadAbort(error)) throw error;
    if (narraBackendCode(error) !== "NOT_FOUND") throw error;
    console.warn(
      `[Catalog] У книги ${catalogBook.catalogKey} нет подготовленного текста, качаем исходник`,
    );
    return prepareEpubSource(catalogBook, signal);
  }
}

/**
 * Текст книги -> файл -> проверка хэша -> импорт в библиотеку. Обложка
 * качается параллельно с книгой: она нужна только для карточки, поэтому её
 * ошибка не отменяет импорт. Прерывание через signal откатывать не нужно —
 * временный файл всё равно удаляется в finally.
 */
export async function importBackendCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  { importBooks, updateBook, signal, onProgress }: ImportBackendCatalogBookOptions,
): Promise<Book> {
  let source: PreparedCatalogSource | null = null;
  try {
    const coverPromise = materializeBackendCatalogCover(catalogBook, signal).catch((error) => {
      console.warn(`[Catalog] Failed to download cover ${catalogBook.catalogKey}:`, error);
      return undefined;
    });
    source = await prepareCatalogSource(catalogBook, signal, onProgress);
    const result = await importBooks([{ uri: source.uri, name: source.name }]);
    const importedBook = result.imported[0] ?? result.skippedDuplicates[0]?.existingBook;
    if (!importedBook) throw new Error("catalog-import-failed");

    const coverUri = (await coverPromise) ?? catalogBook.coverUri;
    const coverUrl =
      (await installBackendCatalogCover(importedBook.id, { ...catalogBook, coverUri })) ??
      importedBook.meta.coverUrl;
    const meta = {
      ...importedBook.meta,
      title: catalogBook.title,
      author: catalogBook.author,
      coverUrl,
    };
    await updateBook(importedBook.id, { meta });
    return { ...importedBook, meta };
  } finally {
    await source?.cleanup().catch((error) => {
      console.warn("[Catalog] Failed to remove temporary source:", error);
    });
  }
}
