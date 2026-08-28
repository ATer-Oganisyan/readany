import { describe, expect, it } from "vitest";
import { catalogGridLayout } from "./catalog-grid-layout";

describe("category row budget", () => {
  it("covers the real phone viewport with a small reserve, not twelve initial books", () => {
    const layout = catalogGridLayout({
      cardWidth: 177,
      viewportHeight: 874,
      topInset: 152,
      bottomInset: 34,
    });
    expect(layout.initialRows).toBe(3);
    expect(layout.initialRows * 2).toBe(6);
    expect(layout.initialRows * layout.rowHeight).toBeGreaterThan(
      874 - 152 - 34 - layout.topPadding,
    );
  });

  it("calculates scroll offsets using row indices including top padding", () => {
    const layout = catalogGridLayout({ cardWidth: 170, viewportHeight: 800 });
    expect(layout.getItemLayout(undefined, 3)).toEqual({
      index: 3,
      length: layout.rowHeight,
      offset: layout.topPadding + 3 * layout.rowHeight,
    });
  });

  it("adapts to small/landscape/tall viewports without zero rows", () => {
    for (const height of [1, 320, 667, 1024, 1366]) {
      const layout = catalogGridLayout({
        cardWidth: 170,
        viewportHeight: height,
        topInset: 140,
        bottomInset: 34,
      });
      expect(layout.initialRows).toBeGreaterThanOrEqual(1);
      expect(layout.initialRows * layout.rowHeight).toBeGreaterThanOrEqual(
        Math.max(1, height - 174 - layout.topPadding),
      );
    }
  });
});
