import type { CachedBackendCatalogBook } from "./backend-catalog-cache";

export function catalogCoverIdentity(book: CachedBackendCatalogBook): string {
  return `${book.catalogKey}:${book.cover?.contentHash ?? "none"}`;
}

export function catalogCoverDisplayState({
  hasCover,
  coverUri,
  decodedCoverUri,
  failedCoverUri,
  downloadFailed,
}: {
  hasCover: boolean;
  coverUri?: string;
  decodedCoverUri: string | null;
  failedCoverUri: string | null;
  downloadFailed?: boolean;
}): "loading" | "image" | "error" {
  if (coverUri) {
    if (coverUri === failedCoverUri) return "error";
    return coverUri === decodedCoverUri ? "image" : "loading";
  }
  if (hasCover) return downloadFailed ? "error" : "loading";
  // Catalog books must have a target cover. Incomplete metadata is not an
  // instruction to invent a colored replacement; allow a catalog refresh.
  return "error";
}

/** A completed old request must not replace a newer catalog cover. */
export function applyCatalogCoverResult(
  books: CachedBackendCatalogBook[],
  requested: CachedBackendCatalogBook,
  coverUri?: string,
): CachedBackendCatalogBook[] {
  return books.map((book) =>
    catalogCoverIdentity(book) === catalogCoverIdentity(requested) && (coverUri || !book.coverUri)
      ? { ...book, coverUri, coverLoadFailed: !coverUri }
      : book,
  );
}

export function retryCatalogCoverDownload(
  books: CachedBackendCatalogBook[],
  requested: CachedBackendCatalogBook,
): CachedBackendCatalogBook[] {
  return books.map((book) =>
    catalogCoverIdentity(book) === catalogCoverIdentity(requested)
      ? { ...book, coverUri: undefined, coverLoadFailed: false }
      : book,
  );
}

/** Refresh may finish after a cover download; keep that same-version local file. */
export function retainCatalogCovers(
  next: CachedBackendCatalogBook[],
  current: CachedBackendCatalogBook[],
): CachedBackendCatalogBook[] {
  const byIdentity = new Map(current.map((book) => [catalogCoverIdentity(book), book]));
  return next.map((book) => {
    const previous = byIdentity.get(catalogCoverIdentity(book));
    return !book.coverUri && previous?.coverUri ? { ...book, coverUri: previous.coverUri } : book;
  });
}
