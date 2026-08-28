import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BackendCatalogGenre } from "./backend-catalog-api";
import type { CachedBackendCatalog, CachedBackendCatalogBook } from "./backend-catalog-cache";
import {
  buildCatalogShelves,
  catalogCoverWindow,
  chunkShelfBooks,
  completeCatalogSnapshot,
  shelfPageForBook,
} from "./catalog-shelves";

const genres: BackendCatalogGenre[] = [
  { id: "history", labelRu: "История", labelEn: "History", order: 2 },
  { id: "fiction", labelRu: "Проза", labelEn: "Fiction", order: 1 },
  { id: "empty", labelRu: "Пустая", labelEn: "Empty", order: 3 },
];
function book(id: string, categories: string[]): CachedBackendCatalogBook {
  return {
    bookEditionId: id,
    catalogKey: id,
    genres: categories,
    title: id,
    author: "Author",
    resolution: "catalog",
    format: "epub",
    contentSha256: "a".repeat(64),
    generationStatus: "ready",
    ready: true,
    sourceDownloadPath: `/v2/books/${id}/source`,
  };
}

describe("catalog shelves", () => {
  it("prefetches adjacent pages and the next shelf without downloading the whole catalog", () => {
    const shelves = Array.from({ length: 10 }, (_, index) => ({
      id: `shelf-${index}`,
      title: `Shelf ${index}`,
      books: Array.from({ length: 20 }, (_, position) => book(`${index}-${position}`, [])),
    }));
    const window = catalogCoverWindow(shelves, new Set(["shelf-3"]), new Map([["shelf-3", 4]]), 2);
    expect(window.visible.map((b) => b.catalogKey)).toEqual(["3-4", "3-5"]);
    expect(window.nearby.map((b) => b.catalogKey)).toEqual([
      "3-2",
      "3-3",
      "3-4",
      "3-5",
      "3-6",
      "3-7",
      "4-0",
      "4-1",
      "4-2",
      "4-3",
    ]);
    const initial = catalogCoverWindow(shelves, new Set(), new Map(), 2);
    expect(initial.visible.map((b) => b.catalogKey)).toEqual(["0-0", "0-1", "1-0", "1-1"]);
    expect(initial.nearby.length).toBeLessThan(20);
  });
  it("orders categories, localizes headings, and hides empty shelves", () => {
    const shelves = buildCatalogShelves(
      [book("a", ["history"]), book("b", ["fiction"])],
      genres,
      "ru",
      "Без категории",
    );
    expect(shelves.map((shelf) => [shelf.id, shelf.title])).toEqual([
      ["fiction", "Проза"],
      ["history", "История"],
    ]);
    expect(
      buildCatalogShelves([book("a", ["history"])], genres, "en-US", "Uncategorized")[0].title,
    ).toBe("History");
    expect(genres[0].id).toBe("history");
  });

  it("places multi-genre books on each shelf without duplicates", () => {
    const a = book("a", ["history", "fiction", "fiction"]);
    const shelves = buildCatalogShelves([a, a], genres, "en", "Uncategorized");
    expect(shelves.map((shelf) => shelf.books.map((item) => item.bookEditionId))).toEqual([
      ["a"],
      ["a"],
    ]);
  });

  it("keeps unclassified books and books with an unavailable dictionary discoverable", () => {
    const books = [book("a", []), book("b", ["new-genre"])];
    expect(buildCatalogShelves(books, genres, "ru", "Без категории")).toEqual([
      { id: "__uncategorized__", title: "Без категории", books },
    ]);
    expect(
      buildCatalogShelves([book("c", ["fiction"])], [], "en", "Uncategorized")[0].books,
    ).toHaveLength(1);
    expect(buildCatalogShelves([], genres, "en", "Uncategorized")).toEqual([]);
  });

  it("appends later catalog pages without losing books from other shelves", () => {
    const initial = [book("a", ["fiction"]), book("b", ["history"])];
    const next = buildCatalogShelves(
      [...initial, book("c", ["history"])],
      genres,
      "en",
      "Uncategorized",
    );
    expect(next[0].books).toEqual([initial[0]]);
    expect(next[1].books.map((item) => item.catalogKey)).toEqual(["b", "c"]);
  });

  it("paginates by pairs on phones and more columns on tablets including the last partial page", () => {
    expect(chunkShelfBooks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkShelfBooks([1, 2, 3, 4, 5], 4)).toEqual([[1, 2, 3, 4], [5]]);
    expect(chunkShelfBooks([], 2)).toEqual([]);
    expect(() => chunkShelfBooks([1], 0)).toThrow();
  });

  it("restores the book position after rotation and clamps after a shorter refresh", () => {
    expect(shelfPageForBook(6, 2, 10)).toBe(3);
    expect(shelfPageForBook(6, 4, 10)).toBe(1);
    expect(shelfPageForBook(8, 2, 3)).toBe(1);
    expect(shelfPageForBook(0, 2, 0)).toBe(0);
  });

  it("uses the home cards, independent horizontal paging, and no category chips", () => {
    const screen = readFileSync(new URL("../../screens/SearchScreen.tsx", import.meta.url), "utf8");
    const shelf = readFileSync(
      new URL("../../components/library/catalog-shelf.tsx", import.meta.url),
      "utf8",
    );
    expect(screen).not.toContain("NativeSegmentedPager");
    expect(screen).not.toContain("selectedCatalogGenre");
    expect(screen).not.toContain("contentOffset=");
    expect(screen).toContain("snapshot.hasCompleteCatalog");
    expect(screen).toContain("<CatalogShelfRow");
    expect(screen).toContain("<CharacterChatList");
    expect(shelf).toContain("<ConnectedCatalogBookCard");
    expect(shelf).not.toContain("pagingEnabled");
    expect(shelf).toContain("snapToInterval={pageStride}");
    expect(shelf).toContain("ItemSeparatorComponent={ShelfPageSeparator}");
    expect(shelf).toContain("offset: edgeInset + pageStride * index");
    expect(shelf).toContain("contentOffset={initialOffset}");
    expect(shelf).toContain("width: viewportWidth");
    expect(screen).toContain("viewportWidth={layout.width}");
    expect(shelf).toContain("directionalLockEnabled");
    expect(shelf).toContain("guard?.scrollHandlers.onScrollBeginDrag(event)");
  });

  it("publishes the full metadata catalog even when later pages discover earlier genres", async () => {
    const first: CachedBackendCatalog = {
      books: [book("a", ["history"])],
      genres,
      genreVersion: "v1",
      nextCursor: "second",
    };
    const result = await completeCatalogSnapshot(first, async (current) => ({
      ...current,
      books: [...current.books, book("b", ["fiction"])],
      nextCursor: null,
    }));
    expect(result?.books).toHaveLength(2);
    expect(result?.nextCursor).toBeNull();
    expect(
      buildCatalogShelves(result?.books ?? [], genres, "en", "Uncategorized").map(
        (shelf) => shelf.id,
      ),
    ).toEqual(["fiction", "history"]);
  });

  it("does not publish an incomplete catalog after failure or a cancelled refresh", async () => {
    const first: CachedBackendCatalog = {
      books: [],
      genres,
      genreVersion: "v1",
      nextCursor: "next",
    };
    await expect(
      completeCatalogSnapshot(first, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(
      await completeCatalogSnapshot(
        first,
        async () => {
          throw new Error("must not fetch");
        },
        () => false,
      ),
    ).toBeNull();
    await expect(completeCatalogSnapshot(first, async () => first)).rejects.toThrow("cursor cycle");
  });
});
