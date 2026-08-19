import type { Book } from "@readany/core/types";
import { describe, expect, it, vi } from "vitest";
import type { BackendBookBinding, BackendBookManifest } from "./backend-book-api";
import {
  type BackendBookCoordinatorApi,
  type BackendBookCoordinatorFiles,
  type BackendBookCoordinatorState,
  createBackendBookCoordinator,
  shouldRefreshBackendManifest,
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
  isBackendManifestCharacterReached: vi.fn(
    (character: { firstAppearanceTextOffset: number }, textLength: number, progress: number) =>
      Number.isFinite(textLength)
        ? character.firstAppearanceTextOffset <= textLength * progress
        : true,
  ),
  loadCachedBackendCharacters: vi.fn(async () => []),
  projectBackendManifestCharacters: vi.fn(() => []),
  persistBackendManifestCharacters: vi.fn(async () => undefined),
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
    async uploadSource() {
      calls.push("upload");
      return {
        resolution: "private",
        bookEditionId: "edition-1",
        contentSha256: HASH,
        generationStatus: "marking_up",
        ready: false,
        sourceUploaded: true,
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
    async readSource() {
      calls.push("read-source");
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: "application/epub+zip" };
    },
    async loadCached() {
      return [];
    },
    project() {
      calls.push("project");
      return characters;
    },
    async persist() {
      calls.push("persist");
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
    updateCharacterMedia() {
      calls.push("update-character-media");
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
  it("keeps refreshing while canonical character media is preparing", () => {
    expect(
      shouldRefreshBackendManifest({
        source: "v3",
        availability: "ready",
        readerTextOffset: 100,
        readingFraction: 0.1,
        characters: [
          {
            characterKey: "egor",
            name: "Егор",
            fullName: "Егор",
            firstAppearanceTextOffset: 0,
            state: "preparing",
            profile: {},
            bundle: null,
          },
        ],
      }),
    ).toBe(true);
  });

  it("stops refreshing only when markup and visible media are ready", () => {
    expect(
      shouldRefreshBackendManifest({
        source: "v3",
        availability: "ready",
        readerTextOffset: 100,
        readingFraction: 0.1,
        characters: [
          {
            characterKey: "egor",
            name: "Егор",
            fullName: "Егор",
            firstAppearanceTextOffset: 0,
            state: "ready",
            profile: {},
            bundle: { version: "v1", assets: [] },
          },
        ],
      }),
    ).toBe(false);
  });

  it("ignores preparation state of characters beyond local reader progress", () => {
    const manifest: BackendBookManifest = {
      source: "v3",
      availability: "ready",
      readerTextOffset: 100,
      readingFraction: 0.1,
      textLength: 1_000,
      characters: [
        {
          characterKey: "visible",
          name: "Видимый",
          fullName: "Видимый",
          firstAppearanceTextOffset: 50,
          state: "ready",
          profile: {},
          bundle: { version: "v1", assets: [] },
        },
        {
          characterKey: "future",
          name: "Будущий",
          fullName: "Будущий",
          firstAppearanceTextOffset: 900,
          state: "preparing",
          profile: {},
          bundle: null,
        },
      ],
    };

    expect(shouldRefreshBackendManifest(manifest, 0.1)).toBe(false);
    expect(shouldRefreshBackendManifest(manifest, 0.95)).toBe(true);
  });

  it("shares concurrent binding, uploads a private source once and starts canonical v3", async () => {
    const value = fixture();
    const coordinator = createBackendBookCoordinator(value);
    const [left, right] = await Promise.all([
      coordinator.ensureBinding(BOOK),
      coordinator.ensureBinding(BOOK),
    ]);
    expect(left.bookEditionId).toBe("edition-1");
    expect(right).toEqual(left);
    expect(value.calls.filter((call) => call === "describe")).toHaveLength(1);
    expect(value.calls).toEqual([
      "describe",
      "set-hash",
      "resolve",
      "register",
      "read-source",
      "upload",
      "set-binding",
    ]);
    expect((left as BackendBookBinding & { sourceUploaded?: boolean }).sourceUploaded).toBe(true);
  });

  it("keeps legacy local markup without publishing it as the default backend result", async () => {
    const value = fixture();
    const coordinator = createBackendBookCoordinator(value);
    await coordinator.syncLocalMarkup(BOOK, [{ id: "anna" } as NarraCharacter]);
    expect(value.calls).not.toContain("publish");
  });

  it("upgrades a persisted legacy private binding by uploading its source before manifest", async () => {
    const value = fixture();
    value.state.setBinding(BOOK.id, {
      resolution: "private",
      bookEditionId: "edition-1",
      contentSha256: HASH,
      generationStatus: "marking_up",
      ready: false,
    });
    value.calls.length = 0;

    await createBackendBookCoordinator(value).open({ ...BOOK, fileHash: HASH });

    expect(value.calls).toContain("upload");
    expect(value.calls.indexOf("upload")).toBeLessThan(value.calls.indexOf("manifest"));
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

  it("projects a refreshed manifest against the current cached media", async () => {
    const value = fixture();
    const cached = [{ id: "cached", portraitUri: "file:///cached.png" } as NarraCharacter];
    value.files.loadCached = vi.fn(async () => cached);
    value.state.getCharacters = () => cached;
    value.files.project = vi.fn(() => cached);

    await createBackendBookCoordinator(value).open(BOOK);

    expect(value.files.project).toHaveBeenCalledWith(expect.any(Object), cached);
  });

  it("keeps provisional scan characters out of the persisted Narra store", async () => {
    const value = fixture();
    value.api.manifest = vi.fn(async () => ({
      source: "v3" as const,
      availability: "processing" as const,
      readerTextOffset: 100,
      readingFraction: 0.1,
      textLength: 1_000,
      characters: [
        {
          characterKey: "provisional:jane",
          name: "Jane",
          fullName: "Jane",
          firstAppearanceTextOffset: 10,
          provisional: true,
          state: "preparing" as const,
          profile: { provisional: true },
          bundle: null,
        },
      ],
    }));
    value.files.project = vi.fn(() => [{ id: "provisional:jane" } as NarraCharacter]);
    value.files.persist = vi.fn(async () => undefined);
    value.files.materialize = vi.fn(async () => []);
    value.state.setCharacters = vi.fn();

    const manifest = await createBackendBookCoordinator(value).open(BOOK);

    expect(manifest?.characters[0]?.provisional).toBe(true);
    expect(value.files.project).not.toHaveBeenCalled();
    expect(value.state.setCharacters).not.toHaveBeenCalled();
    expect(value.files.persist).not.toHaveBeenCalled();
    expect(value.files.materialize).not.toHaveBeenCalled();
  });

  it("publishes manifest characters without waiting for media downloads", async () => {
    const value = fixture();
    const projectedCharacters = [
      { id: "taras", name: "Тарас Бульба", mediaState: "preparing" },
      { id: "ostap", name: "Остап", mediaState: "preparing" },
    ] as NarraCharacter[];
    let finishMedia!: (characters: NarraCharacter[]) => void;
    const mediaPending = new Promise<NarraCharacter[]>((resolve) => {
      finishMedia = resolve;
    });
    value.files.project = vi.fn(() => projectedCharacters);
    value.files.materialize = vi.fn(() => mediaPending);
    value.state.setCharacters = vi.fn();

    const opening = createBackendBookCoordinator(value).open(BOOK);
    let opened = false;
    void opening.then(() => {
      opened = true;
    });

    try {
      await vi.waitFor(() => expect(value.files.materialize).toHaveBeenCalledOnce());
      expect(value.state.setCharacters).toHaveBeenCalledWith(BOOK.id, projectedCharacters);
      await Promise.resolve();
      expect(opened).toBe(true);
    } finally {
      finishMedia(projectedCharacters);
      await opening;
      await vi.waitFor(() => expect(value.state.setCharacters).toHaveBeenCalledTimes(2));
    }
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

  it("synchronizes local reader progress before loading the full manifest", async () => {
    const value = fixture();

    await createBackendBookCoordinator(value).open({ ...BOOK, progress: 0.8 });

    expect(value.calls).toContain("advance:0.8:legacy:legacy");
    expect(value.calls.indexOf("advance:0.8:legacy:legacy")).toBeLessThan(
      value.calls.indexOf("manifest"),
    );
  });

  it("returns and records an empty processing manifest so the UI can keep polling", async () => {
    const value = fixture();
    const processing: BackendBookManifest = {
      source: "v3",
      availability: "processing",
      readerTextOffset: 0,
      readingFraction: null,
      characters: [],
    };
    value.api.manifest = vi.fn(async () => processing);

    const result = await createBackendBookCoordinator(value).open(BOOK);

    expect(result).toEqual(processing);
    expect(value.calls).toContain("set-source:v3");
    expect(value.calls).not.toContain("materialize");
  });
});
