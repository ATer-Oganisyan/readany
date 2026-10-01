import { describe, expect, it } from "vitest";
import { catalogGridLayout, catalogGridWindow } from "./catalog-grid-layout";

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

it("bounds mounted rows after long scrolling while preserving every visible row and total height", () => {
  for (const columns of [2, 4, 5]) {
    for (const itemCount of [0, 1, 20, 71, 1500]) {
      for (const viewportHeight of [320, 874, 1366]) {
        const rowHeight = 280;
        const gridTop = 160;
        const rows = Math.ceil(itemCount / columns);
        for (const scrollY of [-140, 0, 300, 7200, rows * rowHeight]) {
          const window = catalogGridWindow({
            columns,
            itemCount,
            rowHeight,
            gridTop,
            scrollY,
            viewportHeight,
          });
          expect(window.start % columns).toBe(0);
          expect(window.end).toBeLessThanOrEqual(itemCount);
          expect(window.end - window.start).toBeLessThanOrEqual(
            (Math.ceil(viewportHeight / rowHeight) + 7) * columns,
          );
          expect(
            window.paddingTop +
              Math.ceil((window.end - window.start) / columns) * rowHeight +
              window.paddingBottom,
          ).toBe(rows * rowHeight);
          for (let index = 0; index < itemCount; index++) {
            const top = gridTop + Math.floor(index / columns) * rowHeight;
            if (top + rowHeight > scrollY && top < scrollY + viewportHeight) {
              expect(index).toBeGreaterThanOrEqual(window.start);
              expect(index).toBeLessThan(window.end);
            }
          }
        }
      }
    }
  }
});
