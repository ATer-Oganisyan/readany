import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import { catalogCoverIdentity } from "./catalog-cover-state";

interface CatalogCoverQueueOptions {
  concurrency: number;
  load: (book: CachedBackendCatalogBook, signal: AbortSignal) => Promise<string | undefined>;
  onLoaded: (catalogKey: string, coverUri: string, book: CachedBackendCatalogBook) => void;
  onError?: (catalogKey: string, error: unknown, book: CachedBackendCatalogBook) => void;
}

interface QueueEntry {
  book: CachedBackendCatalogBook;
  promise: Promise<string | undefined>;
  resolve: (coverUri: string | undefined) => void;
}

export interface VisibleCatalogCoverOptions {
  books: CachedBackendCatalogBook[];
  gridTop: number;
  viewportHeight: number;
  columnCount: number;
  cardHeight: number;
  rowGap: number;
  overscan: number;
}

export function visibleCatalogCoverBooks({
  books,
  gridTop,
  viewportHeight,
  columnCount,
  cardHeight,
  rowGap,
  overscan,
}: VisibleCatalogCoverOptions): CachedBackendCatalogBook[] {
  const safeColumnCount = Math.max(1, columnCount);
  const viewportTop = -Math.max(0, overscan);
  const viewportBottom = viewportHeight + Math.max(0, overscan);
  const rowHeight = cardHeight + rowGap;

  return books.filter((book, index) => {
    if (!book.cover || book.coverUri) return false;
    const row = Math.floor(index / safeColumnCount);
    const top = gridTop + row * rowHeight;
    return top + cardHeight >= viewportTop && top <= viewportBottom;
  });
}

/** A small, deduplicating queue so catalog covers never saturate the network. */
export class CatalogCoverQueue {
  private readonly concurrency: number;
  private readonly loadCover: CatalogCoverQueueOptions["load"];
  private readonly onLoaded: CatalogCoverQueueOptions["onLoaded"];
  private readonly onError?: CatalogCoverQueueOptions["onError"];
  private readonly entries = new Map<string, QueueEntry>();
  private readonly active = new Map<string, AbortController>();
  private pending: QueueEntry[] = [];
  private disposed = false;
  private paused = false;

  constructor(options: CatalogCoverQueueOptions) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency));
    this.loadCover = options.load;
    this.onLoaded = options.onLoaded;
    this.onError = options.onError;
  }

  enqueue(books: CachedBackendCatalogBook[]): void {
    for (const book of books) void this.load(book);
  }

  /** Keep current books ahead of prefetch; drop work queued for abandoned pages. */
  prioritize(visible: CachedBackendCatalogBook[], nearby: CachedBackendCatalogBook[]): void {
    const ordered = [...visible, ...nearby];
    const rank = new Map(
      ordered.map((book, index) => [catalogCoverIdentity(book), index] as const).reverse(),
    );
    this.pending = this.pending.filter((entry) => {
      const identity = catalogCoverIdentity(entry.book);
      if (rank.has(identity)) return true;
      this.entries.delete(identity);
      entry.resolve(undefined);
      return false;
    });
    this.paused = true;
    this.enqueue(ordered);
    this.pending.sort(
      (a, b) => rank.get(catalogCoverIdentity(a.book))! - rank.get(catalogCoverIdentity(b.book))!,
    );
    this.paused = false;
    this.pump();
  }

  load(book: CachedBackendCatalogBook, priority = false): Promise<string | undefined> {
    if (book.coverUri || !book.cover || book.coverLoadFailed || this.disposed)
      return Promise.resolve(book.coverUri);

    const identity = catalogCoverIdentity(book);
    const existing = this.entries.get(identity);
    if (existing) {
      if (priority && !this.active.has(identity)) {
        this.pending = [existing, ...this.pending.filter((entry) => entry !== existing)];
      }
      return existing.promise;
    }

    let resolveEntry: QueueEntry["resolve"] = () => {};
    const promise = new Promise<string | undefined>((resolve) => {
      resolveEntry = resolve;
    });
    const entry = { book, promise, resolve: resolveEntry };
    this.entries.set(identity, entry);
    if (priority) this.pending.unshift(entry);
    else this.pending.push(entry);
    this.pump();
    return promise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.pending) {
      this.entries.delete(catalogCoverIdentity(entry.book));
      entry.resolve(undefined);
    }
    this.pending = [];
    for (const controller of this.active.values()) controller.abort();
  }

  private pump(): void {
    while (!this.disposed && !this.paused && this.active.size < this.concurrency) {
      const entry = this.pending.shift();
      if (!entry) return;
      const controller = new AbortController();
      this.active.set(catalogCoverIdentity(entry.book), controller);
      void this.run(entry, controller);
    }
  }

  private async run(entry: QueueEntry, controller: AbortController): Promise<void> {
    const { catalogKey } = entry.book;
    try {
      const coverUri = await this.loadCover(entry.book, controller.signal);
      if (!this.disposed && coverUri) this.onLoaded(catalogKey, coverUri, entry.book);
      entry.resolve(coverUri);
    } catch (error) {
      if (!controller.signal.aborted) this.onError?.(catalogKey, error, entry.book);
      entry.resolve(undefined);
    } finally {
      this.active.delete(catalogCoverIdentity(entry.book));
      this.entries.delete(catalogCoverIdentity(entry.book));
      this.pump();
    }
  }
}
