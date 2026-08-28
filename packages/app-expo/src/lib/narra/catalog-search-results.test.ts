import type { Book } from "@readany/core/types";
import { describe, expect, it } from "vitest";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import {
  buildBookSearchIndex,
  searchBookIndex,
  searchResultWindow,
} from "./catalog-search-results";

const catalogBook = (index: number): CachedBackendCatalogBook => ({
  resolution: "catalog",
  bookEditionId: `edition-${index}`,
  catalogKey: `catalog-${index}`,
  title: index === 267 ? "Последняя страница" : `English Book ${index}`,
  author: "Автор Author",
  genres: ["fiction"],
  format: "epub",
  contentSha256: String(index).padStart(64, "a"),
  generationStatus: "ready",
  ready: true,
  sourceDownloadPath: `/books/${index}`,
});
const libraryBook = (id: string, title = "Моя книга"): Book =>
  ({
    id,
    meta: { title, author: "Мой автор" },
    format: "epub",
    filePath: `/books/${id}.epub`,
  }) as Book;

describe("metadata-only local search", () => {
  const books = Array.from({ length: 268 }, (_, index) => catalogBook(index));
  it("matches Russian/English title and author, empty query and absent results", () => {
    const index = buildBookSearchIndex([libraryBook("one")], books);
    expect(searchBookIndex(index, " ")).toEqual([]);
    expect(searchBookIndex(index, "not-a-title")).toEqual([]);
    expect(searchBookIndex(index, "моя КНИГА")).toHaveLength(1);
    expect(searchBookIndex(index, "ENGLISH")).toHaveLength(267);
    expect(searchBookIndex(index, "  последний ")).toHaveLength(0);
    expect(searchBookIndex(index, "последняя")[0]?.key).toBe("catalog:edition-267");
    expect(searchBookIndex(index, "aUtHoR")).toHaveLength(268);
  });

  it("does not include deleted library entries", () => {
    const deleted = { ...libraryBook("gone"), deletedAt: 123 };
    expect(searchBookIndex(buildBookSearchIndex([deleted], []), "книга")).toEqual([]);
  });

  it("keeps imported and non-imported books reachable without duplicate matching rows", () => {
    const edition = books[0];
    const imported: Book = {
      ...libraryBook("imported", edition.title),
      meta: { ...libraryBook("imported").meta, title: edition.title, author: edition.author },
      sourceKind: "catalog",
      bookEditionId: edition.bookEditionId,
      syncStatus: "local",
    };
    const results = searchBookIndex(buildBookSearchIndex([imported], books.slice(0, 2)), "English");
    expect(results.map(({ key }) => key)).toEqual(["library:imported", "catalog:edition-1"]);
    // If the user renamed their local copy, the original catalog title is still searchable.
    const renamed = { ...imported, meta: { ...imported.meta, title: "Мой перевод" } };
    expect(searchBookIndex(buildBookSearchIndex([renamed], [edition]), "English")[0]?.kind).toBe(
      "catalog",
    );
    expect(
      searchBookIndex(buildBookSearchIndex([renamed], [edition]), "Мой перевод")[0]?.kind,
    ).toBe("library");
  });

  it("keeps query results addressable and never mutates old results during rapid typing", () => {
    const index = buildBookSearchIndex([], books);
    const broad = searchBookIndex(index, "author");
    for (const query of ["English Book 1", "", "русский", "author", "English Book 267"])
      searchBookIndex(index, query);
    expect(broad).toHaveLength(268);
    expect(searchBookIndex(index, "Последняя страница")).toEqual([index[267].result]);
  });

  it("restricts cover work to visible rows and two neighboring rows", () => {
    const results = searchBookIndex(buildBookSearchIndex([], books), "author");
    const first = searchResultWindow(results, [], 9);
    expect(first.visible).toHaveLength(9);
    expect(first.nearby).toHaveLength(11);
    const scrolled = searchResultWindow(
      results,
      results.slice(100, 109).map((row) => row.key),
      9,
    );
    expect(scrolled.visible).toEqual(books.slice(100, 109));
    expect(scrolled.nearby).toEqual(books.slice(98, 111));
    expect(
      searchResultWindow(
        results.slice(267),
        results.slice(100, 109).map((row) => row.key),
        9,
      ).visible,
    ).toEqual([books[267]]);
  });
});
