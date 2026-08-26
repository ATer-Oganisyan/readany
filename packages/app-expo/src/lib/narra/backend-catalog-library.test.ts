import type { Book } from "@readany/core/types";
import { describe, expect, it } from "vitest";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import {
  findLibraryBookForCatalogBook,
  findReadableLibraryBookForCatalogBook,
  isCatalogBookRevisionCurrent,
} from "./backend-catalog-library";

const catalogBook = (): CachedBackendCatalogBook => ({
  resolution: "catalog",
  bookEditionId: "edition-a",
  catalogKey: "catalog-a",
  title: "Книга",
  author: "Автор",
  genres: [],
  format: "epub",
  contentSha256: "a".repeat(64),
  generationStatus: "ready",
  ready: true,
  sourceDownloadPath: "/v2/books/edition-a/source",
});

const libraryBook = (updates: Partial<Book> = {}): Book => ({
  id: "book-a",
  filePath: "books/book-a.epub",
  format: "epub",
  meta: { title: "Книга", author: "Автор" },
  addedAt: 1,
  updatedAt: 1,
  progress: 0,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
  ...updates,
});

describe("backend catalog library matching", () => {
  it("matches an imported catalog book by the server edition id", () => {
    const exact = libraryBook({ sourceKind: "catalog", bookEditionId: "edition-a" });
    expect(findLibraryBookForCatalogBook(catalogBook(), [exact])).toBe(exact);
  });

  it("opens one pre-migration local copy without assigning catalog identity", () => {
    const local = libraryBook({ sourceKind: "local" });
    expect(findReadableLibraryBookForCatalogBook(catalogBook(), [local])).toBe(local);
  });

  it("does not guess between equal pre-migration local copies", () => {
    const first = libraryBook({ id: "first", sourceKind: "local" });
    const second = libraryBook({ id: "second", sourceKind: "local" });
    expect(findReadableLibraryBookForCatalogBook(catalogBook(), [first, second])).toBeNull();
  });

  it("checks the downloaded content revision independently of the title", () => {
    const catalog = catalogBook();
    expect(
      isCatalogBookRevisionCurrent(
        libraryBook({ sourceKind: "catalog", contentHash: catalog.contentSha256 }),
        catalog,
      ),
    ).toBe(true);
    expect(
      isCatalogBookRevisionCurrent(
        libraryBook({ sourceKind: "catalog", contentHash: "b".repeat(64) }),
        catalog,
      ),
    ).toBe(false);
  });
});
