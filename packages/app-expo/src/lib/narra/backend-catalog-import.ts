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
 * Каталожная книга снова загружается целиком через source_download_path.
 * Контентные чанки здесь намеренно не используются: скачанный исходный файл
 * напрямую уходит в обычный импорт и открывается текущим ридером.
 *
 * Обложка не задерживает открытие книги. После импорта она устанавливается в
 * фоне и обновляет карточку отдельной записью.
 */
export async function importBackendCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  { importBooks, updateBook, signal }: ImportBackendCatalogBookOptions,
): Promise<Book> {
  let temporarySource: string | null = null;
  try {
    temporarySource = await downloadBackendCatalogSource(catalogBook, signal);
    const result = await importBooks([
      { uri: temporarySource, name: `${catalogBook.catalogKey}.${catalogBook.format}` },
    ]);
    const importedBook = result.imported[0] ?? result.skippedDuplicates[0]?.existingBook;
    if (!importedBook) throw new Error("catalog-import-failed");

    const meta = {
      ...importedBook.meta,
      title: catalogBook.title,
      author: catalogBook.author,
    };
    await updateBook(importedBook.id, { meta });
    // Обложка не нужна для чтения. Не держим ридер на лоадере, пока она
    // скачивается и копируется; карточка обновится отдельно уже после открытия.
    void materializeBackendCatalogCover(catalogBook, signal)
      .catch((error) => {
        console.warn(`[Catalog] Failed to download cover ${catalogBook.catalogKey}:`, error);
        return undefined;
      })
      .then(async (materializedCoverUri) => {
        const coverUri = materializedCoverUri ?? catalogBook.coverUri;
        const coverUrl = await installBackendCatalogCover(importedBook.id, {
          ...catalogBook,
          coverUri,
        });
        if (coverUrl) await updateBook(importedBook.id, { meta: { ...meta, coverUrl } });
      })
      .catch((error) => {
        console.warn(`[Catalog] Failed to install cover ${catalogBook.catalogKey}:`, error);
      });
    return { ...importedBook, meta };
  } finally {
    await cleanupBackendCatalogSource(temporarySource).catch((error) => {
      console.warn("[Catalog] Failed to remove temporary source:", error);
    });
  }
}
