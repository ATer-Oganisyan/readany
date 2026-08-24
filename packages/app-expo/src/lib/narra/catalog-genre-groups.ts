import type { BackendCatalogBook } from "./backend-book-api";
import { CATALOG_GENRE_IDS, type CatalogGenreId, isCatalogGenreId } from "./catalog-genres";

export type CatalogGenreGroupId = CatalogGenreId | "unclassified";

export interface CatalogGenreGroup<T extends BackendCatalogBook = BackendCatalogBook> {
  genre: CatalogGenreGroupId;
  books: T[];
}

/** Keeps the shared taxonomy order and preserves the backend order inside each genre. */
export function groupCatalogBooksByGenre<T extends BackendCatalogBook>(
  books: readonly T[],
): CatalogGenreGroup<T>[] {
  const byGenre = new Map<CatalogGenreGroupId, T[]>();
  for (const book of books) {
    const genres = [...new Set(book.genres?.filter(isCatalogGenreId) ?? [])];
    for (const genre of genres.length > 0 ? genres : ["unclassified" as const]) {
      const group = byGenre.get(genre);
      if (group) group.push(book);
      else byGenre.set(genre, [book]);
    }
  }

  return [...CATALOG_GENRE_IDS, "unclassified" as const].flatMap((genre) => {
    const group = byGenre.get(genre);
    return group?.length ? [{ genre, books: group }] : [];
  });
}
