import { spacingPixels } from "@deslop/primitives";

export const CATALOG_SHELF_GAP = spacingPixels[16];
// Search carousels only; the library grid keeps its original book size.
export const CATALOG_SHELF_CARD_SCALE = 0.8;
// PerspectiveBook's widest shadow: y=11, blur=22. Leave room for its soft tail.
export const CATALOG_SHELF_SHADOW_INSETS = { top: spacingPixels[24], bottom: spacingPixels[44] };

export function catalogShelfLayout(viewportWidth: number, contentWidth: number, columns: number) {
  // Keep fractional widths: rounding each card would change the gap between pages.
  const cardWidth =
    ((contentWidth - CATALOG_SHELF_GAP * (columns - 1)) / columns) * CATALOG_SHELF_CARD_SCALE;
  const pageWidth = cardWidth * columns + CATALOG_SHELF_GAP * (columns - 1);
  const edgeInset = (viewportWidth - contentWidth) / 2;
  return {
    cardWidth,
    pageWidth,
    pageStride: pageWidth + CATALOG_SHELF_GAP,
    edgeInset,
    // Let the final, narrower page still snap with its first book under the heading.
    trailingInset: edgeInset + contentWidth - pageWidth,
  };
}
