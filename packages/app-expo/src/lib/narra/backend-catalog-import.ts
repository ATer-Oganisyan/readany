import type { LibraryState } from "@/stores/library-store";
import type { Book } from "@readany/core/types";
import {
  type CachedBackendCatalogBook,
  installBackendCatalogCover,
  materializeBackendCatalogCover,
} from "./backend-catalog-cache";
import {
  cleanupBackendCatalogSource,
  downloadBackendCatalogSource,
} from "./backend-catalog-source";

interface ImportBackendCatalogBookOptions extends Pick<LibraryState, "importBooks" | "updateBook"> {
  signal?: AbortSignal;
}

/**
 * Подписанная ссылка -> файл -> проверка хэша -> импорт в библиотеку. Обложка
 * качается параллельно с книгой: она нужна только для карточки, поэтому её
 * ошибка не отменяет импорт. Прерывание через signal откатывать не нужно —
 * временный файл всё равно удаляется в finally.
 */
export async function importBackendCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  { importBooks, updateBook, signal }: ImportBackendCatalogBookOptions,
): Promise<Book> {
  let temporarySource: string | null = null;
  try {
    const coverPromise = materializeBackendCatalogCover(catalogBook, signal).catch((error) => {
      console.warn(`[Catalog] Failed to download cover ${catalogBook.catalogKey}:`, error);
      return undefined;
    });
    temporarySource = await downloadBackendCatalogSource(catalogBook, signal);
    const result = await importBooks([
      { uri: temporarySource, name: `${catalogBook.catalogKey}.${catalogBook.format}` },
    ]);
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
    await cleanupBackendCatalogSource(temporarySource).catch((error) => {
      console.warn("[Catalog] Failed to remove temporary source:", error);
    });
  }
}
