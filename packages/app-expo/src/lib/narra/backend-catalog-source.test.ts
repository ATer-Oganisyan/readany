import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendCatalogBook } from "./backend-book-api";

const mocks = vi.hoisted(() => ({
  deleted: vi.fn(),
  download: vi.fn(),
  hash: vi.fn(async () => "a".repeat(64)),
  requestUrl: vi.fn(async () => "https://storage.example/source"),
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  FileSystemSessionType: { BACKGROUND: 0 },
  getInfoAsync: vi.fn(async () => ({ exists: true, isDirectory: true })),
  makeDirectoryAsync: vi.fn(),
  deleteAsync: mocks.deleted,
  createDownloadResumable(url: string, path: string) {
    return {
      async downloadAsync() {
        mocks.download(url, path);
        return { status: 200, uri: path };
      },
    };
  },
}));
vi.mock("./backend-book-api", () => ({ requestBackendDownloadUrl: mocks.requestUrl }));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: mocks.hash }));

import {
  cleanupBackendCatalogSource,
  downloadBackendCatalogSource,
} from "./backend-catalog-source";

const BOOK: BackendCatalogBook = {
  resolution: "catalog",
  bookEditionId: "edition-1",
  catalogKey: "seagull",
  title: "Чайка",
  author: "Антон Чехов",
  format: "epub",
  contentSha256: "a".repeat(64),
  ready: true,
  sourceDownloadPath: "/v2/books/edition-1/source/download",
};

describe("backend catalog source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("downloads to an absolute file URI and verifies its checksum", async () => {
    const path = await downloadBackendCatalogSource(BOOK);
    expect(path).toBe("file:///cache/narra-catalog-import/seagull-edition-1.epub");
    expect(mocks.requestUrl).toHaveBeenCalledWith(BOOK.sourceDownloadPath);
    expect(mocks.download).toHaveBeenCalledWith("https://storage.example/source", path);
    expect(mocks.hash).toHaveBeenCalledWith(path);
  });

  it("deletes a corrupt download before reporting the error", async () => {
    mocks.hash.mockResolvedValueOnce("b".repeat(64));
    await expect(downloadBackendCatalogSource(BOOK)).rejects.toThrow("checksum mismatch");
    expect(mocks.deleted).toHaveBeenLastCalledWith(
      "file:///cache/narra-catalog-import/seagull-edition-1.epub",
      { idempotent: true },
    );
  });

  it("only cleans up files from the private catalog cache", async () => {
    await cleanupBackendCatalogSource("file:///documents/user-book.epub");
    expect(mocks.deleted).not.toHaveBeenCalled();
  });
});
