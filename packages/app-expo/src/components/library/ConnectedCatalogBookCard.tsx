import { SystemSheetZoomSource } from "@/components/navigation/SystemSheetZoomSource";
import { useSheetZoomReturnShadow } from "@/components/navigation/sheet-zoom-return";
import { useCatalogCover } from "@/hooks/use-catalog-cover";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { getCatalogBookWithCover } from "@/lib/narra/catalog-cover-store";
import { memo, useCallback, useId } from "react";
import { CatalogBookCard } from "./CatalogBookCard";

interface ConnectedCatalogBookCardProps {
  book: CachedBackendCatalogBook;
  cardWidth: number;
  isInLibrary: boolean;
  onPress: (book: CachedBackendCatalogBook, zoomSourceId: string) => void;
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
  const instanceId = useId();
  const zoomSourceId = `catalog:${book.catalogKey}:${instanceId}`;
  const { shadowOpacity, onZoomReturn } = useSheetZoomReturnShadow(zoomSourceId);
  const handlePress = useCallback(() => {
    onPress(getCatalogBookWithCover(book), zoomSourceId);
  }, [book, onPress, zoomSourceId]);
  const handleRetry = useCallback(
    () => onRetryCover(getCatalogBookWithCover(book)),
    [book, onRetryCover],
  );
  return (
    <SystemSheetZoomSource
      sourceId={zoomSourceId}
      onZoomReturn={onZoomReturn}
      collapsable={false}
      style={{ width: cardWidth, height: (cardWidth * 41) / 28 }}
    >
      <CatalogBookCard
        revealKey={book}
        title={displayedBook.title}
        author={displayedBook.author}
        coverUri={displayedBook.coverUri}
        hasCover={!!displayedBook.cover}
        coverLoadFailed={displayedBook.coverLoadFailed}
        shadowOpacity={shadowOpacity}
        cardWidth={cardWidth}
        isInLibrary={isInLibrary}
        onPress={handlePress}
        onRetryCover={handleRetry}
      />
    </SystemSheetZoomSource>
  );
});
