import { describe, expect, it, vi } from "vitest";
import { readGatewayResponseText, withGatewayConsumer } from "../ai/narra-gateway-consumer";
import type { BackendCatalogBook, BackendCatalogPage } from "./backend-catalog-api";
import { CatalogCoverStore } from "./catalog-cover-store";
import {
  type CatalogMetadata,
  type CatalogProgress,
  type CatalogStorage,
  type CatalogStoredPage,
  createCatalogStore,
} from "./catalog-store";
import { NarraServiceError } from "./errors";

const genres = [{ id: "fiction", labelRu: "Проза", labelEn: "Fiction", order: 1 }];

function book(id: string, changes: Partial<BackendCatalogBook> = {}): BackendCatalogBook {
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
    ...changes,
  };
}

function catalog(books: BackendCatalogBook[] = [book("old")]): CatalogMetadata {
  return { books, nextCursor: null, genres, genreVersion: "genres-v1" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function setup(complete: CatalogMetadata | null = null, progress: CatalogProgress | null = null) {
  const storage = {
    read: vi.fn(async () => ({ complete, progress })),
    begin: vi.fn(async (_generation: string) => {}),
    append: vi.fn(async (_page: CatalogStoredPage) => {}),
    commit: vi.fn(async (_catalog: CatalogMetadata, _generation: string) => {}),
  } satisfies CatalogStorage;
  const fetchPage = vi.fn(
    async (_cursor: string | undefined, _signal: AbortSignal): Promise<BackendCatalogPage> => ({
      items: [book("new")],
      nextCursor: null,
    }),
  );
  const fetchGenres = vi.fn(async (_signal: AbortSignal) => ({
    items: genres,
    version: "genres-v1",
  }));
  let now = 100;
  let generation = 0;
  const onCacheError = vi.fn();
  const store = createCatalogStore({
    storage,
    fetchPage,
    fetchGenres,
    now: () => now,
    createGeneration: () => `g${++generation}`,
    staleTimeMs: 1000,
    onCacheError,
  });
  return {
    storage,
    fetchPage,
    fetchGenres,
    store,
    onCacheError,
    advanceTime: (ms: number) => {
      now += ms;
    },
  };
}

describe("shared catalog metadata store", () => {
  it("shares hydration, a generation, and each cursor across active surfaces", async () => {
    const { store, storage, fetchPage, fetchGenres } = setup();
    const second = deferred<BackendCatalogPage>();
    fetchPage
      .mockResolvedValueOnce({ items: [book("first")], nextCursor: "next" })
      .mockReturnValueOnce(second.promise);

    const releaseLibrary = store.acquire();
    const releaseSearch = store.acquire();
    const releaseCategory = store.acquire();
    await flush();
    expect(storage.read).toHaveBeenCalledOnce();
    expect(fetchGenres).toHaveBeenCalledOnce();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "next"]);
    expect(store.getSnapshot().loadedCount).toBe(1);
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("first");
    expect(store.getSnapshot().hasCompleteCatalog).toBe(false);
    releaseLibrary();
    releaseSearch();
    await flush();
    expect(fetchPage.mock.calls[1][1].aborted).toBe(false);

    second.resolve({ items: [book("last", { genres: ["history"] })], nextCursor: null });
    await flush();
    expect(store.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "first",
      "last",
    ]);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    expect(storage.commit).toHaveBeenCalledOnce();
    expect(storage.append.mock.calls.map(([page]) => page.page.items.length)).toEqual([1, 1]);
    releaseCategory();
  });

  it("keeps the last complete snapshot while a new generation is incomplete or fails", async () => {
    const previous = catalog();
    const { store, fetchPage, storage } = setup(previous);
    const next = deferred<BackendCatalogPage>();
    fetchPage
      .mockResolvedValueOnce({ items: [book("first")], nextCursor: "next" })
      .mockReturnValueOnce(next.promise);
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    expect(store.getSnapshot().loadedCount).toBe(1);
    next.reject(new Error("offline"));
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    expect(store.getSnapshot().error).toEqual(new Error("offline"));
    expect(storage.commit).not.toHaveBeenCalled();

    fetchPage.mockResolvedValueOnce({ items: [book("last")], nextCursor: null });
    await store.retry();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "next", "next"]);
    expect(store.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "first",
      "last",
    ]);
    expect(store.getSnapshot().error).toBeNull();
    release();
  });

  it("does no disk read or metadata request on a warm remount or focus handoff", async () => {
    const { store, storage, fetchPage } = setup();
    const releaseFirst = store.acquire();
    await flush();
    const snapshot = store.getSnapshot();
    releaseFirst();
    const releaseSecond = store.acquire();
    await flush();
    expect(store.getSnapshot()).toBe(snapshot);
    releaseSecond();
    await flush();
    const releaseThird = store.acquire();
    await flush();
    expect(storage.read).toHaveBeenCalledOnce();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toBe(snapshot);
    releaseThird();
  });

  it("cancels only after the last consumer leaves and drains a late reply before retrying its cursor", async () => {
    const { store, fetchPage } = setup();
    const old = deferred<BackendCatalogPage>();
    const current = deferred<BackendCatalogPage>();
    fetchPage.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const releaseA = store.acquire();
    const releaseB = store.acquire();
    await flush();
    const oldSignal = fetchPage.mock.calls[0][1];
    releaseA();
    await flush();
    expect(oldSignal.aborted).toBe(false);
    releaseB();
    await flush();
    expect(oldSignal.aborted).toBe(true);

    const releaseC = store.acquire();
    await flush();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(store.getDiagnostics()).toMatchObject({ activeRun: 0, drainingRun: 1, pageRequests: 1 });
    old.resolve({ items: [book("obsolete")], nextCursor: null });
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().catalog.books).toHaveLength(0);
    current.resolve({ items: [book("current")], nextCursor: null });
    await flush();
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("current");
    expect(store.getDiagnostics()).toMatchObject({ activeRun: 0, drainingRun: 0, pageRequests: 0 });
    releaseC();
  });

  it("does not cancel during a same-turn consumer transfer", async () => {
    const { store, fetchPage } = setup();
    const result = deferred<BackendCatalogPage>();
    fetchPage.mockReturnValueOnce(result.promise);
    const releaseFirst = store.acquire();
    await flush();
    releaseFirst();
    const releaseNext = store.acquire();
    await flush();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchPage.mock.calls[0][1].aborted).toBe(false);
    result.resolve({ items: [], nextCursor: null });
    await flush();
    releaseNext();
  });

  it("drains both page and genres, rechecks consumers, and resumes the accepted cursor", async () => {
    const previous = catalog();
    const { store, fetchPage, fetchGenres } = setup(previous);
    const oldPage = deferred<BackendCatalogPage>();
    const oldGenres = deferred<{ items: typeof genres; version: string }>();
    fetchPage
      .mockResolvedValueOnce({ items: [book("first")], nextCursor: "next" })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ items: [book("last", { genres: ["history"] })], nextCursor: null });
    fetchGenres.mockReturnValueOnce(oldGenres.promise).mockResolvedValueOnce({
      items: [...genres, { id: "history", labelRu: "История", labelEn: "History", order: 2 }],
      version: "genres-v2",
    });
    const releaseFirst = store.acquire();
    await flush();
    releaseFirst();
    await flush();
    const releaseWaiting = store.acquire();
    await flush();
    oldPage.reject(new Error("late page cancellation"));
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchGenres).toHaveBeenCalledOnce();
    expect(store.getDiagnostics()).toMatchObject({
      drainingRun: 1,
      pageRequests: 0,
      genreRequests: 1,
    });
    releaseWaiting();
    await flush();
    oldGenres.reject(new Error("late genre cancellation"));
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    expect(store.getSnapshot().error).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(store.getDiagnostics()).toMatchObject({
      consumers: 0,
      activeRun: 0,
      drainingRun: 0,
      pageRequests: 0,
      genreRequests: 0,
      pendingPages: 1,
    });
    const releaseCurrent = store.acquire();
    await flush();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "next", "next"]);
    expect(store.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "first",
      "last",
    ]);
    expect(store.getSnapshot().catalog.genres.at(-1)?.id).toBe("history");
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    releaseCurrent();
  });

  it("discards old generation responses after an explicit refresh", async () => {
    const { store, fetchPage, storage } = setup(catalog());
    const old = deferred<BackendCatalogPage>();
    fetchPage.mockReturnValueOnce(old.promise);
    const release = store.acquire();
    await flush();
    const oldSignal = fetchPage.mock.calls[0][1];
    const refresh = store.refresh();
    await flush();
    expect(oldSignal.aborted).toBe(true);
    expect(fetchPage).toHaveBeenCalledOnce();
    old.resolve({ items: [book("obsolete")], nextCursor: null });
    await refresh;
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("new");
    expect(storage.commit).toHaveBeenCalledTimes(1);
    expect(storage.commit.mock.calls[0][1]).toBe("g2");
    release();
  });

  it("starts only the latest generation after concurrent refreshes wait on a cancelled run", async () => {
    const previous = catalog();
    const { store, fetchPage, storage } = setup(previous);
    const old = deferred<BackendCatalogPage>();
    fetchPage.mockReturnValueOnce(old.promise);
    const release = store.acquire();
    await flush();
    const refreshA = store.refresh();
    const refreshB = store.refresh();
    await flush();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(store.getSnapshot().catalog).toBe(previous);
    old.reject(new Error("late old error"));
    await Promise.all([refreshA, refreshB]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(storage.commit).toHaveBeenCalledOnce();
    expect(storage.commit.mock.calls[0][1]).toBe("g3");
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("new");
    expect(store.getSnapshot().error).toBeNull();
    release();
  });

  it("keeps an accepted last page when cancelled before genres settle and ignores the old dictionary", async () => {
    const previous = catalog();
    const { store, fetchPage, fetchGenres, storage } = setup(previous);
    const oldGenres = deferred<{ items: typeof genres; version: string }>();
    fetchGenres.mockReturnValueOnce(oldGenres.promise).mockResolvedValueOnce({
      items: [...genres, { id: "history", labelRu: "История", labelEn: "History", order: 2 }],
      version: "current-genres",
    });
    fetchPage.mockResolvedValue({
      items: [book("last", { genres: ["history"] })],
      nextCursor: null,
    });
    const releaseOld = store.acquire();
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    releaseOld();
    await flush();
    expect(fetchGenres.mock.calls[0][0].aborted).toBe(true);
    const releaseCurrent = store.acquire();
    await flush();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchGenres).toHaveBeenCalledOnce();
    expect(store.getSnapshot().catalog).toBe(previous);
    oldGenres.resolve({ items: [], version: "obsolete-genres" });
    await flush();
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("last");
    expect(store.getSnapshot().catalog.genres).toHaveLength(2);
    expect(store.getSnapshot().catalog.genreVersion).toBe("current-genres");
    expect(storage.commit).toHaveBeenCalledOnce();
    releaseCurrent();
    await flush();
    expect(store.getDiagnostics()).toMatchObject({
      consumers: 0,
      activeRun: 0,
      pendingGeneration: 0,
      pageRequests: 0,
      genreRequests: 0,
      pendingWrites: 0,
    });
  });

  it("preserves an accepted page while its journal write finishes during cancellation and resume", async () => {
    const { store, storage, fetchPage } = setup(catalog());
    const journalWrite = deferred<void>();
    storage.append.mockReturnValueOnce(journalWrite.promise);
    fetchPage
      .mockResolvedValueOnce({ items: [book("first")], nextCursor: "next" })
      .mockResolvedValueOnce({ items: [book("last")], nextCursor: null });
    const releaseFirst = store.acquire();
    await flush();
    expect(store.getDiagnostics().pendingWrites).toBe(1);
    releaseFirst();
    await flush();
    const releaseNext = store.acquire();
    await flush();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined]);
    journalWrite.resolve();
    await flush();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "next"]);
    expect(storage.append.mock.calls.map(([value]) => value.index)).toEqual([0, 1]);
    expect(store.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "first",
      "last",
    ]);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    releaseNext();
    await flush();
    expect(store.getDiagnostics()).toMatchObject({
      consumers: 0,
      pendingWrites: 0,
      pendingGeneration: 0,
    });
  });

  it("serializes an in-flight old commit before a superseding generation can write", async () => {
    const previous = catalog();
    const { store, storage, fetchPage } = setup(previous);
    const firstWrite = deferred<void>();
    const writes: string[] = [];
    storage.commit.mockImplementation(async (_catalog, generation) => {
      if (generation === "g1") await firstWrite.promise;
      writes.push(generation);
    });
    fetchPage
      .mockResolvedValueOnce({ items: [book("old-reply")], nextCursor: null })
      .mockResolvedValueOnce({ items: [book("current-reply")], nextCursor: null });
    const release = store.acquire();
    await flush();
    const refresh = store.refresh();
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    expect(writes).toEqual([]);
    firstWrite.resolve();
    await refresh;
    expect(writes).toEqual(["g1", "g2"]);
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("current-reply");
    release();
  });

  it("restores accepted pages after restart and resumes the remaining cursor offline", async () => {
    const progress: CatalogProgress = {
      ...catalog([book("cached")]),
      nextCursor: "remaining",
      generation: "saved-generation",
      pageCount: 1,
      requestedCursors: [null],
    };
    const { store, fetchPage, storage } = setup(null, progress);
    fetchPage.mockRejectedValueOnce(new Error("offline"));
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("cached");
    expect(store.getSnapshot().hasCompleteCatalog).toBe(false);
    expect(fetchPage.mock.calls[0][0]).toBe("remaining");
    expect(storage.begin).not.toHaveBeenCalled();
    await store.retry();
    expect(store.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "cached",
      "new",
    ]);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    release();
  });

  it("preserves equal metadata references and emits nothing for a no-op acquisition", async () => {
    const previous = catalog([book("same")]);
    const { store, fetchPage } = setup(previous);
    fetchPage.mockResolvedValue({ items: [book("same")], nextCursor: null });
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const releaseOther = store.acquire();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    releaseOther();
    release();
    unsubscribe();
  });

  it("keeps unchanged book references when only one metadata record changes", async () => {
    const previous = catalog([book("a"), book("b")]);
    const { store, fetchPage } = setup(previous);
    fetchPage.mockResolvedValue({
      items: [book("a"), book("b", { title: "changed" })],
      nextCursor: null,
    });
    const release = store.acquire();
    await flush();
    const next = store.getSnapshot().catalog;
    expect(next.books).not.toBe(previous.books);
    expect(next.books[0]).toBe(previous.books[0]);
    expect(next.books[1].title).toBe("changed");
    expect(next.genres).toBe(previous.genres);
    release();
  });

  it("does not mark a cursor loop as a complete catalog or overwrite the old cache", async () => {
    const previous = catalog();
    const { store, fetchPage, storage } = setup(previous);
    fetchPage
      .mockResolvedValueOnce({ items: [book("first")], nextCursor: "loop" })
      .mockResolvedValueOnce({ items: [book("second")], nextCursor: "loop" });
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().error).toEqual(new Error("Catalog cursor cycle"));
    expect(store.getSnapshot().catalog).toBe(previous);
    expect(storage.commit).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    fetchPage.mockResolvedValueOnce({ items: [book("recovered")], nextCursor: null });
    await store.retry();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "loop", undefined]);
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("recovered");
    release();
  });

  it("starts a new generation when the backend rejects a saved cursor but keeps the old full catalog", async () => {
    const previous = catalog();
    const { store, fetchPage } = setup(previous);
    fetchPage
      .mockResolvedValueOnce({ items: [book("first")], nextCursor: "expired" })
      .mockRejectedValueOnce(
        new NarraServiceError("REQUEST", "Invalid cursor", undefined, undefined, "VALIDATION"),
      );
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    fetchPage.mockResolvedValueOnce({ items: [book("recovered")], nextCursor: null });
    await store.retry();
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([
      undefined,
      "expired",
      undefined,
    ]);
    expect(store.getSnapshot().catalog.books.map(({ bookEditionId }) => bookEditionId)).toEqual([
      "recovered",
    ]);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    release();
  });

  it("waits for final genres and preserves the old dictionary after a genre error", async () => {
    const previous = catalog();
    const { store, fetchPage, fetchGenres } = setup(previous);
    const genreResult = deferred<{ items: typeof genres; version: string }>();
    fetchGenres.mockReturnValueOnce(genreResult.promise);
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().catalog).toBe(previous);
    genreResult.resolve({
      items: [...genres, { id: "history", labelRu: "История", labelEn: "History", order: 2 }],
      version: "genres-v2",
    });
    await flush();
    expect(store.getSnapshot().catalog.genres).toHaveLength(2);
    const lastComplete = store.getSnapshot().catalog;
    fetchGenres.mockRejectedValueOnce(new Error("offline"));
    await store.refresh();
    expect(store.getSnapshot().catalog).toBe(lastComplete);
    expect(store.getSnapshot().catalog.genreVersion).toBe("genres-v2");
    expect(store.getSnapshot().catalog.genres).toHaveLength(2);
    expect(store.getSnapshot().error).toEqual(new Error("offline"));
    const pageRequests = fetchPage.mock.calls.length;
    fetchPage.mockRejectedValue(new Error("pages offline"));
    await store.retry();
    expect(fetchPage).toHaveBeenCalledTimes(pageRequests);
    expect(store.getSnapshot().error).toBeNull();
    release();
  });

  it("keeps cold books readable and exposes Retry when the genre dictionary fails", async () => {
    const { store, storage, fetchPage, fetchGenres } = setup();
    const genresError = new NarraServiceError("REQUEST", "genres unavailable");
    fetchGenres.mockRejectedValueOnce(genresError);
    const release = store.acquire();
    await flush();
    const acceptedBooks = store.getSnapshot().catalog.books;
    expect(acceptedBooks).toHaveLength(1);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(false);
    expect(store.getSnapshot().error).toBe(genresError);
    expect(storage.commit).not.toHaveBeenCalled();
    fetchPage.mockRejectedValue(new Error("pages offline"));
    await store.retry();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(store.getSnapshot().catalog.books).toBe(acceptedBooks);
    expect(store.getSnapshot().catalog.genres).toEqual(genres);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    expect(storage.commit).toHaveBeenCalledOnce();
    expect(store.getSnapshot().error).toBeNull();
    release();
  });

  it("handles a synchronous genre adapter failure without stranding a run or repeating its final page", async () => {
    const { store, fetchPage, fetchGenres } = setup();
    const error = new Error("synchronous genres adapter failure");
    fetchGenres.mockImplementationOnce(() => {
      throw error;
    });
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().error).toBe(error);
    expect(store.getSnapshot().catalog.books).toHaveLength(1);
    expect(store.getDiagnostics()).toMatchObject({
      activeRun: 0,
      drainingRun: 0,
      pageRequests: 0,
      genreRequests: 0,
    });
    await store.retry();
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchGenres).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    expect(store.getSnapshot().error).toBeNull();
    release();
  });

  it("loads a successful empty catalog once and refreshes stale memory without rereading disk", async () => {
    const { store, storage, fetchPage, advanceTime } = setup();
    fetchPage.mockResolvedValue({ items: [], nextCursor: null });
    const releaseFirst = store.acquire();
    await flush();
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    releaseFirst();
    await flush();
    advanceTime(1001);
    const releaseSecond = store.acquire();
    await flush();
    expect(storage.read).toHaveBeenCalledOnce();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    releaseSecond();
  });

  it("keeps the metadata snapshot and subscriptions unchanged when a cover finishes", async () => {
    const { store } = setup();
    const release = store.acquire();
    await flush();
    const snapshot = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);
    const covers = new CatalogCoverStore();
    covers.retainBooks(snapshot.catalog.books);
    covers.setResult(snapshot.catalog.books[0], "file:///cover.jpg");
    expect(store.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    expect(snapshot.catalog.books[0]).not.toHaveProperty("coverUri");
    release();
  });

  it("retains usable memory after a cache write error and reports the cache error separately", async () => {
    const { store, storage, onCacheError } = setup();
    storage.append.mockRejectedValueOnce(new Error("disk-full"));
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    expect(store.getSnapshot().error).toBeNull();
    expect(onCacheError).toHaveBeenCalledWith(new Error("disk-full"));
    release();
  });

  it("keeps the same snapshot and single metadata load through fifty warm lifecycle cycles", async () => {
    const { store, fetchPage, storage } = setup();
    const releaseInitial = store.acquire();
    await flush();
    const snapshot = store.getSnapshot();
    releaseInitial();
    await flush();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const release = store.acquire();
      await flush();
      release();
      await flush();
    }
    expect(store.getSnapshot()).toBe(snapshot);
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(storage.read).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    expect(store.getDiagnostics()).toMatchObject({
      consumers: 0,
      listeners: 0,
      pendingGeneration: 0,
      activeRun: 0,
      drainingRun: 0,
      pageRequests: 0,
      genreRequests: 0,
      pendingWrites: 0,
    });
  });

  it("drains bounded page and genre bodies through fifty abort/reacquire cycles before a successful resume", async () => {
    const previous = catalog();
    const { store, storage, fetchPage, fetchGenres } = setup(previous);
    const active = { page: 0, genres: 0 };
    const peak = { page: 0, genres: 0 };
    const stalledBody = async (kind: keyof typeof active, signal: AbortSignal) => {
      active[kind] += 1;
      peak[kind] = Math.max(peak[kind], active[kind]);
      try {
        await withGatewayConsumer(
          (scope) => readGatewayResponseText(new Response(new ReadableStream()), scope),
          { signal, timeoutMs: 60_000 },
        );
      } finally {
        active[kind] -= 1;
      }
    };
    fetchPage.mockImplementation(async (_cursor, signal) => {
      await stalledBody("page", signal);
      return { items: [], nextCursor: null };
    });
    fetchGenres.mockImplementation(async (signal) => {
      await stalledBody("genres", signal);
      return { items: [], version: "never-completed" };
    });
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const release = store.acquire();
      await flush();
      expect(active).toEqual({ page: 1, genres: 1 });
      release();
      await flush();
      expect(store.getSnapshot().catalog).toBe(previous);
      expect(store.getDiagnostics()).toMatchObject({
        consumers: 0,
        activeRun: 0,
        drainingRun: 0,
        pageRequests: 0,
        genreRequests: 0,
        pendingWrites: 0,
        pendingGeneration: 1,
        pendingBooks: 0,
        pendingPages: 0,
      });
      expect(active).toEqual({ page: 0, genres: 0 });
    }
    expect(peak).toEqual({ page: 1, genres: 1 });
    expect(storage.read).toHaveBeenCalledOnce();
    expect(storage.begin).toHaveBeenCalledOnce();
    fetchPage.mockResolvedValue({ items: [book("recovered")], nextCursor: null });
    fetchGenres.mockResolvedValue({ items: genres, version: "recovered-genres" });
    const release = store.acquire();
    await flush();
    expect(store.getSnapshot().catalog.books[0].bookEditionId).toBe("recovered");
    expect(store.getSnapshot().catalog.genreVersion).toBe("recovered-genres");
    expect(store.getSnapshot().hasCompleteCatalog).toBe(true);
    release();
    await flush();
    expect(store.getDiagnostics()).toMatchObject({
      consumers: 0,
      listeners: 0,
      activeRun: 0,
      drainingRun: 0,
      pageRequests: 0,
      genreRequests: 0,
      pendingGeneration: 0,
    });
  });
});
