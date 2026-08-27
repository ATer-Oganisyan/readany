import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
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
  const cardWidth = Math.floor((width - spacing.lg * (columns - 1)) / columns);

  useEffect(() => {
    onVisibleBooks(shelf.id, isVisible ? (pages[page] ?? []).map((book) => book.catalogKey) : []);
    return () => onVisibleBooks(shelf.id, []);
  }, [isVisible, onVisibleBooks, page, pages, shelf.id]);

  const rememberPage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width));
      setPage(next);
      // The loading footer isn't a book page; restore the last real page instead.
      onPageChange(shelf.id, Math.min(next, pages.length - 1) * columns);
    },
    [columns, onPageChange, pages.length, shelf.id, width],
  );

  return (
    <View style={{ width, marginBottom: spacing.xxl }} testID={`catalog-shelf-${shelf.id}`}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.foreground,
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          marginBottom: spacing.sm,
        }}
      >
        {shelf.title}
      </Text>
      <FlatList
        horizontal
        pagingEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        data={pages}
        keyExtractor={(_, index) => String(index)}
        initialScrollIndex={initialPage}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingVertical: spacing.sm }}
        style={{ width, height: cardWidth * (41 / 28) + spacing.sm * 2, flexGrow: 0 }}
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
          <View style={{ width, flexDirection: "row", gap: spacing.lg }}>
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
                width,
                minHeight: cardWidth * (41 / 28),
                flexDirection: "row",
                gap: spacing.lg,
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
