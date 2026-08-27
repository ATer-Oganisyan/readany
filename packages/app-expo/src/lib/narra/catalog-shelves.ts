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

/** The category grid loads only visible books and a small neighboring window. */
export function catalogCategoryCoverWindow(
  books: CachedBackendCatalogBook[],
  visibleEditionIds: readonly string[],
): { visible: CachedBackendCatalogBook[]; nearby: CachedBackendCatalogBook[] } {
  const visible = new Set(visibleEditionIds);
  const indices = books.flatMap((book, index) => (visible.has(book.bookEditionId) ? [index] : []));
  const start = indices.length ? Math.min(...indices) : 0;
  const end = indices.length ? Math.max(...indices) + 1 : 6;
  return {
    visible: books.slice(start, end),
    nearby: books.slice(Math.max(0, start - 2), end + 6),
  };
}

/** A bounded window: current pages first, then adjacent pages and the next shelf. */
export function catalogCoverWindow(
  shelves: CatalogShelf[],
  visibleShelfIds: ReadonlySet<string>,
  positions: ReadonlyMap<string, number>,
  columns: number,
): { visible: CachedBackendCatalogBook[]; nearby: CachedBackendCatalogBook[] } {
  const visible: CachedBackendCatalogBook[] = [];
  const nearby: CachedBackendCatalogBook[] = [];
  const active = visibleShelfIds.size
    ? visibleShelfIds
    : new Set(shelves.slice(0, 2).map((s) => s.id));
  const appendPages = (shelf: CatalogShelf, current: boolean) => {
    const page = shelfPageForBook(positions.get(shelf.id) ?? 0, columns, shelf.books.length);
    const start = page * columns;
    if (current) visible.push(...shelf.books.slice(start, start + columns));
    nearby.push(...shelf.books.slice(Math.max(0, start - columns), start + columns * 2));
  };
  shelves.forEach((shelf, index) => {
    if (!active.has(shelf.id)) return;
    appendPages(shelf, true);
    const next = shelves[index + 1];
    if (next && !active.has(next.id)) appendPages(next, false);
  });
  return { visible, nearby };
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
