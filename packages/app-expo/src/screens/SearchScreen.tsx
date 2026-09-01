import { CharacterChatListRow } from "@/components/chats/character-chat-list";
import { CatalogBookSkeleton } from "@/components/library/CatalogBookSkeleton";
import { BookCoverTypography } from "@/components/library/book-cover-typography";
import { CatalogShelfRow } from "@/components/library/catalog-shelf";
import { BookSurface } from "@/components/library/perspective-book";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { SwipePressGuardProvider, useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { useBackendCatalog, useBackendCatalogActivity } from "@/hooks/use-backend-catalog";
import { useCatalogCover } from "@/hooks/use-catalog-cover";
import { useCatalogCoverWindow } from "@/hooks/use-catalog-cover-window";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { loadingCoverColorForTitleAuthor } from "@/lib/book/loading-cover-placeholder";
import { countRender, markInteraction } from "@/lib/diagnostics/interaction-performance";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { findReadableLibraryBookForCatalogBook } from "@/lib/narra/backend-catalog-library";
import { retryCatalogCover } from "@/lib/narra/catalog-cover-coordinator";
import { getCatalogBookWithCover } from "@/lib/narra/catalog-cover-store";
import {
  type BookSearchResult,
  buildBookSearchIndex,
  normalizeBookQuery,
  searchBookIndex,
  searchResultWindow,
} from "@/lib/narra/catalog-search-results";
import { catalogShelfLayout } from "@/lib/narra/catalog-shelf-layout";
import {
  CATALOG_SHELF_SKELETON_KEYS,
  type CatalogShelf,
  buildCatalogShelves,
  catalogCoverWindow,
} from "@/lib/narra/catalog-shelves";
import { NativeSearchQuery } from "@/lib/narra/native-search-query";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useLibraryStore } from "@/stores";
import { type ThemeColors, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book } from "@readany/core/types";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  type GestureResponderEvent,
  Image,
  Keyboard,
  type KeyboardEvent,
  type ListRenderItemInfo,
  StyleSheet,
  View,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarProps } from "react-native-screens";

type Nav = NativeStackNavigationProp<RootStackParamList>;
const EMPTY_SHELVES: CatalogShelf[] = [];
const INITIAL_SKELETON_KEYS = ["search-skeleton-1", "search-skeleton-2"];

export function SearchScreen() {
  return (
    <SwipePressGuardProvider>
      <SearchContent />
    </SwipePressGuardProvider>
  );
}

const SearchContent = memo(function SearchContent() {
  countRender("search.screen");
  const { colors } = useTheme();
  const layout = useResponsiveLayout();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<Nav>();
  const books = useLibraryStore((state) => state.books);
  const snapshot = useBackendCatalog(false);
  const { catalog } = snapshot;
  const guard = useSwipePressGuard();
  const draft = useRef(new NativeSearchQuery()).current;
  const searchBarRef = useRef<NonNullable<SearchBarProps["ref"]>["current"]>(null);
  const [query, setQuery] = useState("");
  const normalized = normalizeBookQuery(query);
  const deferredQuery = useDeferredValue(normalized);
  const searching = normalized.length > 0;
  const navigating = useRef(false);
  const opening = useRef(false);
  const styles = useMemo(
    () =>
      makeStyles(colors, {
        centeredContentWidth: layout.centeredContentWidth,
        horizontalPadding: layout.horizontalPadding,
      }),
    [colors, layout.centeredContentWidth, layout.horizontalPadding],
  );
  const columns = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : 2;
  const shelves = useMemo(() => {
    countRender("catalog.group");
    return buildCatalogShelves(
      catalog.books,
      catalog.genres,
      i18n.resolvedLanguage ?? "ru",
      t("library.catalogUncategorized", "Без категории"),
    );
  }, [catalog.books, catalog.genres, i18n.resolvedLanguage, t]);
  const libraryKeys = useMemo(
    () =>
      new Set(
        catalog.books.flatMap((book) =>
          findReadableLibraryBookForCatalogBook(book, books) ? [book.catalogKey] : [],
        ),
      ),
    [books, catalog.books],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        ref: searchBarRef,
        placeholder: t("search.booksPlaceholder", "Книги и авторы"),
        onChangeText: ({ nativeEvent }) => {
          const next = draft.change(nativeEvent.text);
          if (next.restore) searchBarRef.current?.setText(next.query);
          else {
            markInteraction("search.input");
            setQuery(next.query);
          }
        },
        onFocus: () => searchBarRef.current?.setText(draft.focus()),
        onCancelButtonPress: () => {
          draft.cancel();
          searchBarRef.current?.blur();
        },
      },
    });
  }, [draft, navigation, t]);
  useEffect(
    () =>
      navigation.addListener("focus", () => {
        if (!opening.current) navigating.current = false;
      }),
    [navigation],
  );

  const openCategory = useCallback(
    (shelf: CatalogShelf) => {
      if (navigating.current || !navigation.isFocused()) return;
      navigating.current = true;
      searchBarRef.current?.blur();
      markInteraction("category.open");
      navigation.navigate("CatalogCategory", { genreId: shelf.id, title: shelf.title });
    },
    [navigation],
  );
  const openCatalogBook = useCallback(
    async (book: CachedBackendCatalogBook) => {
      if (navigating.current || !navigation.isFocused()) return;
      navigating.current = true;
      opening.current = true;
      searchBarRef.current?.blur();
      try {
        const existing = findReadableLibraryBookForCatalogBook(book, books);
        if (existing) {
          if (!(await openMobileBook({ bookId: existing.id, navigation, t })))
            navigating.current = false;
        } else
          navigation.navigate("Reader", { bookId: "", catalogBook: getCatalogBookWithCover(book) });
      } catch (error) {
        navigating.current = false;
        throw error;
      } finally {
        opening.current = false;
      }
    },
    [books, navigation, t],
  );
  const openLibraryBook = useCallback(
    async (book: Book) => {
      if (navigating.current || !navigation.isFocused()) return;
      navigating.current = true;
      opening.current = true;
      searchBarRef.current?.blur();
      try {
        if (!(await openMobileBook({ bookId: book.id, navigation, t }))) navigating.current = false;
      } catch (error) {
        navigating.current = false;
        throw error;
      } finally {
        opening.current = false;
      }
    },
    [navigation, t],
  );
  const retryCover = useCallback(
    (book: CachedBackendCatalogBook) => {
      if (!book.cover) void snapshot.refresh();
      else retryCatalogCover(book);
    },
    [snapshot.refresh],
  );

  return (
    <View style={styles.container} {...guard?.touchHandlers}>
      <SearchLifecycle />
      <View
        style={searching ? styles.hidden : styles.container}
        accessibilityElementsHidden={searching}
        importantForAccessibility={searching ? "no-hide-descendants" : "auto"}
      >
        <DiscoveryList
          shelves={snapshot.hasCompleteCatalog || snapshot.error ? shelves : EMPTY_SHELVES}
          columns={columns}
          libraryKeys={libraryKeys}
          onOpen={openCatalogBook}
          onOpenCategory={openCategory}
          onRetryCover={retryCover}
          enabled={!searching}
          snapshot={snapshot}
        />
      </View>
      {searching ? (
        <SearchResults
          query={deferredQuery}
          books={books}
          catalogBooks={catalog.books}
          onOpenLibrary={openLibraryBook}
          onOpenCatalog={openCatalogBook}
        />
      ) : null}
    </View>
  );
});

function SearchLifecycle() {
  const focused = useIsFocused();
  const guard = useSwipePressGuard();
  useBackendCatalogActivity(focused);
  useEffect(() => {
    guard?.setEnabled(focused);
    markInteraction(focused ? "search.focus" : "search.blur");
  }, [focused, guard]);
  return null;
}

function CoverLifecycle({
  visible,
  nearby,
  enabled = true,
}: { visible: CachedBackendCatalogBook[]; nearby: CachedBackendCatalogBook[]; enabled?: boolean }) {
  const focused = useIsFocused();
  useCatalogCoverWindow({ visible, nearby, active: focused && enabled });
  return null;
}

type DiscoveryProps = {
  shelves: CatalogShelf[];
  columns: number;
  libraryKeys: ReadonlySet<string>;
  onOpen: (book: CachedBackendCatalogBook) => void;
  onOpenCategory: (shelf: CatalogShelf) => void;
  onRetryCover: (book: CachedBackendCatalogBook) => void;
  enabled: boolean;
  snapshot: ReturnType<typeof useBackendCatalog>;
};
const DiscoveryList = memo(function DiscoveryList({
  shelves,
  columns,
  libraryKeys,
  onOpen,
  onOpenCategory,
  onRetryCover,
  enabled,
  snapshot,
}: DiscoveryProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const layout = useResponsiveLayout();
  const guard = useSwipePressGuard();
  const styles = useMemo(
    () =>
      makeStyles(colors, {
        centeredContentWidth: layout.centeredContentWidth,
        horizontalPadding: layout.horizontalPadding,
      }),
    [colors, layout.centeredContentWidth, layout.horizontalPadding],
  );
  const [visibleShelfIds, setVisibleShelfIds] = useState<ReadonlySet<string>>(new Set());
  const [positions, setPositions] = useState<ReadonlyMap<string, number>>(new Map());
  const viewability = useRef({ itemVisiblePercentThreshold: 1 }).current;
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<CatalogShelf>[] }) => {
      const next = new Set(viewableItems.map(({ item }) => item.id));
      setVisibleShelfIds((current) => (equalSets(current, next) ? current : next));
    },
    [],
  );
  const onPageChange = useCallback((id: string, index: number) => {
    setPositions((current) =>
      (current.get(id) ?? 0) === index ? current : new Map(current).set(id, index),
    );
  }, []);
  const window = useMemo(
    () => catalogCoverWindow(shelves, visibleShelfIds, positions, columns),
    [shelves, visibleShelfIds, positions, columns],
  );
  const { cardWidth } = catalogShelfLayout(layout.width, layout.centeredContentWidth, columns);
  const loadMore = useCallback(() => {
    void snapshot.retry();
  }, [snapshot.retry]);
  useEffect(() => {
    if (!enabled) guard?.cancelSwipe();
  }, [enabled, guard]);
  const renderShelf = useCallback(
    ({ item }: ListRenderItemInfo<CatalogShelf>) => (
      <CatalogShelfRow
        key={`${item.id}:${layout.width}:${layout.centeredContentWidth}:${columns}`}
        shelf={item}
        width={layout.centeredContentWidth}
        viewportWidth={layout.width}
        columns={columns}
        initialBookIndex={positions.get(item.id) ?? 0}
        isVisible={enabled && visibleShelfIds.has(item.id)}
        hasMore={!!snapshot.catalog.nextCursor}
        isLoadingMore={snapshot.isLoading}
        loadMoreError={
          snapshot.catalog.nextCursor && snapshot.error
            ? t("library.catalogLoadMoreError", "Не удалось загрузить следующие книги")
            : null
        }
        libraryKeys={libraryKeys}
        onOpen={onOpen}
        onOpenCategory={onOpenCategory}
        onRetryCover={onRetryCover}
        onLoadMore={loadMore}
        onPageChange={onPageChange}
      />
    ),
    [
      columns,
      enabled,
      layout.centeredContentWidth,
      layout.width,
      libraryKeys,
      loadMore,
      onOpen,
      onOpenCategory,
      onPageChange,
      onRetryCover,
      positions,
      snapshot.catalog.nextCursor,
      snapshot.error,
      snapshot.isLoading,
      t,
      visibleShelfIds,
    ],
  );
  return (
    <>
      <CoverLifecycle {...window} enabled={enabled} />
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
        maxToRenderPerBatch={2}
        windowSize={5}
        removeClippedSubviews={false}
        {...guard?.touchHandlers}
        {...guard?.scrollHandlers}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        ListEmptyComponent={
          snapshot.isLoading ? (
            <View style={styles.skeletonGrid}>
              {INITIAL_SKELETON_KEYS.map((key) => (
                <View key={key} style={styles.catalogFooterSkeletons}>
                  {CATALOG_SHELF_SKELETON_KEYS.slice(0, columns).map((columnKey) => (
                    <CatalogBookSkeleton key={columnKey} cardWidth={cardWidth} />
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <CenteredEmptyState
              variant="compact"
              title={
                snapshot.error
                  ? t("library.catalogLoadError", "Не удалось загрузить каталог")
                  : t("library.catalogEmpty", "В каталоге пока нет книг")
              }
              style={styles.catalogStatus}
            >
              {snapshot.error ? (
                <NativeButton
                  label={t("common.retry", "Повторить")}
                  onPress={loadMore}
                  style={styles.catalogStatusButton}
                />
              ) : null}
            </CenteredEmptyState>
          )
        }
        ListFooterComponent={
          snapshot.error && shelves.length ? (
            <View style={styles.catalogLoadMoreStatus}>
              <Text style={styles.catalogLoadMoreText}>
                {t("library.catalogLoadMoreError", "Не удалось загрузить следующие книги")}
              </Text>
              <NativeButton label={t("common.retry", "Повторить")} onPress={loadMore} />
            </View>
          ) : null
        }
      />
    </>
  );
});

const SearchResults = memo(function SearchResults({
  query,
  books,
  catalogBooks,
  onOpenLibrary,
  onOpenCatalog,
}: {
  query: string;
  books: Book[];
  catalogBooks: CachedBackendCatalogBook[];
  onOpenLibrary: (book: Book) => void;
  onOpenCatalog: (book: CachedBackendCatalogBook) => void;
}) {
  countRender("search.results");
  const { colors } = useTheme();
  const { t } = useTranslation();
  const layout = useResponsiveLayout();
  const guard = useSwipePressGuard();
  const insets = useSafeAreaInsets();
  const styles = useMemo(
    () =>
      makeStyles(colors, {
        centeredContentWidth: layout.centeredContentWidth,
        horizontalPadding: layout.horizontalPadding,
      }),
    [colors, layout.centeredContentWidth, layout.horizontalPadding],
  );
  const index = useMemo(() => buildBookSearchIndex(books, catalogBooks), [books, catalogBooks]);
  const results = useMemo(() => {
    countRender("search.results.build");
    return searchBookIndex(index, query);
  }, [index, query]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  const listRef = useRef<FlatList<BookSearchResult>>(null);
  const positionedQuery = useRef<string | null>(null);
  const config = useRef({ itemVisiblePercentThreshold: 1 }).current;
  const initialRows = Math.ceil(layout.height / 80);
  const window = useMemo(
    () => searchResultWindow(results, visibleKeys, initialRows),
    [results, visibleKeys, initialRows],
  );
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<BookSearchResult>[] }) => {
      const next = viewableItems.map(({ item }) => item.key);
      setVisibleKeys((current) =>
        current.length === next.length && current.every((value, i) => value === next[i])
          ? current
          : next,
      );
    },
    [],
  );
  useLayoutEffect(() => {
    if (positionedQuery.current === query) return;
    positionedQuery.current = query;
    guard?.cancelSwipe();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setVisibleKeys((current) => (current.length ? [] : current));
  }, [query, guard]);
  useEffect(() => {
    const onShow = (event: KeyboardEvent) => setKeyboardHeight(event.endCoordinates.height);
    const onHide = () => setKeyboardHeight(0);
    const subscriptions = [
      Keyboard.addListener("keyboardDidShow", onShow),
      Keyboard.addListener("keyboardDidHide", onHide),
    ];
    if (process.env.EXPO_OS === "ios") {
      subscriptions.push(
        Keyboard.addListener("keyboardWillChangeFrame", onShow),
        Keyboard.addListener("keyboardWillHide", onHide),
      );
    }
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  const renderRow = useCallback(
    ({ item, index: rowIndex }: ListRenderItemInfo<BookSearchResult>) =>
      item.kind === "catalog" ? (
        <CatalogResultRow
          book={item.book}
          onOpen={onOpenCatalog}
          separator={rowIndex < results.length - 1}
        />
      ) : (
        <LibraryResultRow
          book={item.book}
          onOpen={onOpenLibrary}
          separator={rowIndex < results.length - 1}
          resolveCover={window.rowKeys.has(item.key)}
        />
      ),
    [onOpenCatalog, onOpenLibrary, results.length, window.rowKeys],
  );
  return (
    <>
      <CoverLifecycle visible={window.visible} nearby={window.nearby} />
      <FlatList
        ref={listRef}
        testID="search-results-list"
        data={results}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        style={styles.container}
        contentContainerStyle={[
          styles.searchContent,
          process.env.EXPO_OS === "ios" && { paddingTop: insets.top },
          !results.length && styles.centeredContent,
          !results.length &&
            keyboardHeight > 0 && { paddingBottom: keyboardHeight + spacing.xxl * 5 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={initialRows}
        maxToRenderPerBatch={6}
        windowSize={3}
        removeClippedSubviews={false}
        viewabilityConfig={config}
        onViewableItemsChanged={onViewable}
        {...guard?.touchHandlers}
        {...guard?.scrollHandlers}
        ListEmptyComponent={
          <CenteredEmptyState variant="compact" title={t("search.empty", "Ничего не найдено")} />
        }
      />
    </>
  );
});

const CatalogResultRow = memo(function CatalogResultRow({
  book,
  onOpen,
  separator,
}: {
  book: CachedBackendCatalogBook;
  onOpen: (book: CachedBackendCatalogBook) => void;
  separator: boolean;
}) {
  const guard = useSwipePressGuard();
  const resolved = useCatalogCover(book);
  const item = useMemo(
    () => ({
      key: `catalog:${book.bookEditionId}`,
      accessibilityLabel: book.title,
      title: book.title,
      subtitle: book.author,
      onPress: (event?: GestureResponderEvent) => {
        if (guard?.canPress(event) !== false) onOpen(resolved);
      },
      avatar: (
        <BookListCover title={book.title} author={book.author} coverUri={resolved.coverUri} />
      ),
    }),
    [book, guard, onOpen, resolved],
  );
  return (
    <CharacterChatListRow
      item={item}
      separator={separator}
      titleNumberOfLines={2}
      titleFontWeight={fontWeight.medium}
    />
  );
});
const LibraryResultRow = memo(function LibraryResultRow({
  book,
  onOpen,
  separator,
  resolveCover,
}: { book: Book; onOpen: (book: Book) => void; separator: boolean; resolveCover: boolean }) {
  const guard = useSwipePressGuard();
  const items = useMemo(
    () => (resolveCover ? [{ bookId: book.id, coverUrl: book.meta.coverUrl }] : []),
    [book.id, book.meta.coverUrl, resolveCover],
  );
  const covers = useResolvedCovers(items);
  const uri = covers.get(book.id);
  const item = useMemo(
    () => ({
      key: `library:${book.id}`,
      accessibilityLabel: book.meta.title,
      title: book.meta.title,
      subtitle: book.meta.author,
      onPress: (event?: GestureResponderEvent) => {
        if (guard?.canPress(event) !== false) onOpen(book);
      },
      avatar: <BookListCover title={book.meta.title} author={book.meta.author} coverUri={uri} />,
    }),
    [book, guard, onOpen, uri],
  );
  return (
    <CharacterChatListRow
      item={item}
      separator={separator}
      titleNumberOfLines={2}
      titleFontWeight={fontWeight.medium}
    />
  );
});

function equalSets(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}
const makeStyles = (
  colors: ThemeColors,
  layout: Pick<
    ReturnType<typeof useResponsiveLayout>,
    "centeredContentWidth" | "horizontalPadding"
  >,
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hidden: { display: "none" },
    catalogContent: {
      width: "100%",
      flexGrow: 1,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    skeletonGrid: { width: layout.centeredContentWidth, alignSelf: "center", gap: spacing.xxl },
    catalogFooterSkeletons: {
      width: layout.centeredContentWidth,
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
    catalogLoadMoreStatus: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
    catalogLoadMoreText: { color: colors.mutedForeground },
    searchContent: {
      flexGrow: 1,
      width: "100%",
      maxWidth: layout.centeredContentWidth + layout.horizontalPadding * 2,
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
  const [failedCoverUri, setFailedCoverUri] = useState<string>();
  const visibleCoverUri = coverUri && coverUri !== failedCoverUri ? coverUri : undefined;

  return (
    <View style={bookListStyles.coverSlot}>
      <BookSurface
        width={SEARCH_COVER_WIDTH}
        height={SEARCH_COVER_HEIGHT}
        borderRadius={SEARCH_COVER_RADIUS}
        showShadow={false}
        cover={
          <View style={bookListStyles.coverCanvas}>
            {visibleCoverUri ? (
              <Image
                source={{ uri: visibleCoverUri }}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
                onError={() => setFailedCoverUri(visibleCoverUri)}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: loadingCoverColorForTitleAuthor({ title, author }) },
                ]}
              />
            )}
            <BookCoverTypography
              title={title}
              author={author}
              width={SEARCH_COVER_WIDTH}
              referenceWidth={SEARCH_COVER_REFERENCE_WIDTH}
              leftInsetAdjustment={0}
              textTone={generatedCoverTextTone({ title, author })}
              coverUri={visibleCoverUri}
            />
          </View>
        }
      />
    </View>
  );
}

const SEARCH_COVER_WIDTH = 38;
const SEARCH_COVER_REFERENCE_WIDTH = 140;
const SEARCH_COVER_HEIGHT = SEARCH_COVER_WIDTH * (41 / 28) + 2;
const SEARCH_COVER_RADIUS = radius.sm * (SEARCH_COVER_WIDTH / SEARCH_COVER_REFERENCE_WIDTH);

const bookListStyles = StyleSheet.create({
  coverSlot: {
    width: 56,
    height: SEARCH_COVER_HEIGHT,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  coverCanvas: { width: "100%", height: "100%", position: "relative", isolation: "isolate" },
});
