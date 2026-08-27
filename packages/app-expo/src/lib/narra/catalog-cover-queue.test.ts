import { describe, expect, it, vi } from "vitest";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import { CatalogCoverQueue, visibleCatalogCoverBooks } from "./catalog-cover-queue";

function book(index: number, coverUri?: string): CachedBackendCatalogBook {
  return {
    resolution: "catalog",
    bookEditionId: `edition-${index}`,
    catalogKey: `book-${index}`,
    title: `Book ${index}`,
    author: "Author",
    genres: ["fiction"],
    format: "epub",
    contentSha256: "a".repeat(64),
    generationStatus: "base_ready",
    ready: true,
    sourceDownloadPath: `/v2/books/${index}/source/download`,
    cover: {
      contentHash: "b".repeat(64),
      mimeType: "image/jpeg",
      byteSize: 42,
      downloadPath: `/v2/books/${index}/cover/download`,
    },
    coverUri,
  };
}

describe("catalog cover queue", () => {
  it("selects only visible and near-viewport rows", () => {
    const books = Array.from({ length: 12 }, (_, index) => book(index));

    expect(
      visibleCatalogCoverBooks({
        books,
        gridTop: 300,
        viewportHeight: 800,
        columnCount: 2,
        cardHeight: 300,
        rowGap: 16,
        overscan: 100,
      }).map((item) => item.catalogKey),
    ).toEqual(["book-0", "book-1", "book-2", "book-3"]);
  });

  it("deduplicates loads and respects the concurrency limit", async () => {
    const resolvers: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const load = vi.fn(async (item: CachedBackendCatalogBook) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      active -= 1;
      return `file:///covers/${item.catalogKey}.jpg`;
    });
    const onLoaded = vi.fn();
    const queue = new CatalogCoverQueue({ concurrency: 2, load, onLoaded });

    queue.enqueue([book(0), book(1), book(2), book(0)]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    resolvers.shift()?.();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    for (const resolve of resolvers.splice(0)) resolve();
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(3));

    expect(maxActive).toBe(2);
  });

  it("aborts active work and drops pending covers when disposed", async () => {
    const aborted: string[] = [];
    const load = vi.fn(
      async (item: CachedBackendCatalogBook, signal: AbortSignal): Promise<string> => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted.push(item.catalogKey);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
        return "unreachable";
      },
    );
    const queue = new CatalogCoverQueue({ concurrency: 1, load, onLoaded: vi.fn() });

    queue.enqueue([book(0), book(1)]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    queue.dispose();
    await vi.waitFor(() => expect(aborted).toEqual(["book-0"]));

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("prioritizes the new viewport and drops obsolete prefetch after a fast scroll", async () => {
    const releases: Array<() => void> = [];
    const load = vi.fn(async (item: CachedBackendCatalogBook) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return `file:///${item.catalogKey}`;
    });
    const queue = new CatalogCoverQueue({ concurrency: 1, load, onLoaded: vi.fn() });
    queue.prioritize([book(0)], [book(1), book(2)]);
    queue.prioritize([book(3)], [book(4), book(3)]);
    releases.shift()!();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[1][0].catalogKey).toBe("book-3");
    releases.shift()!();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(load.mock.calls[2][0].catalogKey).toBe("book-4");
    releases.shift()!();
  });

  it("deduplicates by target version, not just book ID", async () => {
    const load = vi.fn(
      async (item: CachedBackendCatalogBook) => `file:///${item.cover!.contentHash}`,
    );
    const queue = new CatalogCoverQueue({ concurrency: 2, load, onLoaded: vi.fn() });
    const first = book(0);
    const newer = { ...first, cover: { ...first.cover!, contentHash: "c".repeat(64) } };
    await Promise.all([queue.load(first), queue.load(first), queue.load(newer)]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not continuously retry a failed cover on unrelated updates", async () => {
    const load = vi.fn(async () => {
      throw new Error("offline");
    });
    const onError = vi.fn();
    const queue = new CatalogCoverQueue({ concurrency: 2, load, onLoaded: vi.fn(), onError });
    await queue.load(book(0));
    expect(onError).toHaveBeenCalledTimes(1);
    await queue.load({ ...book(0), coverLoadFailed: true });
    expect(load).toHaveBeenCalledTimes(1);
    await queue.load({ ...book(0), coverLoadFailed: false });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
