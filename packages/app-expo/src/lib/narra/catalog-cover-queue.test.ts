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
    format: "epub",
    contentSha256: "a".repeat(64),
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
});
