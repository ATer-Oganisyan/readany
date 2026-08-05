import { NativeButton } from "@/components/ui/NativeButton";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * ReadingTabScreen — вкладка «Читалка»: всегда открывает текст последней книги
 * на месте остановки, без промежуточной карточки.
 *
 * Логика: при фокусе вкладки сразу вызываем канонический `openMobileBook()`
 * (Reader сам открывает сохранённую позицию `book.currentCfi`). Когда пользователь
 * выходит из ридера стрелкой назад и фокус возвращается на вкладку, немедленно
 * переводим его на таб «Библиотека» — вкладка не задерживается на экране.
 */
export function ReadingTabScreen() {
  const { colors } = useTheme();
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

  // true — только что вернулись из ридера: вместо повторного открытия уходим в Библиотеку
  const returnedFromReaderRef = useRef(false);
  const openInFlightRef = useRef(false);

  const goToLibrary = useCallback(() => {
    navigation.getParent()?.navigate("Library" as never);
  }, [navigation]);

  const openLastBook = useCallback(() => {
    const book = lastBookRef.current;
    if (!book || openInFlightRef.current) return;
    openInFlightRef.current = true;
    void openMobileBook({ bookId: book.id, navigation, t })
      .then((opened) => {
        if (opened) returnedFromReaderRef.current = true;
        // Книга не открылась (файл потерян и т.п.) — не оставляем пустую вкладку
        else goToLibrary();
      })
      .finally(() => {
        openInFlightRef.current = false;
      });
  }, [goToLibrary, navigation, t]);

  // Фокус вкладки: возврат из ридера → сразу в Библиотеку, иначе → открыть книгу
  useEffect(() => {
    if (!isFocused || !lastBook) return;
    if (returnedFromReaderRef.current) {
      returnedFromReaderRef.current = false;
      goToLibrary();
      return;
    }
    openLastBook();
  }, [isFocused, lastBook, goToLibrary, openLastBook]);

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
          onPress={goToLibrary}
        />
      </CenteredEmptyState>
    );
  }

  // Пока открывается ридер (или идёт переброс в Библиотеку) — просто фон, без карточки
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
