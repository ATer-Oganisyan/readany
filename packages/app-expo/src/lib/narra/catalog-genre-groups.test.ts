import { describe, expect, it } from "vitest";
import type { BackendCatalogBook } from "./backend-book-api";
import { groupCatalogBooksByGenre } from "./catalog-genre-groups";

function book(id: string, genres?: BackendCatalogBook["genres"]): BackendCatalogBook {
  return {
    resolution: "catalog",
    bookEditionId: id,
    catalogKey: id,
    title: id,
    author: "",
    genres,
    format: "epub",
    contentSha256: "a".repeat(64),
    ready: true,
    sourceDownloadPath: `/v2/books/${id}/source/download`,
  };
}

describe("catalog genre groups", () => {
  it("orders genres by their highest-ranked book and preserves book order inside a group", () => {
    const groups = groupCatalogBooksByGenre([
      book("poetry-1", ["poetry"]),
      book("fantasy-1", ["fantasy"]),
      book("poetry-2", ["poetry"]),
      book("fantasy-2", ["fantasy"]),
    ]);

    expect(groups.map((group) => group.genre)).toEqual(["poetry", "fantasy"]);
    expect(groups[0]?.books.map((item) => item.bookEditionId)).toEqual(["poetry-1", "poetry-2"]);
  });

  it("places a multi-genre book in every matching group", () => {
    const groups = groupCatalogBooksByGenre([book("aelita", ["science-fiction", "romance"])]);

    expect(groups.map((group) => group.genre)).toEqual(["science-fiction", "romance"]);
    expect(groups.every((group) => group.books[0]?.bookEditionId === "aelita")).toBe(true);
  });

  it("keeps books from an old cache in a final unclassified group", () => {
    const groups = groupCatalogBooksByGenre([book("without-genre"), book("fantasy", ["fantasy"])]);
    expect(groups).toEqual([
      expect.objectContaining({
        genre: "fantasy",
        books: [expect.objectContaining({ title: "fantasy" })],
      }),
      expect.objectContaining({
        genre: "unclassified",
        books: [expect.objectContaining({ title: "without-genre" })],
      }),
    ]);
  });
});
