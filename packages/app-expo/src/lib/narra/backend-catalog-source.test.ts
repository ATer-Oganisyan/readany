import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendCatalogBook } from "./backend-catalog-api";

const mocks = vi.hoisted(() => ({
  getInfoAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  deleteAsync: vi.fn(),
  randomUUID: vi.fn(),
  downloadVerifiedBackendFile: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  getInfoAsync: mocks.getInfoAsync,
  makeDirectoryAsync: mocks.makeDirectoryAsync,
  deleteAsync: mocks.deleteAsync,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: mocks.randomUUID,
}));

vi.mock("./backend-file-download", () => ({
  downloadVerifiedBackendFile: mocks.downloadVerifiedBackendFile,
}));

import {
  cleanupBackendCatalogSource,
  downloadBackendCatalogSource,
} from "./backend-catalog-source";

const CATALOG_BOOK: BackendCatalogBook = {
  resolution: "catalog",
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
};

describe("backend catalog source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInfoAsync.mockResolvedValue({ exists: true });
    mocks.downloadVerifiedBackendFile.mockResolvedValue(undefined);
    mocks.randomUUID.mockReturnValueOnce("attempt-1").mockReturnValueOnce("attempt-2");
  });

  it("uses a unique temporary file for every open attempt", async () => {
    const first = await downloadBackendCatalogSource(CATALOG_BOOK);
    const second = await downloadBackendCatalogSource(CATALOG_BOOK);

    expect(first).toBe("file:///cache/narra-catalog-import/book-1-edition-1-attempt-1.epub");
    expect(second).toBe("file:///cache/narra-catalog-import/book-1-edition-1-attempt-2.epub");
    expect(first).not.toBe(second);
  });

  it("cleans up only the path owned by that attempt", async () => {
    const first = await downloadBackendCatalogSource(CATALOG_BOOK);
    const second = await downloadBackendCatalogSource(CATALOG_BOOK);

    await cleanupBackendCatalogSource(first);

    expect(mocks.deleteAsync).toHaveBeenCalledOnce();
    expect(mocks.deleteAsync).toHaveBeenCalledWith(first, { idempotent: true });
    expect(mocks.deleteAsync).not.toHaveBeenCalledWith(second, expect.anything());
  });
});
