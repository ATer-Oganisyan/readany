import type { Book } from "@readany/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as identity from "../book/book-identity";
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
  afterEach(() => vi.restoreAllMocks());

  it("indexes local books once per snapshot and returns current progress", () => {
    const normalize = vi.spyOn(identity, "bookIdentity");
    const local = libraryBook({ sourceKind: "local" });
    const books = [local];
    const catalog = Array.from({ length: 1500 }, (_, i) => ({
      ...catalogBook(),
      catalogKey: `catalog-${i}`,
      title: i === 0 ? local.meta.title : `Другая книга ${i}`,
    }));
    for (const book of catalog) findReadableLibraryBookForCatalogBook(book, books);
    const calls = normalize.mock.calls.length;
    expect(calls).toBe(1501);

    const updated = { ...local, progress: 0.5, currentCfi: "new-position", lastOpenedAt: 2 };
    const updatedBooks = [updated];
    for (const book of catalog) findReadableLibraryBookForCatalogBook(book, updatedBooks);
    expect(normalize).toHaveBeenCalledTimes(calls * 2);
    expect(findReadableLibraryBookForCatalogBook(catalog[0], updatedBooks)).toBe(updated);
  });

  it("does not normalize catalog titles when there are no legacy copies", () => {
    const normalize = vi.spyOn(identity, "bookIdentity");
    const books = [libraryBook({ sourceKind: "catalog", bookEditionId: "other-edition" })];
    expect(findReadableLibraryBookForCatalogBook(catalogBook(), books)).toBeNull();
    expect(normalize).not.toHaveBeenCalled();
  });

  it.each([
    { deletedAt: 1 },
    { sourceKind: "catalog" as const },
    { bookEditionId: "other-edition" },
    { syncStatus: "remote" as const },
    { format: "pdf" as const },
    { meta: { title: "Другая книга", author: "Автор" } },
    { meta: { title: "Книга", author: "Другой автор" } },
  ])("invalidates a legacy match when matching fields change: %o", (updates) => {
    const catalog = catalogBook();
    const local = libraryBook();
    expect(findReadableLibraryBookForCatalogBook(catalog, [local])).toBe(local);
    expect(findReadableLibraryBookForCatalogBook(catalog, [{ ...local, ...updates }])).toBeNull();
  });

  it("invalidates cached misses, ambiguity and edition matches after library changes", () => {
    const catalog = catalogBook();
    expect(findReadableLibraryBookForCatalogBook(catalog, [])).toBeNull();
    const local = libraryBook();
    expect(findReadableLibraryBookForCatalogBook(catalog, [local])).toBe(local);
    const duplicate = libraryBook({ id: "duplicate" });
    expect(findReadableLibraryBookForCatalogBook(catalog, [local, duplicate])).toBeNull();
    const exact = libraryBook({ id: "exact", sourceKind: "catalog", bookEditionId: "edition-a" });
    expect(findReadableLibraryBookForCatalogBook(catalog, [local, duplicate, exact])).toBe(exact);
    expect(findReadableLibraryBookForCatalogBook(catalog, [duplicate])).toBe(duplicate);
  });

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
