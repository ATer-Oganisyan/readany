import { describe, expect, it } from "vitest";
import { getCatalogGridVirtualizationConfig } from "./catalog-grid-virtualization";

describe("getCatalogGridVirtualizationConfig", () => {
  it("renders the viewport and one extra row on a phone", () => {
    expect(
      getCatalogGridVirtualizationConfig({
        columnCount: 2,
        viewportHeight: 800,
        itemHeight: 300,
      }),
    ).toEqual({
      initialNumToRender: 8,
      maxToRenderPerBatch: 4,
      windowSize: 3,
    });
  });

  it("scales batches with tablet column count", () => {
    expect(
      getCatalogGridVirtualizationConfig({
        columnCount: 5,
        viewportHeight: 900,
        itemHeight: 320,
      }),
    ).toEqual({
      initialNumToRender: 20,
      maxToRenderPerBatch: 10,
      windowSize: 3,
    });
  });

  it("normalizes invalid layout measurements", () => {
    expect(
      getCatalogGridVirtualizationConfig({
        columnCount: 0,
        viewportHeight: 0,
        itemHeight: 0,
      }),
    ).toEqual({
      initialNumToRender: 2,
      maxToRenderPerBatch: 2,
      windowSize: 3,
    });
  });
});
