import type { Book } from "@readany/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";

const runtime = vi.hoisted(() => ({
  books: [] as Book[],
  request: vi.fn(),
  hash: vi.fn(async () => "a".repeat(64)),
  sourceBytes: new Uint8Array([60, 63, 120, 109, 108, 62]),
}));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: {
    getState: () => ({
      books: runtime.books,
      updateBook: async (id: string, update: Partial<Book>) => {
        runtime.books = runtime.books.map((book) =>
          book.id === id ? { ...book, ...update } : book,
        );
      },
    }),
  },
}));
vi.mock("@/stores/persist", () => ({
  withPersist: <T extends object>(_key: string, creator: StateCreator<T>) => creator,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    async bytes() {
      return runtime.sourceBytes;
    }
  },
}));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///documents/" }));
vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({
    getAppDataDir: async () => "file:///documents",
    joinPath: (a: string, b: string) => `${a}/${b}`,
  }),
}));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: runtime.hash }));
vi.mock("./backend-character-media", () => ({ loadBackendCharacterMedia: vi.fn(async () => {}) }));
vi.mock("./backend-book-api", async (original) => {
  const api = await original<typeof import("./backend-book-api")>();
  return {
    ...api,
    backendBookRequest: runtime.request,
    postBackendProgress: (id: string, progress: number, signal: AbortSignal) =>
      runtime.request(
        api.backendBookPath(id, "progress"),
        api.backendJsonPost({ progress_fraction: progress }, signal),
      ),
  };
});
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ consumeNarraGatewayResponse: vi.fn() }));

import { useNarraStore } from "@/stores/narra-store";
import { parseBackendManifest } from "./backend-book-contract";
import { retainBackendBookSync, startImportedBackendBook } from "./backend-book-sync";

const ready = {
  availability: "ready",
  markup: { revision: 1, text_length: 1000 },
  characters: [
    {
      character_key: "stable",
      name: "Name",
      full_name: "Full Name",
      provisional: false,
      state: "ready",
      profile: { role: "Role" },
    },
  ],
};
const book = (): Book => ({
  id: "local",
  filePath: "books/local.epub",
  format: "epub",
  meta: { title: "Book", author: "Author" },
  progress: 0.3,
  addedAt: 1,
  updatedAt: 1,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
});
const releases: (() => void)[] = [];
const initial = useNarraStore.getState();
beforeEach(() => {
  vi.useFakeTimers();
  runtime.books = [book()];
  runtime.hash.mockClear();
  runtime.request.mockReset();
  useNarraStore.setState({ ...initial, books: {} });
  runtime.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/manifest")) return ready;
    if (path.endsWith("/identity"))
      return { status: "ready", title: "Normalized", author: "Author" };
    return {};
  });
});
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
});
async function open(value: Book) {
  runtime.books = [value];
  releases.push(retainBackendBookSync(value));
  await vi.advanceTimersByTimeAsync(0);
}

describe("backend book import and persistence integration", () => {
  it.each([
    ["EN_us", "en"],
    ["ru-RU", "ru"],
    [undefined, undefined],
    ["not a language", undefined],
  ])("registers parser language %s and omits unknown values", async (language, expected) => {
    runtime.request
      .mockResolvedValueOnce({ resolution: "local_registration_required" })
      .mockResolvedValueOnce({
        resolution: "private",
        book_edition_id: "language-local",
        source_uploaded: true,
      });
    await open({ ...book(), meta: { ...book().meta, language } });
    const registration = runtime.request.mock.calls.find(([path]) => path === "/v2/books/local");
    expect(registration).toBeDefined();
    const payload = JSON.parse(registration?.[1].body);
    if (expected) expect(payload.language).toBe(expected);
    else expect(payload).not.toHaveProperty("language");
    // Older binding/manifest responses do not wipe file metadata.
    expect(runtime.books[0].meta.language).toBe(language);
  });

  it("retains explicit language from resolve and manifest in the local library", async () => {
    runtime.request.mockResolvedValueOnce({
      resolution: "catalog",
      book_edition_id: "language-catalog",
      language: "en",
    });
    await open(book());
    expect(runtime.books[0].meta.language).toBe("en");
    expect(useNarraStore.getState().books.local.backendBinding?.language).toBe("en");
    releases.pop()?.();
    runtime.request.mockResolvedValueOnce({}).mockResolvedValueOnce({ ...ready, language: "ru" });
    await open(runtime.books[0]);
    expect(runtime.books[0].meta.language).toBe("ru");
  });
  it("catalog open never resolves, registers, uploads or hashes; profiles persist before a portrait exists", async () => {
    await open({
      ...book(),
      sourceKind: "catalog",
      bookEditionId: "catalog-id",
      contentHash: "a".repeat(64),
    });
    expect(runtime.request.mock.calls.map((call) => call[0])).toEqual([
      "/v2/books/catalog-id/progress",
      "/v2/books/catalog-id/manifest",
    ]);
    expect(runtime.hash).not.toHaveBeenCalled();
    expect(useNarraStore.getState().books.local.characters[0]).toMatchObject({
      id: "stable",
      backendManaged: true,
    });
    expect(useNarraStore.getState().books.local.characters[0].portraitUri).toBeUndefined();
  });
  it("resolves a local file to catalog without uploading it", async () => {
    runtime.request.mockResolvedValueOnce({
      resolution: "catalog",
      book_edition_id: "catalog-id",
      catalog_key: "key",
    });
    await open(book());
    expect(runtime.hash).toHaveBeenCalledTimes(1);
    expect(runtime.books[0].sourceKind).toBe("catalog");
    expect(runtime.request.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(false);
    expect(runtime.request.mock.calls.some((call) => call[0] === "/v2/books/local")).toBe(false);
  });
  it("registers and uploads raw bytes once, then reuses the binding on reopen", async () => {
    runtime.request
      .mockResolvedValueOnce({ resolution: "local_registration_required" })
      .mockResolvedValueOnce({
        resolution: "private",
        book_edition_id: "private-id",
        source_uploaded: false,
      });
    await open(book());
    const upload = runtime.request.mock.calls.find((call) => call[1]?.method === "PUT");
    expect(upload?.[0]).toBe("/v2/books/private-id/source");
    expect(upload?.[1].body).toBe(runtime.sourceBytes);
    expect(upload?.[1].headers).toEqual({ "content-type": "application/epub+zip" });
    expect(useNarraStore.getState().books.local.backendBinding?.sourceUploaded).toBe(true);
    releases.pop()?.();
    await open(runtime.books[0]);
    expect(runtime.hash).toHaveBeenCalledTimes(1);
    expect(runtime.request.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
  });
  it("respects source_uploaded true and a registration race to catalog", async () => {
    runtime.request.mockResolvedValueOnce({
      resolution: "private",
      book_edition_id: "already-uploaded",
      source_uploaded: true,
    });
    await open(book());
    expect(runtime.request.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(false);
    releases.pop()?.();
    useNarraStore.setState({ books: {} });
    runtime.request.mockClear();
    runtime.request
      .mockResolvedValueOnce({ resolution: "local_registration_required" })
      .mockResolvedValueOnce({ resolution: "catalog", book_edition_id: "race-winner" });
    await open(book());
    expect(runtime.request.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(false);
  });
  it("resolves an uncertain prior upload before retrying source bytes", async () => {
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "private",
      bookEditionId: "uncertain",
      contentSha256: "a".repeat(64),
      sourceUploaded: false,
    });
    runtime.request.mockResolvedValueOnce({
      resolution: "private",
      book_edition_id: "uncertain",
      source_uploaded: true,
    });
    await open({ ...book(), contentHash: "a".repeat(64) });
    expect(runtime.request.mock.calls[0][0]).toBe("/v2/books/resolve");
    expect(runtime.request.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(false);
  });

  it("keeps an imported book alive after a transient error and retries automatically", async () => {
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "private",
      bookEditionId: "private-id",
      contentSha256: "a".repeat(64),
      sourceUploaded: true,
    });
    let manifestAttempts = 0;
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/manifest")) {
        manifestAttempts++;
        if (manifestAttempts === 1) throw new TypeError("offline");
        return ready;
      }
      if (path.endsWith("/identity"))
        return { status: "ready", title: "Normalized", author: "Author" };
      return {};
    });

    startImportedBackendBook(book());
    await vi.advanceTimersByTimeAsync(0);
    expect(manifestAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(manifestAttempts).toBe(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
  });

  it("retains the last confirmed profiles through processing and ignores older revisions", async () => {
    const store = useNarraStore.getState();
    store.applyBackendManifest("local", parseBackendManifest(ready), 0.3);
    const confirmed = useNarraStore.getState().books.local;
    store.applyBackendManifest(
      "local",
      parseBackendManifest({ ...ready, availability: "processing" }),
      0.3,
    );
    expect(useNarraStore.getState().books.local).toBe(confirmed);
    store.applyBackendManifest(
      "local",
      parseBackendManifest({ ...ready, markup: { revision: 0 } }),
      0.3,
    );
    expect(useNarraStore.getState().books.local).toBe(confirmed);
  });
  it("preserves an explicit portrait override and references on unchanged manifests", async () => {
    const store = useNarraStore.getState();
    const manifest = parseBackendManifest(ready);
    store.applyBackendManifest("local", manifest, 0.3);
    store.updateCharacter("local", "stable", {
      portraitUri: "file:///manual.png",
      portraitUriOverridesAsset: true,
    });
    store.applyBackendManifest("local", manifest, 0.3);
    const previous = useNarraStore.getState().books.local;
    store.applyBackendManifest("local", manifest, 0.3);
    expect(useNarraStore.getState().books.local).toBe(previous);
    expect(previous.characters[0].portraitUri).toBe("file:///manual.png");
  });
});
