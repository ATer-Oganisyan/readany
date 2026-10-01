import { spacingPixels } from "@deslop/primitives";
import { CATALOG_SHELF_GAP } from "./catalog-shelf-layout";

/** FlatList with numColumns=2 passes row indices, not individual book indices. */
export function catalogGridLayout({
  cardWidth,
  viewportHeight,
  topInset = 0,
  bottomInset = 0,
}: {
  cardWidth: number;
  viewportHeight: number;
  topInset?: number;
  bottomInset?: number;
}) {
  const topPadding = spacingPixels[12];
  const rowHeight = cardWidth * (41 / 28) + CATALOG_SHELF_GAP;
  const usableHeight = Math.max(1, viewportHeight - topInset - bottomInset - topPadding);
  // A quarter-row reserve covers a partially visible next row without mounting six rows.
  const initialRows = Math.max(1, Math.ceil((usableHeight + rowHeight / 4) / rowHeight));
  return {
    topPadding,
    rowHeight,
    initialRows,
    getItemLayout: (_data: unknown, rowIndex: number) => ({
      index: rowIndex,
      length: rowHeight,
      offset: topPadding + rowIndex * rowHeight,
    }),
  };
}

/** Fixed-height rows inside Library's existing scroll/pager; omitted rows keep their space. */
export function catalogGridWindow({
  itemCount,
  columns,
  rowHeight,
  scrollY,
  gridTop,
  viewportHeight,
  overscanRows = 3,
}: {
  itemCount: number;
  columns: number;
  rowHeight: number;
  scrollY: number;
  gridTop: number;
  viewportHeight: number;
  overscanRows?: number;
}) {
  const rows = Math.ceil(itemCount / columns);
  const firstVisibleRow = Math.max(
    0,
    Math.min(rows - 1, Math.floor((scrollY - gridTop) / rowHeight)),
  );
  const firstRow = Math.max(0, firstVisibleRow - overscanRows);
  const lastRow = Math.min(
    rows,
    Math.max(firstVisibleRow + 1, Math.ceil((scrollY - gridTop + viewportHeight) / rowHeight)) +
      overscanRows,
  );
  return {
    start: firstRow * columns,
    end: Math.min(itemCount, lastRow * columns),
    paddingTop: firstRow * rowHeight,
    paddingBottom: (rows - lastRow) * rowHeight,
  };
}
