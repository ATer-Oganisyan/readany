import { NativeNotesList } from "@/components/notes/NativeNotesList";
import { ScrollViewMarker } from "@/components/ui/ScrollViewMarker";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { toast } from "@/lib/notifications";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { NATIVE_SCROLL_EDGE_EFFECTS } from "@/navigation/scroll-edge-effects";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { useColors } from "@/styles/theme";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { deleteBookmark, getBookmarks } from "@readany/core/db/database";
import { compareCfiPosition } from "@readany/core/reader";
import type { Bookmark } from "@readany/core/types";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { annotationDayLabel } from "./notes/group-by-annotation-day";

const emptyScrollEdgeEffects = { ...NATIVE_SCROLL_EDGE_EFFECTS, top: "hidden" } as const;

export function BookmarksScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const books = useLibraryStore((state) => state.books);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setFailed(false);
      getBookmarks()
        .then((items) => {
          if (active) setBookmarks(items);
        })
        .catch(() => {
          if (active) setFailed(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  // Grouped by book (most recently bookmarked first), later pages on top.
  const sections = useMemo(() => {
    const pageOf = (bookmark: Bookmark) => {
      const page = bookmark.pageNumber ?? Number(bookmark.cfi.match(/^page[:\-](\d+)$/i)?.[1]);
      return Number.isInteger(page) && page > 0 ? page : undefined;
    };
    const byBook = new Map<string, Bookmark[]>();
    for (const bookmark of bookmarks) {
      byBook.set(bookmark.bookId, [...(byBook.get(bookmark.bookId) ?? []), bookmark]);
    }
    return [...byBook.entries()]
      .map(([bookId, items]) => ({
        bookId,
        lastAddedAt: Math.max(...items.map((item) => item.createdAt)),
        title:
          books.find((book) => book.id === bookId)?.meta.title ||
          t("notes.unknownBook", "Неизвестная книга"),
        data: [...items]
          .sort((a, b) => (pageOf(b) ?? 0) - (pageOf(a) ?? 0) || compareCfiPosition(b.cfi, a.cfi))
          .map((bookmark) => {
            const page = pageOf(bookmark);
            return {
              id: bookmark.id,
              title: page
                ? t("bookmarks.page", "Страница {{page}}", { page })
                : bookmark.chapterTitle || t("bookmarks.pageUnknown", "Страница не сохранена"),
              bookTitle: annotationDayLabel(bookmark.createdAt, t),
            };
          }),
      }))
      .sort((a, b) => b.lastAddedAt - a.lastAddedAt);
  }, [bookmarks, books, t]);

  const handleDelete = async (id: string) => {
    try {
      await deleteBookmark(id);
      setBookmarks((items) => items.filter((item) => item.id !== id));
      const store = useAnnotationStore.getState();
      store.setBookmarks(store.bookmarks.filter((item) => item.id !== id));
    } catch {
      toast.error(t("bookmarks.deleteFailed", "Не удалось удалить закладку"));
    }
  };

  if (loading)
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (failed || sections.length === 0)
    return (
      <ScrollViewMarker
        style={{ flex: 1, backgroundColor: colors.background }}
        scrollEdgeEffects={emptyScrollEdgeEffects}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <CenteredEmptyState
            avoidNativeTabBar
            title={
              failed
                ? t("bookmarks.loadFailed", "Не удалось загрузить закладки")
                : t("bookmarks.empty", "Закладок пока нет")
            }
            description={
              failed
                ? t("bookmarks.retryHint", "Откройте раздел ещё раз, чтобы повторить загрузку.")
                : t("bookmarks.emptyHint", "Добавьте закладку в меню читалки.")
            }
          />
        </ScrollView>
      </ScrollViewMarker>
    );
  return (
    <NativeNotesList
      sections={sections}
      itemAccessibilityKey="bookmarks.openBookmark"
      onDelete={(id) => void handleDelete(id)}
      onPress={(id) => {
        const bookmark = bookmarks.find((item) => item.id === id);
        if (bookmark)
          void openMobileBook({ bookId: bookmark.bookId, cfi: bookmark.cfi, navigation: nav, t });
      }}
    />
  );
}
