import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeBook = { sections: never[]; destroy: ReturnType<typeof vi.fn> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness({
  fixedLayout = false,
  failSavedLocation = false,
  failFallback = false,
  emitInitialLoad = false,
  initialNavigation = async () => {},
}: {
  fixedLayout?: boolean;
  failSavedLocation?: boolean;
  failFallback?: boolean;
  emitInitialLoad?: boolean;
  initialNavigation?: () => Promise<void>;
} = {}) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const source = ts.createSourceFile(
    "reader.js",
    script,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const open = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "openBook",
  );
  if (!open) throw new Error("Reader openBook function missing");
  const messages: Array<{ type: string; detail: unknown }> = [];
  const elements: unknown[] = [];
  const firstParse = deferred<FakeBook>();
  const oldBook = { sections: [], destroy: vi.fn() };
  const nextBook = { sections: [], destroy: vi.fn() };
  const loading = { classList: { add() {}, remove() {} }, innerHTML: "" };
  const loadingError = { hidden: true, textContent: "" };
  const runtime = vm.createContext({
    File,
    Uint8Array,
    AbortController,
    atob,
    console,
    clearTimeout,
    setTimeout,
    window: {},
    view: null,
    readerElement: null,
    currentBook: null,
    currentSectionIndex: 0,
    totalSections: 0,
    bookOpenSequence: 0,
    bookOpenController: null,
    bookTextMetricsJobId: 0,
    bookTextMetricsTimer: null,
    currentPaginatedLayout: "double",
    attachTapListener: vi.fn(),
    attachSelectionListener: vi.fn(),
    attachNoteLongPress: vi.fn(),
    normalizeBrOnlyParagraphs: vi.fn(),
    isVerticalDoc: () => false,
    applyRendererFlowMode: vi.fn(),
    applyDocStyles: vi.fn(),
    refreshUserAnnotations: vi.fn(),
    applySceneInserts: vi.fn(),
    _rubyMode: false,
    _characterNameSpec: null,
    hideFootnoteTip: vi.fn(),
    getVisibleTextSnippet: () => "",
    applyFixedLayoutRendererSettings: vi.fn(),
    sceneCfiFilter() {},
    attachBookTransformHandler() {},
    waitForBundledReaderFontWarmup: async () => {},
    makeBook: (file: File) =>
      file.name === "old.epub" ? firstParse.promise : Promise.resolve(nextBook),
    postToRN: (type: string, detail: unknown) => messages.push({ type, detail }),
    escapeHtml: (text: string) => text,
    document: {
      getElementById: (id: string) =>
        id === "loading" ? loading : id === "loading-error" ? loadingError : { appendChild() {} },
      createElement() {
        const listeners = new Map();
        const el = {
          style: {},
          isFixedLayout: fixedLayout,
          renderer: fixedLayout ? {} : undefined,
          book: null as FakeBook | null,
          addEventListener: (type: string, callback: () => void) => listeners.set(type, callback),
          open: async (book: FakeBook) => {
            el.book = book;
          },
          init: vi.fn(async (options: { lastLocation?: string }) => {
            if (emitInitialLoad) listeners.get("load")?.({ detail: { doc: {}, index: 0 } });
            if (failSavedLocation && options.lastLocation) throw new Error("stale saved location");
            await initialNavigation();
          }),
          goToFraction: vi.fn(async () => {
            if (emitInitialLoad) listeners.get("load")?.({ detail: { doc: {}, index: 0 } });
            if (failFallback) throw new Error("fallback render failed");
            await initialNavigation();
          }),
          close: vi.fn(),
          remove: vi.fn(),
          listeners,
        };
        elements.push(el);
        return el;
      },
    },
  });
  vm.runInContext(script.slice(open.getStart(source), open.end), runtime);
  return {
    runtime,
    elements,
    firstParse,
    oldBook,
    nextBook,
    messages,
    loading,
    loadingError,
    open: (name: string, options: { lastLocation?: string; fallbackFraction?: number } = {}) =>
      runtime.openBook({
        base64: "YQ==",
        fileName: name,
        loadId: name,
        ...options,
      }) as Promise<void>,
  };
}

afterEach(() => vi.useRealTimers());
async function settle() {
  for (let pass = 0; pass < 12; pass++) await Promise.resolve();
}

describe("loaded acknowledges completed initial navigation, not an early iframe", () => {
  it.each([false, true])(
    "keeps first-load gesture wiring but waits for completed init (fixed=%s)",
    async (fixedLayout) => {
      const initial = deferred<void>();
      const h = harness({
        fixedLayout,
        emitInitialLoad: true,
        initialNavigation: () => initial.promise,
      });
      const opening = h.open("new.epub", { lastLocation: "epubcfi(/6/10)" });
      await settle();
      try {
        expect(h.runtime.attachSelectionListener).toHaveBeenCalledOnce();
        expect(h.messages.filter((entry) => entry.type === "loaded")).toEqual([]);
      } finally {
        initial.resolve();
        await opening;
      }
      expect(h.messages.filter((entry) => entry.type === "loaded")).toEqual([
        { type: "loaded", detail: { loadId: "new.epub" } },
      ]);
    },
  );
  it("waits for successful fallback rather than reporting an invalid saved-CFI init as ready", async () => {
    const initial = deferred<void>();
    const h = harness({
      emitInitialLoad: true,
      failSavedLocation: true,
      initialNavigation: () => initial.promise,
    });
    const opening = h.open("new.epub", { lastLocation: "bad-cfi" });
    await settle();
    try {
      expect(h.messages.filter((entry) => entry.type === "loaded")).toEqual([]);
    } finally {
      initial.resolve();
      await opening;
    }
    expect(h.messages.filter((entry) => entry.type === "loaded")).toHaveLength(1);
  });
  it("does not report loaded when both saved-CFI navigation and its fallback fail", async () => {
    const h = harness({ emitInitialLoad: true, failSavedLocation: true, failFallback: true });
    await h.open("new.epub", { lastLocation: "bad-cfi" });
    expect(h.messages.filter((entry) => entry.type === "loaded")).toEqual([]);
    expect(h.loadingError.hidden).toBe(false);
    expect(h.loadingError.textContent).toContain("fallback render failed");
  });
  it("bounds hung initial navigation and rejects late readiness/relocate events after retry", async () => {
    vi.useFakeTimers();
    const initial = deferred<void>();
    let starts = 0;
    const h = harness({
      fixedLayout: true,
      emitInitialLoad: true,
      initialNavigation: () => (++starts === 1 ? initial.promise : Promise.resolve()),
    });
    const opening = h.open("new.epub", { lastLocation: "epubcfi(/6/10)" });
    await settle();
    const failedView = h.runtime.view;
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.loadingError.hidden).toBe(false);
      expect(h.loadingError.textContent).toMatch(/timed out/i);
      expect(h.messages.filter((entry) => entry.type === "loaded")).toEqual([]);
      expect(failedView.close).toHaveBeenCalledOnce();
      await opening;
      await h.open("retry.epub", { lastLocation: "epubcfi(/6/8)" });
      const currentView = h.runtime.view;
      const beforeLateEvents = [...h.messages];
      failedView.listeners.get("load")({ detail: { doc: {}, index: 4 } });
      failedView.listeners.get("relocate")({ detail: { index: 4, cfi: "epubcfi(/6/10)" } });
      initial.resolve();
      await settle();
      expect(h.messages).toEqual(beforeLateEvents);
      expect(h.runtime.view).toBe(currentView);
      expect(currentView.close).not.toHaveBeenCalled();
      expect(h.loadingError.hidden).toBe(true);
    } finally {
      initial.resolve();
      await opening;
    }
  });
  it("does not let stale initial completion announce loaded or close the replacement book", async () => {
    const initial = deferred<void>();
    let starts = 0;
    const h = harness({
      emitInitialLoad: true,
      initialNavigation: () => (++starts === 1 ? initial.promise : Promise.resolve()),
    });
    const old = h.open("new.epub", { lastLocation: "epubcfi(/6/10)" });
    await settle();
    await h.open("replacement.epub");
    const currentView = h.runtime.view;
    initial.resolve();
    await old;
    expect(h.messages.filter((entry) => entry.type === "loaded")).toEqual([
      { type: "loaded", detail: { loadId: "replacement.epub" } },
    ]);
    expect(currentView.close).not.toHaveBeenCalled();
  });
  it("shares one 30-second deadline across rejected saved-CFI navigation and its fallback", async () => {
    vi.useFakeTimers();
    const saved = deferred<void>();
    const fallback = deferred<void>();
    let starts = 0;
    const h = harness({
      emitInitialLoad: true,
      initialNavigation: () => (++starts === 1 ? saved.promise : fallback.promise),
    });
    const opening = h.open("new.epub", { lastLocation: "old-cfi" });
    await settle();
    try {
      await vi.advanceTimersByTimeAsync(20_000);
      saved.reject(new Error("saved CFI cannot resolve"));
      await settle();
      expect(starts).toBe(2);
      expect(h.loadingError.hidden).toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      await opening;
      expect(h.loadingError.textContent).toMatch(/timed out/i);
      expect(h.messages.filter((entry) => entry.type === "loaded")).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      saved.resolve();
      fallback.resolve();
      await opening;
    }
  });
  it("releases a cancelled initial wait promptly and ignores its late rejection", async () => {
    vi.useFakeTimers();
    const initial = deferred<void>();
    let starts = 0;
    const h = harness({
      emitInitialLoad: true,
      initialNavigation: () => (++starts === 1 ? initial.promise : Promise.resolve()),
    });
    let oldFinished = false;
    const old = h.open("new.epub", { lastLocation: "epubcfi(/6/10)" }).then(() => {
      oldFinished = true;
    });
    await settle();
    const oldView = h.runtime.view;
    await h.open("replacement.epub");
    await settle();
    expect(oldFinished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const beforeLateRejection = [...h.messages];
    initial.reject(new Error("late old render error"));
    await old;
    await settle();
    expect(h.messages).toEqual(beforeLateRejection);
    expect(oldView.goToFraction).not.toHaveBeenCalled();
    expect(h.runtime.view.close).not.toHaveBeenCalled();
  });
});

describe("latest requested book owns the reader", () => {
  it("preserves full-fetch recovery when a current EPUB server rejects range loading", async () => {
    const h = harness();
    h.runtime.loadEpubFromRanges = vi.fn(async () => {
      throw new Error("Invalid Content-Range");
    });
    h.runtime.fetch = vi.fn(
      async () =>
        new Response("book bytes", { headers: { "Content-Type": "application/epub+zip" } }),
    );
    await h.runtime.openBook({ uri: "http://127.0.0.1/book", fileName: "new.epub", loadId: "new" });
    expect(h.runtime.fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1/book", {
      signal: expect.any(AbortSignal),
    });
    expect(h.runtime.currentBook).toBe(h.nextBook);
    expect(h.messages.some((message) => message.type === "error")).toBe(false);
  });

  it("aborts an old URL request without starting a full-fetch fallback after a new open", async () => {
    const h = harness();
    let oldSignal!: AbortSignal;
    h.runtime.loadEpubFromRanges = vi.fn((_message: unknown, signal: AbortSignal) => {
      oldSignal = signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    });
    h.runtime.fetch = vi.fn();
    const old = h.runtime.openBook({
      uri: "http://127.0.0.1/book",
      fileName: "old.epub",
      loadId: "old",
    });
    await h.open("new.epub");
    await old;
    expect(oldSignal.aborted).toBe(true);
    expect(h.runtime.fetch).not.toHaveBeenCalled();
    expect(h.runtime.currentBook).toBe(h.nextBook);
    expect(h.messages.some((message) => message.type === "error")).toBe(false);
  });

  it("destroys a late lazy book after cancellation without parsing or opening it", async () => {
    const h = harness();
    const late = deferred<FakeBook>();
    h.runtime.loadEpubFromRanges = vi.fn(() => late.promise);
    h.runtime.fetch = vi.fn();
    const old = h.runtime.openBook({
      uri: "http://127.0.0.1/book",
      fileName: "old.epub",
      loadId: "old",
    });
    await h.open("new.epub");
    late.resolve(h.oldBook);
    await old;
    expect(h.oldBook.destroy).toHaveBeenCalledOnce();
    expect(h.runtime.fetch).not.toHaveBeenCalled();
    expect(h.elements).toHaveLength(1);
    expect(h.runtime.currentBook).toBe(h.nextBook);
  });

  it("restores the loading indicator for a retry after a book fails", async () => {
    const h = harness();
    const oldLoad = h.open("old.epub");
    h.firstParse.reject(new Error("corrupt book"));
    await oldLoad;
    expect(h.loadingError.hidden).toBe(false);
    expect(h.loadingError.textContent).toContain("corrupt book");
    await h.open("new.epub");
    expect(h.loadingError.hidden).toBe(true);
    expect(h.loadingError.textContent).toBe("");
    expect(h.loading.innerHTML).toBe("");
  });

  it("does not replace the current book when a previous parser finishes late", async () => {
    const h = harness();
    const oldLoad = h.open("old.epub");
    await h.open("new.epub");
    h.firstParse.resolve(h.oldBook);
    await oldLoad;
    expect(h.runtime.currentBook).toBe(h.nextBook);
    expect(h.elements).toHaveLength(1);
    expect(h.oldBook.destroy).toHaveBeenCalledOnce();
  });

  it("does not report a stale parse error after another book was opened", async () => {
    const h = harness();
    const oldLoad = h.open("old.epub");
    await h.open("new.epub");
    h.firstParse.reject(new Error("old corrupt book"));
    await oldLoad;
    expect(h.messages.filter((message) => message.type === "error")).toEqual([]);
    expect(h.runtime.currentBook).toBe(h.nextBook);
  });
});

describe("fixed-layout reopening keeps the saved page", () => {
  it("passes a saved comic/PDF CFI to the renderer instead of unconditionally starting over", async () => {
    const h = harness({ fixedLayout: true });
    await h.open("comic.cbz", { lastLocation: "epubcfi(/6/6)" });
    const element = h.elements[0] as { init: ReturnType<typeof vi.fn> };
    expect(element.init).toHaveBeenCalledExactlyOnceWith({ lastLocation: "epubcfi(/6/6)" });
  });

  it.each([false, true])(
    "restores a fixed-layout fraction when the CFI is absent or rejected: %s",
    async (failSavedLocation) => {
      const h = harness({ fixedLayout: true, failSavedLocation });
      await h.open("comic.cbz", {
        fallbackFraction: 0.5,
        ...(failSavedLocation ? { lastLocation: "invalid-old-cfi" } : {}),
      });
      const element = h.elements[0] as { goToFraction: ReturnType<typeof vi.fn> };
      expect(element.goToFraction).toHaveBeenCalledExactlyOnceWith(0.5);
      expect(h.messages.some((message) => message.type === "error")).toBe(false);
    },
  );
});
