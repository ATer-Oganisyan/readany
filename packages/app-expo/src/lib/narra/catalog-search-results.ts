import type { Book } from "@readany/core/types";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import { findReadableLibraryBookForCatalogBook } from "./backend-catalog-library";

export type BookSearchResult =
  | { key: string; kind: "library"; book: Book }
  | { key: string; kind: "catalog"; book: CachedBackendCatalogBook };

export interface SearchIndexEntry {
  result: BookSearchResult;
  title: string;
  author: string;
  importedId?: string;
}

export const normalizeBookQuery = (query: string) => query.trim().toLocaleLowerCase();

/** Metadata-only index. Cover completion cannot invalidate it. */
export function buildBookSearchIndex(
  library: Book[],
  catalog: CachedBackendCatalogBook[],
): SearchIndexEntry[] {
  return [
    ...library
      .filter((book) => !book.deletedAt)
      .map(
        (book): SearchIndexEntry => ({
          result: { key: `library:${book.id}`, kind: "library", book },
          title: normalizeBookQuery(book.meta.title),
          author: normalizeBookQuery(book.meta.author ?? ""),
        }),
      ),
    ...catalog.map(
      (book): SearchIndexEntry => ({
        result: { key: `catalog:${book.bookEditionId}`, kind: "catalog", book },
        title: normalizeBookQuery(book.title),
        author: normalizeBookQuery(book.author),
        importedId: findReadableLibraryBookForCatalogBook(book, library)?.id,
      }),
    ),
  ];
}

export function searchBookIndex(index: SearchIndexEntry[], query: string): BookSearchResult[] {
  const normalized = normalizeBookQuery(query);
  if (!normalized) return [];
  const matching = index.filter(
    ({ title, author }) => title.includes(normalized) || author.includes(normalized),
  );
  const imported = new Set(
    matching.flatMap(({ result }) => (result.kind === "library" ? [result.book.id] : [])),
  );
  return matching
    .filter(({ importedId }) => !importedId || !imported.has(importedId))
    .map(({ result }) => result);
}

/** Cover work follows rows, never every result of a broad query. */
export function searchResultWindow(
  results: BookSearchResult[],
  visibleKeys: readonly string[],
  initialRows: number,
  overscanRows = 2,
) {
  const keys = new Set(visibleKeys);
  const indices = results.flatMap((result, index) => (keys.has(result.key) ? [index] : []));
  const first = indices.length ? Math.min(...indices) : 0;
  const last = indices.length ? Math.max(...indices) : Math.max(0, initialRows - 1);
  const visible = results.slice(first, last + 1);
  const nearby = results.slice(Math.max(0, first - overscanRows), last + 1 + overscanRows);
  const catalogBooks = (rows: BookSearchResult[]) =>
    rows.flatMap((row) => (row.kind === "catalog" ? [row.book] : []));
  return {
    visible: catalogBooks(visible),
    nearby: catalogBooks(nearby),
    rowKeys: new Set(nearby.map(({ key }) => key)),
  };
}
