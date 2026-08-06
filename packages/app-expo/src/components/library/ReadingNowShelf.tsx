import { Text } from "@/components/ui/Typography";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { type ThemeColors, fontSize, fontWeight, spacing, useColors } from "@/styles/theme";
import type { Book } from "@readany/core/types";
/**
 * ReadingNowShelf — секция «Читаю сейчас» в библиотеке: нативный горизонтальный
 * ряд книг, отсортированных по lastOpenedAt.
 */
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { BookCoverTypography } from "./book-cover-typography";
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

  const coverItems = useMemo(
    () => books.map((book) => ({ bookId: book.id, coverUrl: book.meta.coverUrl ?? null })),
    [books],
  );
  const covers = useResolvedCovers(coverItems);

  if (books.length === 0) return null;

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{t("library.readingNow", "Читаю сейчас")}</Text>
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
                    author={book.meta.author}
                    width={CARD_WIDTH}
                    referenceWidth={catalogCardWidth}
                  />
                </View>
              }
              footer={
                <View style={s.cardFooter}>
                  <Text style={[s.cardText, s.cardProgress]} numberOfLines={1}>
                    {`${Math.round(Math.max(0, Math.min(1, book.progress ?? 0)) * 100)}%`}
                  </Text>
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
    section: { marginBottom: spacing.xxl },
    sectionTitle: {
      color: colors.foreground,
      fontSize: fontSize.lg,
      lineHeight: 24,
      fontWeight: fontWeight.bold,
      marginBottom: spacing.lg,
    },
    carousel: { overflow: "visible" },
    row: { gap: spacing.lg },
    coverCanvas: { width: "100%", height: "100%", position: "relative" },
    coverImage: { width: "100%", height: "100%" },
    fallbackCover: {
      flex: 1,
      overflow: "hidden",
      padding: spacing.md,
      backgroundColor: colors.primary10,
    },
    cardFooter: {
      marginTop: 6,
      alignItems: "flex-start",
    },
    cardText: {
      fontSize: 13,
      fontWeight: fontWeight.semibold,
      lineHeight: 18,
    },
    cardProgress: {
      flexShrink: 0,
      color: colors.mutedForeground,
      textAlign: "left",
      fontVariant: ["tabular-nums"],
    },
  });
