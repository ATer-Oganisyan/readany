import { isBundledCatalogCoverPath } from "../catalog/bundled-book-definitions";

const LEGACY_GENERATED_COVER_DELAY_MS = 10_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isGeneratedBookCoverPath(bookId: string, coverUrl?: string): boolean {
  if (!coverUrl) return false;
  const escapedBookId = escapeRegExp(bookId);
  return new RegExp(`^covers/${escapedBookId}-generated\\.(?:jpe?g|png|webp)$`, "i").test(coverUrl);
}

export function isLegacyBookCoverPath(bookId: string, coverUrl?: string): boolean {
  if (!coverUrl) return false;
  const escapedBookId = escapeRegExp(bookId);
  return new RegExp(`^covers/${escapedBookId}\\.(?:jpe?g|png|webp)$`, "i").test(coverUrl);
}

export function isLegacyGeneratedBookCover(params: {
  bookId: string;
  coverUrl?: string;
  bookAddedAt: number;
  coverModifiedAt?: number;
}): boolean {
  return (
    isLegacyBookCoverPath(params.bookId, params.coverUrl) &&
    typeof params.coverModifiedAt === "number" &&
    params.coverModifiedAt - params.bookAddedAt >= LEGACY_GENERATED_COVER_DELAY_MS
  );
}

export function shouldRenderCoverTypography(bookId: string, coverUrl?: string): boolean {
  if (!coverUrl) return true;
  return isGeneratedBookCoverPath(bookId, coverUrl) || isBundledCatalogCoverPath(bookId, coverUrl);
}
