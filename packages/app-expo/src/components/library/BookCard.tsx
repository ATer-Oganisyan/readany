import { Text } from "@/components/ui/Typography";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useLibraryStore } from "@/stores/library-store";
import { useColors } from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
/**
 * BookCard — Touch-optimized book card matching Tauri mobile MobileBookCard exactly.
 * Cover (28:41), vectorization overlay, long-press action sheet.
 */
import type { Book } from "@readany/core/types";
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, TouchableOpacity, View } from "react-native";
import { BookCardActionSheet } from "./BookCardActionSheet";
import { makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { CoverGenerationShimmer } from "./cover-generation-shimmer";

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
  const [imageError, setImageError] = useState(false);
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | undefined>(undefined);
  const bundledCatalogBook = findBundledCatalogBookByTitle(book.meta.title);

  // Resolve relative coverUrl to absolute path
  useEffect(() => {
    const raw = book.meta.coverUrl;
    setImageError(false);
    if (!raw) {
      setResolvedCoverUrl(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setResolvedCoverUrl(raw);
      return;
    }
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, raw);
        setResolvedCoverUrl(absPath);
      } catch (err) {
        console.warn("[Library] Failed to resolve cover URL:", err);
        setResolvedCoverUrl(undefined);
      }
    })();
  }, [book.meta.coverUrl]);

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
          {resolvedCoverUrl && !imageError ? (
            <>
              <Image
                source={{ uri: resolvedCoverUrl }}
                style={s.coverImage}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
              {/* Book spine crease overlay — matches desktop .book-spine */}
              <View style={s.spineOverlay} pointerEvents="none">
                {/* Left edge dark line */}
                <View style={s.spineStrip1} />
                {/* Spine shadow dip */}
                <View style={s.spineStrip2} />
                {/* Highlight reflection */}
                <View style={s.spineStrip3} />
                {/* Transition bright */}
                <View style={s.spineStrip4} />
                {/* Crease dark */}
                <View style={s.spineStrip5} />
                {/* Deep fold */}
                <View style={s.spineStrip6} />
                {/* Subtle bright transition */}
                <View style={s.spineStrip7} />
                {/* Right edge subtle shadow */}
                <View style={s.spineEdgeRight} />
              </View>
              {/* Top highlight */}
              <View style={s.spineTopHighlight} pointerEvents="none" />
            </>
          ) : bundledCatalogBook ? (
            <Image
              source={bundledCatalogBook.coverAssetModule}
              style={s.coverImage}
              resizeMode="cover"
            />
          ) : (
            <View style={s.fallbackCover} />
          )}

          <BookCoverTypography
            title={book.meta.title}
            author={book.meta.author}
            width={cardWidth}
          />
          {isGeneratingCover ? <CoverGenerationShimmer /> : null}

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
