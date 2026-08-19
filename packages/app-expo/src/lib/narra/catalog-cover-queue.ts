import type { CachedBackendCatalogBook } from "./backend-catalog-cache";

interface CatalogCoverQueueOptions {
  concurrency: number;
  load: (book: CachedBackendCatalogBook, signal: AbortSignal) => Promise<string | undefined>;
  onLoaded: (catalogKey: string, coverUri: string) => void;
  onError?: (catalogKey: string, error: unknown) => void;
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

  constructor(options: CatalogCoverQueueOptions) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency));
    this.loadCover = options.load;
    this.onLoaded = options.onLoaded;
    this.onError = options.onError;
  }

  enqueue(books: CachedBackendCatalogBook[]): void {
    for (const book of books) void this.load(book);
  }

  load(book: CachedBackendCatalogBook, priority = false): Promise<string | undefined> {
    if (book.coverUri || !book.cover || this.disposed) return Promise.resolve(book.coverUri);

    const existing = this.entries.get(book.catalogKey);
    if (existing) {
      if (priority && !this.active.has(book.catalogKey)) {
        this.pending = [existing, ...this.pending.filter((entry) => entry !== existing)];
      }
      return existing.promise;
    }

    let resolveEntry: QueueEntry["resolve"] = () => {};
    const promise = new Promise<string | undefined>((resolve) => {
      resolveEntry = resolve;
    });
    const entry = { book, promise, resolve: resolveEntry };
    this.entries.set(book.catalogKey, entry);
    if (priority) this.pending.unshift(entry);
    else this.pending.push(entry);
    this.pump();
    return promise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.pending) {
      this.entries.delete(entry.book.catalogKey);
      entry.resolve(undefined);
    }
    this.pending = [];
    for (const controller of this.active.values()) controller.abort();
  }

  private pump(): void {
    while (!this.disposed && this.active.size < this.concurrency) {
      const entry = this.pending.shift();
      if (!entry) return;
      const controller = new AbortController();
      this.active.set(entry.book.catalogKey, controller);
      void this.run(entry, controller);
    }
  }

  private async run(entry: QueueEntry, controller: AbortController): Promise<void> {
    const { catalogKey } = entry.book;
    try {
      const coverUri = await this.loadCover(entry.book, controller.signal);
      if (!this.disposed && coverUri) this.onLoaded(catalogKey, coverUri);
      entry.resolve(coverUri);
    } catch (error) {
      if (!controller.signal.aborted) this.onError?.(catalogKey, error);
      entry.resolve(undefined);
    } finally {
      this.active.delete(catalogKey);
      this.entries.delete(catalogKey);
      this.pump();
    }
  }
}
