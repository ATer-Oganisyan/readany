import type {
  BackendCatalogBook,
  BackendCatalogGenre,
  BackendCatalogPage,
  BackendGenreCatalog,
} from "./backend-catalog-api";
import { NarraServiceError } from "./errors";

/** Metadata never contains download/decode state; shelves can retain their references. */
export interface CatalogMetadata {
  books: BackendCatalogBook[];
  nextCursor: string | null;
  genres: BackendCatalogGenre[];
  genreVersion: string | null;
}

export interface CatalogProgress extends CatalogMetadata {
  generation: string;
  pageCount: number;
  requestedCursors: Array<string | null>;
}

export interface CatalogStoredPage {
  generation: string;
  index: number;
  cursor: string | null;
  page: BackendCatalogPage;
  genres: BackendCatalogGenre[];
  genreVersion: string | null;
}

export interface CatalogStorage {
  read(): Promise<{
    complete: CatalogMetadata | null;
    progress: CatalogProgress | null;
    /** Migration may fail to write while the previously cached data is still readable. */
    cacheError?: unknown;
  }>;
  /** Starts a small journal without changing the last complete v2 cache. */
  begin(generation: string): Promise<void>;
  append(page: CatalogStoredPage): Promise<void>;
  /** Replaces the complete cache only after all pages and genres have settled. */
  commit(catalog: CatalogMetadata, generation: string): Promise<void>;
}

export interface CatalogStoreDependencies {
  storage: CatalogStorage;
  fetchPage(cursor: string | undefined, signal: AbortSignal): Promise<BackendCatalogPage>;
  fetchGenres(signal: AbortSignal): Promise<BackendGenreCatalog>;
  now?: () => number;
  createGeneration?: () => string;
  staleTimeMs?: number;
  onCacheError?: (error: unknown) => void;
}

export interface CatalogSnapshot {
  catalog: CatalogMetadata;
  isLoading: boolean;
  isRefreshing: boolean;
  loadedCount: number;
  error: unknown | null;
  /** True also for a successfully loaded empty catalog. */
  hasCompleteCatalog: boolean;
}

const EMPTY_CATALOG: CatalogMetadata = {
  books: [],
  nextCursor: null,
  genres: [],
  genreVersion: null,
};

interface Generation extends CatalogProgress {
  booksById: Map<string, BackendCatalogBook>;
  seenCursors: Set<string | null>;
  genresLoaded: boolean;
  started: boolean;
}

interface CatalogRun {
  controller: AbortController;
  generation: Generation;
  promise: Promise<void>;
}

class CatalogCursorCycleError extends Error {
  constructor() {
    super("Catalog cursor cycle");
  }
}

function sameGenres(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameBook(left: BackendCatalogBook, right: BackendCatalogBook): boolean {
  const a = left.cover;
  const b = right.cover;
  return (
    left.bookEditionId === right.bookEditionId &&
    left.catalogKey === right.catalogKey &&
    left.title === right.title &&
    left.author === right.author &&
    left.format === right.format &&
    left.contentSha256 === right.contentSha256 &&
    left.generationStatus === right.generationStatus &&
    left.ready === right.ready &&
    left.sourceDownloadPath === right.sourceDownloadPath &&
    sameGenres(left.genres, right.genres) &&
    (a === b ||
      (!!a &&
        !!b &&
        a.contentHash === b.contentHash &&
        a.mimeType === b.mimeType &&
        a.byteSize === b.byteSize &&
        a.downloadPath === b.downloadPath))
  );
}

/** Preserve equal book, genre, and array references after a metadata refresh. */
export function retainCatalogMetadata(
  next: CatalogMetadata,
  previous: CatalogMetadata,
): CatalogMetadata {
  const oldBooks = new Map(previous.books.map((book) => [book.bookEditionId, book]));
  const retainedBooks = next.books.map((book) => {
    const old = oldBooks.get(book.bookEditionId);
    return old && sameBook(old, book) ? old : book;
  });
  const books =
    previous.books.length === retainedBooks.length &&
    previous.books.every((book, index) => book === retainedBooks[index])
      ? previous.books
      : retainedBooks;
  const genres =
    next.genres.length === previous.genres.length &&
    next.genres.every((genre, index) => {
      const old = previous.genres[index];
      return (
        genre.id === old.id &&
        genre.labelRu === old.labelRu &&
        genre.labelEn === old.labelEn &&
        genre.order === old.order
      );
    })
      ? previous.genres
      : next.genres;
  if (
    books === previous.books &&
    genres === previous.genres &&
    next.nextCursor === previous.nextCursor &&
    next.genreVersion === previous.genreVersion
  ) {
    return previous;
  }
  return { ...next, books, genres };
}

/**
 * One metadata loader shared by all mounted surfaces. A subscription is not an
 * active network consumer: screens retain state while blurred without owning work.
 */
export class CatalogStore {
  private readonly listeners = new Set<() => void>();
  private readonly consumers = new Set<symbol>();
  private readonly now: () => number;
  private readonly staleTimeMs: number;
  private readonly createGeneration: () => string;
  private snapshot: CatalogSnapshot = {
    catalog: EMPTY_CATALOG,
    isLoading: true,
    isRefreshing: false,
    loadedCount: 0,
    error: null,
    hasCompleteCatalog: false,
  };
  private hydration: Promise<void> | null = null;
  private hydrated = false;
  private generation: Generation | null = null;
  private run: CatalogRun | null = null;
  private drainingRun: Promise<void> | null = null;
  private freshUntil = 0;
  private persistence: Promise<void> = Promise.resolve();
  private generationSequence = 0;
  private readonly instanceId = Math.random().toString(36).slice(2, 10);
  private pageRequests = 0;
  private genreRequests = 0;
  private pendingWrites = 0;

  constructor(private readonly deps: CatalogStoreDependencies) {
    this.now = deps.now ?? Date.now;
    this.staleTimeMs = deps.staleTimeMs ?? 5 * 60 * 1000;
    this.createGeneration =
      deps.createGeneration ??
      (() => `${this.now()}-${this.instanceId}-${++this.generationSequence}`);
  }

  getSnapshot = (): CatalogSnapshot => this.snapshot;

  /** Local gauges only: no book ids, query text, cursor, or generation value. */
  getDiagnostics = () => ({
    consumers: this.consumers.size,
    listeners: this.listeners.size,
    loadedBooks: this.snapshot.catalog.books.length,
    pendingBooks: this.generation?.booksById.size ?? 0,
    pendingPages: this.generation?.pageCount ?? 0,
    pendingGeneration: this.generation ? 1 : 0,
    activeRun: this.run ? 1 : 0,
    drainingRun: this.drainingRun ? 1 : 0,
    pageRequests: this.pageRequests,
    genreRequests: this.genreRequests,
    pendingWrites: this.pendingWrites,
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  acquire = (): (() => void) => {
    const consumer = Symbol("catalog-consumer");
    this.consumers.add(consumer);
    void this.ensure();
    return () => {
      this.consumers.delete(consumer);
      // Native tab focus handoffs and Strict Mode may release then acquire in
      // the same turn. Do not cancel a request that already has its new owner.
      queueMicrotask(() => {
        if (this.consumers.size !== 0) return;
        this.cancelRun();
        this.update({
          // Keep the initial placeholder while paused; a return before the
          // passive acquire effect must not briefly show 'catalog is empty'.
          isLoading: !this.snapshot.hasCompleteCatalog && this.snapshot.error === null,
          isRefreshing: false,
        });
      });
    };
  };

  /** Retry resumes the failing cursor instead of downloading accepted pages again. */
  retry = async (): Promise<void> => {
    await this.hydrate();
    if (this.consumers.size === 0) return;
    if (
      this.snapshot.error instanceof CatalogCursorCycleError ||
      (this.generation &&
        this.generation.pageCount > 0 &&
        this.generation.nextCursor !== null &&
        this.snapshot.error instanceof NarraServiceError &&
        this.snapshot.error.code === "REQUEST")
    ) {
      // A rejected saved cursor cannot recover by retrying that same token.
      // Other failures (offline, timeout, rate limit) keep accepted pages.
      this.cancelRun();
      this.generation = this.makeGeneration();
    }
    if (!this.generation && this.snapshot.hasCompleteCatalog) this.freshUntil = 0;
    await this.ensure(true);
  };

  /** An explicit refresh supersedes old replies but leaves the visible snapshot intact. */
  refresh = async (): Promise<void> => {
    await this.hydrate();
    this.cancelRun();
    this.generation = this.makeGeneration();
    this.freshUntil = 0;
    await this.ensure(true);
  };

  private update(patch: Partial<CatalogSnapshot>): void {
    if (
      (Object.keys(patch) as Array<keyof CatalogSnapshot>).every(
        (key) => this.snapshot[key] === patch[key],
      )
    ) {
      return;
    }
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private hydrate(): Promise<void> {
    if (this.hydration) return this.hydration;
    this.hydration = (async () => {
      try {
        const stored = await this.deps.storage.read();
        if (stored.complete) {
          this.update({
            catalog: stored.complete,
            hasCompleteCatalog: true,
            isLoading: false,
            loadedCount: stored.complete.books.length,
          });
        }
        if (stored.progress) {
          this.generation = this.makeGeneration(stored.progress);
          if (!stored.complete) {
            this.update({ catalog: this.metadata(this.generation) });
          }
          this.update({ loadedCount: stored.progress.books.length });
        }
        if ("cacheError" in stored) this.deps.onCacheError?.(stored.cacheError);
      } catch (error) {
        this.deps.onCacheError?.(error);
      } finally {
        this.hydrated = true;
      }
    })();
    return this.hydration;
  }

  private makeGeneration(progress?: CatalogProgress): Generation {
    const catalog = progress && progress.genreVersion !== null ? progress : this.snapshot.catalog;
    const books = progress?.books ?? [];
    const requestedCursors = progress?.requestedCursors ?? [];
    return {
      generation: progress?.generation ?? this.createGeneration(),
      books,
      nextCursor: progress?.nextCursor ?? null,
      genres: catalog.genres,
      genreVersion: catalog.genreVersion,
      pageCount: progress?.pageCount ?? 0,
      requestedCursors,
      booksById: new Map(books.map((book) => [book.bookEditionId, book])),
      seenCursors: new Set(requestedCursors),
      // Refresh genres once per active run; a resumed journal may contain a
      // fallback dictionary if the prior request failed or the app was closed.
      genresLoaded: false,
      started: !!progress,
    };
  }

  private async ensure(retry = false): Promise<void> {
    if (!this.hydrated) await this.hydrate();
    if (this.consumers.size === 0) return;
    if (this.run) {
      if (!this.run.controller.signal.aborted) return this.run.promise;
      await this.run.promise;
      return this.ensure(retry);
    }
    if (this.drainingRun) {
      // An aborted native request may settle after a focus handoff. Do not
      // start the same generation/cursor while its previous caller is alive.
      await this.drainingRun;
      // Consumers, generation and freshness may all change while draining.
      return this.ensure(retry);
    }
    if (!retry && this.snapshot.error) return;
    if (!this.generation && this.snapshot.hasCompleteCatalog && this.now() < this.freshUntil)
      return;
    const generation = this.generation ?? this.makeGeneration();
    this.generation = generation;
    const run: CatalogRun = {
      controller: new AbortController(),
      generation,
      promise: Promise.resolve(),
    };
    this.run = run;
    // Publish the real promise before notifying subscribers: a reentrant
    // release/refresh must drain this run, not the placeholder promise.
    run.promise = Promise.resolve().then(() => this.load(run));
    this.update({
      isLoading: !this.snapshot.hasCompleteCatalog,
      isRefreshing: true,
      loadedCount: generation.booksById.size,
      error: null,
    });
    return run.promise;
  }

  private isCurrent(run: CatalogRun): boolean {
    return this.run === run && this.generation === run.generation && !run.controller.signal.aborted;
  }

  private cancelRun(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    const drain = run.promise.then(
      () => {},
      () => {},
    );
    this.drainingRun = drain;
    void drain.then(() => {
      if (this.drainingRun === drain) this.drainingRun = null;
    });
    run.controller.abort();
  }

  private metadata(generation: Generation): CatalogMetadata {
    return {
      books: Array.from(generation.booksById.values()),
      nextCursor: generation.nextCursor,
      genres: generation.genres,
      genreVersion: generation.genreVersion,
    };
  }

  /** Serialize journal/commit writes, checking ownership again before any mutation. */
  private persist(run: CatalogRun, write: () => Promise<void>): Promise<void> {
    this.pendingWrites += 1;
    const pending = this.persistence
      .then(async () => {
        if (this.generation !== run.generation) return;
        try {
          await write();
        } catch (error) {
          this.deps.onCacheError?.(error);
        }
      })
      .finally(() => {
        this.pendingWrites -= 1;
      });
    this.persistence = pending.catch(() => {});
    return pending;
  }

  private async load(run: CatalogRun): Promise<void> {
    if (!this.isCurrent(run)) return;
    const generation = run.generation;
    const signal = run.controller.signal;
    let genresError: unknown | null = null;
    if (!generation.genresLoaded) this.genreRequests += 1;
    const genresTask = generation.genresLoaded
      ? Promise.resolve()
      : Promise.resolve()
          // Schedule inside the observed promise chain so a synchronous
          // adapter error cannot skip cleanup or leave a request counter up.
          .then(() => (this.isCurrent(run) ? this.deps.fetchGenres(signal) : undefined))
          .then(
            (result) => {
              if (!result || !this.isCurrent(run)) return;
              generation.genres = result.items;
              generation.genreVersion = result.version;
              generation.genresLoaded = true;
            },
            (error) => {
              // Books remain usable offline with the last complete dictionary.
              // Keep Retry available instead of silently accepting missing genres.
              if (this.isCurrent(run)) genresError = error;
            },
          )
          .finally(() => {
            this.genreRequests -= 1;
          });
    try {
      if (!generation.started) {
        await this.persist(run, () => this.deps.storage.begin(generation.generation));
        if (!this.isCurrent(run)) return;
        generation.started = true;
      }
      while (this.isCurrent(run)) {
        if (generation.pageCount > 0 && generation.nextCursor === null) break;
        const cursor = generation.nextCursor;
        if (generation.seenCursors.has(cursor)) throw new CatalogCursorCycleError();
        this.pageRequests += 1;
        let page: BackendCatalogPage;
        try {
          page = await this.deps.fetchPage(cursor ?? undefined, signal);
        } finally {
          this.pageRequests -= 1;
        }
        if (!this.isCurrent(run)) return;
        // Never turn a repeated cursor into a false 'complete' snapshot.
        if (
          page.nextCursor !== null &&
          (page.nextCursor === cursor || generation.seenCursors.has(page.nextCursor))
        ) {
          throw new CatalogCursorCycleError();
        }
        const index = generation.pageCount;
        for (const book of page.items) generation.booksById.set(book.bookEditionId, book);
        generation.seenCursors.add(cursor);
        generation.requestedCursors.push(cursor);
        generation.pageCount += 1;
        generation.nextCursor = page.nextCursor;
        this.update({
          loadedCount: generation.booksById.size,
          // A cold Library may show accepted books immediately. Search can use
          // hasCompleteCatalog to defer genre shelves until their order is known.
          ...(!this.snapshot.hasCompleteCatalog ? { catalog: this.metadata(generation) } : {}),
        });
        await this.persist(run, () =>
          this.deps.storage.append({
            generation: generation.generation,
            index,
            cursor,
            page,
            genres: generation.genres,
            genreVersion: generation.genreVersion,
          }),
        );
      }
      await genresTask;
      if (!this.isCurrent(run)) return;
      if (genresError) {
        // Keep the accepted last page and its journal until the dictionary can
        // be retried. A dictionary-only failure must not refetch every page or
        // replace a previously complete catalog with an incomplete generation.
        this.update({
          error: genresError,
          ...(!this.snapshot.hasCompleteCatalog ? { catalog: this.metadata(generation) } : {}),
        });
        return;
      }
      const complete = retainCatalogMetadata(this.metadata(generation), this.snapshot.catalog);
      await this.persist(run, () => this.deps.storage.commit(complete, generation.generation));
      if (!this.isCurrent(run)) return;
      this.freshUntil = this.now() + this.staleTimeMs;
      this.generation = null;
      this.update({
        catalog: complete,
        hasCompleteCatalog: true,
        loadedCount: complete.books.length,
        error: genresError,
      });
    } catch (error) {
      if (!this.isCurrent(run)) return;
      this.update({
        error,
        // On a first offline/error load, accepted pages are still available for
        // reading and Retry. Never replace a previously complete catalog.
        ...(!this.snapshot.hasCompleteCatalog && generation.booksById.size > 0
          ? { catalog: this.metadata(generation) }
          : {}),
      });
      // A page failure can settle before the concurrent genres request. It no
      // longer has an active run owner and must not outlive a later retry.
      run.controller.abort();
    } finally {
      // A failed/cancelled page must also drain its concurrent dictionary.
      // The configured gateway bounds both callers through auth and body.
      await genresTask;
      if (this.run === run) {
        this.run = null;
        this.update({ isLoading: false, isRefreshing: false });
      }
    }
  }
}

export function createCatalogStore(deps: CatalogStoreDependencies): CatalogStore {
  return new CatalogStore(deps);
}
