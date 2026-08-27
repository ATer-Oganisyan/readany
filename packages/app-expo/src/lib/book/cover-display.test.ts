import { describe, expect, it } from "vitest";
import {
  isGeneratedBookCoverPath,
  isLegacyGeneratedBookCover,
  shouldRenderCoverTypography,
} from "./cover-display";

describe("cover display", () => {
  it("does not overlay typography on original and legacy covers", () => {
    expect(shouldRenderCoverTypography("book-1", "covers/book-1-original.jpg")).toBe(false);
    expect(shouldRenderCoverTypography("book-1", "covers/book-1.jpg")).toBe(false);
    expect(shouldRenderCoverTypography("book-1", "https://example.com/cover.jpg")).toBe(false);
  });

  it("overlays typography on generated, catalog, and missing covers", () => {
    expect(shouldRenderCoverTypography("book-1", "covers/book-1-generated.webp")).toBe(true);
    expect(shouldRenderCoverTypography("book-1", "covers/book-1-catalog-v7.jpg")).toBe(true);
    expect(shouldRenderCoverTypography("book-1")).toBe(true);
  });

  it("matches generated covers only for the requested book", () => {
    expect(isGeneratedBookCoverPath("book-1", "covers/book-1-generated.png")).toBe(true);
    expect(
      isGeneratedBookCoverPath(
        "book-1",
        "covers/book-1-generated-b42e5309-0d9f-49b3-89cf-87fc08ee381b.png",
      ),
    ).toBe(true);
    expect(isGeneratedBookCoverPath("book-1", "covers/book-2-generated.png")).toBe(false);
  });

  it("recognizes an old asynchronously generated cover without mistaking an imported cover", () => {
    expect(
      isLegacyGeneratedBookCover({
        bookId: "book-1",
        coverUrl: "covers/book-1.jpg",
        bookAddedAt: 1_000,
        coverModifiedAt: 31_000,
      }),
    ).toBe(true);
    expect(
      isLegacyGeneratedBookCover({
        bookId: "book-1",
        coverUrl: "covers/book-1.jpg",
        bookAddedAt: 1_000,
        coverModifiedAt: 1_500,
      }),
    ).toBe(false);
  });
});
