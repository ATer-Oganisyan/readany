import { describe, expect, it, vi } from "vitest";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import { catalogCoverIdentity } from "./catalog-cover-state";
import { CatalogCoverStore } from "./catalog-cover-store";

function book(id: string, hash = "a"): CachedBackendCatalogBook {
  return {
    resolution: "catalog",
    bookEditionId: id,
    catalogKey: id,
    title: id,
    author: "Author",
    genres: [],
    format: "epub",
    contentSha256: "0".repeat(64),
    sourceDownloadPath: `/v2/books/${id}/source/download`,
    generationStatus: "ready",
    ready: true,
    cover: {
      contentHash: hash.repeat(64),
      mimeType: "image/jpeg",
      byteSize: 10,
      downloadPath: `/v2/books/${id}/cover/download`,
    },
  };
}

describe("per-card catalog cover store", () => {
  it("notifies only the requested revision and preserves other book references", () => {
    const store = new CatalogCoverStore();
    const a = book("a");
    const b = book("b");
    const firstListener = vi.fn();
    const otherListener = vi.fn();
    store.subscribe(catalogCoverIdentity(a), firstListener);
    store.subscribe(catalogCoverIdentity(b), otherListener);
    store.setResult(a, "file:///a.jpg");
    expect(firstListener).toHaveBeenCalledOnce();
    expect(otherListener).not.toHaveBeenCalled();
    expect(store.getBook(b)).toBe(b);
    expect(store.getBook(a).coverUri).toBe("file:///a.jpg");
    expect(store.getBook(a)).toBe(store.getBook(a));
    expect(a.coverUri).toBeUndefined();
  });

  it("preserves snapshots and avoids notifications for duplicate success and late failure", () => {
    const store = new CatalogCoverStore();
    const item = book("a");
    store.setResult(item, "file:///a.jpg");
    const stable = store.getBook(item);
    const listener = vi.fn();
    store.subscribe(catalogCoverIdentity(item), listener);
    store.setResult(item, "file:///a.jpg");
    store.setResult(item);
    store.resetFailures();
    expect(store.getBook(item)).toBe(stable);
    expect(listener).not.toHaveBeenCalled();
  });

  it("resets only actual failures and makes retry immediately eligible", () => {
    const store = new CatalogCoverStore();
    const a = book("a");
    const b = book("b");
    store.setResult(a);
    const aListener = vi.fn();
    const bListener = vi.fn();
    store.subscribe(catalogCoverIdentity(a), aListener);
    store.subscribe(catalogCoverIdentity(b), bListener);
    store.resetFailures();
    expect(store.getBook(a).coverLoadFailed).toBe(false);
    expect(aListener).toHaveBeenCalledOnce();
    expect(bListener).not.toHaveBeenCalled();
    store.setResult(a, "file:///a.jpg");
    store.retry(a);
    expect(store.getBook(a)).toMatchObject({ coverUri: undefined, coverLoadFailed: false });
  });

  it("rejects stale revisions and releases obsolete cover data after catalog replacement", () => {
    const store = new CatalogCoverStore();
    const old = book("a", "a");
    const next = book("a", "b");
    store.retainBooks([old]);
    store.setResult(old, "file:///old.jpg");
    store.retainBooks([next]);
    store.setResult(old, "file:///late.jpg");
    expect(store.getSnapshot(catalogCoverIdentity(old))).toEqual({});
    expect(store.getBook(next)).toBe(next);
    store.setResult(next, "file:///next.jpg");
    expect(store.getBook(next).coverUri).toBe("file:///next.jpg");
  });

  it("releases listeners on unmount and respects a cached cover until explicit retry", () => {
    const store = new CatalogCoverStore();
    const item = { ...book("a"), coverUri: "file:///cached.jpg" };
    expect(store.getBook(item)).toBe(item);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(catalogCoverIdentity(item), listener);
    unsubscribe();
    store.setResult(item);
    expect(store.getBook(item)).toBe(item);
    store.retry(item);
    expect(store.getBook(item).coverUri).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("retains a mounted old card during the metadata handoff and releases its revision on unmount", () => {
    const store = new CatalogCoverStore();
    const old = book("a", "a");
    const next = book("a", "b");
    store.retainBooks([old]);
    store.setResult(old, "file:///old.jpg");
    const unsubscribe = store.subscribe(catalogCoverIdentity(old), vi.fn());
    store.retainBooks([next]);
    expect(store.getBook(old).coverUri).toBe("file:///old.jpg");
    unsubscribe();
    expect(store.getSnapshot(catalogCoverIdentity(old))).toEqual({});
  });

  it("accepts both active editions when one catalog key has two current cover revisions", () => {
    const store = new CatalogCoverStore();
    const a = { ...book("edition-a", "a"), catalogKey: "same-work" };
    const b = { ...book("edition-b", "b"), catalogKey: "same-work" };
    store.retainBooks([a, b]);
    store.setResult(a, "file:///edition-a.jpg");
    store.setResult(b, "file:///edition-b.jpg");
    expect(store.getBook(a).coverUri).toBe("file:///edition-a.jpg");
    expect(store.getBook(b).coverUri).toBe("file:///edition-b.jpg");
    expect(store.getDiagnostics().entries).toBe(2);
  });

  it("keeps cover data bounded through fifty catalog replacements and releases all subscriptions", () => {
    const store = new CatalogCoverStore();
    let peakEntries = 0;
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const item = book(`edition-${cycle}`);
      store.retainBooks([item]);
      const unsubscribe = store.subscribe(catalogCoverIdentity(item), vi.fn());
      store.setResult(item, `file:///cover-${cycle}.jpg`);
      peakEntries = Math.max(peakEntries, store.getDiagnostics().entries);
      unsubscribe();
    }
    expect(peakEntries).toBe(1);
    expect(store.getDiagnostics()).toEqual({
      entries: 1,
      listeners: 0,
      subscribedIdentities: 0,
      currentIdentities: 1,
    });
    store.retainBooks([]);
    expect(store.getDiagnostics().entries).toBe(0);
  });
});
