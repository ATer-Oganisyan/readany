import { Text } from "@/components/ui/Typography";
import { isGeneratedBookCoverPath, shouldRenderCoverTypography } from "@/lib/book/cover-display";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { loadingCoverColorForBook } from "@/lib/book/loading-cover-placeholder";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useLibraryStore } from "@/stores/library-store";
import { type ThemeColors, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import type { Book } from "@readany/core/types";
import { BlurView } from "expo-blur";
/**
 * ReadingNowShelf — секция «Читаю сейчас» в библиотеке: нативный горизонтальный
 * ряд книг, отсортированных по lastOpenedAt.
 */
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { BookCardActionSheet } from "./BookCardActionSheet";
import { BookCoverTypography } from "./book-cover-typography";
import { BookSpineOverlay } from "./book-spine-overlay";
import { PerspectiveBook } from "./perspective-book";
import { useResolvedAssetUris } from "./use-resolved-asset-uris";

const CARD_WIDTH = 104;
const COVER_HEIGHT = Math.round(CARD_WIDTH * (41 / 28));

interface ReadingNowShelfProps {
  books: Book[];
  edgeInset: number;
  catalogCardWidth: number;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
  onOpen: (book: Book) => void;
}

export const ReadingNowShelf = memo(function ReadingNowShelf({
  books,
  edgeInset,
  catalogCardWidth,
  onDelete,
  onOpen,
}: ReadingNowShelfProps) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const generatingCoverBookIds = useLibraryStore((state) => state.generatingCoverBookIds);
  const generatingCoverIds = useMemo(
    () => new Set(generatingCoverBookIds),
    [generatingCoverBookIds],
  );
  const [failedCoverKeys, setFailedCoverKeys] = useState<Set<string>>(() => new Set());

  const coverItems = useMemo(
    () => books.map((book) => ({ bookId: book.id, coverUrl: book.meta.coverUrl ?? null })),
    [books],
  );
  const covers = useResolvedCovers(coverItems);
  const bundledCoverAssetModules = useMemo(
    () =>
      books.flatMap((book) => {
        const bundledBook = findBundledCatalogBookByTitle(book.meta.title);
        return bundledBook ? [bundledBook.coverAssetModule] : [];
      }),
    [books],
  );
  const bundledCoverUris = useResolvedAssetUris(bundledCoverAssetModules);

  if (books.length === 0) return null;

  return (
    <View style={s.section}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        alwaysBounceHorizontal={books.length > 1}
        contentInsetAdjustmentBehavior="never"
        removeClippedSubviews={false}
        style={[s.carousel, { marginHorizontal: -edgeInset }]}
        contentContainerStyle={[s.row, { paddingHorizontal: edgeInset }]}
      >
        {books.map((book) => {
          const coverUri = covers.get(book.id);
          const coverKey = `${book.id}:${book.meta.coverUrl ?? ""}`;
          const hasUsableCover = Boolean(coverUri) && !failedCoverKeys.has(coverKey);
          const progressPercent = Math.round(Math.max(0, Math.min(1, book.progress ?? 0)) * 100);
          const bundledCatalogBook = hasUsableCover
            ? undefined
            : findBundledCatalogBookByTitle(book.meta.title);
          const bundledCoverUri = bundledCatalogBook
            ? bundledCoverUris.get(bundledCatalogBook.coverAssetModule)
            : undefined;
          const showsLoadingPlaceholder =
            generatingCoverIds.has(book.id) && !hasUsableCover && !bundledCoverUri;
          const showCoverTypography =
            !hasUsableCover || shouldRenderCoverTypography(book.id, book.meta.coverUrl);
          const coverTextTone = showsLoadingPlaceholder
            ? "light"
            : isGeneratedBookCoverPath(book.id, book.meta.coverUrl)
              ? generatedCoverTextTone({ title: book.meta.title, author: book.meta.author })
              : (bundledCatalogBook?.coverTextTone ?? "dark");
          return (
            <BookCardActionSheet key={book.id} book={book} onDelete={onDelete} onOpen={onOpen}>
              <PerspectiveBook
                width={CARD_WIDTH}
                height={COVER_HEIGHT}
                coverEffects={false}
                onPress={() => onOpen(book)}
                accessibilityLabel={book.meta.title}
                accessibilityHint={t("notes.openBook", "Открыть книгу")}
                cover={
                  <View style={s.coverCanvas}>
                    {hasUsableCover && coverUri ? (
                      <Image
                        source={{ uri: coverUri }}
                        style={s.coverImage}
                        resizeMode="cover"
                        onError={() =>
                          setFailedCoverKeys((current) => {
                            if (current.has(coverKey)) return current;
                            const next = new Set(current);
                            next.add(coverKey);
                            return next;
                          })
                        }
                      />
                    ) : bundledCoverUri ? (
                      <Image
                        source={{ uri: bundledCoverUri }}
                        style={s.coverImage}
                        resizeMode="cover"
                      />
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
                    <BookSpineOverlay coverWidth={CARD_WIDTH} />
                    <BookCoverTypography
                      title={book.meta.title}
                      width={CARD_WIDTH}
                      referenceWidth={catalogCardWidth}
                      titleFontSize={15}
                      leftInsetAdjustment={2}
                      showText={showCoverTypography}
                      textTone={coverTextTone}
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
                  </View>
                }
              />
            </BookCardActionSheet>
          );
        })}
      </ScrollView>
    </View>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    section: { marginBottom: spacing.xxl },
    carousel: { overflow: "visible" },
    row: { gap: spacing.lg },
    coverCanvas: {
      width: "100%",
      height: "100%",
      position: "relative",
      isolation: "isolate",
    },
    coverImage: { width: "100%", height: "100%" },
    fallbackCover: {
      flex: 1,
      overflow: "hidden",
      padding: spacing.md,
      backgroundColor: colors.bookCoverSurface,
    },
    progressChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.full,
      overflow: "hidden",
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    cardProgress: {
      fontSize: 13,
      fontWeight: fontWeight.semibold,
      lineHeight: 18,
      flexShrink: 0,
      color: "rgba(255,255,255,0.92)",
      textAlign: "left",
      fontVariant: ["tabular-nums"],
    },
  });
