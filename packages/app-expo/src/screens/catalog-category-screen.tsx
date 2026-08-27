import { CatalogBookCard } from "@/components/library/CatalogBookCard";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { SwipePressGuardProvider, useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import {
  type CachedBackendCatalogBook,
  loadMoreCachedBackendCatalog,
  materializeBackendCatalogCover,
  refreshBackendCatalog,
} from "@/lib/narra/backend-catalog-cache";
import { findReadableLibraryBookForCatalogBook } from "@/lib/narra/backend-catalog-library";
import { isBackendDownloadAbort } from "@/lib/narra/backend-file-download";
import { CatalogCoverQueue } from "@/lib/narra/catalog-cover-queue";
import {
  applyCatalogCoverResult,
  retainCatalogCovers,
  retryCatalogCoverDownload,
} from "@/lib/narra/catalog-cover-state";
import { CATALOG_SHELF_GAP, CATALOG_SHELF_SHADOW_INSETS } from "@/lib/narra/catalog-shelf-layout";
import {
  buildCatalogShelves,
  catalogCategoryCoverWindow,
  completeCatalogSnapshot,
} from "@/lib/narra/catalog-shelves";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores";
import { spacing, useColors } from "@/styles/theme";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, View, type ViewToken } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "CatalogCategory">;
const EMPTY_BOOKS: CachedBackendCatalogBook[] = [];

export function CatalogCategoryScreen(props: Props) {
  return (
    <SwipePressGuardProvider>
      <CategoryGrid {...props} />
    </SwipePressGuardProvider>
  );
}

function CategoryGrid({ route, navigation }: Props) {
  const { genreId } = route.params;
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const layout = useResponsiveLayout();
  const isFocused = useIsFocused();
  const guard = useSwipePressGuard();
  const libraryBooks = useLibraryStore((state) => state.books);
  // Reuse the search snapshot: opening a category does not blank already-loaded covers.
  const [catalog, setCatalog] = useState(route.params.catalog);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const loadingRef = useRef(false);
  const queueRef = useRef<CatalogCoverQueue | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 }).current;
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<CachedBackendCatalogBook>[] }) => {
      setVisibleKeys(viewableItems.map(({ item }) => item.bookEditionId));
    },
    [],
  );

  const category = useMemo(
    () =>
      buildCatalogShelves(
        catalog.books,
        catalog.genres,
        i18n.resolvedLanguage ?? "ru",
        t("library.catalogUncategorized", "Без категории"),
      ).find((shelf) => shelf.id === genreId),
    [catalog.books, catalog.genres, genreId, i18n.resolvedLanguage, t],
  );
  const books = category?.books ?? EMPTY_BOOKS;
  const title = category?.title ?? route.params.title;
  // Deliberately two columns, at the full library size, not the 80% carousel size.
  const cardWidth = (layout.centeredContentWidth - CATALOG_SHELF_GAP) / 2;
  const edgeInset = (layout.width - layout.centeredContentWidth) / 2;

  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const loadCatalog = useCallback(
    async (refresh = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const request = ++requestRef.current;
      const isCurrent = () => requestRef.current === request;
      const previous = catalogRef.current;
      let latest = previous;
      setLoading(true);
      setError(null);
      try {
        if (refresh) latest = await refreshBackendCatalog();
        const complete = await completeCatalogSnapshot(
          latest,
          async (current) => {
            latest = await loadMoreCachedBackendCatalog(current);
            return latest;
          },
          isCurrent,
        );
        if (complete)
          setCatalog((current) => ({
            ...complete,
            books: retainCatalogCovers(complete.books, current.books),
          }));
      } catch (cause) {
        if (!isCurrent()) return;
        console.warn("[Catalog category] Failed to load category:", cause);
        // Keep a complete old snapshot; otherwise retain successfully fetched pages for Retry.
        const fallback = previous.nextCursor ? latest : previous;
        setCatalog((current) => ({
          ...fallback,
          books: retainCatalogCovers(fallback.books, current.books),
        }));
        setError(t("library.catalogLoadMoreError", "Не удалось загрузить следующие книги"));
      } finally {
        if (isCurrent()) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    if (catalogRef.current.nextCursor) void loadCatalog();
    return () => {
      requestRef.current += 1;
      loadingRef.current = false;
    };
  }, [loadCatalog]);

  useEffect(() => {
    if (!isFocused) return;
    setCatalog((current) => ({
      ...current,
      books: current.books.map((book) =>
        book.coverLoadFailed ? { ...book, coverLoadFailed: false } : book,
      ),
    }));
    const queue = new CatalogCoverQueue({
      concurrency: 3,
      load: materializeBackendCatalogCover,
      onLoaded: (_key, uri, requested) =>
        setCatalog((current) => ({
          ...current,
          books: applyCatalogCoverResult(current.books, requested, uri),
        })),
      onError: (_key, cause, requested) => {
        if (isBackendDownloadAbort(cause)) return;
        setCatalog((current) => ({
          ...current,
          books: applyCatalogCoverResult(current.books, requested),
        }));
        console.warn("[Catalog category] Failed to load cover:", cause);
      },
    });
    queueRef.current = queue;
    return () => {
      if (queueRef.current === queue) queueRef.current = null;
      queue.dispose();
    };
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    const { visible, nearby } = catalogCategoryCoverWindow(books, visibleKeys);
    queueRef.current?.prioritize(visible, nearby);
  }, [books, isFocused, visibleKeys]);

  const retryCover = useCallback(
    (requested: CachedBackendCatalogBook) => {
      if (!requested.cover) {
        void loadCatalog(true);
        return;
      }
      setCatalog((current) => ({
        ...current,
        books: retryCatalogCoverDownload(current.books, requested),
      }));
    },
    [loadCatalog],
  );

  const openBook = useCallback(
    async (book: CachedBackendCatalogBook) => {
      const existing = findReadableLibraryBookForCatalogBook(book, libraryBooks);
      if (existing) await openMobileBook({ bookId: existing.id, navigation, t });
      else navigation.navigate("Reader", { bookId: "", catalogBook: book });
    },
    [libraryBooks, navigation, t],
  );

  return (
    <FlatList
      testID="catalog-category-grid"
      style={{ flex: 1, backgroundColor: colors.background }}
      data={books}
      numColumns={2}
      keyExtractor={(book) => book.bookEditionId}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: edgeInset,
        paddingTop: spacing.md,
        paddingBottom: CATALOG_SHELF_SHADOW_INSETS.bottom,
      }}
      columnWrapperStyle={{ gap: CATALOG_SHELF_GAP }}
      removeClippedSubviews={false}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={5}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      onScrollBeginDrag={() => guard?.beginSwipe()}
      onScrollEndDrag={() => guard?.endSwipe()}
      onMomentumScrollBegin={() => guard?.beginSwipe()}
      onMomentumScrollEnd={() => guard?.endSwipe()}
      renderItem={({ item }) => (
        <View style={{ marginBottom: CATALOG_SHELF_GAP, overflow: "visible" }}>
          <CatalogBookCard
            title={item.title}
            author={item.author}
            coverUri={item.coverUri}
            hasCover={!!item.cover}
            coverLoadFailed={item.coverLoadFailed}
            cardWidth={cardWidth}
            isInLibrary={!!findReadableLibraryBookForCatalogBook(item, libraryBooks)}
            onPress={() => void openBook(item)}
            onRetryCover={() => retryCover(item)}
          />
        </View>
      )}
      ListEmptyComponent={
        !loading && !error ? (
          <CenteredEmptyState
            variant="compact"
            title={t("library.catalogEmpty", "В каталоге пока нет книг")}
          />
        ) : null
      }
      ListFooterComponent={
        loading || error ? (
          <View style={{ alignItems: "center", padding: spacing.lg, gap: spacing.md }}>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Text style={{ color: colors.mutedForeground }}>{error}</Text>
                <NativeButton
                  label={t("common.retry", "Повторить")}
                  onPress={() => void loadCatalog(!catalog.nextCursor)}
                />
              </>
            )}
          </View>
        ) : null
      }
    />
  );
}
