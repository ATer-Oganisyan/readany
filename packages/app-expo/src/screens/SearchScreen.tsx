import { CharacterChatList } from "@/components/chats/character-chat-list";
import { CatalogBookSkeleton } from "@/components/library/CatalogBookSkeleton";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { NativeSegmentedPager } from "@/components/ui/native-segmented-pager";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { loadingCoverColorForTitleAuthor } from "@/lib/book/loading-cover-placeholder";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { BackendCatalogGenre } from "@/lib/narra/backend-catalog-api";
import {
  type CachedBackendCatalog,
  type CachedBackendCatalogBook,
  loadCachedBackendCatalog,
  loadMoreCachedBackendCatalog,
  materializeBackendCatalogCover,
  refreshBackendCatalog,
} from "@/lib/narra/backend-catalog-cache";
import { findReadableLibraryBookForCatalogBook } from "@/lib/narra/backend-catalog-library";
import { isBackendDownloadAbort } from "@/lib/narra/backend-file-download";
import { CatalogCoverQueue } from "@/lib/narra/catalog-cover-queue";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useLibraryStore } from "@/stores";
import { type ThemeColors, fontSize, radius, spacing, useTheme } from "@/styles/theme";
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Image,
  Keyboard,
  type KeyboardEvent,
  type ListRenderItemInfo,
  ScrollView,
  StyleSheet,
  View,
  type ViewToken,
} from "react-native";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const FILTER_MINIMUM_BOOKS = 8;
const INITIAL_SKELETON_COUNT = 6;
const INITIAL_SKELETON_KEYS = Array.from(
  { length: INITIAL_SKELETON_COUNT },
  (_, index) => `search-catalog-skeleton-${index}`,
);
const FOOTER_SKELETON_KEYS = Array.from(
  { length: 5 },
  (_, index) => `search-catalog-footer-skeleton-${index}`,
);

interface CatalogGenreOption {
  id: string | null;
  label: string;
}

export function SearchScreen() {
  const { colors, isDark } = useTheme();
  const layout = useResponsiveLayout();
  const styles = useMemo(
    () =>
      makeStyles(colors, {
        contentWidth: layout.centeredContentWidth,
        horizontalPadding: layout.horizontalPadding,
      }),
    [colors, layout.centeredContentWidth, layout.horizontalPadding],
  );
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<Nav>();
  const nativeHeaderHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const books = useLibraryStore((state) => state.books);
  const [query, setQuery] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [catalogBooks, setCatalogBooks] = useState<CachedBackendCatalogBook[]>([]);
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(null);
  const [catalogGenres, setCatalogGenres] = useState<BackendCatalogGenre[]>([]);
  const [catalogGenreVersion, setCatalogGenreVersion] = useState<string | null>(null);
  const [selectedCatalogGenre, setSelectedCatalogGenre] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isCatalogLoadingMore, setIsCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoadMoreError, setCatalogLoadMoreError] = useState<string | null>(null);
  const [visibleCatalogKeys, setVisibleCatalogKeys] = useState<Set<string>>(new Set());
  const catalogLoadMoreLockRef = useRef(false);
  const catalogCoverQueueRef = useRef<CatalogCoverQueue | null>(null);
  const catalogViewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 }).current;

  useEffect(() => {
    const updateKeyboardHeight = (event: KeyboardEvent) => {
      setKeyboardHeight(event.endCoordinates.height);
    };
    const showEvent = process.env.EXPO_OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = process.env.EXPO_OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, updateKeyboardHeight);
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder: t("search.booksPlaceholder", "Книги и авторы"),
        onChangeText: ({ nativeEvent }) => setQuery(nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [navigation, t]);

  const applyBackendCatalog = useCallback((catalog: CachedBackendCatalog) => {
    setCatalogBooks(catalog.books);
    setCatalogNextCursor(catalog.nextCursor);
    setCatalogGenres(catalog.genres);
    setCatalogGenreVersion(catalog.genreVersion);
  }, []);

  const loadBackendCatalog = useCallback(async () => {
    setIsCatalogLoading(true);
    setCatalogError(null);
    setCatalogLoadMoreError(null);
    const cachedCatalog = await loadCachedBackendCatalog();
    if (cachedCatalog.books.length > 0) applyBackendCatalog(cachedCatalog);
    try {
      applyBackendCatalog(await refreshBackendCatalog());
    } catch (error) {
      console.warn("[Search catalog] Failed to refresh backend catalog:", error);
      if (cachedCatalog.books.length === 0) {
        setCatalogError(t("library.catalogLoadError", "Не удалось загрузить каталог"));
      }
    } finally {
      setIsCatalogLoading(false);
    }
  }, [applyBackendCatalog, t]);

  useEffect(() => {
    void loadBackendCatalog();
  }, [loadBackendCatalog]);

  const loadMoreBackendCatalogPage = useCallback(async () => {
    if (!catalogNextCursor || catalogLoadMoreLockRef.current) return;
    catalogLoadMoreLockRef.current = true;
    setIsCatalogLoadingMore(true);
    setCatalogLoadMoreError(null);
    try {
      applyBackendCatalog(
        await loadMoreCachedBackendCatalog({
          books: catalogBooks,
          nextCursor: catalogNextCursor,
          genres: catalogGenres,
          genreVersion: catalogGenreVersion,
        }),
      );
    } catch (error) {
      console.warn("[Search catalog] Failed to load the next catalog page:", error);
      setCatalogLoadMoreError(
        t("library.catalogLoadMoreError", "Не удалось загрузить следующие книги"),
      );
    } finally {
      catalogLoadMoreLockRef.current = false;
      setIsCatalogLoadingMore(false);
    }
  }, [applyBackendCatalog, catalogBooks, catalogGenreVersion, catalogGenres, catalogNextCursor, t]);

  const validCatalogGenreIds = useMemo(
    () => new Set(catalogGenres.map((genre) => genre.id)),
    [catalogGenres],
  );
  const filteredCatalogBooks = useMemo(() => {
    if (!selectedCatalogGenre) return catalogBooks;
    if (selectedCatalogGenre === "__uncategorized__") {
      return catalogBooks.filter((book) => book.genres.length === 0);
    }
    if (!validCatalogGenreIds.has(selectedCatalogGenre)) return catalogBooks;
    return catalogBooks.filter((book) => book.genres.includes(selectedCatalogGenre));
  }, [catalogBooks, selectedCatalogGenre, validCatalogGenreIds]);
  const hasUncategorizedCatalogBooks = useMemo(
    () => catalogBooks.some((book) => book.genres.length === 0),
    [catalogBooks],
  );
  const genreOptions = useMemo<CatalogGenreOption[]>(() => {
    const options: CatalogGenreOption[] = [
      { id: null, label: t("library.catalogAllGenres", "Все") },
      ...catalogGenres.map((genre) => ({
        id: genre.id,
        label: i18n.resolvedLanguage === "en" ? genre.labelEn : genre.labelRu,
      })),
    ];
    if (hasUncategorizedCatalogBooks) {
      options.push({
        id: "__uncategorized__",
        label: t("library.catalogUncategorized", "Без категории"),
      });
    }
    return options;
  }, [catalogGenres, hasUncategorizedCatalogBooks, i18n.resolvedLanguage, t]);
  const selectedGenreIndex = Math.max(
    0,
    genreOptions.findIndex((option) => option.id === selectedCatalogGenre),
  );

  useEffect(() => {
    if (
      selectedCatalogGenre &&
      selectedCatalogGenre !== "__uncategorized__" &&
      !validCatalogGenreIds.has(selectedCatalogGenre)
    ) {
      setSelectedCatalogGenre(null);
    }
  }, [selectedCatalogGenre, validCatalogGenreIds]);

  useEffect(() => {
    if (
      selectedCatalogGenre &&
      filteredCatalogBooks.length < FILTER_MINIMUM_BOOKS &&
      catalogNextCursor &&
      !isCatalogLoading &&
      !isCatalogLoadingMore &&
      !catalogLoadMoreError
    ) {
      void loadMoreBackendCatalogPage();
    }
  }, [
    catalogLoadMoreError,
    catalogNextCursor,
    filteredCatalogBooks.length,
    isCatalogLoading,
    isCatalogLoadingMore,
    loadMoreBackendCatalogPage,
    selectedCatalogGenre,
  ]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    return books.filter((book) => {
      if (book.deletedAt) return false;
      return [book.meta.title, book.meta.author]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [books, normalizedQuery]);
  const resultCoverItems = useMemo(
    () => results.map((book) => ({ bookId: book.id, coverUrl: book.meta.coverUrl ?? null })),
    [results],
  );
  const resultCovers = useResolvedCovers(resultCoverItems);

  const catalogBooksInLibrary = useMemo(() => {
    const result = new Map<string, Book>();
    for (const catalogBook of catalogBooks) {
      const existingBook = findReadableLibraryBookForCatalogBook(catalogBook, books);
      if (existingBook) result.set(catalogBook.catalogKey, existingBook);
    }
    return result;
  }, [books, catalogBooks]);
  const catalogSearchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return catalogBooks.filter((book) =>
      [book.title, book.author].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      ),
    );
  }, [catalogBooks, normalizedQuery]);

  const rememberCatalogCover = useCallback((catalogKey: string, coverUri: string) => {
    setCatalogBooks((current) =>
      current.map((book) => (book.catalogKey === catalogKey ? { ...book, coverUri } : book)),
    );
  }, []);

  useEffect(() => {
    if (!isFocused) {
      catalogCoverQueueRef.current?.dispose();
      catalogCoverQueueRef.current = null;
      return;
    }

    const queue = new CatalogCoverQueue({
      concurrency: 2,
      load: materializeBackendCatalogCover,
      onLoaded: rememberCatalogCover,
      onError: (catalogKey, error) => {
        if (!isBackendDownloadAbort(error)) {
          console.warn(`[Search catalog] Failed to load visible cover ${catalogKey}:`, error);
        }
      },
    });
    catalogCoverQueueRef.current = queue;
    return () => {
      if (catalogCoverQueueRef.current === queue) catalogCoverQueueRef.current = null;
      queue.dispose();
    };
  }, [isFocused, rememberCatalogCover]);

  useEffect(() => {
    if (!catalogCoverQueueRef.current || visibleCatalogKeys.size === 0) return;
    catalogCoverQueueRef.current.enqueue(
      filteredCatalogBooks.filter(
        (book) => visibleCatalogKeys.has(book.catalogKey) && book.cover && !book.coverUri,
      ),
    );
  }, [filteredCatalogBooks, visibleCatalogKeys]);

  useEffect(() => {
    if (!normalizedQuery || !catalogCoverQueueRef.current) return;
    catalogCoverQueueRef.current.enqueue(
      catalogSearchResults.filter((book) => book.cover && !book.coverUri),
    );
  }, [catalogSearchResults, normalizedQuery]);

  useEffect(() => {
    if (
      normalizedQuery &&
      catalogSearchResults.length < FILTER_MINIMUM_BOOKS &&
      catalogNextCursor &&
      !isCatalogLoading &&
      !isCatalogLoadingMore &&
      !catalogLoadMoreError
    ) {
      void loadMoreBackendCatalogPage();
    }
  }, [
    catalogLoadMoreError,
    catalogNextCursor,
    catalogSearchResults.length,
    isCatalogLoading,
    isCatalogLoadingMore,
    loadMoreBackendCatalogPage,
    normalizedQuery,
  ]);

  const handleCatalogViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<CachedBackendCatalogBook>[] }) => {
      const nextKeys = new Set(
        viewableItems.flatMap(({ item }) => (item ? [item.catalogKey] : [])),
      );
      setVisibleCatalogKeys((current) => {
        if (
          current.size === nextKeys.size &&
          [...current].every((catalogKey) => nextKeys.has(catalogKey))
        ) {
          return current;
        }
        return nextKeys;
      });
    },
    [],
  );

  const handleCatalogOpen = useCallback(
    async (catalogBook: CachedBackendCatalogBook) => {
      const existingBook = catalogBooksInLibrary.get(catalogBook.catalogKey);
      if (existingBook) {
        await openMobileBook({ bookId: existingBook.id, navigation, t });
        return;
      }
      navigation.navigate("Reader", { bookId: "", catalogBook });
    },
    [catalogBooksInLibrary, navigation, t],
  );

  const selectCatalogGenre = useCallback(
    (index: number) => {
      const genreId = genreOptions[index]?.id ?? null;
      setSelectedCatalogGenre(genreId);
      setVisibleCatalogKeys(new Set());
    },
    [genreOptions],
  );

  const renderCatalogBook = useCallback(
    ({ item }: ListRenderItemInfo<CachedBackendCatalogBook>) => (
      <CharacterChatList
        items={[
          {
            key: item.bookEditionId,
            accessibilityLabel: item.title,
            title: item.title,
            subtitle: item.author,
            onPress: () => void handleCatalogOpen(item),
            avatar: (
              <BookListCover title={item.title} author={item.author} coverUri={item.coverUri} />
            ),
          },
        ]}
      />
    ),
    [handleCatalogOpen],
  );

  const renderCatalogPage = (option: CatalogGenreOption, index: number) => {
    const pageBooks = (() => {
      if (!option.id) return catalogBooks;
      if (option.id === "__uncategorized__") {
        return catalogBooks.filter((book) => book.genres.length === 0);
      }
      if (!validCatalogGenreIds.has(option.id)) return catalogBooks;
      return catalogBooks.filter((book) => book.genres.includes(option.id as string));
    })();
    const isActivePage = index === selectedGenreIndex;

    return (
      <FlatList
        key={`search-catalog-${option.id ?? "all"}`}
        data={pageBooks}
        renderItem={renderCatalogBook}
        keyExtractor={(book) => book.bookEditionId}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.container}
        contentContainerStyle={styles.catalogContent}
        ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
        ListEmptyComponent={
          isCatalogLoading ? (
            <View style={styles.skeletonGrid}>
              {INITIAL_SKELETON_KEYS.map((key) => (
                <BookListSkeleton key={key} />
              ))}
            </View>
          ) : catalogError ? (
            <CenteredEmptyState variant="compact" title={catalogError} style={styles.catalogStatus}>
              <NativeButton
                label={t("common.retry", "Повторить")}
                onPress={() => void loadBackendCatalog()}
                style={styles.catalogStatusButton}
              />
            </CenteredEmptyState>
          ) : (
            <CenteredEmptyState
              variant="compact"
              title={
                option.id
                  ? t("library.catalogGenreEmpty", "В этой категории пока нет книг")
                  : t("library.catalogEmpty", "В каталоге пока нет книг")
              }
              style={styles.catalogStatus}
            />
          )
        }
        ListFooterComponent={
          isActivePage && isCatalogLoadingMore ? (
            <View style={styles.catalogFooterSkeletons}>
              {FOOTER_SKELETON_KEYS.slice(0, 3).map((key) => (
                <BookListSkeleton key={key} />
              ))}
            </View>
          ) : isActivePage && catalogLoadMoreError ? (
            <View style={styles.catalogLoadMoreStatus}>
              <Text style={styles.catalogLoadMoreText}>{catalogLoadMoreError}</Text>
              <NativeButton
                label={t("common.retry", "Повторить")}
                onPress={() => void loadMoreBackendCatalogPage()}
                style={styles.catalogStatusButton}
              />
            </View>
          ) : null
        }
        onViewableItemsChanged={handleCatalogViewableItemsChanged}
        viewabilityConfig={catalogViewabilityConfig}
        onEndReached={isActivePage ? () => void loadMoreBackendCatalogPage() : undefined}
        onEndReachedThreshold={0.75}
      />
    );
  };

  if (!normalizedQuery) {
    return (
      <View style={styles.container}>
        <NativeSegmentedPager
          values={genreOptions.map((option) => option.label)}
          selectedIndex={selectedGenreIndex}
          onSelect={selectCatalogGenre}
          colorScheme={isDark ? "dark" : "light"}
          accessibilityLabel={t("search.genreFilter", "Фильтр по жанру")}
          scrollableSegments
          fillHeight
          controlsStyle={{
            paddingTop: nativeHeaderHeight + spacing.sm,
            paddingBottom: spacing.lg,
          }}
        >
          {genreOptions.map(renderCatalogPage)}
        </NativeSegmentedPager>
      </View>
    );
  }

  const catalogOnlySearchResults = catalogSearchResults.filter((catalogBook) => {
    const imported = catalogBooksInLibrary.get(catalogBook.catalogKey);
    return !imported || !results.some((book) => book.id === imported.id);
  });
  const hasSearchResults = results.length > 0 || catalogOnlySearchResults.length > 0;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={styles.container}
      contentContainerStyle={[
        styles.searchContent,
        !hasSearchResults && styles.centeredContent,
        !hasSearchResults &&
          keyboardHeight > 0 && {
            // The native search controls sit above the keyboard, outside this React Native view.
            paddingBottom: keyboardHeight + spacing.xxl * 5,
          },
      ]}
    >
      {!hasSearchResults ? (
        <CenteredEmptyState variant="compact" title={t("search.empty", "Ничего не найдено")} />
      ) : (
        <CharacterChatList
          items={[
            ...results.map((book) => ({
              key: `library:${book.id}`,
              accessibilityLabel: book.meta.title,
              title: book.meta.title,
              subtitle: book.meta.author,
              onPress: () => void openMobileBook({ bookId: book.id, navigation, t }),
              avatar: (
                <BookListCover
                  title={book.meta.title}
                  author={book.meta.author}
                  coverUri={resultCovers.get(book.id)}
                />
              ),
            })),
            ...catalogOnlySearchResults.map((book) => ({
              key: `catalog:${book.bookEditionId}`,
              accessibilityLabel: book.title,
              title: book.title,
              subtitle: book.author,
              onPress: () => void handleCatalogOpen(book),
              avatar: (
                <BookListCover title={book.title} author={book.author} coverUri={book.coverUri} />
              ),
            })),
          ]}
        />
      )}
    </ScrollView>
  );
}

const makeStyles = (
  colors: ThemeColors,
  layout: { contentWidth: number; horizontalPadding: number },
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    catalogContent: {
      width: "100%",
      maxWidth: layout.contentWidth + layout.horizontalPadding * 2,
      alignSelf: "center",
      flexGrow: 1,
      paddingHorizontal: layout.horizontalPadding,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    skeletonGrid: {
      gap: spacing.sm,
    },
    catalogFooterSkeletons: {
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    catalogStatus: {
      minHeight: 280,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.lg,
      paddingHorizontal: spacing.xl,
    },
    catalogStatusButton: { alignSelf: "center" },
    catalogLoadMoreStatus: {
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xl,
    },
    catalogLoadMoreText: { color: colors.mutedForeground, fontSize: fontSize.sm },
    searchContent: {
      flexGrow: 1,
      width: "100%",
      maxWidth: layout.contentWidth + layout.horizontalPadding * 2,
      alignSelf: "center",
      paddingHorizontal: layout.horizontalPadding,
      paddingBottom: spacing.xxl,
    },
    centeredContent: { justifyContent: "center" },
    listSeparator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 56 + spacing.lg,
      backgroundColor: colors.primary20,
    },
  });

function BookListCover({
  title,
  author,
  coverUri,
}: {
  title: string;
  author?: string;
  coverUri?: string;
}) {
  const { colors } = useTheme();
  const [failedCoverUri, setFailedCoverUri] = useState<string>();
  const visibleCoverUri = coverUri && coverUri !== failedCoverUri ? coverUri : undefined;

  return (
    <View style={bookListStyles.coverSlot}>
      <View
        style={[
          bookListStyles.cover,
          {
            backgroundColor:
              visibleCoverUri == null
                ? loadingCoverColorForTitleAuthor({ title, author })
                : colors.primary5,
          },
        ]}
      >
        {visibleCoverUri ? (
          <Image
            source={{ uri: visibleCoverUri }}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
            onError={() => setFailedCoverUri(visibleCoverUri)}
          />
        ) : null}
      </View>
    </View>
  );
}

function BookListSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={bookListStyles.skeletonRow}>
      <View style={bookListStyles.coverSlot}>
        <CatalogBookSkeleton cardWidth={38} />
      </View>
      <View style={bookListStyles.skeletonCopy}>
        <View style={[bookListStyles.skeletonTitle, { backgroundColor: colors.primary10 }]} />
        <View style={[bookListStyles.skeletonAuthor, { backgroundColor: colors.primary5 }]} />
      </View>
    </View>
  );
}

const bookListStyles = StyleSheet.create({
  coverSlot: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  cover: {
    width: 38,
    height: 56,
    overflow: "hidden",
    borderRadius: radius.sm,
    borderCurve: "continuous",
  },
  skeletonRow: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  skeletonCopy: { flex: 1, gap: spacing.sm, paddingTop: spacing.xs },
  skeletonTitle: { width: "62%", height: 16, borderRadius: radius.sm },
  skeletonAuthor: { width: "42%", height: 14, borderRadius: radius.sm },
});
