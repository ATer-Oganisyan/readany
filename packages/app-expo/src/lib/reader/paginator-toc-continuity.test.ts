import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function harness(initialIndexes = [2], nonLinear: number[] = []) {
  const source = readFileSync(
    new URL("../../../../foliate-js/paginator.js", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("paginator.js", source, ts.ScriptTarget.ESNext, true);
  const paginator = ast.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === "Paginator",
  );
  if (!paginator) throw new Error("Paginator missing");
  const names = new Set([
    "#goTo",
    "goTo",
    "#clearViewsExcept",
    "#fillVisibleArea",
    "#sortedViews",
    "#primaryView",
    "#canGoToIndex",
    "#adjacentIndex",
    "#isSameDirection",
    "#turnPage",
    "next",
    "prev",
    "#scrollNext",
    "#scrollPrev",
    "#detectPrimaryView",
    "#getViewOffset",
    "#getPagesBeforeView",
    "#renderedViewSize",
    "#renderedStart",
    "#renderedEnd",
    "#renderedPage",
    "#renderedPages",
    "atStart",
    "atEnd",
    "primaryIndex",
  ]);
  const methods = paginator.members
    .filter((node) => node.name && names.has(node.name.getText(ast)))
    .map((node) => node.getText(ast))
    .join("\n");
  const context = vm.createContext({
    AbortController,
    CustomEvent,
    Event,
    initialIndexes,
    nonLinear,
    getDirection: () => ({ vertical: false }),
    loadSectionResources: async () => ({ src: "book-section", data: "section" }),
  });
  // Actual navigation, retention, fill, page-turn and primary-view detection run
  // together. This port supplies laid-out 12-page chapter frames, not a browser
  // layout engine. It makes missing intermediate chapter frames observable.
  vm.runInContext(
    `
    class TocHarness {
      sections = Array.from({length:4}, (_, i) => ({linear: nonLinear.includes(i) ? 'no' : 'yes'}));
      #views = new Map(); #directionCache = new Map(); #primaryIndex = initialIndexes[0];
      #lifecycle = new AbortController(); #vertical = false; #stabilizing = false;
      #locked = false; #pendingTurns = 0; #pendingDistance; #fillPromise; #filling = false;
      #styles; #anchor = 0; #container = {style:{}, scrollLeft:0};
      size = 100; columnCount = 1; sideProp = 'width'; scrollProp = 'scrollLeft';
      scrolled = false; noPreload = false; noContinuousScroll = false;
      destroyed = []; loaded = []; relocations = [];
      constructor() { for (const index of initialIndexes) this.addView(index); }
      addView(index) { this.#views.set(index, {document: {hasFocus:()=>false}, contentPages:12, element:{getBoundingClientRect:()=>({width:1200})}}); }
      get indexes() { return this.#sortedViews.map(([i])=>i); }
      #destroyView(index) { this.destroyed.push(index); this.#views.delete(index); }
      #destroyAllViews() { for (const [i] of this.#views) this.#destroyView(i); }
      #syncA11y() {} #replaceBackground() {} #trimDistantViews() {}
      #preloadNext() { return Promise.resolve(); }
      focusView() {} setStyles() {} dispatchEvent() {}
      async #loadAdjacentSection(index) { this.loaded.push(index); this.addView(index); }
      async #display(promise) { const {index, anchor} = await promise; this.loaded.push(index); this.addView(index); this.#primaryIndex=index;
        await this.scrollToAnchor(typeof anchor==='function' ? anchor(this.#primaryView.document) : anchor ?? 0);
        await this.#fillVisibleArea(); }
      async scrollToAnchor(anchor) { this.#anchor=anchor; this.#container.scrollLeft=this.#getViewOffset(this.#primaryIndex) + anchor*1100; }
      #scrollToAnchor(anchor) { return this.scrollToAnchor(anchor); }
      async #scrollToPage(page) { this.#container.scrollLeft=page*this.size; this.#detectPrimaryView(); this.relocations.push(this.#primaryIndex); }
      async #scrollTo(offset) { this.#container.scrollLeft=offset; this.#detectPrimaryView(); }
      ${methods}
    }
    globalThis.harness = new TocHarness();`,
    context,
  );
  return context.harness as {
    indexes: number[];
    primaryIndex: number;
    destroyed: number[];
    loaded: number[];
    relocations: number[];
    noPreload: boolean;
    noContinuousScroll: boolean;
    goTo: (target: { index: number; anchor?: number }) => Promise<void>;
    next: () => Promise<void>;
    prev: () => Promise<void>;
  };
}

describe("TOC navigation keeps chapter frames contiguous", () => {
  it("loads chapter 2 after TOC chapter 3→1 instead of treating chapter 3 as the next page", async () => {
    const h = harness([2]);
    await h.goTo({ index: 0 });
    for (let n = 0; n < 12; n++) await h.next();
    expect(h.primaryIndex).toBe(1);
    expect(h.relocations).not.toContain(2);
    expect(h.loaded).toContain(1);
  });
  it("does not expose chapter 1 immediately before chapter 3 when chapter 2 was not loaded", async () => {
    const h = harness([0]);
    await h.goTo({ index: 2 });
    await h.prev();
    expect(h.primaryIndex).toBe(1);
  });
  it("keeps the sequence after fresh chapter 1→TOC 3→TOC 1 without warming chapter 2", async () => {
    const h = harness([0]);
    await h.goTo({ index: 2 });
    await h.goTo({ index: 0 });
    for (let n = 0; n < 12; n++) await h.next();
    expect(h.primaryIndex).toBe(1);
    expect(h.relocations).not.toContain(2);
  });
  it("retains genuinely adjacent ready chapter frames for smooth navigation", async () => {
    const h = harness([1, 2]);
    await h.goTo({ index: 0 });
    expect(h.indexes).toEqual([0, 1, 2]);
    expect(h.destroyed).toEqual([]);
    for (let n = 0; n < 12; n++) await h.next();
    expect(h.primaryIndex).toBe(1);
  });
  it("treats non-linear spine entries as intentionally skipped, not missing chapters", async () => {
    const h = harness([2], [1]);
    await h.goTo({ index: 0 });
    expect(h.indexes).toEqual([0, 2]);
    expect(h.destroyed).toEqual([]);
    for (let n = 0; n < 12; n++) await h.next();
    expect(h.primaryIndex).toBe(2);
  });
});

function adjacentHarness(initialIndexes: number[], pendingIndex: number, scrolled = false) {
  const source = readFileSync(
    new URL("../../../../foliate-js/paginator.js", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("paginator.js", source, ts.ScriptTarget.ESNext, true);
  const paginator = ast.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === "Paginator",
  );
  if (!paginator) throw new Error("Paginator missing");
  const names = new Set([
    "#loadAdjacentSection",
    "#adjacentIndex",
    "#canGoToIndex",
    "#sortedViews",
  ]);
  const methods = paginator.members
    .filter((node) => node.name && names.has(node.name.getText(ast)))
    .map((node) => node.getText(ast))
    .join("\n");
  let resolveResources: (value: { src: string }) => void = () => {};
  const resources = new Promise<{ src: string }>((resolve) => {
    resolveResources = resolve;
  });
  const context = vm.createContext({
    AbortController,
    CustomEvent,
    initialIndexes,
    scrolled,
    console: { warn() {} },
    loadSectionResources: () => resources,
    getDirection: () => ({ vertical: false }),
  });
  vm.runInContext(
    `class AdjacentHarness {
    sections = [{}, {}, {}, {}]; #views = new Map(initialIndexes.map(index => [index, {initial:true}])); #primaryIndex = initialIndexes[0];
    #lifecycle = new AbortController(); #vertical = false; #lastLayout = {}; #directionCache = new Map();
    #styleMap = new Map(); #styles; get #renderedStart() { return this.containerPosition; }
    scrolled = scrolled; sideProp = 'width'; containerPosition = 100; created = [];
    get indexes() { return this.#sortedViews.map(([index])=>index); }
    setCurrentFrames(indexes) { this.#views = new Map(indexes.map(index => [index, {initial:true}])); }
    isOriginal(index) { return this.#views.get(index)?.initial === true; }
    #createView(index) { this.created.push(index); const view = {document:null, element:{getBoundingClientRect:()=>({width:100})}, load:async()=>{}}; this.#views.set(index,view); return view; }
    #destroyView(index) { this.#views.delete(index); }
    setStyles() {} dispatchEvent() {}
    load(index) { return this.#loadAdjacentSection(index); }
    ${methods}
  }; globalThis.harness = new AdjacentHarness();`,
    context,
  );
  const h = context.harness as {
    indexes: number[];
    created: number[];
    containerPosition: number;
    setCurrentFrames: (indexes: number[]) => void;
    isOriginal: (index: number) => boolean;
    load: (index: number) => Promise<void>;
  };
  const pending = h.load(pendingIndex);
  return {
    h,
    finish: async () => {
      resolveResources({ src: "section" });
      await pending;
    },
  };
}

describe("late adjacent preload across a TOC change", () => {
  it("does not recreate a disconnected old chapter after its resources finish", async () => {
    const { h, finish } = adjacentHarness([2], 3);
    // The real TOC retention path above has discarded the old chapter frames.
    h.setCurrentFrames([0]);
    await finish();
    expect(h.indexes).toEqual([0]);
    expect(h.created).toEqual([]);
  });
  it("does not replace a target frame loaded by navigation while preload was waiting", async () => {
    const { h, finish } = adjacentHarness([0], 1);
    h.setCurrentFrames([1]);
    await finish();
    expect(h.created).toEqual([]);
    expect(h.isOriginal(1)).toBe(true);
  });
  it("keeps a completed preload that still adjoins the active chapter frames", async () => {
    const { h, finish } = adjacentHarness([2], 3);
    await finish();
    expect(h.indexes).toEqual([2, 3]);
    expect(h.created).toEqual([3]);
  });
  it("preserves the latest scroll position, not the position before a slow prepend request", async () => {
    const { h, finish } = adjacentHarness([1], 0, true);
    h.containerPosition = 500;
    await finish();
    expect(h.containerPosition).toBe(600);
  });
});
