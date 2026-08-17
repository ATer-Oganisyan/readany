export interface CatalogGridVirtualizationOptions {
  columnCount: number;
  viewportHeight: number;
  itemHeight: number;
}

export interface CatalogGridVirtualizationConfig {
  initialNumToRender: number;
  maxToRenderPerBatch: number;
  windowSize: number;
}

/**
 * Keeps the first catalog render close to the visible viewport. Remote covers can
 * be large, so mounting the whole catalog at once creates enough decoded
 * bitmaps to exhaust Android's graphics memory.
 */
export function getCatalogGridVirtualizationConfig({
  columnCount,
  viewportHeight,
  itemHeight,
}: CatalogGridVirtualizationOptions): CatalogGridVirtualizationConfig {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  const safeViewportHeight = Math.max(1, viewportHeight);
  const safeItemHeight = Math.max(1, itemHeight);
  const visibleRowCount = Math.max(1, Math.ceil(safeViewportHeight / safeItemHeight));

  return {
    initialNumToRender: safeColumnCount * (visibleRowCount + 1),
    maxToRenderPerBatch: safeColumnCount * 2,
    windowSize: 3,
  };
}
