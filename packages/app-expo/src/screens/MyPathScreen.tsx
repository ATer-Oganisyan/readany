import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface MyPathEntry {
  book: Book;
  character: NarraCharacter;
  unlocked: boolean;
  /** true — персонажи взяты из bundled-каталога и ещё не записаны в narra-store */
  fromBundledCatalog: boolean;
}

/**
 * MyPathScreen — вкладка «Мой путь»: персонажи всех книг библиотеки.
 * Открытые (isCharacterUnlocked по прогрессу книги) ведут в чат с персонажем,
 * запертые показываются приглушённо с порогом открытия.
 */
export function MyPathScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const books = useLibraryStore((state) => state.books);
  const narraBooks = useNarraStore((state) => state.books);
  const setCharacters = useNarraStore((state) => state.setCharacters);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);

  const entries = useMemo<MyPathEntry[]>(() => {
    const result: MyPathEntry[] = [];
    for (const book of books) {
      if (book.deletedAt) continue;
      const stored = narraBooks[book.id]?.characters ?? [];
      const fromBundledCatalog = stored.length === 0;
      const characters = fromBundledCatalog
        ? (getBundledCatalogCharactersByTitle(book.meta.title) ?? [])
        : stored;
      for (const character of characters) {
        result.push({
          book,
          character,
          unlocked: isCharacterUnlocked(book.progress ?? 0, character),
          fromBundledCatalog,
        });
      }
    }
    return result.sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) ||
        (b.book.lastOpenedAt ?? 0) - (a.book.lastOpenedAt ?? 0) ||
        a.character.unlockProgress - b.character.unlockProgress,
    );
  }, [books, narraBooks]);

  const openCharacterChat = useCallback(
    (entry: MyPathEntry) => {
      // Чат ищет персонажа в narra-store — для bundled-каталога сначала фиксируем его там
      if (entry.fromBundledCatalog) {
        const bundled = getBundledCatalogCharactersByTitle(entry.book.meta.title);
        if (bundled?.length) setCharacters(entry.book.id, bundled);
      }
      navigation.navigate("NarraCharacterChat", {
        bookId: entry.book.id,
        characterId: entry.character.id,
      });
    },
    [navigation, setCharacters],
  );

  if (entries.length === 0) {
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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.grid}>
        {entries.map((entry) => {
          const { book, character, unlocked } = entry;
          const portraitUri = character.portraitUri
            ? normalizePersistedNarraMediaUri(character.portraitUri)
            : undefined;
          const unlockPercent = Math.round(
            Math.min(1, Math.max(0, character.unlockProgress)) * 100,
          );
          return (
            <TouchableOpacity
              key={`${book.id}:${character.id}`}
              accessibilityRole="button"
              accessibilityLabel={
                unlocked
                  ? t("narra.openCharacterChat", "Открыть чат с {{character}}", {
                      character: character.name,
                    })
                  : t("myPath.lockedCharacter", "{{character}} откроется на {{percent}}%", {
                      character: character.name,
                      percent: unlockPercent,
                    })
              }
              activeOpacity={0.62}
              disabled={!unlocked}
              onPress={() => openCharacterChat(entry)}
              style={[styles.card, !unlocked && styles.cardLocked]}
            >
              <View style={styles.portrait}>
                {portraitUri ? (
                  <Image
                    source={{ uri: portraitUri }}
                    style={styles.portraitImage}
                    onError={() =>
                      updateCharacter(book.id, character.id, { portraitUri: undefined })
                    }
                  />
                ) : (
                  <Text style={styles.portraitLetter}>
                    {character.name.slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={styles.characterName} numberOfLines={1}>
                {character.name}
              </Text>
              <Text style={styles.bookTitle} numberOfLines={1}>
                {book.meta.title}
              </Text>
              {!unlocked ? (
                <Text style={styles.lockedLabel} numberOfLines={1}>
                  {t("myPath.unlocksAt", "откроется на {{percent}}%", {
                    percent: unlockPercent,
                  })}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, padding: spacing.lg },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.md,
    },
    card: {
      flexBasis: "47%",
      flexGrow: 1,
      alignItems: "center",
      gap: 2,
      padding: spacing.md,
      borderRadius: radius.card,
      borderWidth: 0.5,
      borderColor: colors.primary5,
      backgroundColor: colors.elevation1,
    },
    cardLocked: { opacity: 0.45 },
    portrait: {
      width: 84,
      height: 84,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      marginBottom: spacing.sm,
    },
    portraitImage: { width: "100%", height: "100%" },
    portraitLetter: {
      color: colors.primaryForeground,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
    },
    characterName: {
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
    },
    bookTitle: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      textAlign: "center",
    },
    lockedLabel: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      marginTop: 2,
    },
  });
