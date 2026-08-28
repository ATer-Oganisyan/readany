import type { BackendCatalogBook } from "./backend-catalog-api";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import { catalogCoverIdentity } from "./catalog-cover-state";

export interface CatalogCoverSnapshot {
  coverUri?: string;
  coverLoadFailed?: boolean;
}

const EMPTY_COVER: CatalogCoverSnapshot = Object.freeze({});

/** Per revision subscriptions; finishing one download never publishes new metadata. */
export class CatalogCoverStore {
  private readonly covers = new Map<string, CatalogCoverSnapshot>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly combined = new WeakMap<
    CachedBackendCatalogBook,
    { cover: CatalogCoverSnapshot; book: CachedBackendCatalogBook }
  >();
  private currentIdentities: Set<string> | null = null;

  getSnapshot = (identity: string): CatalogCoverSnapshot =>
    this.covers.get(identity) ?? EMPTY_COVER;

  getDiagnostics = () => {
    let listeners = 0;
    for (const subscriptions of this.listeners.values()) listeners += subscriptions.size;
    return {
      entries: this.covers.size,
      listeners,
      subscribedIdentities: this.listeners.size,
      currentIdentities: this.currentIdentities?.size ?? 0,
    };
  };

  subscribe = (identity: string, listener: () => void): (() => void) => {
    let subscriptions = this.listeners.get(identity);
    if (!subscriptions) {
      subscriptions = new Set();
      this.listeners.set(identity, subscriptions);
    }
    subscriptions.add(listener);
    return () => {
      subscriptions.delete(listener);
      if (subscriptions.size === 0) {
        this.listeners.delete(identity);
        if (this.currentIdentities && !this.currentIdentities.has(identity))
          this.covers.delete(identity);
      }
    };
  };

  getBook = (book: CachedBackendCatalogBook): CachedBackendCatalogBook => {
    const cover = this.getSnapshot(catalogCoverIdentity(book));
    if (cover === EMPTY_COVER) return book;
    const cached = this.combined.get(book);
    if (cached?.cover === cover) return cached.book;
    const combined = { ...book, coverUri: cover.coverUri, coverLoadFailed: cover.coverLoadFailed };
    this.combined.set(book, { cover, book: combined });
    return combined;
  };

  setResult = (book: CachedBackendCatalogBook, coverUri?: string): void => {
    const identity = catalogCoverIdentity(book);
    if (!this.isCurrent(book)) return;
    const previous = this.covers.get(identity);
    // A late failure must not remove an already downloaded same-version cover.
    if (!coverUri && (previous?.coverUri || (!previous && book.coverUri))) return;
    this.set(identity, { coverUri, coverLoadFailed: !coverUri });
  };

  retry = (book: BackendCatalogBook): void => {
    if (!this.isCurrent(book)) return;
    this.set(catalogCoverIdentity(book), { coverUri: undefined, coverLoadFailed: false });
  };

  resetFailures = (): void => {
    for (const [identity, cover] of this.covers) {
      if (cover.coverLoadFailed) {
        this.set(identity, { coverUri: cover.coverUri, coverLoadFailed: false });
      }
    }
  };

  /** Remove obsolete cover revisions after a new complete metadata generation. */
  retainBooks = (books: BackendCatalogBook[]): void => {
    this.currentIdentities = new Set(books.map(catalogCoverIdentity));
    for (const identity of this.covers.keys()) {
      // A card can still show the previous metadata during React's handoff.
      // Keep its snapshot until it unsubscribes, then discard that revision.
      if (!this.currentIdentities.has(identity) && !this.listeners.has(identity))
        this.covers.delete(identity);
    }
  };

  private isCurrent(book: BackendCatalogBook): boolean {
    return (
      this.currentIdentities === null || this.currentIdentities.has(catalogCoverIdentity(book))
    );
  }

  private set(identity: string, cover: CatalogCoverSnapshot): void {
    const previous = this.covers.get(identity);
    if (
      previous?.coverUri === cover.coverUri &&
      previous?.coverLoadFailed === cover.coverLoadFailed
    ) {
      return;
    }
    this.covers.set(identity, cover);
    for (const listener of this.listeners.get(identity) ?? []) listener();
  }
}

export const catalogCoverStore = new CatalogCoverStore();
export const getCatalogBookWithCover = catalogCoverStore.getBook;
