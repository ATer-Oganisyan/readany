import { describe, expect, it, vi } from "vitest";
import type { BackendCatalogBook } from "./backend-catalog-api";
import { type CatalogFileIO, createCatalogFileStorage } from "./catalog-storage";
import { type CatalogMetadata, type CatalogStoredPage, createCatalogStore } from "./catalog-store";

const root = "/cache/catalog";

function book(id: string): BackendCatalogBook {
  return {
    resolution: "catalog",
    bookEditionId: id,
    catalogKey: id,
    title: id,
    author: "Author",
    genres: ["fiction"],
    format: "epub",
    contentSha256: "a".repeat(64),
    sourceDownloadPath: `/v2/books/${id}/source/download`,
    generationStatus: "ready",
    ready: true,
  };
}

function catalog(id = "cached"): CatalogMetadata {
  return {
    books: [book(id)],
    nextCursor: null,
    genres: [{ id: "fiction", labelRu: "Проза", labelEn: "Fiction", order: 0 }],
    genreVersion: "v1",
  };
}

function page(index: number, cursor: string | null, nextCursor: string | null): CatalogStoredPage {
  return {
    generation: "g1",
    index,
    cursor,
    page: { items: [book(String(index))], nextCursor },
    genres: catalog().genres,
    genreVersion: "v1",
  };
}

function memoryIO() {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const io = {
    read: vi.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing file");
      return value;
    }),
    write: vi.fn(async (path: string, text: string) => {
      files.set(path, text);
    }),
    move: vi.fn(async (from: string, to: string) => {
      const source = files.get(from);
      if (source === undefined) throw new Error("missing source");
      if (files.has(to)) throw new Error("destination exists");
      files.set(to, source);
      files.delete(from);
    }),
    remove: vi.fn(async (path: string) => {
      for (const key of files.keys()) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
      for (const key of directories) {
        if (key === path || key.startsWith(`${path}/`)) directories.delete(key);
      }
    }),
    exists: vi.fn(async (path: string) => files.has(path) || directories.has(path)),
    mkdir: vi.fn(async (path: string) => {
      directories.add(path);
    }),
    list: vi.fn(async (path: string) => {
      const entries = new Set<string>();
      for (const key of [...files.keys(), ...directories]) {
        if (key.startsWith(`${path}/`)) entries.add(key.slice(path.length + 1).split("/")[0]);
      }
      return [...entries];
    }),
  } satisfies CatalogFileIO;
  return { files, io, storage: createCatalogFileStorage(io, root) };
}

describe("catalog v2 metadata storage and page journal", () => {
  it("reads the existing v2 cache without checking every cover file", async () => {
    const { files, io, storage } = memoryIO();
    const value = catalog();
    files.set(`${root}/catalog.json`, JSON.stringify({ version: 2, ...value }));
    const result = await storage.read();
    expect(result).toEqual({ complete: value, progress: null });
    expect(io.exists).not.toHaveBeenCalled();
    expect(io.read.mock.calls.every(([path]) => !path.includes("/covers/"))).toBe(true);
  });

  it("migrates a valid v1 cache while preserving book identities", async () => {
    const { files, storage } = memoryIO();
    const old = book("legacy");
    files.set(`${root}/catalog.json`, JSON.stringify({ version: 1, books: [old] }));
    const result = await storage.read();
    expect(result.complete?.books[0]).toEqual({
      ...old,
      genres: [],
      generationStatus: "legacy-cache",
      ready: true,
    });
    expect(result.complete?.genres).toEqual([]);
    expect(result.progress).toBeNull();
  });

  it("stores one page per append and writes the accumulated metadata only on completion", async () => {
    const { files, io, storage } = memoryIO();
    const previous = catalog();
    files.set(`${root}/catalog.json`, JSON.stringify({ version: 2, ...previous }));
    await storage.begin("g1");
    await storage.append(page(0, null, "two"));
    await storage.append(page(1, "two", null));
    expect(JSON.parse(files.get(`${root}/catalog.json`) ?? "")).toEqual({
      version: 2,
      ...previous,
    });
    const pageWrites = io.write.mock.calls
      .filter(([path]) => path.includes("/pages/"))
      .map(([, text]) => JSON.parse(text).page.items.length);
    expect(pageWrites).toEqual([1, 1]);
    const beforeCommit = await storage.read();
    expect(beforeCommit.complete).toEqual(previous);
    expect(beforeCommit.progress?.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "0",
      "1",
    ]);
    const complete = { ...previous, books: [book("0"), book("1")] };
    await storage.commit(complete, "g1");
    const completeWrites = io.write.mock.calls.filter(([path]) =>
      /catalog\.json\..*\.tmp$/.test(path),
    );
    expect(completeWrites).toHaveLength(1);
    expect(await storage.read()).toEqual({ complete, progress: null });
    expect([...files.keys()].some((path) => path.includes("/pages/"))).toBe(false);
  });

  it("restores a legacy partial v2 cache as progress and never labels it complete", async () => {
    const { files, storage } = memoryIO();
    files.set(
      `${root}/catalog.json`,
      JSON.stringify({ version: 2, ...catalog(), nextCursor: "next" }),
    );
    const first = await storage.read();
    expect(first.complete).toBeNull();
    expect(first.progress).toMatchObject({
      pageCount: 1,
      nextCursor: "next",
      requestedCursors: [null],
    });
    expect(first.progress?.books[0].bookEditionId).toBe("cached");
    const second = await storage.read();
    expect(second.progress).toEqual(first.progress);
  });

  it.each(["begin", "append"])(
    "preserves readable legacy progress if migration %s cannot write",
    async (stage) => {
      const { files, io, storage } = memoryIO();
      const legacy = JSON.stringify({ version: 2, ...catalog(), nextCursor: "remaining" });
      const diskFull = new Error("disk-full");
      const write = io.write.getMockImplementation();
      if (!write) throw new Error("Missing write implementation");
      files.set(`${root}/catalog.json`, legacy);
      io.write.mockImplementation(async (path, text) => {
        if (stage === "begin" || path.includes("/pages/")) throw diskFull;
        await write(path, text);
      });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await storage.read();
        expect(result.complete).toBeNull();
        expect(result.progress).toMatchObject({
          books: catalog().books,
          nextCursor: "remaining",
          pageCount: 1,
          requestedCursors: [null],
        });
        expect(result.cacheError).toBe(diskFull);
        expect(files.get(`${root}/catalog.json`)).toBe(legacy);
      }
    },
  );

  it("keeps the complete backup visible while restoring a legacy partial primary", async () => {
    const { files, storage } = memoryIO();
    const previous = catalog("complete");
    files.set(`${root}/catalog.json.previous`, JSON.stringify({ version: 2, ...previous }));
    files.set(
      `${root}/catalog.json`,
      JSON.stringify({ version: 2, ...catalog("partial"), nextCursor: "remaining" }),
    );
    const result = await storage.read();
    expect(result.complete).toEqual(previous);
    expect(result.progress?.books[0].bookEditionId).toBe("partial");
    expect(result.progress?.nextCursor).toBe("remaining");
  });

  it("hydrates legacy books offline when migration fails and reports the cache error separately", async () => {
    const { files, io, storage } = memoryIO();
    const diskFull = new Error("disk-full");
    const offline = new Error("offline");
    files.set(
      `${root}/catalog.json`,
      JSON.stringify({ version: 2, ...catalog(), nextCursor: "remaining" }),
    );
    io.write.mockRejectedValue(diskFull);
    const fetchPage = vi.fn(async (_cursor: string | undefined, _signal: AbortSignal) => {
      throw offline;
    });
    const onCacheError = vi.fn();
    const store = createCatalogStore({
      storage,
      fetchPage,
      fetchGenres: async () => ({ items: catalog().genres, version: "v1" }),
      onCacheError,
    });
    const release = store.acquire();
    await store.retry();
    expect(store.getSnapshot().catalog.books).toEqual(catalog().books);
    expect(store.getSnapshot().catalog.nextCursor).toBe("remaining");
    expect(store.getSnapshot().error).toBe(offline);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(false);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual(["remaining"]);
    expect(onCacheError).toHaveBeenCalledWith(diskFull);
    release();
  });

  it("recovers accepted pages when the last page file is incomplete or missing", async () => {
    const { files, storage } = memoryIO();
    await storage.begin("g1");
    await storage.append(page(0, null, "two"));
    await storage.append(page(1, "two", "three"));
    files.set(`${root}/pages/g1/1.json`, "{truncated");
    const result = await storage.read();
    expect(result.progress).toMatchObject({
      pageCount: 1,
      nextCursor: "two",
      requestedCursors: [null],
    });
    expect(result.progress?.books.map(({ bookEditionId }) => bookEditionId)).toEqual(["0"]);
    expect(result.complete).toBeNull();
  });

  it("keeps the previous complete cache readable after an interrupted final rename", async () => {
    const { files, io, storage } = memoryIO();
    const previous = catalog();
    files.set(`${root}/catalog.json`, JSON.stringify({ version: 2, ...previous }));
    const move = io.move.getMockImplementation();
    if (!move) throw new Error("Missing move implementation");
    io.move.mockImplementation(async (from, to) => {
      if (to === `${root}/catalog.json` && from.endsWith(".tmp"))
        throw new Error("interrupted rename");
      await move(from, to);
    });
    await expect(storage.commit(catalog("new"), "new-generation")).rejects.toThrow(
      "interrupted rename",
    );
    expect((await storage.read()).complete).toEqual(previous);
    expect([...files.keys()].some((path) => path.endsWith(".tmp"))).toBe(false);
  });

  it("rejects corrupted complete metadata rather than silently losing one book", async () => {
    const { files, storage } = memoryIO();
    files.set(
      `${root}/catalog.json`,
      JSON.stringify({ version: 2, ...catalog(), books: [book("a"), { title: "bad" }] }),
    );
    files.set(
      `${root}/catalog.json.previous`,
      JSON.stringify({ version: 2, ...catalog("previous") }),
    );
    expect((await storage.read()).complete).toEqual(catalog("previous"));
  });

  it("omits transient cover state from disk and never touches user book or cover files", async () => {
    const { files, io, storage } = memoryIO();
    const coverPath = `${root}/covers/user-cover.jpg`;
    files.set(coverPath, "image-bytes");
    const withCoverState = {
      ...catalog(),
      books: [{ ...book("a"), coverUri: "file:///a.jpg", coverLoadFailed: true }],
    };
    await storage.begin("g1");
    await storage.append(page(0, null, null));
    await storage.commit(withCoverState, "g1");
    const disk = JSON.parse(files.get(`${root}/catalog.json`) ?? "");
    expect(disk.version).toBe(2);
    expect(disk.books[0]).not.toHaveProperty("coverUri");
    expect(disk.books[0]).not.toHaveProperty("coverLoadFailed");
    expect(files.get(coverPath)).toBe("image-bytes");
    expect(io.remove.mock.calls.some(([path]) => path.includes("/covers/"))).toBe(false);
  });

  it("cleans abandoned generations and rejects a partial commit", async () => {
    const { files, storage } = memoryIO();
    await storage.begin("g1");
    await storage.append(page(0, null, "two"));
    await storage.begin("g2");
    expect([...files.keys()].some((path) => path.includes("/pages/g1/"))).toBe(false);
    await expect(storage.commit({ ...catalog(), nextCursor: "more" }, "g2")).rejects.toThrow(
      "incomplete",
    );
    expect(files.has(`${root}/catalog.json`)).toBe(false);
  });

  it("preserves a valid backup when the primary is corrupt and another commit is interrupted", async () => {
    const { files, io, storage } = memoryIO();
    const previous = catalog("last-complete");
    files.set(`${root}/catalog.json`, "{truncated");
    files.set(`${root}/catalog.json.previous`, JSON.stringify({ version: 2, ...previous }));
    const move = io.move.getMockImplementation();
    if (!move) throw new Error("Missing move implementation");
    io.move.mockImplementation(async (from, to) => {
      if (to === `${root}/catalog.json`) throw new Error("interrupted rename");
      await move(from, to);
    });
    await expect(storage.commit(catalog("new"), "g2")).rejects.toThrow("interrupted rename");
    expect((await storage.read()).complete).toEqual(previous);
  });

  it("restores service progress across an offline restart without losing the complete catalog", async () => {
    const { files, storage } = memoryIO();
    const previous = catalog();
    files.set(`${root}/catalog.json`, JSON.stringify({ version: 2, ...previous }));
    const fetchPage = vi.fn(async (_cursor: string | undefined, _signal: AbortSignal) => ({
      items: [book("last")],
      nextCursor: null as string | null,
    }));
    fetchPage
      .mockResolvedValueOnce({ items: [book("first")], nextCursor: "next" })
      .mockRejectedValueOnce(new Error("offline"));
    const deps = {
      storage,
      fetchPage,
      fetchGenres: async () => ({ items: previous.genres, version: "v1" }),
    };
    const first = createCatalogStore(deps);
    const releaseFirst = first.acquire();
    await first.retry();
    expect(first.getSnapshot().catalog).toEqual(previous);
    expect(first.getSnapshot().error).toEqual(new Error("offline"));
    releaseFirst();
    await Promise.resolve();

    const restored = createCatalogStore(deps);
    const releaseRestored = restored.acquire();
    await restored.retry();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "next", "next"]);
    expect(restored.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "first",
      "last",
    ]);
    expect((await storage.read()).progress).toBeNull();
    expect(JSON.parse(files.get(`${root}/catalog.json`) ?? "").books).toHaveLength(2);
    releaseRestored();
  });

  it("restores the accepted last page after a genre failure and retries only the dictionary", async () => {
    const { storage } = memoryIO();
    const offline = new Error("genres offline");
    const fetchPage = vi.fn(async (_cursor: string | undefined, _signal: AbortSignal) => ({
      items: [book("last")],
      nextCursor: null,
    }));
    const fetchGenres = vi.fn(async (_signal: AbortSignal) => ({
      items: catalog().genres,
      version: "v1",
    }));
    fetchGenres.mockRejectedValueOnce(offline);
    const deps = { storage, fetchPage, fetchGenres };
    const first = createCatalogStore(deps);
    const releaseFirst = first.acquire();
    await first.retry();
    expect(first.getSnapshot().error).toBe(offline);
    expect((await storage.read()).progress?.nextCursor).toBeNull();
    expect((await storage.read()).complete).toBeNull();
    releaseFirst();
    await Promise.resolve();

    // The pages endpoint is now unavailable. Recovery must use the accepted
    // final journal page, not ask that endpoint for page zero again.
    fetchPage.mockRejectedValue(new Error("pages offline"));
    const restored = createCatalogStore(deps);
    const releaseRestored = restored.acquire();
    await restored.retry();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchGenres).toHaveBeenCalledTimes(2);
    expect(restored.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "last",
    ]);
    expect(restored.getSnapshot().catalog.genres).toEqual(catalog().genres);
    expect(restored.getSnapshot().hasCompleteCatalog).toBe(true);
    expect(restored.getSnapshot().error).toBeNull();
    expect((await storage.read()).progress).toBeNull();
    expect((await storage.read()).complete?.books).toEqual([book("last")]);
    releaseRestored();
  });
});
