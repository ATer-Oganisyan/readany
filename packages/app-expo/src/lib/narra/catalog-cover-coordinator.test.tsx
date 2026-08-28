import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useCatalogCoverWindow } from "../../hooks/use-catalog-cover-window";
import type { CachedBackendCatalogBook } from "./backend-catalog-cache";
import { CatalogCoverCoordinator, catalogCoverCoordinator } from "./catalog-cover-coordinator";
import { CatalogCoverQueue } from "./catalog-cover-queue";

vi.mock("./backend-catalog-cache", () => ({ materializeBackendCatalogCover: vi.fn() }));
vi.mock("@/lib/diagnostics/interaction-performance", () => ({ markInteraction: vi.fn() }));

const fixture = (index: number): CachedBackendCatalogBook => ({
  bookEditionId: `window-edition-${index}`,
  catalogKey: `window-book-${index}`,
  title: "Test fixture",
  author: "Fixture author",
  genres: ["fiction"],
  resolution: "catalog",
  format: "epub",
  contentSha256: "a".repeat(64),
  generationStatus: "ready",
  ready: true,
  sourceDownloadPath: "/fixture/source",
  cover: {
    contentHash: "b".repeat(64),
    byteSize: 42,
    mimeType: "image/jpeg",
    downloadPath: "/fixture/cover",
  },
});

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function pendingLoads({ ignoreAbort = false } = {}) {
  const requests: {
    book: CachedBackendCatalogBook;
    signal: AbortSignal;
    resolve: (uri: string) => void;
  }[] = [];
  let active = 0;
  let maximumActive = 0;
  const load = vi.fn((book: CachedBackendCatalogBook, signal: AbortSignal) => {
    active += 1;
    maximumActive = Math.max(active, maximumActive);
    return new Promise<string>((resolve, reject) => {
      requests.push({ book, signal, resolve });
      if (!ignoreAbort)
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }).finally(() => {
      active -= 1;
    });
  });
  const resolve = (index: number) => {
    const request = requests[index];
    if (!request) throw new Error(`Missing fixture request ${index}`);
    request.resolve(`file:///fixture/${request.book.bookEditionId}`);
  };
  return { load, requests, resolve, maximumActive: () => maximumActive };
}

describe("shared catalog cover windows", () => {
  it("hands a shared in-flight cover between screens without abort/restart", async () => {
    const io = pendingLoads();
    const onLoaded = vi.fn();
    const queue = new CatalogCoverQueue({ concurrency: 3, load: io.load, onLoaded });
    const coordinator = new CatalogCoverCoordinator(queue);
    const search = Symbol("search");
    const category = Symbol("category");
    const book = fixture(0);
    coordinator.setWindow(search, { visible: [book], nearby: [] });
    await settle();
    expect(io.load).toHaveBeenCalledTimes(1);
    coordinator.removeWindow(search);
    coordinator.setWindow(category, { visible: [book], nearby: [] });
    await settle();
    expect(io.load).toHaveBeenCalledTimes(1);
    expect(io.requests[0]?.signal.aborted).toBe(false);
    io.resolve(0);
    await settle();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    coordinator.removeWindow(category);
    await settle();
    expect(queue.getDiagnostics()).toEqual({ active: 0, pending: 0, entries: 0 });
    expect(coordinator.getConsumerCount()).toBe(0);
  });

  it("enforces one global limit of three across overlapping screens and prioritizes visible work", async () => {
    const io = pendingLoads();
    const queue = new CatalogCoverQueue({ concurrency: 3, load: io.load, onLoaded: vi.fn() });
    const coordinator = new CatalogCoverCoordinator(queue);
    const library = Symbol("library");
    const search = Symbol("search");
    coordinator.setWindow(library, {
      visible: [fixture(0), fixture(1)],
      nearby: [fixture(2), fixture(3)],
    });
    coordinator.setWindow(search, { visible: [fixture(1), fixture(4)], nearby: [fixture(5)] });
    await settle();
    expect(io.requests.map(({ book }) => book.bookEditionId)).toEqual([
      "window-edition-0",
      "window-edition-1",
      "window-edition-4",
    ]);
    expect(queue.getDiagnostics()).toEqual({ active: 3, pending: 3, entries: 6 });
    coordinator.removeWindow(library);
    coordinator.removeWindow(search);
    await settle();
    expect(io.maximumActive()).toBe(3);
    expect(queue.getDiagnostics()).toEqual({ active: 0, pending: 0, entries: 0 });
  });

  it("drops a stale success even when the native loader ignores abort", async () => {
    const io = pendingLoads({ ignoreAbort: true });
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const queue = new CatalogCoverQueue({ concurrency: 1, load: io.load, onLoaded, onError });
    queue.prioritize([fixture(0)], [fixture(1)]);
    const abandoned = queue.load(fixture(0));
    queue.prioritize([fixture(2)], []);
    expect(io.requests[0]?.signal.aborted).toBe(true);
    io.resolve(0);
    await settle();
    expect(await abandoned).toBeUndefined();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(io.requests.map(({ book }) => book.bookEditionId)).toEqual([
      "window-edition-0",
      "window-edition-2",
    ]);
    io.resolve(1);
    await settle();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded.mock.calls[0][0]).toBe("window-book-2");
    expect(onError).not.toHaveBeenCalled();
    expect(io.maximumActive()).toBe(1);
    expect(queue.getDiagnostics()).toEqual({ active: 0, pending: 0, entries: 0 });
  });

  it("restarts a quickly wanted-again aborted cover only after the old task settles", async () => {
    const io = pendingLoads({ ignoreAbort: true });
    const onLoaded = vi.fn();
    const queue = new CatalogCoverQueue({ concurrency: 1, load: io.load, onLoaded });
    queue.prioritize([fixture(0)], []);
    queue.prioritize([fixture(1)], []);
    queue.prioritize([fixture(0)], []);
    expect(io.load).toHaveBeenCalledTimes(1);
    io.resolve(0);
    await settle();
    expect(io.load).toHaveBeenCalledTimes(2);
    expect(io.requests[1]?.book.bookEditionId).toBe("window-edition-0");
    expect(onLoaded).not.toHaveBeenCalled();
    io.resolve(1);
    await settle();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(io.maximumActive()).toBe(1);
    expect(queue.getDiagnostics()).toEqual({ active: 0, pending: 0, entries: 0 });
  });

  it("leaves no pending tasks or consumers after 50 slow-load open/close cycles", async () => {
    const io = pendingLoads();
    const queue = new CatalogCoverQueue({ concurrency: 3, load: io.load, onLoaded: vi.fn() });
    const coordinator = new CatalogCoverCoordinator(queue);
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const owner = Symbol("cycle");
      coordinator.setWindow(owner, {
        visible: [fixture(cycle)],
        nearby: Array.from({ length: 5 }, (_, i) => fixture(cycle + i + 1)),
      });
      await settle();
      expect(queue.getDiagnostics().active).toBe(3);
      coordinator.removeWindow(owner);
      await settle();
      expect(queue.getDiagnostics()).toEqual({ active: 0, pending: 0, entries: 0 });
      expect(coordinator.getConsumerCount()).toBe(0);
    }
    expect(io.maximumActive()).toBe(3);
  });
});

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
let tree: ReactTestRenderer | undefined;
beforeAll(() => {
  previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});
afterEach(async () => {
  if (tree)
    await act(async () => {
      tree?.unmount();
    });
  tree = undefined;
  vi.restoreAllMocks();
});

function WindowWorker(props: Parameters<typeof useCatalogCoverWindow>[0]) {
  useCatalogCoverWindow(props);
  return null;
}

it("updates the real hook window without unmount cleanup on every viewport change", async () => {
  const remove = vi.spyOn(catalogCoverCoordinator, "removeWindow");
  const set = vi.spyOn(catalogCoverCoordinator, "setWindow");
  const book = { ...fixture(1000), cover: undefined };
  await act(async () => {
    tree = create(createElement(WindowWorker, { visible: [book], nearby: [], active: true }));
  });
  expect(remove).not.toHaveBeenCalled();
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      tree?.update(createElement(WindowWorker, { visible: [book], nearby: [], active: true }));
    });
  }
  expect(set).toHaveBeenCalledTimes(6);
  expect(remove).not.toHaveBeenCalled();
  expect(catalogCoverCoordinator.getConsumerCount()).toBe(1);
  await act(async () => {
    tree?.update(createElement(WindowWorker, { visible: [book], nearby: [], active: false }));
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(catalogCoverCoordinator.getConsumerCount()).toBe(0);
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
  expect(remove).toHaveBeenCalledTimes(2);
});
