import { beforeEach, describe, expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({
  endpoint: "https://api-test.narra.disrupt.builders",
  files: new Map<string, string>(),
  events: [] as string[],
}));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({
  getNarraGatewayConfig: () => ({ baseUrl: fs.endpoint }),
}));
vi.mock("@/lib/diagnostics/interaction-performance", () => ({ markInteraction: vi.fn() }));
vi.mock("@readany/core/services", () => ({ getPlatformService: vi.fn() }));
vi.mock("./backend-file-download", () => ({
  downloadVerifiedBackendFile: async ({ destinationPath }: { destinationPath: string }) => {
    fs.files.set(destinationPath, fs.endpoint);
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  readAsStringAsync: async (path: string) => {
    if (!fs.files.has(path)) throw new Error("missing");
    return fs.files.get(path);
  },
  writeAsStringAsync: async (path: string, value: string) => {
    fs.events.push(`write:${path}`);
    fs.files.set(path, value);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    fs.events.push(`move:${to}`);
    fs.files.set(to, fs.files.get(from)!);
    fs.files.delete(from);
  },
  deleteAsync: async (path: string) => {
    fs.events.push(`delete:${path}`);
    fs.files.delete(path);
  },
  getInfoAsync: async (path: string) => ({
    exists: fs.files.has(path),
    isDirectory: false,
    size: 42,
  }),
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async () => [],
}));
const metadata = (title: string) => ({
  books: [
    {
      resolution: "catalog" as const,
      bookEditionId: "same-id",
      catalogKey: "same-key",
      title,
      author: "QA",
      genres: [],
      format: "epub",
      contentSha256: "a".repeat(64),
      generationStatus: "ready",
      ready: true,
      sourceDownloadPath: "/v2/books/same-id/source",
    },
  ],
  genres: [],
  genreVersion: null,
  nextCursor: null,
});
beforeEach(() => {
  vi.resetModules();
  fs.files.clear();
  fs.events = [];
  fs.endpoint = "https://api-test.narra.disrupt.builders";
});
describe("catalog endpoint filesystem isolation", () => {
  it("keeps same-ID cover bytes separate and reuses TEST cover after returning", async () => {
    const book = {
      ...metadata("same").books[0],
      cover: {
        contentHash: "b".repeat(64),
        byteSize: 42,
        mimeType: "image/png" as const,
        downloadPath: "/v2/books/same-id/cover",
      },
    };
    const remote = await import("./backend-catalog-cache");
    const remotePath = (await remote.materializeBackendCatalogCover(book))!;
    expect(remotePath).toBe(
      `file:///documents/narra-backend-catalog/covers/same-key-${"b".repeat(64)}.png`,
    );
    const remoteBytes = fs.files.get(remotePath);
    fs.endpoint = "http://127.0.0.1:18787";
    vi.resetModules();
    const local = await import("./backend-catalog-cache");
    const localPath = (await local.materializeBackendCatalogCover(book))!;
    expect(localPath).not.toBe(remotePath);
    expect(fs.files.get(remotePath)).toBe(remoteBytes);
    expect(fs.files.get(localPath)).toBe(fs.endpoint);
    fs.endpoint = "https://api-test.narra.disrupt.builders";
    vi.resetModules();
    expect(
      await (await import("./backend-catalog-cache")).materializeBackendCatalogCover(book),
    ).toBe(remotePath);
    expect(fs.files.get(remotePath)).toBe(remoteBytes);
  });
  it("preserves TEST current and backup through LOCAL writes and a return to TEST", async () => {
    const remote = (await import("./backend-catalog-cache")).backendCatalogStorage;
    await remote.commit(metadata("TEST previous"), "remote1");
    await remote.commit(metadata("TEST current"), "remote2");
    const before = new Map(fs.files);
    fs.endpoint = "http://127.0.0.1:18787";
    vi.resetModules();
    const local = (await import("./backend-catalog-cache")).backendCatalogStorage;
    expect((await local.read()).complete).toBeNull();
    await local.commit(metadata("LOCAL"), "local1");
    for (const [path, bytes] of before) expect(fs.files.get(path)).toBe(bytes);
    fs.endpoint = "https://api-test.narra.disrupt.builders";
    // Existing local storage captures its endpoint even after configuration changes.
    await local.commit(metadata("LOCAL late"), "local2");
    vi.resetModules();
    const returned = (await import("./backend-catalog-cache")).backendCatalogStorage;
    expect((await returned.read()).complete?.books[0].title).toBe("TEST current");
    expect((await local.read()).complete?.books[0].title).toBe("LOCAL late");
    for (const [path, bytes] of before) expect(fs.files.get(path)).toBe(bytes);
    expect(fs.events.some((event) => event.includes("/local/"))).toBe(true);
  });
});
