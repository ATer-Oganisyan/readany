import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendCatalogBook } from "./backend-book-api";

const mocks = vi.hoisted(() => ({
  directories: new Set([
    "file:///documents/narra-backend-catalog",
    "file:///documents/narra-backend-catalog/covers",
  ]),
  files: new Map<string, { size: number; text?: string }>(),
  fetchCatalog: vi.fn(),
  requestUrl: vi.fn(async () => "https://storage.example/cover"),
  hash: vi.fn(async () => "b".repeat(64)),
  writeFile: vi.fn(),
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
        mocks.files.set(path, { size: 42 });
        return { status: 200, uri: path };
      },
    };
  },
  async deleteAsync(path: string) {
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
  fetchBackendCatalogBooks: mocks.fetchCatalog,
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
  refreshBackendCatalog,
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
    mocks.fetchCatalog.mockReset();
    mocks.fetchCatalog.mockResolvedValue([BOOK]);
    mocks.requestUrl.mockClear();
    mocks.hash.mockClear();
    mocks.writeFile.mockClear();
  });

  it("persists catalog metadata and a verified cover for offline use", async () => {
    const refreshed = await refreshBackendCatalog();
    expect(refreshed[0]?.coverUri).toContain("narra-backend-catalog/covers/seagull-");
    expect(mocks.requestUrl).toHaveBeenCalledWith(BOOK.cover?.downloadPath);

    const cached = await loadCachedBackendCatalog();
    expect(cached).toEqual([
      expect.objectContaining({ catalogKey: "seagull", coverUri: refreshed[0]?.coverUri }),
    ]);
    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("copies the cached cover into the persistent library location", async () => {
    const [cached] = await refreshBackendCatalog();
    expect(cached).toBeDefined();
    if (!cached) throw new Error("catalog cache is empty");
    await expect(installBackendCatalogCover("local-book", cached)).resolves.toBe(
      "covers/local-book-catalog.jpg",
    );
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });
});
