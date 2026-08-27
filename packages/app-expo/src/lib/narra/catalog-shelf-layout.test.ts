import { describe, expect, it } from "vitest";
import { CATALOG_SHELF_GAP, catalogShelfLayout } from "./catalog-shelf-layout";

describe("catalog shelf geometry", () => {
  it.each([
    [393, 361, 2],
    [402, 370, 2],
    [440, 408, 2],
    [768, 720, 4],
    [1194, 1138, 5],
    [1440, 1260, 5],
  ])("keeps the same gap inside and between pages at %i pt", (viewport, content, columns) => {
    const { cardWidth, pageWidth, pageStride, edgeInset } = catalogShelfLayout(
      viewport,
      content,
      columns,
    );
    expect(CATALOG_SHELF_GAP).toBe(16);
    expect(pageWidth + edgeInset * 2).toBe(viewport);
    const positions = Array.from(
      { length: columns * 4 },
      (_, index) =>
        edgeInset +
        Math.floor(index / columns) * pageStride +
        (index % columns) * (cardWidth + CATALOG_SHELF_GAP),
    );
    for (const scrollOffset of [0, cardWidth / 2, pageStride, pageStride * 2.4]) {
      for (let index = 1; index < positions.length; index++) {
        const previousRight = positions[index - 1] - scrollOffset + cardWidth;
        const nextLeft = positions[index] - scrollOffset;
        expect(nextLeft - previousRight).toBeCloseTo(CATALOG_SHELF_GAP);
      }
    }
    // Restoring a page keeps its first book under the heading.
    expect(positions[columns * 2] - pageStride * 2).toBeCloseTo(edgeInset);
    // Last-page scroll limit matches the snap target, without an extra empty step.
    const totalWidth = edgeInset * 2 + pageWidth * 4 + CATALOG_SHELF_GAP * 3;
    expect(totalWidth - viewport).toBeCloseTo(pageStride * 3);
  });
});
