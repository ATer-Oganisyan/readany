import { Text } from "@/components/ui/Typography";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import type { Book } from "@readany/core/types";
import { LinearGradient } from "expo-linear-gradient";
/**
 * ReadingNowShelf — секция «Читаю сейчас» в библиотеке: горизонтальный ряд книг
 * с прогрессом чтения (0 < progress < 1), отсортированных по lastOpenedAt.
 * У обложек — эффект «скрученного уголка» страницы (page curl) в правом нижнем углу.
 */
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

const CARD_WIDTH = 104;
const COVER_HEIGHT = Math.round(CARD_WIDTH * (41 / 28));
const CURL_SIZE = Math.round(CARD_WIDTH * 0.34);

/** Цвета «бумаги» отвёрнутого уголка: от светлого сгиба к затенённому краю. */
const CURL_PAPER_COLORS = ["#fbfaf5", "#ece9de", "#d3cfc0"] as const;

interface ReadingNowShelfProps {
  books: Book[];
  onOpen: (book: Book) => void;
}

export const ReadingNowShelf = memo(function ReadingNowShelf({
  books,
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {books.map((book) => {
          const progressPercent = Math.min(100, Math.round((book.progress ?? 0) * 100));
          const coverUri = covers.get(book.id);
          const bundledCatalogBook = coverUri
            ? undefined
            : findBundledCatalogBookByTitle(book.meta.title);
          return (
            <TouchableOpacity
              key={book.id}
              style={s.card}
              onPress={() => onOpen(book)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={book.meta.title}
              accessibilityHint={t("library.readingProgress", {
                percent: progressPercent,
                defaultValue: "Прочитано {{percent}}%",
              })}
            >
              <View style={s.coverWrap}>
                {coverUri ? (
                  <Image source={{ uri: coverUri }} style={s.coverImage} resizeMode="cover" />
                ) : bundledCatalogBook ? (
                  <Image
                    source={bundledCatalogBook.coverAssetModule}
                    style={s.coverImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={s.fallbackCover}>
                    <Text style={s.fallbackTitle} numberOfLines={4}>
                      {book.meta.title}
                    </Text>
                  </View>
                )}
                {/* Page curl: тень под отвёрнутым уголком… */}
                <View style={s.curlShadow} pointerEvents="none" />
                {/* …и сама «бумага» уголка градиентом, обрезается рамкой обложки */}
                <LinearGradient
                  colors={CURL_PAPER_COLORS}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.curlPage}
                  pointerEvents="none"
                />
              </View>
              <Text style={s.cardTitle} numberOfLines={1} ellipsizeMode="tail">
                {book.meta.title}
              </Text>
              <View style={s.progressRow}>
                <View style={s.progressTrack}>
                  <View style={[s.progressFill, { width: `${progressPercent}%` }]} />
                </View>
                <Text style={s.progressLabel}>{progressPercent}%</Text>
              </View>
            </TouchableOpacity>
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
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      marginBottom: spacing.lg,
    },
    row: { gap: spacing.lg, paddingRight: spacing.sm },
    card: { width: CARD_WIDTH },
    coverWrap: {
      width: CARD_WIDTH,
      height: COVER_HEIGHT,
      borderRadius: radius.sm,
      overflow: "hidden",
      position: "relative",
      backgroundColor: colors.elevation2,
    },
    coverImage: { width: "100%", height: "100%" },
    fallbackCover: {
      flex: 1,
      overflow: "hidden",
      padding: spacing.md,
      backgroundColor: colors.primary10,
    },
    fallbackTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      color: colors.primary30,
      lineHeight: 18,
    },
    // Квадрат, повернутый на 45° с центром в правом нижнем углу обложки:
    // видимая внутри рамки половина выглядит как отвёрнутый уголок страницы.
    curlShadow: {
      position: "absolute",
      right: -CURL_SIZE / 2,
      bottom: -CURL_SIZE / 2,
      width: CURL_SIZE + 8,
      height: CURL_SIZE + 8,
      backgroundColor: "rgba(0,0,0,0.28)",
      transform: [{ rotate: "45deg" }],
      borderRadius: 3,
    },
    curlPage: {
      position: "absolute",
      right: -CURL_SIZE / 2,
      bottom: -CURL_SIZE / 2,
      width: CURL_SIZE,
      height: CURL_SIZE,
      transform: [{ rotate: "45deg" }],
      borderRadius: 2,
    },
    cardTitle: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      lineHeight: 18,
    },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs + 2,
      marginTop: spacing.xs,
    },
    progressTrack: {
      flex: 1,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.primary10,
      overflow: "hidden",
    },
    progressFill: { height: "100%", borderRadius: radius.full, backgroundColor: colors.primary },
    progressLabel: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      fontVariant: ["tabular-nums"],
      minWidth: 34,
      textAlign: "right",
    },
  });
