import { describe, expect, it } from "vitest";
import { LOADING_COVER_COLORS, loadingCoverColorForBook } from "./loading-cover-placeholder";

describe("loading cover placeholder", () => {
  it("selects a stable color from the Paper palette", () => {
    const color = loadingCoverColorForBook("book-42");

    expect(LOADING_COVER_COLORS).toContain(color);
    expect(loadingCoverColorForBook("book-42")).toBe(color);
  });

  it("distributes books across all four colors", () => {
    const colors = new Set(
      Array.from({ length: 40 }, (_, index) => loadingCoverColorForBook(`book-${index}`)),
    );

    expect(colors).toEqual(new Set(LOADING_COVER_COLORS));
  });
});
