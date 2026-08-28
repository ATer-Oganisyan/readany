import { MishanaerIcon } from "@/components/ui/MishanaerIcon";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { countRender } from "@/lib/diagnostics/interaction-performance";
import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import {
  CATALOG_SHELF_GAP,
  CATALOG_SHELF_SHADOW_INSETS,
  catalogShelfLayout,
} from "@/lib/narra/catalog-shelf-layout";
import {
  CATALOG_SHELF_SKELETON_KEYS,
  type CatalogShelf,
  chunkShelfBooks,
  shelfPageForBook,
} from "@/lib/narra/catalog-shelves";
import { fontSize, fontWeight, largeTitleFontFamily, spacing, useColors } from "@/styles/theme";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  View,
} from "react-native";
import { CatalogBookSkeleton } from "./CatalogBookSkeleton";
import { ConnectedCatalogBookCard } from "./ConnectedCatalogBookCard";

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
  onOpenCategory: (shelf: CatalogShelf) => void;
  onRetryCover: (book: CachedBackendCatalogBook) => void;
  onLoadMore: (shelf: CatalogShelf) => void;
  onPageChange: (id: string, firstBookIndex: number) => void;
}

export const CatalogShelfRow = memo(function CatalogShelfRow({
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
  onOpenCategory,
  onRetryCover,
  onLoadMore,
  onPageChange,
}: Props) {
  countRender("search.shelf");
  const colors = useColors();
  const { t } = useTranslation();
  const guard = useSwipePressGuard();
  useEffect(() => {
    if (!isVisible) guard?.cancelSwipe();
  }, [guard, isVisible]);
  const initialPage = useRef(
    shelfPageForBook(initialBookIndex, columns, shelf.books.length),
  ).current;
  const didDrag = useRef(false);
  const pages = useMemo(() => chunkShelfBooks(shelf.books, columns), [shelf.books, columns]);
  const { cardWidth, pageWidth, pageStride, edgeInset, trailingInset } = catalogShelfLayout(
    viewportWidth,
    width,
    columns,
  );
  // Keep the restored page aligned with the heading, including the leading inset.
  const initialOffset = useRef({ x: initialPage * pageStride, y: 0 }).current;

  const rememberPage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.max(0, Math.round(event.nativeEvent.contentOffset.x / pageStride));
      // The loading footer isn't a book page; restore the last real page instead.
      onPageChange(shelf.id, Math.min(next, pages.length - 1) * columns);
    },
    [columns, onPageChange, pages.length, shelf.id, pageStride],
  );

  return (
    <View
      style={{ width: viewportWidth, overflow: "visible" }}
      testID={`catalog-shelf-${shelf.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shelf.title}
        testID={`catalog-category-link-${shelf.id}`}
        onPress={(event) => {
          if (guard?.canPress(event) === false) return;
          onOpenCategory(shelf);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          gap: spacing.sm,
          marginBottom: spacing.sm,
          paddingHorizontal: edgeInset,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <Text
          accessibilityRole="header"
          style={{
            flexShrink: 1,
            color: colors.foreground,
            fontFamily: largeTitleFontFamily,
            fontSize: fontSize.xl,
            fontWeight: fontWeight.normal,
          }}
        >
          {shelf.title}
        </Text>
        <MishanaerIcon name="chevron-small-right" size={24} color={colors.primary40} />
      </Pressable>
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
        contentContainerStyle={{
          paddingTop: CATALOG_SHELF_SHADOW_INSETS.top,
          paddingBottom: CATALOG_SHELF_SHADOW_INSETS.bottom,
          paddingLeft: edgeInset,
          paddingRight: trailingInset,
        }}
        style={{
          width: viewportWidth,
          height:
            cardWidth * (41 / 28) +
            CATALOG_SHELF_SHADOW_INSETS.top +
            CATALOG_SHELF_SHADOW_INSETS.bottom,
          // Preserve the cover's distance from its heading; reserve real room below for shadows.
          marginTop: spacing.sm - CATALOG_SHELF_SHADOW_INSETS.top,
          overflow: "visible",
          flexGrow: 0,
        }}
        accessibilityLabel={shelf.title}
        onScroll={rememberPage}
        scrollEventThrottle={100}
        {...guard?.touchHandlers}
        {...guard?.scrollHandlers}
        onScrollBeginDrag={(event) => {
          didDrag.current = true;
          guard?.scrollHandlers.onScrollBeginDrag(event);
        }}
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
              <ConnectedCatalogBookCard
                key={book.bookEditionId}
                book={book}
                cardWidth={cardWidth}
                isInLibrary={libraryKeys.has(book.catalogKey)}
                onPress={onOpen}
                onRetryCover={onRetryCover}
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
});

function ShelfPageSeparator() {
  return <View style={{ width: CATALOG_SHELF_GAP }} />;
}
