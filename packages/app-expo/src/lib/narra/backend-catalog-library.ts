import type { Book } from "@readany/core/types";
import { bookIdentity } from "../book/book-identity";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";

function isReadableLocalCatalogCopy(book: Book): boolean {
  return book.syncStatus === "local" && (book.format === "epub" || book.format === "txt");
}

export function findLibraryBookForCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  books: Book[],
): Book | null {
  return (
    books.find(
      (book) =>
        !book.deletedAt &&
        book.sourceKind === "catalog" &&
        book.bookEditionId === catalogBook.bookEditionId,
    ) ?? null
  );
}

/**
 * Uses the server-owned edition id when available. A single pre-migration
 * local copy may still be opened by display identity without claiming the
 * catalog identity; ambiguous matches deliberately fall back to download.
 */
export function findReadableLibraryBookForCatalogBook(
  catalogBook: CachedBackendCatalogBook,
  books: Book[],
): Book | null {
  const exact = findLibraryBookForCatalogBook(catalogBook, books);
  if (exact) return exact;

  const expectedIdentity = bookIdentity(catalogBook.title, catalogBook.author);
  const legacyCandidates = books.filter(
    (book) =>
      !book.deletedAt &&
      book.sourceKind !== "catalog" &&
      !book.bookEditionId &&
      isReadableLocalCatalogCopy(book) &&
      bookIdentity(book.meta.title, book.meta.author) === expectedIdentity,
  );
  return legacyCandidates.length === 1 ? legacyCandidates[0] : null;
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
