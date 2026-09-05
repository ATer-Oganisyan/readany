import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

class Element extends EventTarget {
  style: Record<string, string> = {};
  children: Element[] = [];
  attributes = new Map<string, string>();
  shadow?: Element;
  src = "";
  tag = "";
  contentDocument = {
    URL: "blob:comic-page",
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

function selectionHarness(renderer: unknown, book: unknown, fixed = true) {
  const cfiModule = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../../../../foliate-js/epubcfi.js", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
    ).outputText,
    { module: cfiModule, exports: cfiModule.exports },
  );
  const fromRange = vi.fn(() => "epubcfi(/4/2/1:3)");
  const toRange = vi.fn();
  const cfi = { ...cfiModule.exports, fromRange, toRange };
  const source = readFileSync(new URL("../../../../foliate-js/view.js", import.meta.url), "utf8");
  const ast = ts.createSourceFile("view.js", source, ts.ScriptTarget.ESNext, true);
  const klass = ast.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === "View",
  );
  if (!klass || !ts.isClassDeclaration(klass)) throw new Error("View class missing");
  const methodNames = new Set([
    "getCFI",
    "resolveCFI",
    "resolveNavigation",
    "addAnnotation",
    "#getOverlayer",
  ]);
  const methods = klass.members
    .filter((node) => node.name && methodNames.has(node.name.getText(ast)))
    .map((node) => node.getText(ast))
    .join("\n");
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const template = ts.createSourceFile("template.js", script, ts.ScriptTarget.ESNext, true);
  const emit = template.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "emitSelection",
  );
  if (!emit) throw new Error("emitSelection missing");
  type SelectionDetail = { text: string; cfi: string; cfiGranularity?: "page" | "range" };
  const messages: Array<{ type: string; detail: SelectionDetail }> = [];
  const draw = vi.fn();
  const context = vm.createContext({
    renderer,
    book,
    fixed,
    CFI: cfi,
    console,
    SEARCH_PREFIX: "foliate-search:",
    TTS_PREFIX: "foliate-tts:",
    draw,
    dismissSceneSelection: () => false,
    getRangeTextWithoutRuby: () => "diary",
    postToRN: (type: string, detail: SelectionDetail) => messages.push({ type, detail }),
  });
  vm.runInContext(
    `class SelectionView {
    book=book; renderer=renderer; isFixedLayout=fixed; cfiFilter=undefined;
    #tocProgress={getProgress:()=>({label:'Page'})}; #sectionProgress;
    #emit(...args) { draw(...args); }
    ${methods}
  }; globalThis.view=new SelectionView(); ${emit.getText(template)}`,
    context,
  );
  const range = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 30, height: 12 }),
    getClientRects: () => [],
  };
  return {
    emit(doc: unknown) {
      context.emitSelection(doc, { toString: () => "diary" }, range);
      return messages.at(-1)?.detail;
    },
    view: context.view,
    fromRange,
    toRange,
    range,
    draw,
  };
}

async function openPage(h: ReturnType<typeof harness>, index: number) {
  const opening = h.renderer.goTo({ index });
  // FixedLayout loads left/right spread frames sequentially.
  for (let pass = 0; pass < 3; pass++) {
    await settle();
    for (const frame of h.frames) if (frame.src) frame.dispatchEvent(new Event("load"));
  }
  await opening;
}

describe("fixed-layout initial settings and iframe lifecycle", () => {
  it("publishes a stable page-4 selection address and reopens that page without a full-page highlight", async () => {
    const h = harness();
    h.renderer.open(h.book);
    await openPage(h, 3);
    const doc = h.frames.find((frame) => frame.src === "blob:page-3")?.contentDocument;
    const selection = selectionHarness(h.renderer, h.book);
    const detail = selection.emit(doc);
    expect(detail?.cfiGranularity).toBe("page");
    expect(detail).toMatchObject({ text: "diary", cfi: "epubcfi(/6/8)" });
    expect(selection.fromRange).not.toHaveBeenCalled();
    await openPage(h, 0);
    const target = selection.view.resolveCFI(detail?.cfi);
    expect(target.index).toBe(3);
    await openPage(h, target.index);
    expect(h.renderer.index).toBe(3);
    await selection.view.addAnnotation({
      value: detail?.cfi,
      type: "highlight",
      note: "My PDF note",
    });
    expect(selection.draw).not.toHaveBeenCalled();
    expect(selection.toRange).not.toHaveBeenCalled();
    h.renderer.destroy();
  });

  it("identifies the selected side of a spread instead of substituting the primary page", async () => {
    const h = harness();
    h.renderer.open(h.book);
    await openPage(h, 1);
    const selection = selectionHarness(h.renderer, h.book);
    const rightDoc = h.frames.find((frame) => frame.src === "blob:page-2")?.contentDocument;
    expect(h.renderer.index).toBe(1);
    expect(selection.emit(rightDoc)?.cfi).toBe("epubcfi(/6/6)");
    expect(h.renderer.getContents().map((item: { index: number }) => item.index)).toEqual([1, 2]);
    h.renderer.destroy();
  });

  it("does not expose blank spread placeholders as book pages", async () => {
    const h = harness();
    h.renderer.open(h.book);
    await openPage(h, 0);
    expect(h.renderer.getContents().map((item: { index: number }) => item.index)).toEqual([0]);
    h.renderer.destroy();
  });

  it("keeps reflowable selection range CFI semantics unchanged", () => {
    const doc = {};
    const selection = selectionHarness(
      { getContents: () => [{ index: 2, doc }] },
      { sections: [{}, {}, {}] },
      false,
    );
    expect(selection.emit(doc)?.cfi).toBe("epubcfi(/6/6!/4/2/1:3)");
    expect(selection.emit(doc)?.cfiGranularity).toBe("range");
    expect(selection.fromRange).toHaveBeenCalledWith(selection.range, undefined);
  });

  it("applies startup spread settings without navigating before view.init calls next", async () => {
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
    expect(renderer.getContents()[0].doc).toBe(frames[0].contentDocument);
    expect(frames[0].style.display).toBe("block");
    renderer.destroy();
  });

  it("does not reload a comic page when its load handler reapplies unchanged spread settings", async () => {
    const { renderer, book, frames } = harness();
    renderer.setAttribute("spread", "auto");
    renderer.open(book);
    // This is the actual template path: iframe load -> applySettings -> spread.
    renderer.addEventListener("load", () => renderer.setAttribute("spread", "auto"));
    const opening = renderer.next();
    await settle();
    const page = frames.find((frame) => frame.src);
    expect(page?.src).toBe("blob:page-0");
    page?.dispatchEvent(new Event("load"));
    await opening;
    await settle();
    expect(book.sections[0].load).toHaveBeenCalledTimes(1);
    expect(frames.filter((frame) => frame.src)).toHaveLength(1);
    expect(page?.style.display).toBe("block");
    expect(renderer.index).toBe(0);
    renderer.destroy();
  });

  it("reports the selected page when TOC navigation stays inside an already loaded spread", async () => {
    const { renderer, book, frames } = harness();
    renderer.open(book);
    const opening = renderer.goTo({ index: 1 });
    await settle();
    frames.find((frame) => frame.src === "blob:page-1")?.dispatchEvent(new Event("load"));
    await settle();
    frames.find((frame) => frame.src === "blob:page-2")?.dispatchEvent(new Event("load"));
    await opening;
    expect(renderer.index).toBe(1);
    const locations: number[] = [];
    renderer.addEventListener("relocate", (event: CustomEvent<{ index: number }>) =>
      locations.push(event.detail.index),
    );
    await renderer.goTo({ index: 2 });
    expect(renderer.index).toBe(2);
    expect(locations).toEqual([2]);
    expect(book.sections[1].load).toHaveBeenCalledTimes(1);
    expect(book.sections[2].load).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });
});
