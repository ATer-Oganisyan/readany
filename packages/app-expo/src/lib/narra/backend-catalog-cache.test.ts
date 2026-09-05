import { beforeEach, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  readFile: vi.fn(async () => new Uint8Array([1, 2])),
  getAppDataDir: vi.fn(async () => "/own"),
  joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async (_path: string, _bytes: Uint8Array) => {}),
  deleteFile: vi.fn(async (_path: string) => {}),
  sequence: 0,
}));
vi.mock("@readany/core/services", () => ({ getPlatformService: () => runtime }));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "/own/" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `unique-${++runtime.sequence}` }));
vi.mock("./backend-cache-scope", () => ({ backendCacheRoot: (path: string) => path }));
vi.mock("./backend-file-download", () => ({ downloadVerifiedBackendFile: vi.fn() }));
vi.mock("./catalog-storage", () => ({ createCatalogFileStorage: () => ({}) }));
vi.mock("@/lib/diagnostics/interaction-performance", () => ({ markInteraction: vi.fn() }));
import { type CachedBackendCatalogBook, installBackendCatalogCover } from "./backend-catalog-cache";
const book = {
  coverUri: "/cache/cover",
  cover: { mimeType: "image/jpeg" },
} as CachedBackendCatalogBook;
beforeEach(() => vi.clearAllMocks());
it("uses a different destination for each install so an old writer cannot overwrite a new cover", async () => {
  const first = await installBackendCatalogCover("book", book);
  const next = await installBackendCatalogCover("book", book);
  expect(first).not.toBe(next);
  expect(runtime.writeFile).toHaveBeenCalledTimes(2);
});
it("does not write when identity changes during the source read", async () => {
  let current = true;
  runtime.readFile.mockImplementationOnce(async () => {
    current = false;
    return new Uint8Array([1]);
  });
  expect(
    await installBackendCatalogCover("book", book, { isCurrent: () => current }),
  ).toBeUndefined();
  expect(runtime.writeFile).not.toHaveBeenCalled();
});
it("removes only its unique output when identity changes during writing", async () => {
  let current = true;
  runtime.writeFile.mockImplementationOnce(async () => {
    current = false;
  });
  expect(
    await installBackendCatalogCover("book", book, { isCurrent: () => current }),
  ).toBeUndefined();
  expect(runtime.deleteFile).toHaveBeenCalledExactlyOnceWith(runtime.writeFile.mock.calls[0][0]);
});
