import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { isCharacterUnlocked, normalizeReadingProgress } from "@/lib/narra/domain";
import { normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ReaderCharacterCard } from "@/screens/reader/ReaderCharacterCard";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import { serifTextFontFamily } from "@deslop/primitives/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface CharacterRow {
  character: NarraCharacter;
  unlocked: boolean;
  /** Сообщений в чате с героем (0 — чат не вёлся). */
  messageCount: number;
}

interface BookSection {
  book: Book;
  progressPercent: number;
  rows: CharacterRow[];
  /** true — персонажи взяты из bundled-каталога и ещё не записаны в narra-store */
  fromBundledCatalog: boolean;
}

/** Герой, чья карточка открыта в bottom-sheet. */
interface SelectedCharacter {
  bookId: string;
  character: NarraCharacter;
}

/**
 * MyPathScreen — вкладка «Мой путь» по образцу экрана «Герои» из narra:
 * секции по книгам (название + прогресс чтения), внутри — строки героев с
 * круглым аватаром. Открытые ведут в карточку героя (портрет/досье/чат),
 * закрытые приглушены с подписью «ещё не знакомы» и не кликабельны.
 */
export function MyPathScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Плавающий нативный таббар перекрывает низ — добавляем его высоту в отступ
  const tabBarSpace =
    (Platform.OS === "android" ? 80 : Platform.OS === "ios" ? 49 : 0) + insets.bottom;
  const styles = useMemo(() => makeStyles(colors, tabBarSpace), [colors, tabBarSpace]);
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const books = useLibraryStore((state) => state.books);
  const narraBooks = useNarraStore((state) => state.books);
  const setCharacters = useNarraStore((state) => state.setCharacters);
  const [selected, setSelected] = useState<SelectedCharacter | null>(null);

  const sections = useMemo<BookSection[]>(() => {
    const result: BookSection[] = [];
    for (const book of books) {
      if (book.deletedAt) continue;
      const stored = narraBooks[book.id]?.characters ?? [];
      const fromBundledCatalog = stored.length === 0;
      const characters = fromBundledCatalog
        ? (getBundledCatalogCharactersByTitle(book.meta.title) ?? [])
        : stored;
      if (characters.length === 0) continue;
      const chats = narraBooks[book.id]?.chats ?? {};
      const rows = characters
        .map<CharacterRow>((character) => ({
          character,
          unlocked: isCharacterUnlocked(book.progress ?? 0, character),
          messageCount: chats[character.id]?.length ?? 0,
        }))
        .sort(
          (a, b) =>
            Number(b.unlocked) - Number(a.unlocked) ||
            a.character.unlockProgress - b.character.unlockProgress,
        );
      result.push({
        book,
        progressPercent: Math.round(normalizeReadingProgress(book.progress ?? 0) * 100),
        rows,
        fromBundledCatalog,
      });
    }
    // Книги — в порядке последнего открытия
    return result.sort((a, b) => (b.book.lastOpenedAt ?? 0) - (a.book.lastOpenedAt ?? 0));
  }, [books, narraBooks]);

  const openCharacterCard = useCallback(
    (section: BookSection, character: NarraCharacter) => {
      // Карточка и чат ищут героя в narra-store — bundled-каталог сначала фиксируем там
      if (section.fromBundledCatalog) {
        const bundled = getBundledCatalogCharactersByTitle(section.book.meta.title);
        if (bundled?.length) setCharacters(section.book.id, bundled);
      }
      setSelected({ bookId: section.book.id, character });
    },
    [setCharacters],
  );

  const openCharacterChat = useCallback(
    (character: NarraCharacter) => {
      const bookId = selected?.bookId;
      setSelected(null);
      if (!bookId) return;
      navigation.navigate("NarraCharacterChat", { bookId, characterId: character.id });
    },
    [navigation, selected],
  );

  if (sections.length === 0) {
    return (
      <CenteredEmptyState
        avoidNativeTabBar
        title={t("myPath.emptyTitle", "Герои ещё впереди")}
        description={t(
          "myPath.emptyDescription",
          "Читайте книги — герои будут открываться по мере прогресса и появятся здесь",
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

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {sections.map((section) => (
          <View key={section.book.id} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.bookTitle} numberOfLines={1}>
                {section.book.meta.title}
              </Text>
              <View
                style={styles.progressRow}
                accessibilityLabel={t("library.readingProgress", {
                  percent: section.progressPercent,
                  defaultValue: "Прочитано {{percent}}%",
                })}
              >
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${section.progressPercent}%` }]} />
                </View>
                <Text style={styles.progressLabel}>{section.progressPercent}%</Text>
              </View>
            </View>
            {section.rows.map(({ character, unlocked, messageCount }) => {
              const portraitUri =
                unlocked && character.portraitUri
                  ? normalizePersistedNarraMediaUri(character.portraitUri)
                  : undefined;
              const subtitle = unlocked
                ? messageCount > 0
                  ? t("myPath.messagesShort", "{{count}} сообщ.", { count: messageCount })
                  : character.role
                : t("myPath.notMetYet", "ещё не знакомы");
              return (
                <TouchableOpacity
                  key={character.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    unlocked
                      ? t("myPath.openCharacter", "Открыть карточку {{character}}", {
                          character: character.name,
                        })
                      : `${character.name} — ${t("myPath.notMetYet", "ещё не знакомы")}`
                  }
                  activeOpacity={0.62}
                  disabled={!unlocked}
                  onPress={() => openCharacterCard(section, character)}
                  style={[styles.row, !unlocked && styles.rowLocked]}
                >
                  <View style={[styles.avatar, !unlocked && styles.avatarLocked]}>
                    {portraitUri ? (
                      <Image source={{ uri: portraitUri }} style={styles.avatarImage} />
                    ) : (
                      <Text style={[styles.avatarLetter, !unlocked && styles.avatarLetterLocked]}>
                        {character.name.slice(0, 1).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.characterName} numberOfLines={1}>
                      {character.name}
                    </Text>
                    {subtitle ? (
                      <Text style={styles.characterMeta} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
      {/* Карточка героя — тот же bottom-sheet, что и в ридере (портрет/досье/чат) */}
      <ReaderCharacterCard
        visible={!!selected}
        character={selected?.character ?? null}
        bookId={selected?.bookId ?? ""}
        onClose={() => setSelected(null)}
        onOpenChat={openCharacterChat}
      />
    </>
  );
}

const makeStyles = (colors: ThemeColors, tabBarSpace: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flexGrow: 1,
      padding: spacing.lg,
      paddingBottom: spacing.lg + tabBarSpace,
      gap: spacing.xl,
    },
    section: { gap: spacing.sm },
    sectionHeader: {
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    bookTitle: {
      color: colors.foreground,
      fontFamily: serifTextFontFamily.bold,
      fontSize: fontSize.lg,
    },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
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
      minWidth: 34,
      textAlign: "right",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 0.5,
      borderColor: colors.primary5,
      backgroundColor: colors.elevation1,
    },
    rowLocked: { opacity: 0.45 },
    avatar: {
      width: 44,
      height: 44,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    avatarLocked: { backgroundColor: colors.elevation2 },
    avatarImage: { width: "100%", height: "100%" },
    avatarLetter: {
      color: colors.primaryForeground,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
    },
    avatarLetterLocked: { color: colors.mutedForeground },
    rowBody: { flex: 1, gap: 1 },
    characterName: {
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    characterMeta: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
    },
  });
