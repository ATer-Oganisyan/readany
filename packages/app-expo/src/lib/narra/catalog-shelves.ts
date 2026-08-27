import type { BackendCatalogGenre } from "./backend-catalog-api";
import type { CachedBackendCatalog, CachedBackendCatalogBook } from "./backend-catalog-cache";

export interface CatalogShelf {
  id: string;
  title: string;
  books: CachedBackendCatalogBook[];
}

export const CATALOG_SHELF_SKELETON_KEYS = [
  "column-1",
  "column-2",
  "column-3",
  "column-4",
  "column-5",
];

export function buildCatalogShelves(
  books: CachedBackendCatalogBook[],
  genres: BackendCatalogGenre[],
  language: string,
  uncategorizedTitle: string,
): CatalogShelf[] {
  const shelves = [...genres]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((genre) => ({
      id: genre.id,
      title: language.startsWith("en") ? genre.labelEn : genre.labelRu,
      books: [] as CachedBackendCatalogBook[],
    }));
  const byId = new Map(shelves.map((shelf) => [shelf.id, shelf]));
  const uncategorized: CatalogShelf = {
    id: "__uncategorized__",
    title: uncategorizedTitle,
    books: [],
  };
  const seen = new Set<string>();
  for (const book of books) {
    if (seen.has(book.bookEditionId)) continue;
    seen.add(book.bookEditionId);
    const matches = [...new Set(book.genres)].flatMap((id) => byId.get(id) ?? []);
    // A missing/stale genre dictionary must not make books disappear.
    if (matches.length === 0) uncategorized.books.push(book);
    else for (const shelf of matches) shelf.books.push(book);
  }
  return [...shelves, uncategorized].filter((shelf) => shelf.books.length > 0);
}

export function chunkShelfBooks<T>(books: readonly T[], count: number): T[][] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid shelf page size");
  const pages: T[][] = [];
  for (let i = 0; i < books.length; i += count) pages.push(books.slice(i, i + count));
  return pages;
}

export function shelfPageForBook(firstBookIndex: number, count: number, bookCount: number): number {
  return Math.max(
    0,
    Math.min(Math.floor(firstBookIndex / count), Math.ceil(bookCount / count) - 1),
  );
}

/** Genre filtering is client-side: publish one complete metadata snapshot so
 * newly discovered genres cannot insert rows above the reader's viewport. */
export async function completeCatalogSnapshot(
  first: CachedBackendCatalog,
  loadNext: (catalog: CachedBackendCatalog) => Promise<CachedBackendCatalog>,
  isCurrent: () => boolean = () => true,
): Promise<CachedBackendCatalog | null> {
  let catalog = first;
  const cursors = new Set<string>();
  while (catalog.nextCursor) {
    if (!isCurrent()) return null;
    if (cursors.has(catalog.nextCursor)) throw new Error("Catalog cursor cycle");
    cursors.add(catalog.nextCursor);
    catalog = await loadNext(catalog);
  }
  return isCurrent() ? catalog : null;
}
