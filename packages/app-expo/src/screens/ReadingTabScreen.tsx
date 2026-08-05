import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Image, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolvedCovers } from "./notes/useResolvedCovers";

const COVER_WIDTH = 148;
const CURL_SIZE = Math.round(COVER_WIDTH * 0.3);
/** Цвета «бумаги» отвёрнутого уголка — как в ReadingNowShelf. */
const CURL_PAPER_COLORS = ["#fbfaf5", "#ece9de", "#d3cfc0"] as const;

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * ReadingTabScreen — вкладка «Читалка»: сразу продолжает последнюю открытую книгу.
 *
 * Логика resume: берём книгу с максимальным `lastOpenedAt` (library-store);
 * Reader сам открывает сохранённую позицию `book.currentCfi`, поэтому cfi не передаём.
 * После возврата из ридера показываем карточку «Читаю сейчас», повторный тап
 * по табу или повторный вход на вкладку снова открывает книгу.
 */
export function ReadingTabScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Плавающий нативный таббар перекрывает низ — добавляем его высоту в отступ
  const tabBarSpace =
    (Platform.OS === "android" ? 80 : Platform.OS === "ios" ? 49 : 0) + insets.bottom;
  const styles = useMemo(() => makeStyles(colors, tabBarSpace), [colors, tabBarSpace]);
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const books = useLibraryStore((state) => state.books);

  const lastBook = useMemo(() => {
    let candidate: Book | null = null;
    for (const book of books) {
      if (!book.lastOpenedAt || book.deletedAt) continue;
      if (!candidate || book.lastOpenedAt > (candidate.lastOpenedAt ?? 0)) candidate = book;
    }
    return candidate;
  }, [books]);
  const lastBookRef = useRef(lastBook);
  lastBookRef.current = lastBook;

  const coverItems = useMemo(
    () =>
      lastBook ? [{ bookId: lastBook.id, coverUrl: lastBook.meta.coverUrl ?? null }] : undefined,
    [lastBook],
  );
  const covers = useResolvedCovers(coverItems);
  const coverUri = lastBook ? covers.get(lastBook.id) : undefined;

  // true — только что вернулись из ридера, автопереход один раз пропускаем
  const returnedFromReaderRef = useRef(false);
  const openInFlightRef = useRef(false);

  const openLastBook = useCallback(() => {
    const book = lastBookRef.current;
    if (!book || openInFlightRef.current) return;
    openInFlightRef.current = true;
    void openMobileBook({ bookId: book.id, navigation, t })
      .then((opened) => {
        if (opened) returnedFromReaderRef.current = true;
      })
      .finally(() => {
        openInFlightRef.current = false;
      });
  }, [navigation, t]);

  // Автопереход в ридер при входе на вкладку (и когда стор догрузил книги)
  useEffect(() => {
    if (!isFocused || !lastBook) return;
    if (returnedFromReaderRef.current) {
      returnedFromReaderRef.current = false;
      return;
    }
    openLastBook();
  }, [isFocused, lastBook, openLastBook]);

  // Повторный тап по табу «Читалка» снова открывает книгу
  useEffect(() => {
    const tabNavigator = navigation.getParent();
    if (!tabNavigator) return;
    return tabNavigator.addListener("tabPress" as never, () => {
      returnedFromReaderRef.current = false;
      openLastBook();
    });
  }, [navigation, openLastBook]);

  if (!lastBook) {
    return (
      <CenteredEmptyState
        avoidNativeTabBar
        title={t("readingTab.emptyTitle", "Нет открытых книг")}
        description={t(
          "readingTab.emptyDescription",
          "Откройте книгу в библиотеке — она появится здесь и будет открываться сразу на нужной странице",
        )}
      >
        <NativeButton
          label={t("readingTab.goToLibrary", "В библиотеку")}
          accessibilityLabel={t("readingTab.goToLibrary", "В библиотеку")}
          size="large"
          onPress={() => navigation.getParent()?.navigate("Library" as never)}
        />
      </CenteredEmptyState>
    );
  }

  const progressPercent = Math.round(Math.min(1, Math.max(0, lastBook.progress ?? 0)) * 100);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.card}>
        <View style={styles.cover}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.coverImage} resizeMode="cover" />
          ) : (
            <Text style={styles.coverLetter}>{lastBook.meta.title.slice(0, 1).toUpperCase()}</Text>
          )}
          <View style={styles.curlShadow} pointerEvents="none" />
          <LinearGradient
            colors={CURL_PAPER_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.curlPage}
            pointerEvents="none"
          />
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {lastBook.meta.title}
        </Text>
        {lastBook.meta.author ? (
          <Text style={styles.author} numberOfLines={1}>
            {lastBook.meta.author}
          </Text>
        ) : null}
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{progressPercent}%</Text>
        </View>
        <NativeButton
          label={t("readingTab.continueReading", "Продолжить чтение")}
          accessibilityLabel={t("readingTab.continueReading", "Продолжить чтение")}
          size="large"
          onPress={openLastBook}
        />
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors, tabBarSpace: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      paddingBottom: spacing.xl + tabBarSpace,
    },
    card: { alignItems: "center", gap: spacing.md, maxWidth: 320, width: "100%" },
    cover: {
      width: COVER_WIDTH,
      height: 212,
      borderRadius: radius.card,
      overflow: "hidden",
      position: "relative",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.elevation2,
      marginBottom: spacing.sm,
    },
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
    coverImage: { width: "100%", height: "100%" },
    coverLetter: {
      color: colors.mutedForeground,
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
    },
    title: {
      color: colors.foreground,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
    },
    author: { color: colors.mutedForeground, fontSize: fontSize.sm, textAlign: "center" },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      alignSelf: "stretch",
      marginBottom: spacing.sm,
    },
    progressTrack: {
      flex: 1,
      height: 5,
      borderRadius: radius.full,
      backgroundColor: colors.primary10,
      overflow: "hidden",
    },
    progressFill: { height: "100%", borderRadius: radius.full, backgroundColor: colors.primary },
    progressLabel: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      minWidth: 36,
      textAlign: "right",
    },
  });
