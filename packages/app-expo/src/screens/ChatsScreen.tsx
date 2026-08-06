import { NativeThemePicker } from "@/components/profile/NativeThemePicker";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const getBookTabLabel = (title: string) => {
  const normalizedTitle = title.trim();
  return normalizedTitle.split(/[.!?…]+(?=\s|$)/u)[0]?.trim() || normalizedTitle;
};

interface ChatBook {
  book: Book;
  characters: NarraCharacter[];
  fromBundledCatalog: boolean;
}

interface ChatRow {
  book: Book;
  character: NarraCharacter;
  unlocked: boolean;
  messageCount: number;
  fromBundledCatalog: boolean;
}

export function ChatsScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const books = useLibraryStore((state) => state.books);
  const narraBooks = useNarraStore((state) => state.books);
  const setCharacters = useNarraStore((state) => state.setCharacters);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const [selectedBookId, setSelectedBookId] = useState("all");
  const [portraitLoadingKey, setPortraitLoadingKey] = useState<string | null>(null);
  const portraitAttemptsRef = useRef(new Set<string>());

  const chatBooks = useMemo<ChatBook[]>(() => {
    return books
      .filter((book) => !book.deletedAt)
      .map((book) => {
        const storedCharacters = narraBooks[book.id]?.characters ?? [];
        const fromBundledCatalog = storedCharacters.length === 0;
        const characters = fromBundledCatalog
          ? (getBundledCatalogCharactersByTitle(book.meta.title) ?? [])
          : storedCharacters;
        return { book, characters, fromBundledCatalog };
      })
      .filter((item) => item.characters.length > 0)
      .sort((a, b) => (b.book.lastOpenedAt ?? 0) - (a.book.lastOpenedAt ?? 0));
  }, [books, narraBooks]);

  const segmentValues = useMemo(
    () => [
      t("common.all", "Все"),
      ...chatBooks.map(({ book }) => getBookTabLabel(book.meta.title)),
    ],
    [chatBooks, t],
  );
  const selectedSegmentIndex = Math.max(
    0,
    chatBooks.findIndex(({ book }) => book.id === selectedBookId) + 1,
  );

  useEffect(() => {
    if (selectedBookId !== "all" && !chatBooks.some(({ book }) => book.id === selectedBookId)) {
      setSelectedBookId("all");
    }
  }, [chatBooks, selectedBookId]);

  const rows = useMemo<ChatRow[]>(() => {
    const visibleBooks =
      selectedBookId === "all"
        ? chatBooks
        : chatBooks.filter(({ book }) => book.id === selectedBookId);

    return visibleBooks.flatMap(({ book, characters, fromBundledCatalog }) => {
      const chats = narraBooks[book.id]?.chats ?? {};
      return characters
        .map((character) => ({
          book,
          character,
          unlocked: isCharacterUnlocked(book.progress ?? 0, character),
          messageCount: chats[character.id]?.length ?? 0,
          fromBundledCatalog,
        }))
        .filter((row) => row.unlocked)
        .sort(
          (a, b) =>
            b.messageCount - a.messageCount ||
            a.character.unlockProgress - b.character.unlockProgress,
        );
    });
  }, [chatBooks, narraBooks, selectedBookId]);

  const openChat = useCallback(
    (row: ChatRow) => {
      if (!row.unlocked) return;
      if (row.fromBundledCatalog) {
        const bundled = getBundledCatalogCharactersByTitle(row.book.meta.title);
        if (bundled?.length) setCharacters(row.book.id, bundled);
      }
      navigation.navigate("NarraCharacterChat", {
        bookId: row.book.id,
        characterId: row.character.id,
      });
    },
    [navigation, setCharacters],
  );

  useEffect(() => {
    if (portraitLoadingKey) return;
    const nextRow = rows.find((row) => {
      const key = `${row.book.id}:${row.character.id}`;
      return row.unlocked && !row.character.portraitUri && !portraitAttemptsRef.current.has(key);
    });
    if (!nextRow) return;

    const key = `${nextRow.book.id}:${nextRow.character.id}`;
    portraitAttemptsRef.current.add(key);
    setPortraitLoadingKey(key);
    if (nextRow.fromBundledCatalog) {
      const bundled = getBundledCatalogCharactersByTitle(nextRow.book.meta.title);
      if (bundled?.length) setCharacters(nextRow.book.id, bundled);
    }
    void ensureCharacterPortrait(nextRow.book.id, nextRow.character)
      .then((portraitUri) =>
        updateCharacter(nextRow.book.id, nextRow.character.id, { portraitUri }),
      )
      .catch((error) => reportNarraError("character_portrait_background", error))
      .finally(() => setPortraitLoadingKey(null));
  }, [portraitLoadingKey, rows, setCharacters, updateCharacter]);

  if (chatBooks.length === 0) {
    return (
      <CenteredEmptyState
        avoidNativeTabBar
        title={t("chats.emptyTitle", "Диалогов пока нет")}
        description={t("chats.emptyDescription", "Персонажи появятся здесь после добавления книг")}
      >
        {null}
      </CenteredEmptyState>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.tabs}>
        <NativeThemePicker
          values={segmentValues}
          selectedIndex={selectedSegmentIndex}
          onSelect={(index) =>
            setSelectedBookId(index === 0 ? "all" : (chatBooks[index - 1]?.book.id ?? "all"))
          }
          colorScheme={isDark ? "dark" : "light"}
          accessibilityLabel={t("chats.bookFilter", "Фильтр по книге")}
          scrollable
        />
      </View>

      <View style={styles.list}>
        {rows.map((row, index) => {
          const rowKey = `${row.book.id}:${row.character.id}`;
          const portraitUri = row.character.portraitUri
            ? normalizePersistedNarraMediaUri(row.character.portraitUri)
            : undefined;
          return (
            <View key={rowKey}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`${row.character.name}, ${row.book.meta.title}`}
                activeOpacity={0.62}
                onPress={() => openChat(row)}
                style={styles.row}
              >
                <View style={styles.avatar}>
                  {portraitUri ? (
                    <Image
                      source={{ uri: portraitUri }}
                      style={styles.avatarImage}
                      onError={() =>
                        updateCharacter(row.book.id, row.character.id, { portraitUri: undefined })
                      }
                    />
                  ) : (
                    <InitialsAvatar
                      size={56}
                      userId={rowKey}
                      name={row.character.fullName || row.character.name}
                    />
                  )}
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.characterName} numberOfLines={1}>
                    {row.character.fullName || row.character.name}
                  </Text>
                  {row.character.role ? (
                    <Text style={styles.characterMeta} numberOfLines={1}>
                      {row.character.role}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
              {index < rows.length - 1 ? <View style={styles.separator} /> : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl + bottomInset,
    },
    tabs: {
      marginHorizontal: -spacing.lg,
      paddingBottom: spacing.lg,
    },
    list: {},
    row: {
      minHeight: 80,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      paddingVertical: spacing.md,
    },
    avatar: {
      width: 56,
      height: 56,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    avatarImage: { width: "100%", height: "100%" },
    rowBody: { flex: 1, gap: 2 },
    characterName: {
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    characterMeta: {
      color: colors.mutedForeground,
      fontSize: fontSize.base,
      lineHeight: 20,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 56 + spacing.lg,
      backgroundColor: colors.border,
    },
  });
