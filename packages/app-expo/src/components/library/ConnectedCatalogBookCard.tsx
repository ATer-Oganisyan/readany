import { useCatalogCover } from "@/hooks/use-catalog-cover";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { getCatalogBookWithCover } from "@/lib/narra/catalog-cover-store";
import { memo, useCallback } from "react";
import { CatalogBookCard } from "./CatalogBookCard";

interface ConnectedCatalogBookCardProps {
  book: CachedBackendCatalogBook;
  cardWidth: number;
  isInLibrary: boolean;
  onPress: (book: CachedBackendCatalogBook) => void;
  onRetryCover: (book: CachedBackendCatalogBook) => void;
}

/** Download updates stop here instead of rebuilding the shelf or its sibling cards. */
export const ConnectedCatalogBookCard = memo(function ConnectedCatalogBookCard({
  book,
  cardWidth,
  isInLibrary,
  onPress,
  onRetryCover,
}: ConnectedCatalogBookCardProps) {
  const displayedBook = useCatalogCover(book);
  const handlePress = useCallback(() => onPress(getCatalogBookWithCover(book)), [book, onPress]);
  const handleRetry = useCallback(
    () => onRetryCover(getCatalogBookWithCover(book)),
    [book, onRetryCover],
  );
  return (
    <CatalogBookCard
      title={displayedBook.title}
      author={displayedBook.author}
      coverUri={displayedBook.coverUri}
      hasCover={!!displayedBook.cover}
      coverLoadFailed={displayedBook.coverLoadFailed}
      cardWidth={cardWidth}
      isInLibrary={isInLibrary}
      onPress={handlePress}
      onRetryCover={handleRetry}
    />
  );
});
