import type { Book } from "@readany/core/types";
import { describe, expect, it, vi } from "vitest";
import { importBackendCatalogBook } from "./backend-catalog-import";

const mocks = vi.hoisted(() => ({
  installCover: vi.fn(),
  materializeCover: vi.fn(),
  cleanupSource: vi.fn(),
  downloadSource: vi.fn(),
}));

vi.mock("./backend-catalog-cache", () => ({
  installBackendCatalogCover: mocks.installCover,
  materializeBackendCatalogCover: mocks.materializeCover,
}));

vi.mock("./backend-catalog-source", () => ({
  cleanupBackendCatalogSource: mocks.cleanupSource,
  downloadBackendCatalogSource: mocks.downloadSource,
}));

const IMPORTED_BOOK: Book = {
  id: "local-book",
  filePath: "books/local-book.epub",
  format: "epub",
  meta: { title: "temporary", author: "" },
  addedAt: 1,
  updatedAt: 1,
  progress: 0,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
};

const CATALOG_BOOK = {
  resolution: "catalog" as const,
  bookEditionId: "edition-1",
  catalogKey: "book-1",
  title: "Книга",
  author: "Автор",
  genres: [],
  format: "epub",
  contentSha256: "a".repeat(64),
  generationStatus: "ready",
  ready: true,
  sourceDownloadPath: "/source",
  cover: {
    contentHash: "b".repeat(64),
    mimeType: "image/jpeg" as const,
    byteSize: 10,
    downloadPath: "/cover",
  },
};

describe("backend catalog import", () => {
  it("imports the complete source file without waiting for the cover", async () => {
    let finishCover: ((value: string) => void) | undefined;
    mocks.downloadSource.mockResolvedValueOnce("file:///complete.epub");
    mocks.cleanupSource.mockResolvedValueOnce(undefined);
    mocks.materializeCover.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishCover = resolve;
      }),
    );
    const importBooks = vi.fn().mockResolvedValue({
      imported: [IMPORTED_BOOK],
      skippedDuplicates: [],
    });
    const updateBook = vi.fn().mockResolvedValue(undefined);

    const result = await Promise.race([
      importBackendCatalogBook(CATALOG_BOOK, { importBooks, updateBook }),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(result).not.toBe("timeout");
    expect(result).toMatchObject({ id: "local-book", meta: { title: "Книга" } });
    expect(mocks.downloadSource).toHaveBeenCalledWith(CATALOG_BOOK, undefined);
    expect(importBooks).toHaveBeenCalledWith([
      { uri: "file:///complete.epub", name: "book-1.epub" },
    ]);
    expect(mocks.cleanupSource).toHaveBeenCalledWith("file:///complete.epub");
    expect(mocks.installCover).not.toHaveBeenCalled();

    finishCover?.("file:///cover.jpg");
    await vi.waitFor(() => expect(mocks.installCover).toHaveBeenCalledOnce());
  });
});
