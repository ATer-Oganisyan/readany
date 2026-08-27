import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { CATALOG_SHELF_GAP, catalogShelfLayout } from "@/lib/narra/catalog-shelf-layout";
import {
  CATALOG_SHELF_SKELETON_KEYS,
  type CatalogShelf,
  chunkShelfBooks,
  shelfPageForBook,
} from "@/lib/narra/catalog-shelves";
import { fontSize, fontWeight, spacing, useColors } from "@/styles/theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, View } from "react-native";
import { CatalogBookCard } from "./CatalogBookCard";
import { CatalogBookSkeleton } from "./CatalogBookSkeleton";

interface Props {
  shelf: CatalogShelf;
  width: number;
  viewportWidth: number;
  columns: number;
  isVisible: boolean;
  initialBookIndex: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  libraryKeys: ReadonlySet<string>;
  onOpen: (book: CachedBackendCatalogBook) => void;
  onLoadMore: (shelf: CatalogShelf) => void;
  onPageChange: (id: string, firstBookIndex: number) => void;
  onVisibleBooks: (id: string, keys: string[]) => void;
}

export function CatalogShelfRow({
  shelf,
  width,
  viewportWidth,
  columns,
  isVisible,
  initialBookIndex,
  hasMore,
  isLoadingMore,
  loadMoreError,
  libraryKeys,
  onOpen,
  onLoadMore,
  onPageChange,
  onVisibleBooks,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const guard = useSwipePressGuard();
  const initialPage = useRef(
    shelfPageForBook(initialBookIndex, columns, shelf.books.length),
  ).current;
  const [page, setPage] = useState(initialPage);
  const didDrag = useRef(false);
  const pages = useMemo(() => chunkShelfBooks(shelf.books, columns), [shelf.books, columns]);
  const { cardWidth, pageWidth, pageStride, edgeInset } = catalogShelfLayout(
    viewportWidth,
    width,
    columns,
  );
  // Keep the restored page aligned with the heading, including the leading inset.
  const initialOffset = useRef({ x: initialPage * pageStride, y: 0 }).current;

  useEffect(() => {
    onVisibleBooks(shelf.id, isVisible ? (pages[page] ?? []).map((book) => book.catalogKey) : []);
    return () => onVisibleBooks(shelf.id, []);
  }, [isVisible, onVisibleBooks, page, pages, shelf.id]);

  const rememberPage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.max(0, Math.round(event.nativeEvent.contentOffset.x / pageStride));
      setPage(next);
      // The loading footer isn't a book page; restore the last real page instead.
      onPageChange(shelf.id, Math.min(next, pages.length - 1) * columns);
    },
    [columns, onPageChange, pages.length, shelf.id, pageStride],
  );

  return (
    <View
      style={{ width: viewportWidth, marginBottom: spacing.xxl }}
      testID={`catalog-shelf-${shelf.id}`}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.foreground,
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          marginBottom: spacing.sm,
          paddingHorizontal: edgeInset,
        }}
      >
        {shelf.title}
      </Text>
      <FlatList
        horizontal
        snapToInterval={pageStride}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        data={pages}
        keyExtractor={(_, index) => String(index)}
        initialScrollIndex={initialPage}
        contentOffset={initialOffset}
        getItemLayout={(_, index) => ({
          length: pageWidth,
          offset: edgeInset + pageStride * index,
          index,
        })}
        ItemSeparatorComponent={ShelfPageSeparator}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingVertical: spacing.sm, paddingHorizontal: edgeInset }}
        style={{
          width: viewportWidth,
          height: cardWidth * (41 / 28) + spacing.sm * 2,
          flexGrow: 0,
        }}
        accessibilityLabel={shelf.title}
        onScroll={rememberPage}
        scrollEventThrottle={100}
        onScrollBeginDrag={() => {
          didDrag.current = true;
          guard?.beginSwipe();
        }}
        onScrollEndDrag={() => guard?.endSwipe()}
        onMomentumScrollBegin={() => guard?.beginSwipe()}
        onMomentumScrollEnd={() => guard?.endSwipe()}
        onEndReached={() => {
          if (didDrag.current && isVisible && hasMore && !loadMoreError) {
            didDrag.current = false;
            onLoadMore(shelf);
          }
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <View style={{ width: pageWidth, flexDirection: "row", gap: CATALOG_SHELF_GAP }}>
            {item.map((book) => (
              <CatalogBookCard
                key={book.bookEditionId}
                title={book.title}
                author={book.author}
                coverUri={book.coverUri}
                cardWidth={cardWidth}
                isInLibrary={libraryKeys.has(book.catalogKey)}
                onPress={() => onOpen(book)}
              />
            ))}
          </View>
        )}
        ListFooterComponent={
          hasMore ? (
            <View
              style={{
                width: pageWidth,
                marginLeft: CATALOG_SHELF_GAP,
                minHeight: cardWidth * (41 / 28),
                flexDirection: "row",
                gap: CATALOG_SHELF_GAP,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {isLoadingMore ? (
                CATALOG_SHELF_SKELETON_KEYS.slice(0, columns).map((key) => (
                  <CatalogBookSkeleton key={key} cardWidth={cardWidth} />
                ))
              ) : (
                <View
                  style={{ gap: spacing.sm, alignItems: "center", paddingHorizontal: spacing.lg }}
                >
                  {loadMoreError ? (
                    <Text style={{ color: colors.mutedForeground }}>{loadMoreError}</Text>
                  ) : null}
                  <NativeButton
                    label={
                      loadMoreError
                        ? t("common.retry", "Повторить")
                        : t("common.loadMore", "Загрузить ещё")
                    }
                    onPress={() => onLoadMore(shelf)}
                  />
                </View>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}

function ShelfPageSeparator() {
  return <View style={{ width: CATALOG_SHELF_GAP }} />;
}
