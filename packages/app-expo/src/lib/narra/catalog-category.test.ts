import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CachedBackendCatalog, CachedBackendCatalogBook } from "./backend-catalog-cache";
import {
  buildCatalogShelves,
  catalogCategoryCoverWindow,
  chunkShelfBooks,
  completeCatalogSnapshot,
} from "./catalog-shelves";

const book = (id: string, genres = ["fiction"]): CachedBackendCatalogBook => ({
  bookEditionId: id,
  catalogKey: id,
  genres,
  title: id,
  author: "Author",
  resolution: "catalog",
  format: "epub",
  contentSha256: "a".repeat(64),
  generationStatus: "ready",
  ready: true,
  sourceDownloadPath: `/v2/books/${id}/source`,
});
const genres = [
  { id: "fiction", labelEn: "Fiction", labelRu: "Проза", order: 1 },
  { id: "history", labelEn: "History", labelRu: "История", order: 2 },
];

describe("expanded catalog category", () => {
  it("shows the entire selected category in pairs, not just the carousel page", () => {
    const items = Array.from({ length: 7 }, (_, index) => book(String(index)));
    const shelves = buildCatalogShelves(
      [...items, book("history-only", ["history"]), items[0]],
      genres,
      "en",
      "Uncategorized",
    );
    expect(
      chunkShelfBooks(shelves.find((shelf) => shelf.id === "fiction")?.books ?? [], 2).map((row) =>
        row.map((item) => item.catalogKey),
      ),
    ).toEqual([["0", "1"], ["2", "3"], ["4", "5"], ["6"]]);
  });

  it("includes matching books beyond the first metadata page", async () => {
    const initial: CachedBackendCatalog = {
      books: [book("first")],
      nextCursor: "next",
      genres,
      genreVersion: "1",
    };
    const loadNext = vi.fn(async (current: CachedBackendCatalog) => ({
      ...current,
      books: [...current.books, book("last")],
      nextCursor: null,
    }));
    const complete = await completeCatalogSnapshot(initial, loadNext);
    expect(
      buildCatalogShelves(complete?.books ?? [], genres, "ru", "Без категории")[0],
    ).toMatchObject({
      title: "Проза",
      books: [book("first"), book("last")],
    });
    expect(loadNext).toHaveBeenCalledOnce();
  });

  it("does not refetch a complete snapshot on category navigation", async () => {
    const initial: CachedBackendCatalog = {
      books: [book("first")],
      nextCursor: null,
      genres,
      genreVersion: "1",
    };
    const loadNext = vi.fn();
    expect(await completeCatalogSnapshot(initial, loadNext)).toBe(initial);
    expect(loadNext).not.toHaveBeenCalled();
  });

  it("keeps a bounded cover window and follows scrolling", () => {
    const books = Array.from({ length: 100 }, (_, index) => book(String(index)));
    expect(catalogCategoryCoverWindow(books, []).visible).toHaveLength(6);
    const window = catalogCategoryCoverWindow(books, ["40", "41", "42", "43"]);
    expect(window.visible.map((item) => item.bookEditionId)).toEqual(["40", "41", "42", "43"]);
    expect(window.nearby.map((item) => item.bookEditionId)).toEqual(
      Array.from({ length: 12 }, (_, index) => String(38 + index)),
    );
    expect(catalogCategoryCoverWindow([], [])).toEqual({ visible: [], nearby: [] });
    expect(
      catalogCategoryCoverWindow(books, ["99"]).nearby.map((item) => item.bookEditionId),
    ).toEqual(["97", "98", "99"]);
  });

  it("wires the pack's small chevron to the root large-title grid and retains cover recovery", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const shelf = read("../../components/library/catalog-shelf.tsx");
    const screen = read("../../screens/catalog-category-screen.tsx");
    const search = read("../../screens/SearchScreen.tsx");
    const navigator = read("../../navigation/RootNavigator.tsx");
    const icons = read("../../components/ui/mishanaer-icons.generated.ts");
    expect(shelf).toContain('accessibilityRole="button"');
    expect(shelf).toContain("minHeight: 44");
    expect(shelf).toContain("onOpenCategory(shelf)");
    expect(shelf).toMatch(/<MishanaerIcon\s+name="chevron-small-right"/);
    expect(shelf).toMatch(/name="chevron-small-right"[\s\S]*?color=\{colors.primary40\}/);
    expect(icons).toContain('"chevron-small-right": StrokeChevronSmallRightAsset');
    expect(read("../../../assets/icons/mishanaer/stroke/chevron-small-right.svg")).toContain(
      'd="m9.5 7 5 5-5 5"',
    );
    expect(search).toContain('navigation.navigate("CatalogCategory"');
    expect(search).toContain("genreId: shelf.id");
    expect(navigator).toMatch(/name="CatalogCategory"[\s\S]*?\.\.\.largeTitleOptions/);
    expect(screen).toContain("numColumns={2}");
    expect(screen).toContain('contentInsetAdjustmentBehavior="automatic"');
    expect(screen).not.toContain("headerSearchBarOptions");
    expect(screen).toContain("retryCatalogCover(book)");
    expect(screen).toContain("findReadableLibraryBookForCatalogBook");
    expect(screen).toContain("useCatalogCoverWindow");
  });
});
