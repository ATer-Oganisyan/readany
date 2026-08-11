import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import {
  CharacterChatAvatar,
  CharacterChatList,
  type CharacterChatListItem,
} from "@/components/chats/character-chat-list";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { NativeThemePicker } from "@/components/profile/NativeThemePicker";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { hasCharacterPortrait } from "@/lib/narra/character-portrait";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, spacing, useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
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

  const openNarraChat = useCallback(() => {
    if (selectedBookId === "all") {
      navigation.navigate("Chat");
      return;
    }
    navigation.navigate("BookChat", { bookId: selectedBookId });
  }, [navigation, selectedBookId]);

  useEffect(() => {
    if (portraitLoadingKey) return;
    const nextRow = rows.find((row) => {
      const key = `${row.book.id}:${row.character.id}`;
      return (
        row.unlocked &&
        !hasCharacterPortrait(row.character) &&
        !portraitAttemptsRef.current.has(key)
      );
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

  const listItems: CharacterChatListItem[] = [
    {
      key: "narra",
      accessibilityLabel:
        selectedBookId === "all" ? "Открыть чат с Наррой" : "Открыть чат с Наррой об этой книге",
      title: "Нарра",
      subtitle:
        selectedBookId === "all" ? "Спросите что угодно о книгах" : "Спросите что угодно о книге",
      onPress: openNarraChat,
      avatar: (
        <CharacterChatAvatar muted>
          <AnimatedNarraFace width={38} height={40} />
        </CharacterChatAvatar>
      ),
    },
    ...rows.map((row): CharacterChatListItem => {
      const rowKey = `${row.book.id}:${row.character.id}`;

      return {
        key: rowKey,
        accessibilityLabel: `${row.character.name}, ${row.book.meta.title}`,
        title: row.character.fullName || row.character.name,
        subtitle: row.character.role,
        onPress: () => openChat(row),
        avatar: (
          <CharacterChatAvatar>
            <CharacterPortraitImage
              character={row.character}
              style={styles.avatarImage}
              fallback={
                <InitialsAvatar
                  size={56}
                  userId={rowKey}
                  name={row.character.fullName || row.character.name}
                />
              }
            />
          </CharacterChatAvatar>
        ),
      };
    }),
  ];

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

      <CharacterChatList items={listItems} />
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
    avatarImage: { width: "100%", height: "100%" },
  });
