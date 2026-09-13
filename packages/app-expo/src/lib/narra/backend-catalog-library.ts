import type { Book } from "@readany/core/types";
import { bookIdentity } from "../book/book-identity";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";

function isReadableLocalCatalogCopy(book: Book): boolean {
  return book.syncStatus === "local" && (book.format === "epub" || book.format === "txt");
}

interface LibraryIndex {
  editions: Map<Book["bookEditionId"], Book>;
  legacy: Map<string, Book | null>;
}

const indexes = new WeakMap<Book[], LibraryIndex>();

function libraryIndex(books: Book[]): LibraryIndex {
  const cached = indexes.get(books);
  if (cached) return cached;
  const index: LibraryIndex = { editions: new Map(), legacy: new Map() };
  for (const book of books) {
    if (book.deletedAt) continue;
    if (book.sourceKind === "catalog") {
      // Preserve the existing first-copy preference for a server edition.
      if (!index.editions.has(book.bookEditionId)) index.editions.set(book.bookEditionId, book);
    } else if (!book.bookEditionId && isReadableLocalCatalogCopy(book)) {
      const identity = bookIdentity(book.meta.title, book.meta.author);
      index.legacy.set(identity, index.legacy.has(identity) ? null : book);
    }
  }
  // Each immutable books array gets fresh objects, including current progress.
  indexes.set(books, index);
  return index;
}

export function findLibraryBookForCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  books: Book[],
): Book | null {
  return libraryIndex(books).editions.get(catalogBook.bookEditionId) ?? null;
}

/**
 * Prefer the server edition. Only one unambiguous pre-migration local copy
 * may match by display identity without claiming a catalog identity.
 */
export function findReadableLibraryBookForCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  books: Book[],
): Book | null {
  const index = libraryIndex(books);
  const exact = index.editions.get(catalogBook.bookEditionId);
  if (exact) return exact;
  return index.legacy.size
    ? (index.legacy.get(bookIdentity(catalogBook.title, catalogBook.author)) ?? null)
    : null;
}

export function isCatalogBookRevisionCurrent(
  book: Book,
  catalogBook: CachedBackendCatalogBook,
): boolean {
  const expected = catalogBook.contentSha256.toLowerCase();
  return [book.contentHash, book.revisionId].some(
    (value) => typeof value === "string" && value.toLowerCase() === expected,
  );
}
