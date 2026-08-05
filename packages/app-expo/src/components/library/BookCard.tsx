import { ClockIcon, Loader2Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useColors } from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
/**
 * BookCard — Touch-optimized book card matching Tauri mobile MobileBookCard exactly.
 * Cover (28:41), vectorization overlay, long-press action sheet.
 */
import type { Book } from "@readany/core/types";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, Image, TouchableOpacity, View } from "react-native";
import { BookCardActionSheet } from "./BookCardActionSheet";
import { makeStyles } from "./book-card-styles";

const AnimatedLoader = () => {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Loader2Icon size={24} color="#fff" />
    </Animated.View>
  );
};

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
  onShowDetails?: (book: Book) => void;
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
  isVectorizing,
  isQueued,
  vectorProgress,
  downloadProgress,
  cardWidth = 96,
}: BookCardProps) {
  const colors = useColors();
  const s = makeStyles(colors, cardWidth);
  const { t } = useTranslation();
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

  const vecPct = vectorProgress
    ? vectorProgress.totalChunks > 0
      ? Math.round((vectorProgress.processedChunks / vectorProgress.totalChunks) * 100)
      : 0
    : 0;

  return (
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
            {/* Bottom shadow */}
            <View style={s.spineBottomShadow} pointerEvents="none" />
          </>
        ) : bundledCatalogBook ? (
          <Image
            source={bundledCatalogBook.coverAssetModule}
            style={s.coverImage}
            resizeMode="cover"
          />
        ) : (
          <View style={s.fallbackCover}>
            <Text style={s.fallbackTitle} numberOfLines={6}>
              {book.meta.title}
            </Text>
          </View>
        )}

        {/* Vectorization progress overlay */}
        {isVectorizing && (
          <View style={s.vecOverlay}>
            <AnimatedLoader />
            <Text style={s.vecOverlayText}>
              {vectorProgress?.status === "chunking"
                ? `${vecPct}%`
                : vectorProgress?.status === "embedding"
                  ? `${vecPct}%`
                  : vectorProgress?.status === "indexing"
                    ? t("home.vec_indexing")
                    : vectorProgress?.status === "completed"
                      ? "✓"
                      : vectorProgress?.status === "error"
                        ? "✗"
                        : t("home.vec_processing")}
            </Text>
          </View>
        )}

        {/* Queued overlay */}
        {isQueued && !isVectorizing && (
          <View style={s.queuedOverlay}>
            <ClockIcon size={20} color="#fff" />
            <Text style={s.queuedOverlayText}>{t("home.vec_queued", "排队中")}</Text>
          </View>
        )}

        {/* Remote status overlay (on-demand download) */}
        {book.syncStatus === "remote" && (
          <View style={s.remoteOverlay}>
            <Text style={s.remoteOverlayText}>{t("home.remote", "需下载")}</Text>
          </View>
        )}

        {/* Downloading status overlay */}
        {book.syncStatus === "downloading" && (
          <View style={s.downloadingOverlay}>
            <AnimatedLoader />
            <Text style={s.downloadingOverlayText}>{t("home.downloading", "下载中")}</Text>
            {downloadProgress && downloadProgress.total > 0 && (
              <Text style={s.downloadingOverlayPct}>
                {Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}%
              </Text>
            )}
          </View>
        )}

        <BookCardActionSheet book={book} onOpen={onOpen} onDelete={onDelete} />
      </View>

      {/* Info below cover */}
      <View style={s.infoWrap}>
        <Text style={s.bookTitle} numberOfLines={1} ellipsizeMode="tail">
          {book.meta.title}
        </Text>
        {book.meta.author ? (
          <Text style={s.bookAuthor} numberOfLines={1}>
            {book.meta.author}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});
