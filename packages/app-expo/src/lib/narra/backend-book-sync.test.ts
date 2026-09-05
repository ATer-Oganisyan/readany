import { createHash } from "node:crypto";
import type { Book } from "@readany/core/types";
import { buildStoreOnlyZip } from "@readany/core/utils/store-only-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";

const runtime = vi.hoisted(() => ({
  books: [] as Book[],
  request: vi.fn(),
  hash: vi.fn(async () => "a".repeat(64)),
  media: vi.fn(async () => {}),
  sourceBytes: new Uint8Array([60, 63, 120, 109, 108, 62]),
  files: new Map<string, Uint8Array>(),
  missingFiles: new Set<string>(),
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
      if (runtime.missingFiles.has(this.uri)) throw new Error("File does not exist");
      return runtime.files.get(this.uri) ?? runtime.sourceBytes;
    }
    get exists() {
      return !runtime.missingFiles.has(this.uri);
    }
    get size() {
      return (runtime.files.get(this.uri) ?? runtime.sourceBytes).length;
    }
    slice(start = 0, end = this.size) {
      return new Blob([new Uint8Array(runtime.files.get(this.uri) ?? runtime.sourceBytes)]).slice(
        start,
        end,
      );
    }
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { Base64: "base64" },
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: async (uri: string, data: string) => {
    runtime.files.set(uri, new Uint8Array(Buffer.from(data, "base64")));
  },
  deleteAsync: async (uri: string) => {
    runtime.files.delete(uri);
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "22222222-2222-4222-8222-222222222222" }));
vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({
    getAppDataDir: async () => "file:///documents",
    joinPath: (a: string, b: string) => `${a}/${b}`,
  }),
}));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: runtime.hash }));
vi.mock("./backend-character-media", () => ({
  loadBackendCharacterMedia: runtime.media,
}));
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
    postBackendAnalysisRetry: (id: string, requestId: string, signal?: AbortSignal) =>
      runtime.request(
        api.backendBookPath(id, "analysis/retry"),
        api.backendJsonPost({ request_id: requestId }, signal),
      ),
  };
});
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ consumeNarraGatewayResponse: vi.fn() }));

import { useNarraStore } from "@/stores/narra-store";
import { BackendBookError } from "./backend-book-api";
import { parseBackendManifest } from "./backend-book-contract";
import {
  retainBackendBookSync,
  retryBackendBookAnalysis,
  retryBackendBookSync,
  startImportedBackendBook,
  updateBackendBookProgress,
  useBackendBookStatus,
} from "./backend-book-sync";
import { characterBiography } from "./character-profile";
import { backendSceneMarkupIdentity } from "./backend-scene-identity";

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
  runtime.files.clear();
  runtime.missingFiles.clear();
  runtime.hash.mockClear();
  runtime.request.mockReset();
  runtime.media.mockClear();
  useNarraStore.setState({ ...initial, books: {} });
  useBackendBookStatus.setState({ books: {} });
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
  it("clears already visible preview and starts the replacement edition without reopening", async () => {
    runtime.request.mockImplementation(async (path: string) => {
      if (path === "/v2/books/new-edition/manifest") return ready;
      if (path.endsWith("/manifest")) return { availability: "processing", characters_status: "preview_ready", characters: [] };
      if (path.endsWith("/characters/preview")) return {
        contract_version: "book-characters-preview-v1", book_edition_id: "catalog-id", status: "preview_ready",
        poll_after_ms: 1000, characters: [{ character_key: "old", name: "Old", full_name: "", provisional: true,
          state: "preparing", profile: { provisional: true }, bundle: null }],
      };
      return {};
    });
    await open({ ...book(), sourceKind: "catalog", bookEditionId: "catalog-id", contentHash: "a".repeat(64) });
    expect(useBackendBookStatus.getState().books.local.preview?.characters[0].name).toBe("Old");
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "catalog", bookEditionId: "new-edition", contentSha256: "b".repeat(64), sourceUploaded: true,
    });
    expect(useBackendBookStatus.getState().books.local?.preview).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.request.mock.calls.some(([path]) => path === "/v2/books/new-edition/manifest")).toBe(true);
    expect(useNarraStore.getState().books.local.characters[0]?.id).toBe("stable");
    releases.pop()?.();
    runtime.request.mockClear();
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "catalog", bookEditionId: "third-edition", contentSha256: "c".repeat(64), sourceUploaded: true,
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(runtime.request).not.toHaveBeenCalled();
    expect(useBackendBookStatus.getState().books.local).toBeUndefined();
  });
  it.each(["edition", "hash", "deleted"])("ignores pending character preview after %s changes", async (change) => {
    let finish!: (value: unknown) => void;
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/manifest")) return { availability: "processing", characters_status: "preview_ready",
        analysis: { run_id: "run-old", stage: "scan", status: "running" }, characters: [] };
      if (path.endsWith("/characters/preview")) return new Promise((resolve) => { finish = resolve; });
      return {};
    });
    await open({ ...book(), sourceKind: "catalog", bookEditionId: "catalog-id", contentHash: "a".repeat(64) });
    expect(finish).toBeTypeOf("function");
    if (change === "deleted") runtime.books = [];
    else useNarraStore.getState().setBackendBinding("local", {
      ...useNarraStore.getState().books.local.backendBinding!,
      ...(change === "edition" ? { bookEditionId: "new-edition" } : { contentSha256: "b".repeat(64) }),
    });
    finish({ contract_version: "book-characters-preview-v1", book_edition_id: "catalog-id",
      status: "preview_ready", run_id: "run-old", poll_after_ms: 1000,
      characters: [{ character_key: "old", name: "Старый герой", full_name: "", provisional: true,
        state: "preparing", profile: { provisional: true }, bundle: null }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(useBackendBookStatus.getState().books.local?.preview).toBeUndefined();
  });
  it.each(["resolve", "source"])("does not replace a newer binding after delayed %s", async (phase) => {
    let finish!: (value: unknown) => void;
    const oldResponse = { resolution: "private", book_edition_id: "old-edition", source_uploaded: phase === "resolve" };
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith(`/${phase}`)) return new Promise((resolve) => { finish = resolve; });
      if (path.endsWith("/resolve")) return oldResponse;
      if (path.endsWith("/manifest")) return ready;
      return {};
    });
    await open({ ...book(), contentHash: "a".repeat(64) });
    expect(finish).toBeTypeOf("function");
    const replacement = { resolution: "private" as const, bookEditionId: "new-edition", contentSha256: "b".repeat(64), sourceUploaded: true };
    useNarraStore.getState().setBackendBinding("local", replacement);
    finish(phase === "resolve" ? oldResponse : {});
    await vi.advanceTimersByTimeAsync(0);
    expect(useNarraStore.getState().books.local.backendBinding).toEqual(replacement);
    expect(useBackendBookStatus.getState().books.local?.error).toBeUndefined();
  });
  it.each(["deleted", "changed-bytes"])("discards resolve after local source is %s without a replacement binding", async (change) => {
    let finish!: (value: unknown) => void;
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/resolve")) return new Promise((resolve) => { finish = resolve; });
      return {};
    });
    await open({ ...book(), contentHash: "a".repeat(64) });
    expect(finish).toBeTypeOf("function");
    runtime.books = change === "deleted" ? [] : [{ ...runtime.books[0], contentHash: "b".repeat(64) }];
    finish({ resolution: "private", book_edition_id: "stale", source_uploaded: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(useNarraStore.getState().books.local?.backendBinding).toBeUndefined();
    expect(runtime.request.mock.calls.some(([path]) => path.endsWith("/source"))).toBe(false);
    expect(useBackendBookStatus.getState().books.local?.error).toBeUndefined();
  });
  it.each(["ready", "failed", "network-error"])("ignores a delayed %s identity after source replacement", async (resultStatus) => {
    const binding = { resolution: "private" as const, bookEditionId: "old-edition",
      contentSha256: "a".repeat(64), sourceUploaded: true };
    useNarraStore.getState().setBackendBinding("local", binding);
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/identity")) return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      if (path.endsWith("/manifest")) return ready;
      return {};
    });
    await open(book());
    expect(finish).toBeTypeOf("function");
    useNarraStore.getState().setBackendBinding("local", {
      ...binding, bookEditionId: "new-edition", contentSha256: "b".repeat(64),
    });
    if (resultStatus === "network-error") fail(new Error("Old network failure"));
    else finish({ status: resultStatus, title: "Old source title", author: "Old author", error_code: "OLD_FAILURE" });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.books[0].meta.title).toBe("Book");
    expect(useBackendBookStatus.getState().books.local?.identityError).toBeUndefined();
    expect(useBackendBookStatus.getState().books.local?.error).toBeUndefined();
  });
  it.each(["edition-a", "edition-b"])(
    "isolates changed source bytes and restores conversations (%s)",
    (edition) => {
      const store = useNarraStore.getState();
      const a = {
        resolution: "private" as const,
        bookEditionId: "edition-a",
        contentSha256: "a".repeat(64),
        sourceUploaded: true,
      };
      const b = { ...a, bookEditionId: edition, contentSha256: "b".repeat(64) };
      store.setBackendBinding("local", a);
      store.applyBackendManifest(
        "local",
        parseBackendManifest({ ...ready, markup: { revision: 9 } }),
        0.3,
      );
      store.appendChatMessage("local", "stable", {
        id: "a-message",
        role: "user",
        content: "Only A",
        createdAt: 1,
      });
      store.setMemory("local", "stable", "Memory A");
      store.setBackendBinding("local", b);
      expect(useNarraStore.getState().books.local.characters).toEqual([]);
      expect(useNarraStore.getState().books.local.chats).toEqual({});
      expect(useNarraStore.getState().books.local.memories).toEqual({});
      store.applyBackendManifest("local", parseBackendManifest(ready), 0.3);
      expect(useNarraStore.getState().books.local.backendManifest?.revision).toBe(1);
      store.appendChatMessage("local", "stable", {
        id: "b-message",
        role: "user",
        content: "Only B",
        createdAt: 2,
      });
      store.setMemory("local", "stable", "Memory B");
      // Persisted state must survive an ordinary JSON round trip without nesting
      // archives or retaining a second copy of the active content.
      useNarraStore.setState({ books: JSON.parse(JSON.stringify(useNarraStore.getState().books)) });
      const archived = useNarraStore.getState().books.local.backendContentArchives;
      expect(Object.keys(archived ?? {})).toEqual([a.contentSha256]);
      expect(archived?.[a.contentSha256]).not.toHaveProperty("backendContentArchives");
      store.setBackendBinding("local", { ...a, bookEditionId: "edition-a-renewed" });
      expect(
        useNarraStore.getState().books.local.chats.stable.map((message) => message.id),
      ).toEqual(["a-message"]);
      expect(useNarraStore.getState().books.local.memories.stable).toBe("Memory A");
      expect(useNarraStore.getState().books.local.backendManifest).toBeUndefined();
      store.setBackendBinding("local", b);
      expect(
        useNarraStore.getState().books.local.chats.stable.map((message) => message.id),
      ).toEqual(["b-message"]);
      expect(useNarraStore.getState().books.local.memories.stable).toBe("Memory B");
      expect(
        Object.keys(useNarraStore.getState().books.local.backendContentArchives ?? {}),
      ).toEqual([a.contentSha256]);
    },
  );
  it.each(["same", "wire", "edition", "source"])(
    "manifest completion belongs to its captured binding (%s)",
    async (change) => {
      const binding = {
        resolution: "catalog" as const,
        bookEditionId: "edition-a",
        contentSha256: "a".repeat(64),
        sourceUploaded: true,
      };
      useNarraStore.getState().setBackendBinding("local", binding);
      let resolveManifest!: (value: unknown) => void;
      runtime.request.mockImplementation(async (path: string) =>
        path.endsWith("/manifest")
          ? new Promise((resolve) => {
              resolveManifest = resolve;
            })
          : {},
      );
      await open({
        ...book(),
        sourceKind: "catalog",
        bookEditionId: binding.bookEditionId,
        contentHash: binding.contentSha256,
      });
      expect(resolveManifest).toBeTypeOf("function");
      const switched = change === "edition" || change === "source";
      if (switched)
        useNarraStore.getState().setBackendBinding("local", {
          ...binding,
          bookEditionId: change === "edition" ? "edition-b" : binding.bookEditionId,
          contentSha256: change === "source" ? "b".repeat(64) : binding.contentSha256,
        });
      const before = useNarraStore.getState().books.local;
      const beforeStatus = useBackendBookStatus.getState().books.local;
      resolveManifest({
        ...ready,
        language: "en",
        ...(change === "wire"
          ? {
              book: {
                book_edition_id: binding.bookEditionId,
                content_sha256: binding.contentSha256,
              },
            }
          : {}),
      }); // Legacy response provenance must come from request.
      await vi.advanceTimersByTimeAsync(0);
      if (!switched) {
        expect(useNarraStore.getState().books.local.characters[0]?.id).toBe("stable");
        expect(useBackendBookStatus.getState().books.local.manifest?.availability).toBe("ready");
        expect(runtime.books[0].meta.language).toBe("en");
      } else {
        expect(useNarraStore.getState().books.local).toBe(before);
        expect(useBackendBookStatus.getState().books.local).toBe(beforeStatus);
        expect(runtime.books[0].meta.language).toBeUndefined();
        expect(runtime.media).not.toHaveBeenCalled();
      }
    },
  );
  it("does not republish a session's cached manifest after external binding replacement", async () => {
    const binding = {
      resolution: "catalog" as const,
      bookEditionId: "edition-a",
      contentSha256: "a".repeat(64),
      sourceUploaded: true,
    };
    useNarraStore.getState().setBackendBinding("local", binding);
    await open({
      ...book(),
      sourceKind: "catalog",
      bookEditionId: binding.bookEditionId,
      contentHash: binding.contentSha256,
    });
    expect(useNarraStore.getState().books.local.backendManifest?.availability).toBe("ready");
    // Keep the replacement response pending: this test concerns the old cache,
    // not the independently tested successful publication of the new edition.
    runtime.request.mockImplementation(async (path: string) => {
      if (path === "/v2/books/edition-b/manifest") return new Promise(() => {});
      return {};
    });
    useNarraStore.getState().setBackendBinding("local", { ...binding, bookEditionId: "edition-b" });
    const before = useNarraStore.getState().books.local;
    const beforeStatus = useBackendBookStatus.getState().books.local;
    runtime.media.mockClear();
    updateBackendBookProgress("local", 0.6);
    await vi.advanceTimersByTimeAsync(0);
    expect(useNarraStore.getState().books.local).toBe(before);
    expect(useBackendBookStatus.getState().books.local).toBe(beforeStatus);
    expect(runtime.media).not.toHaveBeenCalled();
  });
  it.each(["missing", "empty"])(
    "recovers a %s derived FB2 from the retained original archive before re-upload",
    async (failure) => {
      const xml = new TextEncoder().encode(
        "<FictionBook><description><title-info><book-title>Book</book-title></title-info></description><body><section><p>Анна читает.</p></section></body></FictionBook>",
      );
      const archive = buildStoreOnlyZip([{ name: "nested/book.fb2", data: xml }]);
      const archiveHash = createHash("sha256").update(archive).digest("hex");
      const xmlHash = createHash("sha256").update(xml).digest("hex");
      const value = {
        ...book(),
        format: "fbz" as const,
        filePath: "books/recovery.fbz",
        fileHash: archiveHash,
        contentHash: archiveHash,
      };
      runtime.files.set("file:///documents/books/recovery.fbz", archive);
      if (failure === "missing") runtime.missingFiles.add("file:///documents/derived.fb2");
      else runtime.files.set("file:///documents/derived.fb2", new Uint8Array());
      useNarraStore.getState().setBackendOriginalSource("local", {
        path: "derived.fb2",
        format: "fb2",
        hash: xmlHash,
        derivedFrom: { filePath: value.filePath, contentHash: archiveHash },
      });
      useNarraStore.getState().setBackendBinding("local", {
        resolution: "private",
        bookEditionId: "derived-edition",
        contentSha256: xmlHash,
        sourceUploaded: false,
      });
      runtime.hash.mockImplementationOnce(async (path?: string) => {
        const bytes = runtime.files.get(path ?? "");
        if (!bytes) throw new Error("Missing actual derived file");
        return createHash("sha256").update(bytes).digest("hex");
      });
      runtime.request.mockResolvedValueOnce({
        resolution: "private",
        book_edition_id: "derived-edition",
        source_uploaded: false,
      });
      await open(value);
      const upload = runtime.request.mock.calls.find((call) => call[1]?.method === "PUT");
      expect(upload?.[1].body).toEqual(xml);
      expect(upload?.[1].headers).toEqual({ "content-type": "application/x-fictionbook+xml" });
      expect(useNarraStore.getState().books.local.backendOriginalSource?.path).not.toBe(
        "derived.fb2",
      );
      expect(useNarraStore.getState().books.local.backendBinding?.sourceUploaded).toBe(true);
      expect(runtime.books[0]).toMatchObject({
        filePath: value.filePath,
        contentHash: archiveHash,
      });
    },
  );
  it.each(["story.fbz", "story.fb2.zip"])(
    "normalizes %s to exact FB2 bytes without replacing archive identity",
    async (name) => {
      const xml = new TextEncoder().encode(
        "<FictionBook><description><title-info><book-title>Book</book-title></title-info></description><body><section><p>Анна читает.</p></section></body></FictionBook>",
      );
      const archive = buildStoreOnlyZip([{ name: "nested/book.fb2", data: xml }]);
      const archiveHash = createHash("sha256").update(archive).digest("hex");
      const xmlHash = createHash("sha256").update(xml).digest("hex");
      const value = {
        ...book(),
        format: "fbz" as const,
        filePath: `books/${name}`,
        contentHash: archiveHash,
      };
      runtime.files.set(`file:///documents/books/${name}`, archive);
      useNarraStore.getState().setBackendOriginalSource("local", {
        path: "old.fb2",
        format: "fb2",
        hash: "old-xml-hash",
        derivedFrom: { filePath: "books/previous.fbz", contentHash: "old-archive-hash" },
      });
      useNarraStore.getState().setBackendBinding("local", {
        resolution: "private",
        bookEditionId: "old-edition",
        contentSha256: "old-xml-hash",
        sourceUploaded: true,
      });
      runtime.hash.mockImplementationOnce(async (path?: string) => {
        const bytes = runtime.files.get(path ?? "");
        if (!bytes) throw new Error("Missing actual derived file");
        return createHash("sha256").update(bytes).digest("hex");
      });
      runtime.request
        .mockResolvedValueOnce({ resolution: "local_registration_required" })
        .mockResolvedValueOnce({
          resolution: "private",
          book_edition_id: "normalized-fb2",
          source_uploaded: false,
        });
      await open(value);
      const registration = runtime.request.mock.calls.find(([path]) => path === "/v2/books/local");
      expect(registration).toBeDefined();
      expect(JSON.parse(registration?.[1].body)).toMatchObject({
        format: "fb2",
        content_sha256: xmlHash,
      });
      const upload = runtime.request.mock.calls.find((call) => call[1]?.method === "PUT");
      expect(upload?.[1].headers).toEqual({ "content-type": "application/x-fictionbook+xml" });
      expect(upload?.[1].body).toEqual(xml);
      expect(runtime.books[0]).toMatchObject({
        format: "fbz",
        filePath: value.filePath,
        contentHash: archiveHash,
      });
      expect(useNarraStore.getState().books.local.backendOriginalSource).toMatchObject({
        format: "fb2",
        hash: xmlHash,
      });
    },
  );
  it("reuses the derived source only for the same archive identity", async () => {
    const value = {
      ...book(),
      format: "fbz" as const,
      filePath: "books/story.fbz",
      contentHash: "archive-hash",
    };
    useNarraStore.getState().setBackendOriginalSource("local", {
      path: "derived.fb2",
      format: "fb2",
      hash: "xml-hash",
      derivedFrom: { filePath: value.filePath, contentHash: value.contentHash },
    });
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "private",
      bookEditionId: "derived-edition",
      contentSha256: "xml-hash",
      sourceUploaded: true,
    });
    await open(value);
    expect(runtime.hash).not.toHaveBeenCalled();
    expect(
      runtime.request.mock.calls.some(
        ([path]) => path === "/v2/books/local" || path === "/v2/books/resolve",
      ),
    ).toBe(false);
    expect(useBackendBookStatus.getState().books.local.manifest?.availability).toBe("ready");
  });
  it("does not register a corrupt FBZ archive or label it as raw FB2", async () => {
    const value = { ...book(), format: "fbz" as const, filePath: "books/broken.fbz" };
    runtime.files.set("file:///documents/books/broken.fbz", new Uint8Array([1, 2, 3]));
    await open(value);
    expect(runtime.request).not.toHaveBeenCalled();
    expect(runtime.hash).not.toHaveBeenCalled();
    expect(useNarraStore.getState().books.local?.backendOriginalSource).toBeUndefined();
  });
  it("exposes sync retry completion only after the refreshed manifest is published", async () => {
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "private",
      bookEditionId: "private-id",
      contentSha256: "a".repeat(64),
      sourceUploaded: true,
    });
    await open(book());
    let finish!: (manifest: typeof ready) => void;
    runtime.request.mockImplementation((path: string) =>
      path.endsWith("/manifest")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({}),
    );
    let completed = false;
    const retry = retryBackendBookSync("local").then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toBe(false);
    finish(ready);
    await retry;
    expect(completed).toBe(true);
    expect(useBackendBookStatus.getState().books.local.manifest?.availability).toBe("ready");
  });
  it("does not register or keep retrying formats the analysis backend cannot parse", async () => {
    const unsupported = { ...book(), format: "mobi" as const, filePath: "books/local.mobi" };
    await open(unsupported);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runtime.request).not.toHaveBeenCalled();
    expect(runtime.hash).not.toHaveBeenCalled();
    expect(useBackendBookStatus.getState().books.local.error).toBe("BOOK_FORMAT_UNSUPPORTED");
    expect(runtime.books[0]).toEqual(unsupported);
  });

  it("uploads the converted EPUB for legacy UMD imports instead of unsupported raw UMD", async () => {
    useNarraStore.getState().setBackendOriginalSource("local", {
      path: "raw/local.umd",
      format: "umd",
      hash: "old-umd-hash",
    });
    runtime.request
      .mockResolvedValueOnce({ resolution: "local_registration_required" })
      .mockResolvedValueOnce({
        resolution: "private",
        book_edition_id: "converted-umd",
        source_uploaded: false,
      });
    await open({ ...book(), format: "umd", contentHash: "old-umd-hash" });
    expect(runtime.hash).toHaveBeenCalledWith("file:///documents/books/local.epub");
    const registration = runtime.request.mock.calls.find(([path]) => path === "/v2/books/local");
    expect(JSON.parse(registration?.[1].body).format).toBe("epub");
    const upload = runtime.request.mock.calls.find((call) => call[1]?.method === "PUT");
    expect(upload?.[1].headers).toEqual({ "content-type": "application/epub+zip" });
  });

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
  it("polls markup status, keeps preview rows ephemeral, then switches to the full manifest", async () => {
    let fullReady = false;
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/manifest"))
        return fullReady
          ? ready
          : {
              availability: "processing",
              characters_status: "preview_ready",
              analysis: { run_id: "run-1", stage: "scan", status: "running" },
              characters: [],
            };
      if (path.endsWith("/characters/preview"))
        return {
          contract_version: "book-characters-preview-v1",
          book_edition_id: "catalog-id",
          status: "preview_ready",
          run_id: "run-1",
          poll_after_ms: 1000,
          characters: [
            {
              character_key: "provisional:hero",
              name: "Предварительный герой",
              full_name: "",
              provisional: true,
              state: "preparing",
              profile: { provisional: true },
              bundle: null,
            },
          ],
        };
      return {};
    });

    await open({
      ...book(),
      sourceKind: "catalog",
      bookEditionId: "catalog-id",
      contentHash: "a".repeat(64),
    });

    expect(runtime.request.mock.calls.map((call) => call[0])).toContain(
      "/v2/books/catalog-id/characters/preview",
    );
    expect(useBackendBookStatus.getState().books.local.preview?.characters[0]?.name).toBe(
      "Предварительный герой",
    );
    expect(useNarraStore.getState().books.local.characters).toEqual([]);
    expect(runtime.media).not.toHaveBeenCalled();

    fullReady = true;
    await vi.advanceTimersByTimeAsync(1000);

    expect(useBackendBookStatus.getState().books.local.manifest?.charactersStatus).toBe(
      "full_ready",
    );
    expect(useBackendBookStatus.getState().books.local.preview).toBeUndefined();
    expect(useNarraStore.getState().books.local.characters[0]?.id).toBe("stable");
    expect(runtime.media).toHaveBeenCalledTimes(1);
  });
  it("shows catalog description as bio when role is null", async () => {
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/manifest"))
        return {
          ...ready,
          characters: [
            {
              ...ready.characters[0],
              profile: { role: null, description: "Био каталожного персонажа." },
            },
          ],
        };
      return {};
    });

    await open({
      ...book(),
      sourceKind: "catalog",
      bookEditionId: "catalog-id",
      contentHash: "a".repeat(64),
    });

    const character = useNarraStore.getState().books.local.characters[0];
    expect(character.role).toBe("");
    expect(character.description).toBe("Био каталожного персонажа.");
    expect(characterBiography(character)).toBe("Био каталожного персонажа.");
  });
  it("shows private-book description as bio when role and description differ", async () => {
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "private",
      bookEditionId: "private-id",
      contentSha256: "a".repeat(64),
      sourceUploaded: true,
    });
    runtime.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/manifest"))
        return {
          ...ready,
          characters: [
            {
              ...ready.characters[0],
              profile: {
                role: "Главный герой",
                description: "Отдельное описание личного персонажа.",
              },
            },
          ],
        };
      return {};
    });

    await open(book());

    const character = useNarraStore.getState().books.local.characters[0];
    expect(character.role).toBe("Главный герой");
    expect(character.description).toBe("Отдельное описание личного персонажа.");
    expect(characterBiography(character)).toBe("Отдельное описание личного персонажа.");
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

  it("retries a terminal private run on the same edition with an idempotency request id", async () => {
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "private",
      bookEditionId: "private-id",
      contentSha256: "a".repeat(64),
      sourceUploaded: true,
    });
    runtime.request.mockResolvedValueOnce({ status: "queued", run_id: "run-2" });
    await retryBackendBookAnalysis("local");
    expect(runtime.request).toHaveBeenCalledWith(
      "/v2/books/private-id/analysis/retry",
      expect.objectContaining({
        method: "POST",
        body: '{"request_id":"22222222-2222-4222-8222-222222222222"}',
      }),
    );
    expect(useBackendBookStatus.getState().books.local).toMatchObject({
      analysisRetrying: false,
      error: undefined,
    });
    expect(runtime.hash).not.toHaveBeenCalled();
  });

  it("does not offer analysis retry without a private binding", async () => {
    await retryBackendBookAnalysis("local");
    expect(runtime.request).not.toHaveBeenCalled();
    expect(useBackendBookStatus.getState().books.local).toMatchObject({
      analysisRetrying: false,
      error: "ANALYSIS_RETRY_UNAVAILABLE",
    });
  });

  it("keeps an expired-source retry terminal and user-safe", async () => {
    useNarraStore.getState().setBackendBinding("local", {
      resolution: "private",
      bookEditionId: "private-id",
      contentSha256: "a".repeat(64),
      sourceUploaded: true,
    });
    runtime.request.mockRejectedValueOnce(
      new BackendBookError(409, {
        code: "SOURCE_UNAVAILABLE",
        detail: "private storage detail must stay hidden",
      }),
    );
    await expect(retryBackendBookAnalysis("local")).rejects.toMatchObject({ status: 409 });
    expect(useBackendBookStatus.getState().books.local).toMatchObject({
      analysisRetrying: false,
      error: "SOURCE_UNAVAILABLE",
    });
    expect(JSON.stringify(useBackendBookStatus.getState())).not.toContain("private storage detail");
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
  it("accepts revision one after a same-source edition replacement without losing conversation", () => {
    const store = useNarraStore.getState();
    const binding = {
      resolution: "private" as const,
      bookEditionId: "old-edition",
      contentSha256: "a".repeat(64),
      sourceUploaded: true,
    };
    store.setBackendBinding("local", binding);
    store.applyBackendManifest(
      "local",
      parseBackendManifest({ ...ready, markup: { revision: 9 } }),
      0.3,
    );
    store.appendChatMessage("local", "stable", {
      id: "message",
      role: "user",
      content: "Remember our conversation",
      createdAt: 1,
    });
    store.setMemory("local", "stable", "Our conversation memory");
    store.setSceneRequest("local", "page:anchor", {
      bookEditionId: binding.bookEditionId,
      markupIdentity: backendSceneMarkupIdentity(
        useNarraStore.getState().books.local.backendManifest,
        binding,
      ),
      requestedProgress: 0.3,
      sceneKey: "old-scene",
    });
    store.updateCharacter("local", "stable", {
      voiceOverride: "manual-voice",
      portraitUri: "file:///old.png",
      backendMedia: { primary_portrait: { hash: "old", uri: "file:///old.png" } },
    });
    const before = useNarraStore.getState().books.local;
    store.setBackendBinding("local", { ...binding, bookEditionId: "new-edition" });
    const rebound = useNarraStore.getState().books.local;
    expect(rebound.backendManifest).toBeUndefined();
    expect(rebound.characters[0].backendMedia).toBeUndefined();
    expect(rebound.characters[0].portraitUri).toBeUndefined();
    expect(rebound.chats).toBe(before.chats);
    expect(rebound.memories).toBe(before.memories);
    expect(rebound.sceneRequests).toEqual({});
    expect(rebound.sceneAnchorBindings).toEqual({});
    store.applyBackendManifest("local", parseBackendManifest(ready), 0.3);
    const after = useNarraStore.getState().books.local;
    expect(after.backendManifest?.revision).toBe(1);
    expect(after.chats).toBe(before.chats);
    expect(after.memories).toBe(before.memories);
    expect(after.characters[0].voiceOverride).toBe("manual-voice");
  });
  it("preserves a manual portrait on same-source rebind and does not reset a binding metadata refresh", () => {
    const store = useNarraStore.getState();
    const binding = {
      resolution: "private" as const,
      bookEditionId: "old-edition",
      contentSha256: "a".repeat(64),
      sourceUploaded: false,
    };
    store.setBackendBinding("local", binding);
    store.applyBackendManifest("local", parseBackendManifest(ready), 0.3);
    store.updateCharacter("local", "stable", {
      portraitUri: "file:///manual.png",
      portraitUriOverridesAsset: true,
    });
    const before = useNarraStore.getState().books.local;
    store.setBackendBinding("local", { ...binding, sourceUploaded: true });
    const refreshed = useNarraStore.getState().books.local;
    expect(refreshed.backendManifest).toBe(before.backendManifest);
    expect(refreshed.characters).toBe(before.characters);
    store.setBackendBinding("local", { ...binding, sourceUploaded: true });
    expect(useNarraStore.getState().books.local).toBe(refreshed);
    store.setBackendBinding("local", {
      ...binding,
      bookEditionId: "new-edition",
      contentSha256: "A".repeat(64),
    });
    expect(useNarraStore.getState().books.local.characters[0].portraitUri).toBe(
      "file:///manual.png",
    );
    store.applyBackendManifest("local", parseBackendManifest(ready), 0.3);
    expect(useNarraStore.getState().books.local.characters[0].portraitUri).toBe(
      "file:///manual.png",
    );
  });
});
