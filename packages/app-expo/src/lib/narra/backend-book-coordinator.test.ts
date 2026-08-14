import type { Book } from "@readany/core/types";
import { describe, expect, it, vi } from "vitest";
import type { BackendBookBinding, BackendBookManifest } from "./backend-book-api";
import {
  type BackendBookCoordinatorApi,
  type BackendBookCoordinatorFiles,
  type BackendBookCoordinatorState,
  createBackendBookCoordinator,
} from "./backend-book-coordinator";
import type { NarraCharacter } from "./types";

vi.mock("@/stores/library-store", () => ({
  useLibraryStore: { getState: () => ({ updateBook: vi.fn() }) },
}));
vi.mock("@/stores/narra-store", () => ({
  useNarraStore: {
    getState: () => ({ books: {}, setBackendBinding: vi.fn(), setCharacters: vi.fn() }),
  },
}));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));
vi.mock("@readany/core/services", () => ({ getPlatformService: vi.fn() }));
vi.mock("./backend-book-cache", () => ({
  loadCachedBackendCharacters: vi.fn(async () => []),
  materializeBackendManifest: vi.fn(async () => []),
}));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: vi.fn() }));

const HASH = "a".repeat(64);
const BOOK: Book = {
  id: "local-book",
  filePath: "books/local-book.epub",
  format: "epub",
  meta: { title: "Book", author: "Author" },
  addedAt: 1,
  updatedAt: 1,
  progress: 0,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
};

function fixture() {
  let binding: BackendBookBinding | undefined;
  const calls: string[] = [];
  const characters: NarraCharacter[] = [];
  const manifest: BackendBookManifest = {
    source: "v2",
    availability: "ready",
    readerTextOffset: 100,
    readingFraction: 0.1,
    textLength: 1_000,
    revision: 1,
    characters: [],
  };
  const api: BackendBookCoordinatorApi = {
    async resolve() {
      calls.push("resolve");
      return { resolution: "local_registration_required", contentSha256: HASH, ready: false };
    },
    async register() {
      calls.push("register");
      return {
        resolution: "private",
        bookEditionId: "edition-1",
        contentSha256: HASH,
        ready: false,
      };
    },
    async publish() {
      calls.push("publish");
      return {
        resolution: "private",
        bookEditionId: "edition-1",
        contentSha256: HASH,
        generationStatus: "base_ready",
        ready: true,
      };
    },
    async advance(_editionId, offset, _chapterKey, sectionPosition) {
      calls.push(
        `advance:${offset}:${sectionPosition?.sectionIndex ?? "legacy"}:${sectionPosition?.sectionFraction ?? "legacy"}`,
      );
    },
    async manifest() {
      calls.push("manifest");
      return manifest;
    },
  };
  const files: BackendBookCoordinatorFiles = {
    async describe() {
      calls.push("describe");
      return { contentSha256: HASH };
    },
    async loadCached() {
      return [];
    },
    async materialize() {
      calls.push("materialize");
      return characters;
    },
  };
  const state: BackendBookCoordinatorState = {
    getBinding() {
      return binding;
    },
    getCharacters() {
      return characters;
    },
    setBinding(_bookId, value) {
      binding = value;
      calls.push("set-binding");
    },
    setCharacters() {
      calls.push("set-characters");
    },
    setManifestSource(_bookId, source) {
      calls.push(`set-source:${source}`);
    },
    async updateBookHash() {
      calls.push("set-hash");
    },
    reportError(_scope, error) {
      throw error;
    },
  };
  return { api, files, state, calls, getBinding: () => binding };
}

describe("backend book coordinator", () => {
  it("shares concurrent binding and registers a local-only book only once", async () => {
    const value = fixture();
    const coordinator = createBackendBookCoordinator(value);
    const [left, right] = await Promise.all([
      coordinator.ensureBinding(BOOK),
      coordinator.ensureBinding(BOOK),
    ]);
    expect(left.bookEditionId).toBe("edition-1");
    expect(right).toEqual(left);
    expect(value.calls.filter((call) => call === "describe")).toHaveLength(1);
    expect(value.calls).toEqual(["describe", "set-hash", "resolve", "register", "set-binding"]);
  });

  it("publishes derived characters without uploading the source book", async () => {
    const value = fixture();
    const coordinator = createBackendBookCoordinator(value);
    await coordinator.syncLocalMarkup(BOOK, [{ id: "anna" } as NarraCharacter]);
    expect(value.calls).toContain("publish");
    expect(value.calls).not.toContain("upload");
  });

  it("coalesces reader events to the greatest reading fraction", async () => {
    const value = fixture();
    const coordinator = createBackendBookCoordinator({ ...value, debounceMs: 60_000 });
    coordinator.queueProgress(BOOK, 0.12, "chapter-2", {
      sectionIndex: 2,
      sectionFraction: 0.5,
    });
    coordinator.queueProgress(BOOK, 0.08, "chapter-1");
    await coordinator.flush(BOOK.id);
    expect(value.calls).toContain("advance:0.12:2:0.5");
    expect(value.calls.indexOf("advance:0.12:2:0.5")).toBeLessThan(value.calls.indexOf("manifest"));
  });

  it("restores cached characters before a network refresh", async () => {
    const value = fixture();
    value.files.loadCached = vi.fn(async () => [{ id: "cached" } as NarraCharacter]);
    await createBackendBookCoordinator(value).open(BOOK);
    expect(value.calls[0]).toBe("set-characters");
  });

  it("drops legacy local profiles after a book is identified as catalog content", async () => {
    const value = fixture();
    const setCharacters = vi.fn();
    value.state.getCharacters = () => [{ id: "legacy" } as NarraCharacter];
    value.state.setCharacters = setCharacters;
    value.state.setBinding("local-book", {
      resolution: "catalog",
      bookEditionId: "catalog-edition",
      contentSha256: HASH,
      ready: true,
    });
    await createBackendBookCoordinator(value).open({ ...BOOK, fileHash: HASH });
    expect(setCharacters).toHaveBeenCalledWith("local-book", []);
  });

  it("always loads the canonical manifest without a preview selector", async () => {
    const value = fixture();
    value.api.manifest = vi.fn(async () => ({
      source: "v3" as const,
      availability: "ready" as const,
      readerTextOffset: 100,
      readingFraction: 0.1,
      characters: [],
    }));
    await createBackendBookCoordinator(value).open(BOOK);
    expect(value.api.manifest).toHaveBeenCalledWith("edition-1");
    expect(value.calls).toContain("set-source:v3");
  });
});
