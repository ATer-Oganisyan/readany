import { markInteraction } from "@/lib/diagnostics/interaction-performance";
import {
  type CachedBackendCatalogBook,
  materializeBackendCatalogCover,
} from "./backend-catalog-cache";
import { CatalogCoverQueue } from "./catalog-cover-queue";
import { catalogCoverIdentity } from "./catalog-cover-state";
import { catalogCoverStore, getCatalogBookWithCover } from "./catalog-cover-store";

interface CoverWindow {
  visible: CachedBackendCatalogBook[];
  nearby: CachedBackendCatalogBook[];
}

/** One queue across tab/stack handoffs, with a strict global maximum of three loads. */
export class CatalogCoverCoordinator {
  private readonly windows = new Map<symbol, CoverWindow>();
  private updateScheduled = false;

  constructor(private readonly queue: CatalogCoverQueue) {}

  setWindow(owner: symbol, window: CoverWindow): void {
    this.windows.set(owner, window);
    this.scheduleUpdate();
  }

  removeWindow(owner: symbol): void {
    if (this.windows.delete(owner)) this.scheduleUpdate();
  }

  retry(book: CachedBackendCatalogBook): void {
    const identity = catalogCoverIdentity(book);
    const wanted = [...this.windows.values()].some(({ visible, nearby }) =>
      [...visible, ...nearby].some((candidate) => catalogCoverIdentity(candidate) === identity),
    );
    if (!wanted) return;
    catalogCoverStore.retry(book);
    this.scheduleUpdate();
  }

  getConsumerCount(): number {
    return this.windows.size;
  }

  private scheduleUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    // A focus handoff/StrictMode cleanup may remove one window before adding the next.
    // Publish the final windows from this commit without aborting their shared covers.
    queueMicrotask(() => {
      this.updateScheduled = false;
      this.update();
    });
  }

  private update(): void {
    const visible: CachedBackendCatalogBook[] = [];
    const nearby: CachedBackendCatalogBook[] = [];
    for (const window of this.windows.values()) {
      visible.push(...window.visible.map(getCatalogBookWithCover));
      nearby.push(...window.nearby.map(getCatalogBookWithCover));
    }
    this.queue.prioritize(visible, nearby);
  }
}

const sharedQueue = new CatalogCoverQueue({
  concurrency: 3,
  load: materializeBackendCatalogCover,
  onLoaded: (_key, uri, book) => {
    catalogCoverStore.setResult(book, uri);
    markInteraction("catalog.cover.complete");
  },
  onError: (_key, _error, book) => catalogCoverStore.setResult(book),
});

export const catalogCoverCoordinator = new CatalogCoverCoordinator(sharedQueue);
export const retryCatalogCover = (book: CachedBackendCatalogBook) =>
  catalogCoverCoordinator.retry(book);

if (typeof __DEV__ !== "undefined" && __DEV__) {
  Object.assign(globalThis, {
    __NARRA_COVER_STATUS__: () => ({
      ...sharedQueue.getDiagnostics(),
      consumers: catalogCoverCoordinator.getConsumerCount(),
      store: catalogCoverStore.getDiagnostics(),
    }),
  });
}
