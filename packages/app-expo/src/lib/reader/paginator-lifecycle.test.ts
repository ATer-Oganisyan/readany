import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: { type: string }) => unknown;
type Engine = {
  View: new (
    ...args: unknown[]
  ) => {
    load: (...args: unknown[]) => Promise<void>;
    destroy: () => void;
    render: () => void;
    expand: () => void;
  };
  Paginator: new () => FakeElement & {
    open: (book: { sections: Array<{ load: () => Promise<unknown> }> }) => void;
    next: () => Promise<void>;
    destroy: () => void;
  };
  rafAnimateScroll: (...args: unknown[]) => Promise<void>;
  cssAnimateScroll: (...args: unknown[]) => Promise<void>;
};

class FakeElement {
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  shadowElements = new Map<string, FakeElement>();
  listeners = new Map<string, Set<Listener>>();
  contentDocument = {
    title: "Chapter",
    body: { style: {}, querySelector: () => null },
    documentElement: {},
    defaultView: {
      getComputedStyle: () => ({
        writingMode: "horizontal-tb",
        direction: "ltr",
        background: "white",
      }),
    },
    fonts: { ready: Promise.resolve() },
  };
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  attachShadow() {
    return {
      getElementById: (id: string) => {
        const element = new FakeElement();
        this.shadowElements.set(id, element);
        return element;
      },
    };
  }
  append(child: FakeElement) {
    this.children.push(child);
  }
  addEventListener(type: string, callback: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(callback);
  }
  removeEventListener(type: string, callback: Listener) {
    this.listeners.get(type)?.delete(callback);
  }
  dispatch(type: string) {
    // Capture async listener exceptions as a browser would report them; the
    // caller's load promise must still reject instead of hanging forever.
    for (const callback of this.listeners.get(type) ?? [])
      Promise.resolve(callback({ type })).catch(() => {});
  }
  getBoundingClientRect() {
    return {};
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function harness() {
  let iframe!: FakeElement;
  const frames = new Map<number, (time: number) => void>();
  let frameId = 0;
  const runtime = vm.createContext({
    document: {
      hidden: false,
      createElement: (tag: string) => {
        const element = new FakeElement();
        if (tag === "iframe") iframe = element;
        return element;
      },
      createRange: () => ({ selectNodeContents() {} }),
    },
    HTMLElement: FakeElement,
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    customElements: { get: () => true },
    setTimeout,
    clearTimeout,
    DOMException,
    AbortController,
    requestAnimationFrame: (callback: (time: number) => void) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  // Execute production implementation, including private View fields.
  const source = readFileSync(
    new URL("../../../../foliate-js/paginator.js", import.meta.url),
    "utf8",
  );
  vm.runInContext(
    `${source.replaceAll("export ", "")}\nglobalThis.engine = { View, Paginator, rafAnimateScroll, cssAnimateScroll };`,
    runtime,
  );
  const engine = runtime.engine as Engine;
  return { engine, frames, iframe: () => iframe };
}

describe("paginator lifecycle", () => {
  it("renders and resolves a healthy section before its watchdog expires", async () => {
    const h = harness();
    const view = new h.engine.View({ container: {}, onExpand() {} });
    view.render = vi.fn();
    view.expand = vi.fn();
    const afterLoad = vi.fn();
    const done = vi.fn();
    void view.load("blob:chapter", null, afterLoad, () => ({})).then(done);
    h.iframe().dispatch("load");
    await vi.advanceTimersByTimeAsync(1);
    expect(afterLoad).toHaveBeenCalledWith(h.iframe().contentDocument);
    expect(view.render).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("completes a normal animation once and clears its watchdog", async () => {
    const { engine, frames } = harness();
    const render = vi.fn();
    const done = vi.fn();
    void engine.rafAnimateScroll(0, 400, 300, (x: number) => x, render).then(done);
    const step = (time: number) => {
      const entry = frames.entries().next().value;
      if (!entry) throw new Error("Expected a scheduled frame");
      frames.delete(entry[0]);
      entry[1](time);
    };
    step(0);
    step(150);
    step(300);
    await vi.advanceTimersByTimeAsync(1000);
    expect(render.mock.calls.map(([value]) => value)).toEqual([0, 200, 400]);
    expect(done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an iframe error immediately and clears its watchdog", async () => {
    const h = harness();
    const view = new h.engine.View({ container: {}, onExpand() {} });
    const fail = vi.fn();
    void view.load("blob:chapter").catch(fail);
    h.iframe().dispatch("error");
    await vi.advanceTimersByTimeAsync(1);
    expect(fail).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the navigation lock and restores visibility if the section source never resolves", async () => {
    const { engine } = harness();
    const paginator = new engine.Paginator();
    const load = vi.fn(() => new Promise(() => {}));
    paginator.open({ sections: [{ load }] });
    const fail = vi.fn();
    void paginator.next().catch(fail);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fail).toHaveBeenCalledOnce();
    expect(paginator.shadowElements.get("container")?.style.opacity).toBe("1");
    void paginator.next().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    paginator.destroy();
  });

  it("cancels an outstanding section-source load when closing a book", async () => {
    const { engine } = harness();
    const paginator = new engine.Paginator();
    paginator.open({ sections: [{ load: () => new Promise(() => {}) }] });
    const fail = vi.fn();
    void paginator.next().catch(fail);
    await vi.advanceTimersByTimeAsync(1);
    paginator.destroy();
    await vi.advanceTimersByTimeAsync(1);
    expect(fail).toHaveBeenCalledOnce();
  });

  it("finishes a page turn if the WebView stops delivering animation frames", async () => {
    const { engine, frames } = harness();
    const render = vi.fn();
    const done = vi.fn();
    void engine.rafAnimateScroll(0, 400, 300, (x: number) => x, render).then(done);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toHaveBeenCalledOnce();
    expect(render).toHaveBeenLastCalledWith(400);
    expect(frames.size).toBe(0);
  });

  it("removes transition listeners after the fallback completes", async () => {
    const { engine } = harness();
    const element = new FakeElement();
    const child = new FakeElement();
    element.append(child);
    const completion = engine.cssAnimateScroll(element, "scrollLeft", 0, 400, 300);
    await vi.advanceTimersByTimeAsync(1000);
    await completion;
    expect(child.listeners.get("transitionend")?.size ?? 0).toBe(0);
  });

  it("rejects section loading when document setup throws", async () => {
    const h = harness();
    const view = new h.engine.View({ container: {}, onExpand() {} });
    const fail = vi.fn();
    void view
      .load("blob:chapter", null, () => {
        throw new Error("broken chapter");
      })
      .catch(fail);
    h.iframe().dispatch("load");
    await vi.advanceTimersByTimeAsync(1);
    expect(fail).toHaveBeenCalledOnce();
    expect(String(fail.mock.calls[0]?.[0])).toContain("broken chapter");
  });

  it("rejects missing iframe load/error events after a bounded wait", async () => {
    const h = harness();
    const view = new h.engine.View({ container: {}, onExpand() {} });
    const fail = vi.fn();
    void view.load("blob:chapter").catch(fail);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fail).toHaveBeenCalledOnce();
    expect(h.iframe().listeners.get("load")?.size ?? 0).toBe(0);
  });

  it("cancels pending section loading when the view is destroyed", async () => {
    const h = harness();
    const view = new h.engine.View({ container: {}, onExpand() {} });
    const fail = vi.fn();
    void view.load("blob:chapter").catch(fail);
    view.destroy();
    await vi.advanceTimersByTimeAsync(1);
    expect(fail).toHaveBeenCalledOnce();
    expect(h.iframe().listeners.get("load")?.size ?? 0).toBe(0);
  });
});
