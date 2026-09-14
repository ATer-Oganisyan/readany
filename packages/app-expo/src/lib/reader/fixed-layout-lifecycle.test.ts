import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

class Element extends EventTarget {
  style: Record<string, string> = {};
  children: Element[] = [];
  attributes = new Map<string, string>();
  shadow?: Element;
  src = "";
  tag = "";
  contentDocument = {
    documentElement: { localName: "html" },
    querySelector: (query: string) =>
      query === "img" ? { naturalWidth: 600, naturalHeight: 900 } : null,
  };

  attachShadow() {
    this.shadow = new Element();
    return this.shadow;
  }

  append(child: Element) {
    this.children.push(child);
  }

  replaceChildren() {
    this.children = [];
  }

  querySelectorAll(tag: string): Element[] {
    return this.children.flatMap((child) => [
      ...(child.tag === tag ? [child] : []),
      ...child.querySelectorAll(tag),
    ]);
  }

  setAttribute(name: string, value: string) {
    const oldValue = this.attributes.get(name) ?? null;
    this.attributes.set(name, value);
    (
      this as Element & {
        attributeChangedCallback?: (name: string, previous: string | null, value: string) => void;
      }
    ).attributeChangedCallback?.(name, oldValue, value);
  }

  getBoundingClientRect() {
    return { width: 393, height: 700 };
  }
}

const settle = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function harness() {
  const frames: Element[] = [];
  const context = vm.createContext({
    HTMLElement: Element,
    Event,
    CustomEvent,
    console,
    CSSStyleSheet: class {
      replaceSync() {}
    },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
    },
    customElements: { get: () => true },
    document: {
      createElement(tag: string) {
        const element = new Element();
        element.tag = tag;
        if (tag === "iframe") frames.push(element);
        return element;
      },
    },
  });
  const source = readFileSync(
    new URL("../../../../foliate-js/fixed-layout.js", import.meta.url),
    "utf8",
  );
  vm.runInContext(
    source.replace("export class FixedLayout", "globalThis.FixedLayout = class FixedLayout"),
    context,
  );
  const renderer = new context.FixedLayout();
  const sections = Array.from({ length: 4 }, (_, index) => ({
    id: `page-${index}`,
    load: vi.fn(async () => `blob:page-${index}`),
  }));
  const book = { sections, rendition: { layout: "pre-paginated", spread: "auto" } };
  return { renderer, book, frames };
}

describe("fixed-layout startup lifecycle", () => {
  it("applies startup spread settings without navigating before view.init", async () => {
    const { renderer, book, frames } = harness();
    renderer.open(book);
    renderer.setAttribute("spread", "none");
    await settle();

    expect(book.sections.every((section) => section.load.mock.calls.length === 0)).toBe(true);

    const opening = renderer.next();
    await settle();
    expect(frames.filter((frame) => frame.src).map((frame) => frame.src)).toEqual(["blob:page-0"]);
    frames.find((frame) => frame.src)?.dispatchEvent(new Event("load"));
    await opening;

    expect(renderer.index).toBe(0);
    expect(renderer.getContents()).toEqual([
      expect.objectContaining({ index: 0, doc: frames[0].contentDocument }),
    ]);
    renderer.destroy();
  });

  it("does not reload a page when its load handler reapplies the same spread", async () => {
    const { renderer, book, frames } = harness();
    renderer.setAttribute("spread", "auto");
    renderer.open(book);
    renderer.addEventListener("load", () => renderer.setAttribute("spread", "auto"));

    const opening = renderer.next();
    await settle();
    const page = frames.find((frame) => frame.src);
    page?.dispatchEvent(new Event("load"));
    await opening;
    await settle();

    expect(book.sections[0].load).toHaveBeenCalledTimes(1);
    expect(frames.filter((frame) => frame.src)).toHaveLength(1);
    expect(renderer.index).toBe(0);
    renderer.destroy();
  });

  it("advances through portrait spreads one physical page at a time", async () => {
    const { renderer, book, frames } = harness();
    renderer.setAttribute("spread", "auto");
    renderer.open(book);

    const opening = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:page-0")?.dispatchEvent(new Event("load"));
    await opening;
    expect(renderer.index).toBe(0);

    const nextSpread = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:page-1")?.dispatchEvent(new Event("load"));
    await settle();
    frames.find((frame) => frame.src === "blob:page-2")?.dispatchEvent(new Event("load"));
    await nextSpread;
    expect(renderer.index).toBe(1);

    await renderer.next();
    expect(renderer.index).toBe(2);
    renderer.destroy();
  });

  it("places an interstitial after a fixed page without changing its physical index", async () => {
    const { renderer, book, frames } = harness();
    renderer.open(book);
    renderer.setAttribute("spread", "none");
    await settle();
    const loadScene = vi.fn(async () => "blob:scene-after-0");
    const interstitials = [{ key: "scene-0", afterIndex: 0, load: loadScene }];
    await renderer.setInterstitials(interstitials);

    const opening = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:page-0")?.dispatchEvent(new Event("load"));
    await opening;
    expect(renderer.index).toBe(0);

    const frameCount = frames.length;
    await renderer.setInterstitials(interstitials);
    expect(frames).toHaveLength(frameCount);

    const scene = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:scene-after-0")?.dispatchEvent(new Event("load"));
    await scene;
    expect(loadScene).toHaveBeenCalledTimes(1);
    expect(renderer.index).toBe(0);

    const nextPage = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:page-1")?.dispatchEvent(new Event("load"));
    await nextPage;
    expect(renderer.index).toBe(1);
    expect(book.sections).toHaveLength(4);
    renderer.destroy();
  });

  it("returns to the physical page when the active interstitial is removed", async () => {
    const { renderer, book, frames } = harness();
    renderer.open(book);
    renderer.setAttribute("spread", "none");
    await settle();
    await renderer.setInterstitials([
      { key: "scene-0", afterIndex: 0, load: async () => "blob:scene-after-0" },
    ]);

    const opening = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:page-0")?.dispatchEvent(new Event("load"));
    await opening;

    const scene = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:scene-after-0")?.dispatchEvent(new Event("load"));
    await scene;

    const removal = renderer.setInterstitials([]);
    await settle();
    frames
      .filter((frame) => frame.src === "blob:page-0")
      .at(-1)
      ?.dispatchEvent(new Event("load"));
    await removal;

    expect(renderer.index).toBe(0);
    const nextPage = renderer.next();
    await settle();
    frames
      .filter((frame) => frame.src === "blob:page-1")
      .at(-1)
      ?.dispatchEvent(new Event("load"));
    await nextPage;
    expect(renderer.index).toBe(1);
    renderer.destroy();
  });

  it("rebuilds an active spread when an interstitial is added while reading", async () => {
    const { renderer, book, frames } = harness();
    renderer.setAttribute("spread", "auto");
    renderer.open(book);

    const opening = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:page-0")?.dispatchEvent(new Event("load"));
    await opening;

    const spread = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:page-1")?.dispatchEvent(new Event("load"));
    await settle();
    frames.find((frame) => frame.src === "blob:page-2")?.dispatchEvent(new Event("load"));
    await spread;
    expect(renderer.index).toBe(1);

    const update = renderer.setInterstitials([
      { key: "scene-1", afterIndex: 1, load: async () => "blob:scene-after-1" },
    ]);
    await settle();
    const reloadedPage = frames.filter((frame) => frame.src === "blob:page-1").at(-1);
    reloadedPage?.dispatchEvent(new Event("load"));
    await update;
    expect(renderer.index).toBe(1);

    const scene = renderer.next();
    await settle();
    frames.find((frame) => frame.src === "blob:scene-after-1")?.dispatchEvent(new Event("load"));
    await scene;
    expect(renderer.index).toBe(1);
    renderer.destroy();
  });
});
