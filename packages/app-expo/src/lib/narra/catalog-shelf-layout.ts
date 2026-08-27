import { spacingPixels } from "@deslop/primitives";

export const CATALOG_SHELF_GAP = spacingPixels[16];

export function catalogShelfLayout(viewportWidth: number, contentWidth: number, columns: number) {
  return {
    // Keep fractional widths: rounding each card would change the gap between pages.
    cardWidth: (contentWidth - CATALOG_SHELF_GAP * (columns - 1)) / columns,
    pageWidth: contentWidth,
    pageStride: contentWidth + CATALOG_SHELF_GAP,
    edgeInset: (viewportWidth - contentWidth) / 2,
  };
}
