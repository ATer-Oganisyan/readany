import { Text } from "@/components/ui/Typography";
import { isGeneratedBookCoverPath, shouldRenderCoverTypography } from "@/lib/book/cover-display";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { loadingCoverColorForBook } from "@/lib/book/loading-cover-placeholder";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useLibraryStore } from "@/stores/library-store";
import { useColors } from "@/styles/theme";
/**
 * BookCard — Touch-optimized book card matching Tauri mobile MobileBookCard exactly.
 * Cover (28:41), vectorization overlay, long-press action sheet.
 */
import type { Book } from "@readany/core/types";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, TouchableOpacity, View } from "react-native";
import { BookCardActionSheet } from "./BookCardActionSheet";
import { makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { BookSpineOverlay } from "./book-spine-overlay";
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
  downloadProgress?: { downloaded: number; total: number } | null;
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
  const isGeneratingCover = useLibraryStore((state) =>
    state.generatingCoverBookIds.includes(book.id),
  );
  const [failedCoverUrl, setFailedCoverUrl] = useState<string>();
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
  const showsLoadingPlaceholder = isGeneratingCover && !hasUsableSavedCover && !bundledCoverUri;
  const showCoverTypography =
    !hasUsableSavedCover || shouldRenderCoverTypography(book.id, book.meta.coverUrl);
  const coverTextTone = showsLoadingPlaceholder
    ? "light"
    : isGeneratedBookCoverPath(book.id, book.meta.coverUrl)
      ? generatedCoverTextTone({ title: book.meta.title, author: book.meta.author })
      : (bundledCatalogBook?.coverTextTone ?? "dark");

  return (
    <BookCardActionSheet book={book} onOpen={onOpen} onDelete={onDelete}>
      <TouchableOpacity
        style={s.container}
        onPress={() => onOpen(book)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={book.meta.title}
        accessibilityHint={t("notes.openBook", "Открыть")}
      >
        {/* Cover — 28:41 aspect ratio */}
        <View style={s.coverWrap}>
          {hasUsableSavedCover && resolvedCoverUrl ? (
            <Image
              source={{ uri: resolvedCoverUrl }}
              style={s.coverImage}
              resizeMode="cover"
              onError={() => setFailedCoverUrl(resolvedCoverUrl)}
            />
          ) : bundledCoverUri ? (
            <Image source={{ uri: bundledCoverUri }} style={s.coverImage} resizeMode="cover" />
          ) : (
            <View
              style={[
                s.fallbackCover,
                showsLoadingPlaceholder
                  ? { backgroundColor: loadingCoverColorForBook(book.id) }
                  : null,
              ]}
            />
          )}

          {/* Корешок остаётся видимым и на собственной обложке, и на заглушке. */}
          <BookSpineOverlay coverWidth={cardWidth} />

          {showCoverTypography ? (
            <BookCoverTypography
              title={book.meta.title}
              author={book.meta.author}
              width={cardWidth}
              textTone={coverTextTone}
            />
          ) : null}
          {/* Remote status overlay (on-demand download) */}
          {book.syncStatus === "remote" && (
            <View style={s.remoteOverlay}>
              <Text style={s.remoteOverlayText}>{t("home.remote", "需下载")}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </BookCardActionSheet>
  );
});
