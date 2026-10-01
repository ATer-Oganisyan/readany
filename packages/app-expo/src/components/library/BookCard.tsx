import { SystemSheetZoomSource } from "@/components/navigation/SystemSheetZoomSource";
import { useSheetZoomReturnShadow } from "@/components/navigation/sheet-zoom-return";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { isGeneratedBookCoverPath, shouldRenderCoverTypography } from "@/lib/book/cover-display";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { loadingCoverColorForTitleAuthor } from "@/lib/book/loading-cover-placeholder";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { hapticLight } from "@/lib/haptics";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useColors } from "@/styles/theme";
/**
 * BookCard — Touch-optimized book card matching Tauri mobile MobileBookCard exactly.
 * Cover (28:41), vectorization overlay, long-press action sheet.
 */
import type { Book } from "@readany/core/types";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, View } from "react-native";
import { BookCardActionSheet } from "./BookCardActionSheet";
import { getBookCardMetrics, makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { BookSpineOverlay } from "./book-spine-overlay";
import { useCoverPress } from "./cover-press";
import { BookSurface } from "./perspective-book";
import { useResolvedAssetUris } from "./use-resolved-asset-uris";

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
  onManageTags?: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  isVectorizing?: boolean;
  isQueued?: boolean;
  vectorProgress?: { status: string; processedChunks: number; totalChunks: number } | null;
  cardWidth?: number;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (book: Book) => void;
  onLongPress?: (book: Book) => void;
}

export const BookCard = memo(function BookCard({
  book,
  onOpen,
  onDelete,
  cardWidth = 96,
}: BookCardProps) {
  const colors = useColors();
  const s = makeStyles(colors, cardWidth);
  const { t } = useTranslation();
  const swipePressGuard = useSwipePressGuard();
  const [failedCoverUrl, setFailedCoverUrl] = useState<string>();
  const { pressStyle, onPressIn, onPressOut } = useCoverPress();
  const { shadowOpacity, onZoomReturn } = useSheetZoomReturnShadow(`reader:${book.id}`);
  const bundledCatalogBook = findBundledCatalogBookByTitle(book.meta.title);
  const coverItems = useMemo(
    () => [{ bookId: book.id, coverUrl: book.meta.coverUrl ?? null }],
    [book.id, book.meta.coverUrl],
  );
  const resolvedCoverUrl = useResolvedCovers(coverItems).get(book.id);
  const bundledCoverAssetModules = useMemo(
    () => (bundledCatalogBook ? [bundledCatalogBook.coverAssetModule] : []),
    [bundledCatalogBook],
  );
  const bundledCoverUris = useResolvedAssetUris(bundledCoverAssetModules);
  const bundledCoverUri = bundledCatalogBook
    ? bundledCoverUris.get(bundledCatalogBook.coverAssetModule)
    : undefined;
  const hasUsableSavedCover = Boolean(resolvedCoverUrl) && resolvedCoverUrl !== failedCoverUrl;
  const showsColorPlaceholder = !hasUsableSavedCover && !bundledCoverUri;
  const showCoverTypography =
    !hasUsableSavedCover || shouldRenderCoverTypography(book.id, book.meta.coverUrl);
  const coverTextTone = showsColorPlaceholder
    ? "light"
    : isGeneratedBookCoverPath(book.id, book.meta.coverUrl)
      ? generatedCoverTextTone({ title: book.meta.title, author: book.meta.author })
      : (bundledCatalogBook?.coverTextTone ?? "dark");

  return (
    <SystemSheetZoomSource
      sourceId={`reader:${book.id}`}
      onZoomReturn={onZoomReturn}
      collapsable={false}
    >
      <BookCardActionSheet book={book} onOpen={onOpen} onDelete={onDelete}>
        <Pressable
          onPress={(event) => {
            if (swipePressGuard?.canPress(event) === false) return;
            hapticLight();
            onOpen(book);
          }}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          // Небольшой сдвиг пальца не должен отменять нажатие.
          pressRetentionOffset={16}
          style={s.container}
          accessibilityRole="button"
          accessibilityLabel={book.meta.title}
          accessibilityHint={t("notes.openBook", "Открыть книгу")}
        >
          <BookSurface
            width={cardWidth}
            height={getBookCardMetrics(cardWidth).coverHeight}
            coverEffects={false}
            shadowOpacity={shadowOpacity}
            style={pressStyle}
            cover={
              <View
                style={[
                  s.coverCanvas,
                  {
                    backgroundColor: loadingCoverColorForTitleAuthor({
                      title: book.meta.title,
                      author: book.meta.author,
                    }),
                  },
                ]}
              >
                {hasUsableSavedCover && resolvedCoverUrl ? (
                  <Image
                    source={{ uri: resolvedCoverUrl }}
                    style={s.coverImage}
                    resizeMode="cover"
                    onError={() => setFailedCoverUrl(resolvedCoverUrl)}
                  />
                ) : bundledCoverUri ? (
                  <Image
                    source={{ uri: bundledCoverUri }}
                    style={s.coverImage}
                    resizeMode="cover"
                  />
                ) : null}

                {/* Корешок остаётся видимым и на собственной обложке, и на заглушке. */}
                <BookSpineOverlay coverWidth={cardWidth} />

                <BookCoverTypography
                  title={book.meta.title}
                  author={book.meta.author}
                  width={cardWidth}
                  showText={showCoverTypography}
                  textTone={coverTextTone}
                  coverUri={(hasUsableSavedCover ? resolvedCoverUrl : bundledCoverUri) ?? undefined}
                />
              </View>
            }
          />
        </Pressable>
      </BookCardActionSheet>
    </SystemSheetZoomSource>
  );
});
