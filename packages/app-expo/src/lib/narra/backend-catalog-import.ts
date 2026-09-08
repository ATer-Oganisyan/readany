import type { LibraryState } from "@/stores/library-store";
import { useNarraStore } from "@/stores/narra-store";
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
import { normalizeBookLanguage } from "./book-language";

interface ImportBackendCatalogBookOptions extends Pick<LibraryState, "importBooks" | "updateBook"> {
  signal?: AbortSignal;
}

const activeCatalogImports = new Map<string, Promise<Book>>();

async function performDownloadedBackendCatalogImport(
  catalogBook: CachedBackendCatalogBook,
  sourcePath: string,
  { importBooks, updateBook, signal }: ImportBackendCatalogBookOptions,
): Promise<Book> {
  if (signal?.aborted) throw signal.reason ?? new Error("catalog-import-aborted");
  const result = await importBooks([
    {
      uri: sourcePath,
      name: `${catalogBook.catalogKey}.${catalogBook.format}`,
      knownBook: {
        ...(catalogBook.language ? { language: catalogBook.language } : {}),
        title: catalogBook.title,
        author: catalogBook.author,
        sourceKind: "catalog",
        bookEditionId: catalogBook.bookEditionId,
        contentHash: catalogBook.contentSha256,
        revisionId: catalogBook.contentSha256,
      },
    },
  ]);
  const importedBook = result.imported[0] ?? result.skippedDuplicates[0]?.existingBook;
  if (!importedBook) throw new Error("catalog-import-failed");

  const meta = {
    ...importedBook.meta,
    title: catalogBook.title,
    author: catalogBook.author,
    language: normalizeBookLanguage(catalogBook.language) ?? importedBook.meta.language,
  };
  const catalogIdentity = {
    sourceKind: "catalog" as const,
    catalogKey: catalogBook.catalogKey,
    bookEditionId: catalogBook.bookEditionId,
    contentHash: catalogBook.contentSha256,
    revisionId: catalogBook.contentSha256,
  };
  // importBooks has already mutated the library. From this point identity
  // finalization is transactional from the caller's perspective and must not
  // be interrupted by a screen-unmount abort.
  await updateBook(importedBook.id, { meta, ...catalogIdentity });
  useNarraStore.getState().setBackendBinding(importedBook.id, {
    resolution: "catalog",
    language: normalizeBookLanguage(catalogBook.language),
    bookEditionId: catalogBook.bookEditionId,
    catalogKey: catalogBook.catalogKey,
    contentSha256: catalogBook.contentSha256,
    sourceUploaded: true,
  });
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
  return { ...importedBook, meta, ...catalogIdentity };
}

export function importDownloadedBackendCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  sourcePath: string,
  options: ImportBackendCatalogBookOptions,
): Promise<Book> {
  const revisionKey = `${catalogBook.bookEditionId}:${catalogBook.contentSha256}`;
  const activeImport = activeCatalogImports.get(revisionKey);
  if (activeImport) return activeImport;

  const importPromise = performDownloadedBackendCatalogImport(catalogBook, sourcePath, options);
  activeCatalogImports.set(revisionKey, importPromise);
  const clear = () => {
    if (activeCatalogImports.get(revisionKey) === importPromise) {
      activeCatalogImports.delete(revisionKey);
    }
  };
  void importPromise.then(clear, clear);
  return importPromise;
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
    return await importDownloadedBackendCatalogBook(catalogBook, temporarySource, {
      importBooks,
      updateBook,
      signal,
    });
  } finally {
    await cleanupBackendCatalogSource(temporarySource).catch((error) => {
      console.warn("[Catalog] Failed to remove temporary source:", error);
    });
  }
}
