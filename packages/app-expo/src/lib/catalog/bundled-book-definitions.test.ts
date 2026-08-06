import { describe, expect, it } from "vitest";
import {
  BUNDLED_CATALOG_COVER_VERSION,
  getBundledCatalogCoverPath,
  isBundledCatalogCoverPath,
  shouldRefreshBundledCatalogCover,
} from "./bundled-book-definitions";

describe("bundled catalog cover versioning", () => {
  it("uses the current version in newly installed cover paths", () => {
    expect(getBundledCatalogCoverPath("anna-karenina")).toBe(
      `covers/anna-karenina-catalog-v${BUNDLED_CATALOG_COVER_VERSION}.jpg`,
    );
  });

  it("recognizes old and versioned catalog paths for safe migration", () => {
    expect(isBundledCatalogCoverPath("anna-karenina", "covers/anna-karenina-catalog.jpg")).toBe(
      true,
    );
    expect(isBundledCatalogCoverPath("anna-karenina", "covers/anna-karenina-catalog-v1.jpg")).toBe(
      true,
    );
  });

  it("does not replace a user-selected cover", () => {
    expect(isBundledCatalogCoverPath("anna-karenina", "covers/my-custom-cover.jpg")).toBe(false);
    expect(isBundledCatalogCoverPath("anna-karenina", "https://example.com/cover.jpg")).toBe(false);
  });

  it("refreshes only missing or outdated catalog covers", () => {
    expect(shouldRefreshBundledCatalogCover("anna-karenina")).toBe(true);
    expect(
      shouldRefreshBundledCatalogCover("anna-karenina", "covers/anna-karenina-catalog.jpg"),
    ).toBe(true);
    expect(
      shouldRefreshBundledCatalogCover(
        "anna-karenina",
        getBundledCatalogCoverPath("anna-karenina"),
      ),
    ).toBe(false);
    expect(shouldRefreshBundledCatalogCover("anna-karenina", "covers/my-custom-cover.jpg")).toBe(
      false,
    );
  });
});
