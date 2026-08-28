import { CatalogBookSkeleton } from "@/components/library/CatalogBookSkeleton";
import { ConnectedCatalogBookCard } from "@/components/library/ConnectedCatalogBookCard";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { SwipePressGuardProvider, useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { useBackendCatalog, useBackendCatalogActivity } from "@/hooks/use-backend-catalog";
import { useCatalogCoverWindow } from "@/hooks/use-catalog-cover-window";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { countRender, markInteraction } from "@/lib/diagnostics/interaction-performance";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { findReadableLibraryBookForCatalogBook } from "@/lib/narra/backend-catalog-library";
import { retryCatalogCover } from "@/lib/narra/catalog-cover-coordinator";
import { getCatalogBookWithCover } from "@/lib/narra/catalog-cover-store";
import { catalogGridLayout } from "@/lib/narra/catalog-grid-layout";
import { CATALOG_SHELF_GAP, CATALOG_SHELF_SHADOW_INSETS } from "@/lib/narra/catalog-shelf-layout";
import { buildCatalogShelves, catalogCategoryCoverWindow } from "@/lib/narra/catalog-shelves";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores";
import { spacing, useColors } from "@/styles/theme";
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  View,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "CatalogCategory">;
const EMPTY_BOOKS: CachedBackendCatalogBook[] = [];

export function CatalogCategoryScreen(props: Props) {
  return (
    <SwipePressGuardProvider>
      <CategoryGrid {...props} />
    </SwipePressGuardProvider>
  );
}

const CategoryGrid = memo(function CategoryGrid({ route, navigation }: Props) {
  countRender("catalog.category");
  const { genreId } = route.params;
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const layout = useResponsiveLayout();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const guard = useSwipePressGuard();
  const libraryBooks = useLibraryStore((state) => state.books);
  const snapshot = useBackendCatalog(false);
  const { catalog } = snapshot;
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [viewportHeight, setViewportHeight] = useState(layout.height);
  const navigating = useRef(false);
  const opening = useRef(false);
  const viewability = useRef({ itemVisiblePercentThreshold: 1 }).current;
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<CachedBackendCatalogBook>[] }) => {
      const next = viewableItems.map(({ item }) => item.bookEditionId);
      setVisibleKeys((current) =>
        current.length === next.length && current.every((value, i) => value === next[i])
          ? current
          : next,
      );
    },
    [],
  );
  const category = useMemo(() => {
    countRender("catalog.group");
    return buildCatalogShelves(
      catalog.books,
      catalog.genres,
      i18n.resolvedLanguage ?? "ru",
      t("library.catalogUncategorized", "Без категории"),
    ).find((shelf) => shelf.id === genreId);
  }, [catalog.books, catalog.genres, genreId, i18n.resolvedLanguage, t]);
  const books = category?.books ?? EMPTY_BOOKS;
  const title = category?.title ?? route.params.title;
  const cardWidth = (layout.centeredContentWidth - CATALOG_SHELF_GAP) / 2;
  const edgeInset = (layout.width - layout.centeredContentWidth) / 2;
  const grid = useMemo(
    () =>
      catalogGridLayout({
        cardWidth,
        viewportHeight,
        topInset: headerHeight,
        bottomInset: insets.bottom,
      }),
    [cardWidth, viewportHeight, headerHeight, insets.bottom],
  );
  const coverWindow = useMemo(
    () => catalogCategoryCoverWindow(books, visibleKeys),
    [books, visibleKeys],
  );
  const libraryKeys = useMemo(
    () =>
      new Set(
        books.flatMap((book) =>
          findReadableLibraryBookForCatalogBook(book, libraryBooks) ? [book.catalogKey] : [],
        ),
      ),
    [books, libraryBooks],
  );
  const style = useMemo(
    () => ({ flex: 1, backgroundColor: colors.background }),
    [colors.background],
  );
  const contentStyle = useMemo(
    () => ({
      paddingHorizontal: edgeInset,
      paddingTop: grid.topPadding,
      paddingBottom: CATALOG_SHELF_SHADOW_INSETS.bottom,
    }),
    [edgeInset, grid.topPadding],
  );
  const columnStyle = useMemo(() => ({ gap: CATALOG_SHELF_GAP }), []);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0) setViewportHeight((current) => (current === height ? current : height));
    markInteraction("category.layout");
  }, []);
  useLayoutEffect(() => navigation.setOptions({ title }), [navigation, title]);
  useEffect(
    () =>
      navigation.addListener("focus", () => {
        if (!opening.current) navigating.current = false;
      }),
    [navigation],
  );
  const retryCover = useCallback(
    (book: CachedBackendCatalogBook) => {
      if (!book.cover) void snapshot.refresh();
      else retryCatalogCover(book);
    },
    [snapshot.refresh],
  );
  const openBook = useCallback(
    async (book: CachedBackendCatalogBook) => {
      if (navigating.current || !navigation.isFocused()) return;
      navigating.current = true;
      opening.current = true;
      try {
        const existing = findReadableLibraryBookForCatalogBook(book, libraryBooks);
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
    [libraryBooks, navigation, t],
  );
  const renderBook = useCallback(
    ({ item }: ListRenderItemInfo<CachedBackendCatalogBook>) => (
      <View style={bookRowStyle}>
        <ConnectedCatalogBookCard
          book={item}
          cardWidth={cardWidth}
          isInLibrary={libraryKeys.has(item.catalogKey)}
          onPress={openBook}
          onRetryCover={retryCover}
        />
      </View>
    ),
    [cardWidth, libraryKeys, openBook, retryCover],
  );
  return (
    <View style={style} {...guard?.touchHandlers}>
      <CategoryLifecycle {...coverWindow} />
      <FlatList
        testID="catalog-category-grid"
        style={style}
        data={books}
        numColumns={2}
        keyExtractor={(book) => book.bookEditionId}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={contentStyle}
        columnWrapperStyle={columnStyle}
        removeClippedSubviews={false}
        initialNumToRender={grid.initialRows}
        maxToRenderPerBatch={2}
        windowSize={3}
        getItemLayout={grid.getItemLayout}
        onLayout={onLayout}
        viewabilityConfig={viewability}
        onViewableItemsChanged={onViewable}
        renderItem={renderBook}
        {...guard?.touchHandlers}
        {...guard?.scrollHandlers}
        ListEmptyComponent={
          snapshot.isLoading ? (
            <View style={{ flexDirection: "row", gap: CATALOG_SHELF_GAP }}>
              <CatalogBookSkeleton cardWidth={cardWidth} />
              <CatalogBookSkeleton cardWidth={cardWidth} />
            </View>
          ) : !snapshot.error ? (
            <CenteredEmptyState
              variant="compact"
              title={t("library.catalogEmpty", "В каталоге пока нет книг")}
            />
          ) : null
        }
        ListFooterComponent={
          snapshot.isLoading || snapshot.error ? (
            <View style={{ alignItems: "center", padding: spacing.lg, gap: spacing.md }}>
              {snapshot.isLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Text style={{ color: colors.mutedForeground }}>
                    {t("library.catalogLoadMoreError", "Не удалось загрузить следующие книги")}
                  </Text>
                  <NativeButton
                    label={t("common.retry", "Повторить")}
                    onPress={() => void snapshot.retry()}
                  />
                </>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
});

const bookRowStyle = { marginBottom: CATALOG_SHELF_GAP, overflow: "visible" as const };
function CategoryLifecycle({
  visible,
  nearby,
}: { visible: CachedBackendCatalogBook[]; nearby: CachedBackendCatalogBook[] }) {
  const focused = useIsFocused();
  const guard = useSwipePressGuard();
  useBackendCatalogActivity(focused);
  useCatalogCoverWindow({ visible, nearby, active: focused });
  useEffect(() => {
    guard?.setEnabled(focused);
  }, [focused, guard]);
  return null;
}
