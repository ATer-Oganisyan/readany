import type { BackendCatalogBook } from "./backend-book-api";
import { type CatalogGenreId, isCatalogGenreId } from "./catalog-genres";

export type CatalogGenreGroupId = CatalogGenreId | "unclassified";

export interface CatalogGenreGroup<T extends BackendCatalogBook = BackendCatalogBook> {
  genre: CatalogGenreGroupId;
  books: T[];
}

/** Orders genres by their highest-ranked backend book and preserves book order inside each genre. */
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

  const rankedGroups = [...byGenre.entries()]
    .filter(([genre]) => genre !== "unclassified")
    .map(([genre, groupedBooks]) => ({ genre, books: groupedBooks }));
  const unclassified = byGenre.get("unclassified");
  return unclassified?.length
    ? [...rankedGroups, { genre: "unclassified", books: unclassified }]
    : rankedGroups;
}
