import { CharacterChatList } from "@/components/chats/character-chat-list";
import { CatalogBookSkeleton } from "@/components/library/CatalogBookSkeleton";
import { CatalogShelfRow } from "@/components/library/catalog-shelf";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { SwipePressGuardProvider, useSwipePressGuard } from "@/components/ui/swipe-press-guard";
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
import { catalogShelfLayout } from "@/lib/narra/catalog-shelf-layout";
import {
  CATALOG_SHELF_SKELETON_KEYS,
  type CatalogShelf,
  buildCatalogShelves,
  completeCatalogSnapshot,
} from "@/lib/narra/catalog-shelves";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useLibraryStore } from "@/stores";
import { type ThemeColors, fontSize, radius, spacing, useTheme } from "@/styles/theme";
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
const INITIAL_SKELETON_COUNT = 2;
const INITIAL_SKELETON_KEYS = Array.from(
  { length: INITIAL_SKELETON_COUNT },
  (_, index) => `search-catalog-skeleton-${index}`,
);
export function SearchScreen() {
  return (
    <SwipePressGuardProvider>
      <SearchContent />
    </SwipePressGuardProvider>
  );
}

function SearchContent() {
  const { colors } = useTheme();
  const swipeGuard = useSwipePressGuard();
  const layout = useResponsiveLayout();
  const shelfColumns = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : 2;
  const { cardWidth: shelfCardWidth } = catalogShelfLayout(
    layout.width,
    layout.centeredContentWidth,
    shelfColumns,
  );
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
  const isFocused = useIsFocused();
  const books = useLibraryStore((state) => state.books);
  const [query, setQuery] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [catalogBooks, setCatalogBooks] = useState<CachedBackendCatalogBook[]>([]);
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(null);
  const [catalogGenres, setCatalogGenres] = useState<BackendCatalogGenre[]>([]);
  const [catalogGenreVersion, setCatalogGenreVersion] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isCatalogLoadingMore, setIsCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoadMoreError, setCatalogLoadMoreError] = useState<string | null>(null);
  const [visibleCatalogKeys, setVisibleCatalogKeys] = useState<Set<string>>(new Set());
  const catalogLoadMoreLockRef = useRef(false);
  const catalogCoverQueueRef = useRef<CatalogCoverQueue | null>(null);
  const catalogViewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 }).current;
  const [visibleShelfIds, setVisibleShelfIds] = useState<Set<string>>(new Set());
  const shelfVisibleBooksRef = useRef(new Map<string, string[]>());
  const shelfBookPositionsRef = useRef(new Map<string, number>());
  const catalogRequestRef = useRef(0);

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
    const request = ++catalogRequestRef.current;
    const isCurrent = () => catalogRequestRef.current === request;
    setIsCatalogLoading(true);
    setCatalogError(null);
    setCatalogLoadMoreError(null);
    const cachedCatalog = await loadCachedBackendCatalog();
    if (!isCurrent()) return;
    // Only a complete cache can safely expose genre shelves during refresh.
    if (cachedCatalog.books.length > 0 && !cachedCatalog.nextCursor)
      applyBackendCatalog(cachedCatalog);
    let latestCatalog = cachedCatalog;
    try {
      latestCatalog = await refreshBackendCatalog();
      const complete = await completeCatalogSnapshot(
        latestCatalog,
        async (current) => {
          latestCatalog = await loadMoreCachedBackendCatalog(current);
          return latestCatalog;
        },
        isCurrent,
      );
      if (complete) applyBackendCatalog(complete);
    } catch (error) {
      if (!isCurrent()) return;
      console.warn("[Search catalog] Failed to refresh backend catalog:", error);
      const fallback =
        cachedCatalog.books.length > 0 && !cachedCatalog.nextCursor ? cachedCatalog : latestCatalog;
      if (fallback.books.length > 0) {
        applyBackendCatalog(fallback);
        if (fallback.nextCursor)
          setCatalogLoadMoreError(
            t("library.catalogLoadMoreError", "Не удалось загрузить следующие книги"),
          );
      } else {
        setCatalogError(t("library.catalogLoadError", "Не удалось загрузить каталог"));
      }
    } finally {
      if (isCurrent()) setIsCatalogLoading(false);
    }
  }, [applyBackendCatalog, t]);

  useEffect(() => {
    void loadBackendCatalog();
    return () => {
      catalogRequestRef.current += 1;
    };
  }, [loadBackendCatalog]);

  const loadMoreBackendCatalogPage = useCallback(async () => {
    if (!catalogNextCursor || catalogLoadMoreLockRef.current || isCatalogLoading || !isFocused)
      return;
    catalogLoadMoreLockRef.current = true;
    setIsCatalogLoadingMore(true);
    setCatalogLoadMoreError(null);
    const request = catalogRequestRef.current;
    try {
      const complete = await completeCatalogSnapshot(
        {
          books: catalogBooks,
          nextCursor: catalogNextCursor,
          genres: catalogGenres,
          genreVersion: catalogGenreVersion,
        },
        loadMoreCachedBackendCatalog,
        () => catalogRequestRef.current === request,
      );
      if (complete) applyBackendCatalog(complete);
    } catch (error) {
      console.warn("[Search catalog] Failed to load the next catalog page:", error);
      setCatalogLoadMoreError(
        t("library.catalogLoadMoreError", "Не удалось загрузить следующие книги"),
      );
    } finally {
      catalogLoadMoreLockRef.current = false;
      setIsCatalogLoadingMore(false);
    }
  }, [
    applyBackendCatalog,
    catalogBooks,
    catalogGenreVersion,
    catalogGenres,
    catalogNextCursor,
    isCatalogLoading,
    isFocused,
    t,
  ]);

  const shelves = useMemo(
    () =>
      buildCatalogShelves(
        catalogBooks,
        catalogGenres,
        i18n.resolvedLanguage ?? "ru",
        t("library.catalogUncategorized", "Без категории"),
      ),
    [catalogBooks, catalogGenres, i18n.resolvedLanguage, t],
  );

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
    if (!isFocused || !catalogCoverQueueRef.current || visibleCatalogKeys.size === 0) return;
    catalogCoverQueueRef.current.enqueue(
      catalogBooks.filter(
        (book) => visibleCatalogKeys.has(book.catalogKey) && book.cover && !book.coverUri,
      ),
    );
  }, [catalogBooks, visibleCatalogKeys, isFocused]);

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
    ({ viewableItems }: { viewableItems: ViewToken<CatalogShelf>[] }) => {
      setVisibleShelfIds(new Set(viewableItems.map(({ item }) => item.id)));
    },
    [],
  );

  const rememberVisibleShelfBooks = useCallback((id: string, keys: string[]) => {
    if (keys.length) shelfVisibleBooksRef.current.set(id, keys);
    else shelfVisibleBooksRef.current.delete(id);
    const next = new Set([...shelfVisibleBooksRef.current.values()].flat());
    setVisibleCatalogKeys((current) =>
      current.size === next.size && [...current].every((key) => next.has(key)) ? current : next,
    );
  }, []);

  const rememberShelfPage = useCallback((id: string, firstBookIndex: number) => {
    shelfBookPositionsRef.current.set(id, firstBookIndex);
  }, []);

  const requestShelfPage = useCallback(() => {
    void loadMoreBackendCatalogPage();
  }, [loadMoreBackendCatalogPage]);

  const libraryKeys = useMemo(() => new Set(catalogBooksInLibrary.keys()), [catalogBooksInLibrary]);

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

  const renderShelf = useCallback(
    ({ item }: ListRenderItemInfo<CatalogShelf>) => (
      <CatalogShelfRow
        key={`${item.id}:${layout.width}:${layout.centeredContentWidth}:${shelfColumns}`}
        shelf={item}
        width={layout.centeredContentWidth}
        viewportWidth={layout.width}
        columns={shelfColumns}
        initialBookIndex={shelfBookPositionsRef.current.get(item.id) ?? 0}
        isVisible={isFocused && visibleShelfIds.has(item.id)}
        hasMore={!!catalogNextCursor}
        isLoadingMore={isCatalogLoadingMore}
        loadMoreError={catalogLoadMoreError}
        libraryKeys={libraryKeys}
        onOpen={handleCatalogOpen}
        onLoadMore={requestShelfPage}
        onPageChange={rememberShelfPage}
        onVisibleBooks={rememberVisibleShelfBooks}
      />
    ),
    [
      layout.width,
      layout.centeredContentWidth,
      shelfColumns,
      isFocused,
      visibleShelfIds,
      catalogNextCursor,
      isCatalogLoadingMore,
      catalogLoadMoreError,
      libraryKeys,
      handleCatalogOpen,
      requestShelfPage,
      rememberShelfPage,
      rememberVisibleShelfBooks,
    ],
  );

  if (!normalizedQuery) {
    return (
      <FlatList
        data={shelves}
        keyExtractor={(shelf) => shelf.id}
        renderItem={renderShelf}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.container}
        contentContainerStyle={styles.catalogContent}
        initialNumToRender={3}
        windowSize={5}
        removeClippedSubviews={false}
        onScrollBeginDrag={() => swipeGuard?.beginSwipe()}
        onScrollEndDrag={() => swipeGuard?.endSwipe()}
        onMomentumScrollBegin={() => swipeGuard?.beginSwipe()}
        onMomentumScrollEnd={() => swipeGuard?.endSwipe()}
        onViewableItemsChanged={handleCatalogViewableItemsChanged}
        viewabilityConfig={catalogViewabilityConfig}
        onEndReached={() => {
          if (!catalogLoadMoreError) void loadMoreBackendCatalogPage();
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          isCatalogLoading ? (
            <View style={styles.skeletonGrid}>
              {INITIAL_SKELETON_KEYS.map((key) => (
                <View key={key} style={styles.catalogFooterSkeletons}>
                  {CATALOG_SHELF_SKELETON_KEYS.slice(0, shelfColumns).map((columnKey) => (
                    <CatalogBookSkeleton key={columnKey} cardWidth={shelfCardWidth} />
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <CenteredEmptyState
              variant="compact"
              title={catalogError ?? t("library.catalogEmpty", "В каталоге пока нет книг")}
              style={styles.catalogStatus}
            >
              {catalogError ? (
                <NativeButton
                  label={t("common.retry", "Повторить")}
                  onPress={() => void loadBackendCatalog()}
                  style={styles.catalogStatusButton}
                />
              ) : null}
            </CenteredEmptyState>
          )
        }
        ListFooterComponent={
          isCatalogLoadingMore ? (
            <View style={styles.catalogFooterSkeletons}>
              {CATALOG_SHELF_SKELETON_KEYS.slice(0, shelfColumns).map((columnKey) => (
                <CatalogBookSkeleton key={columnKey} cardWidth={shelfCardWidth} />
              ))}
            </View>
          ) : catalogNextCursor ? (
            <View style={styles.catalogLoadMoreStatus}>
              {catalogLoadMoreError ? (
                <Text style={styles.catalogLoadMoreText}>{catalogLoadMoreError}</Text>
              ) : null}
              <NativeButton
                label={
                  catalogLoadMoreError
                    ? t("common.retry", "Повторить")
                    : t("common.loadMore", "Загрузить ещё")
                }
                onPress={() => void loadMoreBackendCatalogPage()}
                style={styles.catalogStatusButton}
              />
            </View>
          ) : null
        }
      />
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
      flexGrow: 1,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    skeletonGrid: {
      width: layout.contentWidth,
      alignSelf: "center",
      gap: spacing.xxl,
    },
    catalogFooterSkeletons: {
      width: layout.contentWidth,
      alignSelf: "center",
      flexDirection: "row",
      gap: spacing.lg,
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
});
