import { Text } from "@/components/ui/Typography";
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
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { BookCoverTypography } from "./book-cover-typography";
import { CoverGenerationShimmer } from "./cover-generation-shimmer";
import { PerspectiveBook } from "./perspective-book";

const CARD_WIDTH = 104;
const COVER_HEIGHT = Math.round(CARD_WIDTH * (41 / 28));

interface ReadingNowShelfProps {
  books: Book[];
  edgeInset: number;
  catalogCardWidth: number;
  onOpen: (book: Book) => void;
}

export const ReadingNowShelf = memo(function ReadingNowShelf({
  books,
  edgeInset,
  catalogCardWidth,
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

  const coverItems = useMemo(
    () => books.map((book) => ({ bookId: book.id, coverUrl: book.meta.coverUrl ?? null })),
    [books],
  );
  const covers = useResolvedCovers(coverItems);

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
          const bundledCatalogBook = coverUri
            ? undefined
            : findBundledCatalogBookByTitle(book.meta.title);
          return (
            <PerspectiveBook
              key={book.id}
              width={CARD_WIDTH}
              height={COVER_HEIGHT}
              onPress={() => onOpen(book)}
              accessibilityLabel={book.meta.title}
              accessibilityHint={t("notes.openBook", "Открыть книгу")}
              cover={
                <View style={s.coverCanvas}>
                  {coverUri ? (
                    <Image source={{ uri: coverUri }} style={s.coverImage} resizeMode="cover" />
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
                    width={CARD_WIDTH}
                    referenceWidth={catalogCardWidth}
                    titleFontSize={15}
                    leftInsetAdjustment={2}
                    bottomAccessory={
                      <BlurView tint="dark" intensity={50} style={s.progressChip}>
                        <Text style={s.cardProgress} numberOfLines={1}>
                          {`${Math.round(Math.max(0, Math.min(1, book.progress ?? 0)) * 100)}%`}
                        </Text>
                      </BlurView>
                    }
                  />
                  {generatingCoverIds.has(book.id) ? <CoverGenerationShimmer /> : null}
                </View>
              }
            />
          );
        })}
      </ScrollView>
    </View>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    section: { marginBottom: 32 },
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
      backgroundColor: colors.primary10,
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
