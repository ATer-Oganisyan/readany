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
