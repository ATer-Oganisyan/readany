import { Text } from "@/components/ui/Typography";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { shouldRenderCoverTypography } from "@/lib/book/cover-display";
import { loadingCoverColorForBook } from "@/lib/book/loading-cover-placeholder";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useColors } from "@/styles/theme";
/**
 * BookCard — Touch-optimized book card matching Tauri mobile MobileBookCard exactly.
 * Cover (28:41), vectorization overlay, long-press action sheet.
 */
import type { Book } from "@readany/core/types";
import { BlurView } from "expo-blur";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, TouchableOpacity, View } from "react-native";
import { BookCardActionSheet } from "./BookCardActionSheet";
import { makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { BookSpineOverlay } from "./book-spine-overlay";

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
  const swipePressGuard = useSwipePressGuard();
  const [failedCoverUrl, setFailedCoverUrl] = useState<string>();
  const coverItems = useMemo(
    () => [{ bookId: book.id, coverUrl: book.meta.coverUrl ?? null }],
    [book.id, book.meta.coverUrl],
  );
  const resolvedCoverUrl = useResolvedCovers(coverItems).get(book.id);
  const hasUsableSavedCover = Boolean(resolvedCoverUrl) && resolvedCoverUrl !== failedCoverUrl;
  const showCoverTypography =
    !hasUsableSavedCover || shouldRenderCoverTypography(book.id, book.meta.coverUrl);
  const progressPercent = Math.round(Math.max(0, Math.min(1, book.progress ?? 0)) * 100);

  return (
    <BookCardActionSheet book={book} onOpen={onOpen} onDelete={onDelete}>
      <TouchableOpacity
        style={s.container}
        onPress={() => {
          if (swipePressGuard?.canPress() === false) return;
          onOpen(book);
        }}
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
          ) : (
            <View
              style={[s.fallbackCover, { backgroundColor: loadingCoverColorForBook(book.id) }]}
            />
          )}

          {/* Корешок остаётся видимым и на собственной обложке, и на заглушке. */}
          <BookSpineOverlay coverWidth={cardWidth} />

          <BookCoverTypography
            title={book.meta.title}
            author={book.meta.author}
            width={cardWidth}
            showText={showCoverTypography}
            textTone="light"
            bottomAccessory={
              progressPercent > 0 ? (
                <BlurView tint="dark" intensity={50} style={s.progressChip}>
                  <Text style={s.cardProgress} numberOfLines={1}>
                    {`${progressPercent}%`}
                  </Text>
                </BlurView>
              ) : null
            }
          />
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
