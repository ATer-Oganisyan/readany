import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendCatalogBook } from "./backend-book-api";

const mocks = vi.hoisted(() => ({
  directories: new Set([
    "file:///documents/narra-backend-catalog",
    "file:///documents/narra-backend-catalog/covers",
    "file:///documents/narra-backend-catalog/pages",
  ]),
  files: new Map<string, { size: number; text?: string }>(),
  fetchCatalog: vi.fn(),
  requestUrl: vi.fn(async () => "https://storage.example/cover"),
  hash: vi.fn(async () => "b".repeat(64)),
  writeFile: vi.fn(),
  holdDownloads: false,
  activeDownloads: 0,
  maxActiveDownloads: 0,
  releaseDownloads: [] as Array<() => void>,
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  FileSystemSessionType: { BACKGROUND: 0 },
  async getInfoAsync(path: string) {
    if (mocks.directories.has(path)) return { exists: true, isDirectory: true, uri: path };
    const file = mocks.files.get(path);
    return file
      ? { exists: true, isDirectory: false, uri: path, size: file.size }
      : { exists: false, isDirectory: false, uri: path };
  },
  async makeDirectoryAsync(path: string) {
    mocks.directories.add(path);
  },
  createDownloadResumable(_url: string, path: string) {
    return {
      async downloadAsync() {
        mocks.activeDownloads += 1;
        mocks.maxActiveDownloads = Math.max(mocks.maxActiveDownloads, mocks.activeDownloads);
        try {
          if (mocks.holdDownloads) {
            await new Promise<void>((resolve) => mocks.releaseDownloads.push(resolve));
          }
          mocks.files.set(path, { size: 42 });
          return { status: 200, uri: path };
        } finally {
          mocks.activeDownloads -= 1;
        }
      },
    };
  },
  async deleteAsync(path: string) {
    if (mocks.directories.has(path)) {
      mocks.directories.delete(path);
      for (const file of [...mocks.files.keys()]) {
        if (file.startsWith(`${path}/`)) mocks.files.delete(file);
      }
    }
    mocks.files.delete(path);
  },
  async moveAsync({ from, to }: { from: string; to: string }) {
    const value = mocks.files.get(from);
    if (value) mocks.files.set(to, value);
    mocks.files.delete(from);
  },
  async writeAsStringAsync(path: string, text: string) {
    mocks.files.set(path, { size: text.length, text });
  },
  async readAsStringAsync(path: string) {
    const value = mocks.files.get(path)?.text;
    if (value === undefined) throw new Error("missing file");
    return value;
  },
}));
vi.mock("./backend-book-api", () => ({
  fetchBackendCatalogBooksPage: mocks.fetchCatalog,
  requestBackendDownloadUrl: mocks.requestUrl,
}));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: mocks.hash }));
vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getAppDataDir: vi.fn(async () => "file:///app"),
    joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
    mkdir: vi.fn(),
    writeFile: mocks.writeFile,
  }),
}));

import {
  installBackendCatalogCover,
  loadCachedBackendCatalog,
  loadCachedBackendCatalogPage,
  materializeBackendCatalogCover,
  refreshBackendCatalog,
  refreshBackendCatalogPage,
} from "./backend-catalog-cache";

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
  cover: {
    contentHash: "b".repeat(64),
    mimeType: "image/jpeg",
    byteSize: 42,
    downloadPath: "/v2/books/edition-1/cover/download",
  },
};

describe("backend catalog cache", () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.directories.clear();
    mocks.directories.add("file:///documents/narra-backend-catalog");
    mocks.directories.add("file:///documents/narra-backend-catalog/covers");
    mocks.directories.add("file:///documents/narra-backend-catalog/pages");
    mocks.fetchCatalog.mockReset();
    mocks.fetchCatalog.mockResolvedValue({ books: [BOOK], nextCursor: null });
    mocks.requestUrl.mockClear();
    mocks.hash.mockClear();
    mocks.writeFile.mockClear();
    mocks.holdDownloads = false;
    mocks.activeDownloads = 0;
    mocks.maxActiveDownloads = 0;
    for (const release of mocks.releaseDownloads.splice(0)) release();
  });

  it("returns catalog metadata before downloading a requested cover", async () => {
    const refreshed = await refreshBackendCatalog();
    expect(refreshed[0]?.coverUri).toBeUndefined();
    expect(mocks.requestUrl).not.toHaveBeenCalled();

    const coverUri = await materializeBackendCatalogCover(BOOK);
    expect(coverUri).toContain("narra-backend-catalog/covers/seagull-");
    expect(mocks.requestUrl).toHaveBeenCalledWith(BOOK.cover?.downloadPath);

    const cached = await loadCachedBackendCatalog();
    expect(cached).toEqual([expect.objectContaining({ catalogKey: "seagull", coverUri })]);
    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("stores and reads catalog pages independently", async () => {
    const secondBook = {
      ...BOOK,
      bookEditionId: "edition-2",
      catalogKey: "second-book",
      title: "Вторая книга",
    };
    mocks.fetchCatalog
      .mockResolvedValueOnce({ books: [BOOK], nextCursor: "cursor-2" })
      .mockResolvedValueOnce({ books: [secondBook], nextCursor: null });

    await refreshBackendCatalogPage({ limit: 24, reset: true });
    await refreshBackendCatalogPage({ limit: 24, cursor: "cursor-2" });

    await expect(loadCachedBackendCatalogPage()).resolves.toEqual({
      books: [expect.objectContaining({ bookEditionId: "edition-1" })],
      nextCursor: "cursor-2",
    });
    await expect(loadCachedBackendCatalogPage("cursor-2")).resolves.toEqual({
      books: [expect.objectContaining({ bookEditionId: "edition-2" })],
      nextCursor: null,
    });
    await expect(loadCachedBackendCatalog()).resolves.toEqual([
      expect.objectContaining({ bookEditionId: "edition-1" }),
      expect.objectContaining({ bookEditionId: "edition-2" }),
    ]);
  });

  it("copies the cached cover into the persistent library location", async () => {
    await refreshBackendCatalog();
    const coverUri = await materializeBackendCatalogCover(BOOK);
    if (!coverUri) throw new Error("catalog cover was not materialized");
    const cached = { ...BOOK, coverUri };
    await expect(installBackendCatalogCover("local-book", cached)).resolves.toBe(
      "covers/local-book-catalog.jpg",
    );
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });

  it("materializes the cover before import when lazy loading has not finished", async () => {
    await expect(installBackendCatalogCover("local-book", BOOK)).resolves.toBe(
      "covers/local-book-catalog.jpg",
    );
    expect(mocks.requestUrl).toHaveBeenCalledWith(BOOK.cover?.downloadPath);
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });

  it("limits visible cover downloads to three concurrent requests", async () => {
    const books = Array.from({ length: 5 }, (_, index) => ({
      ...BOOK,
      bookEditionId: `edition-${index}`,
      catalogKey: `book-${index}`,
    }));
    mocks.holdDownloads = true;

    const downloads = books.map((book) => materializeBackendCatalogCover(book));
    await vi.waitFor(() => expect(mocks.activeDownloads).toBe(3));
    expect(mocks.maxActiveDownloads).toBe(3);

    mocks.holdDownloads = false;
    for (const release of mocks.releaseDownloads.splice(0)) release();
    await Promise.all(downloads);

    expect(mocks.requestUrl).toHaveBeenCalledTimes(5);
    expect(mocks.maxActiveDownloads).toBe(3);
  });
});
