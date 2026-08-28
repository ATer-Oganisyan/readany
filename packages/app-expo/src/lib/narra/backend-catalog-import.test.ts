vi.mock("@/stores/narra-store", () => ({
  useNarraStore: { getState: () => ({ setBackendBinding: vi.fn() }) },
}));
import type { Book } from "@readany/core/types";
import { describe, expect, it, vi } from "vitest";
import {
  importBackendCatalogBook,
  importDownloadedBackendCatalogBook,
} from "./backend-catalog-import";

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
      {
        uri: "file:///complete.epub",
        name: "book-1.epub",
        knownBook: {
          title: "Книга",
          author: "Автор",
          sourceKind: "catalog",
          bookEditionId: "edition-1",
          contentHash: CATALOG_BOOK.contentSha256,
          revisionId: CATALOG_BOOK.contentSha256,
        },
      },
    ]);
    expect(mocks.cleanupSource).toHaveBeenCalledWith("file:///complete.epub");
    expect(mocks.installCover).not.toHaveBeenCalled();

    finishCover?.("file:///cover.jpg");
    await vi.waitFor(() => expect(mocks.installCover).toHaveBeenCalledOnce());
  });

  it("finalizes catalog identity after the library import even if the screen unmounts", async () => {
    const controller = new AbortController();
    mocks.materializeCover.mockRejectedValueOnce(new Error("aborted"));
    const importBooks = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { imported: [IMPORTED_BOOK], skippedDuplicates: [] };
    });
    const updateBook = vi.fn().mockResolvedValue(undefined);

    const result = await importDownloadedBackendCatalogBook(CATALOG_BOOK, "file:///complete.epub", {
      importBooks,
      updateBook,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      id: "local-book",
      sourceKind: "catalog",
      bookEditionId: "edition-1",
      contentHash: CATALOG_BOOK.contentSha256,
    });
    expect(updateBook).toHaveBeenCalledWith(
      "local-book",
      expect.objectContaining({
        sourceKind: "catalog",
        bookEditionId: "edition-1",
        contentHash: CATALOG_BOOK.contentSha256,
      }),
    );
  });

  it("keeps the temporary source until the library import finishes", async () => {
    let finishImport: (() => void) | undefined;
    mocks.downloadSource.mockResolvedValueOnce("file:///deferred.epub");
    mocks.cleanupSource.mockResolvedValueOnce(undefined);
    mocks.materializeCover.mockResolvedValueOnce(undefined);
    const cleanupCallsBefore = mocks.cleanupSource.mock.calls.length;
    const importBooks = vi.fn(
      () =>
        new Promise<{ imported: Book[]; skippedDuplicates: []; failures: [] }>((resolve) => {
          finishImport = () =>
            resolve({ imported: [IMPORTED_BOOK], skippedDuplicates: [], failures: [] });
        }),
    );
    const updateBook = vi.fn().mockResolvedValue(undefined);

    const importPromise = importBackendCatalogBook(CATALOG_BOOK, { importBooks, updateBook });
    await vi.waitFor(() => expect(importBooks).toHaveBeenCalledOnce());

    expect(mocks.cleanupSource).toHaveBeenCalledTimes(cleanupCallsBefore);
    finishImport?.();
    await importPromise;
    expect(mocks.cleanupSource).toHaveBeenCalledTimes(cleanupCallsBefore + 1);
    expect(mocks.cleanupSource).toHaveBeenLastCalledWith("file:///deferred.epub");
  });

  it("does not finalize a catalog book when the library import fails", async () => {
    mocks.downloadSource.mockResolvedValueOnce("file:///failed.epub");
    mocks.cleanupSource.mockResolvedValueOnce(undefined);
    const coverCallsBefore = mocks.materializeCover.mock.calls.length;
    const importBooks = vi.fn().mockResolvedValue({
      imported: [],
      skippedDuplicates: [],
      failures: [{ name: "book-1.epub", error: "Book copy failed" }],
    });
    const updateBook = vi.fn().mockResolvedValue(undefined);

    await expect(
      importBackendCatalogBook(CATALOG_BOOK, { importBooks, updateBook }),
    ).rejects.toThrow("catalog-import-failed");

    expect(updateBook).not.toHaveBeenCalled();
    expect(mocks.materializeCover).toHaveBeenCalledTimes(coverCallsBefore);
    expect(mocks.cleanupSource).toHaveBeenLastCalledWith("file:///failed.epub");
  });

  it("joins concurrent imports of the same catalog revision", async () => {
    let finishImport: (() => void) | undefined;
    const importBooks = vi.fn(
      () =>
        new Promise<{ imported: Book[]; skippedDuplicates: []; failures: [] }>((resolve) => {
          finishImport = () =>
            resolve({ imported: [IMPORTED_BOOK], skippedDuplicates: [], failures: [] });
        }),
    );
    const updateBook = vi.fn().mockResolvedValue(undefined);
    mocks.materializeCover.mockResolvedValueOnce(undefined);

    const first = importDownloadedBackendCatalogBook(CATALOG_BOOK, "file:///first.epub", {
      importBooks,
      updateBook,
    });
    const second = importDownloadedBackendCatalogBook(CATALOG_BOOK, "file:///second.epub", {
      importBooks,
      updateBook,
    });

    expect(first).toBe(second);
    expect(importBooks).toHaveBeenCalledOnce();
    finishImport?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ id: "local-book" }),
      expect.objectContaining({ id: "local-book" }),
    ]);
    expect(updateBook).toHaveBeenCalledOnce();
  });
});
