import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import {
  CharacterChatAvatar,
  CharacterChatList,
  type CharacterChatListItem,
} from "@/components/chats/character-chat-list";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { EmptyStateActionButton } from "@/components/ui/empty-state-action-button";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { NativeSegmentedPager } from "@/components/ui/native-segmented-pager";
import { getBookTabLabel } from "@/lib/book/book-tab-label";
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
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

const MAX_AUTOMATIC_PORTRAIT_ATTEMPTS = 2;

export function ChatsScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const books = useLibraryStore((state) => state.books);
  const narraBooks = useNarraStore((state) => state.books);
  const setCharacters = useNarraStore((state) => state.setCharacters);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const [selectedBookId, setSelectedBookId] = useState("all");
  const [portraitLoadingKey, setPortraitLoadingKey] = useState<string | null>(null);
  const portraitAttemptsRef = useRef(new Map<string, number>());

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

  const allRows = useMemo<ChatRow[]>(() => {
    return chatBooks.flatMap(({ book, characters, fromBundledCatalog }) => {
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
  }, [chatBooks, narraBooks]);

  const rows = useMemo(
    () =>
      selectedBookId === "all" ? allRows : allRows.filter(({ book }) => book.id === selectedBookId),
    [allRows, selectedBookId],
  );

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

  const openNarraChat = useCallback(
    (bookId: string) => {
      if (bookId === "all") {
        navigation.navigate("Chat");
        return;
      }
      navigation.navigate("BookChat", { bookId });
    },
    [navigation],
  );

  const goToCatalog = useCallback(() => {
    navigation.getParent()?.navigate(
      "Library" as never,
      {
        screen: "LibraryHome",
        params: { initialSection: "catalog" },
      } as never,
    );
  }, [navigation]);

  const selectChatPage = useCallback(
    (index: number) => {
      setSelectedBookId(index === 0 ? "all" : (chatBooks[index - 1]?.book.id ?? "all"));
    },
    [chatBooks],
  );

  const buildListItems = (pageBookId: string): CharacterChatListItem[] => {
    const pageRows =
      pageBookId === "all" ? allRows : allRows.filter(({ book }) => book.id === pageBookId);

    return [
      {
        key: "narra",
        accessibilityLabel:
          pageBookId === "all"
            ? t("narra.openNarraChat", "Открыть чат с Наррой")
            : t("narra.openNarraBookChat", "Открыть чат с Наррой об этой книге"),
        title: "Нарра",
        subtitle:
          pageBookId === "all"
            ? t("narra.askAboutBooks", "Спросите что угодно о книгах")
            : t("narra.askAboutBook", "Спросите что угодно о книге"),
        onPress: () => openNarraChat(pageBookId),
        avatar: (
          <CharacterChatAvatar muted>
            <AnimatedNarraFace width={38} height={40} />
          </CharacterChatAvatar>
        ),
      },
      ...pageRows.map((row): CharacterChatListItem => {
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
  };

  /*
   * Portrait generation stays scoped to the selected page so horizontal paging
   * does not start background work for every book at once.
   */
  useEffect(() => {
    if (portraitLoadingKey) return;
    const nextRow = rows.find((row) => {
      const key = `${row.book.id}:${row.character.id}`;
      return (
        row.unlocked &&
        !hasCharacterPortrait(row.character) &&
        (portraitAttemptsRef.current.get(key) ?? 0) < MAX_AUTOMATIC_PORTRAIT_ATTEMPTS
      );
    });
    if (!nextRow) return;

    const key = `${nextRow.book.id}:${nextRow.character.id}`;
    portraitAttemptsRef.current.set(key, (portraitAttemptsRef.current.get(key) ?? 0) + 1);
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
        title={t("chats.emptyTitle", "Чаты с героями появятся после добавления книги")}
        description={t("chats.emptyDescription", "С ними можно будет пообщаться")}
      >
        <EmptyStateActionButton
          label={t("chats.emptyAction", "Добавить")}
          accessibilityLabel={t("chats.emptyAction", "Добавить")}
          onPress={goToCatalog}
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
      <NativeSegmentedPager
        values={segmentValues}
        selectedIndex={selectedSegmentIndex}
        onSelect={selectChatPage}
        colorScheme={isDark ? "dark" : "light"}
        accessibilityLabel={t("chats.bookFilter", "Фильтр по книге")}
        scrollableSegments
        controlsStyle={styles.tabs}
        minimumPageHeight={Math.max(1, viewportHeight - insets.top - insets.bottom - 120)}
      >
        {segmentValues.map((_, index) => {
          const pageBookId = index === 0 ? "all" : chatBooks[index - 1]?.book.id;
          return (
            <View key={pageBookId ?? `chat-page-${index}`}>
              <CharacterChatList items={buildListItems(pageBookId ?? "all")} />
            </View>
          );
        })}
      </NativeSegmentedPager>
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
