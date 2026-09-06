import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function harness() {
  const source = readFileSync(
    new URL("../../../../foliate-js/paginator.js", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("paginator.js", source, ts.ScriptTarget.ESNext, true);
  const paginator = ast.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === "Paginator",
  );
  const constructorNode = paginator?.members.find(ts.isConstructorDeclaration);
  const scrollCallback = constructorNode?.body?.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(ast) === "debouncedScroll",
      ),
  );
  const afterScroll = paginator?.members.find((node) => node.name?.getText(ast) === "#afterScroll");
  const render = paginator?.members.find((node) => node.name?.getText(ast) === "render");
  const debounce = ast.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(ast) === "debounce",
      ),
  );
  if (!scrollCallback || !afterScroll || !debounce || !render)
    throw new Error("Missing paginator methods");
  const context = vm.createContext({ setTimeout, clearTimeout, CustomEvent, Event });
  // Execute the production event/debounce/anchor code. The layout port models
  // a temporary earlier page during font/adjacent-frame layout stabilization;
  // the saved Range must survive until the engine can reanchor that layout.
  vm.runInContext(
    `${debounce.getText(ast)}
    class RestoreHarness {
      #stabilizing = false;
      #isAnimating = false;
      #justAnchored = false;
      #anchor = 'saved-paragraph-17';
      #views = new Map([[1, { document: {}, render() {} }]]);
      #primaryIndex = 1;
      #lastVisibleRange;
      #primaryView = { contentPages: 40 };
      #renderedPages = 40;
      #renderedPage = 18;
      #header = { style: {} };
      #vertical = false;
      #rtl = false;
      scrolled = false;
      visible = 'temporary-paragraph-13';
      columnCount = 1;
      events = [];
      #detectPrimaryView() {}
      #syncA11y() {}
      #getVisibleRange() { return { range: this.visible, index: 1 }; }
      #getPagesBeforeView() { return 0; }
      #getViewOffset() { return 0; }
      #renderedViewSize = 4000;
      #renderedStart = 1800;
      #replaceBackground() {}
      #beforeRender() { if (this.failLayout) throw new Error('Layout failed'); return {}; }
      #scrollToAnchor(anchor) { this.#anchor = anchor; this.#justAnchored = true; }
      dispatchEvent(event) { if (event.detail) this.events.push(event.detail); }
      get anchor() { return this.#anchor; }
      get stabilizing() { return this.#stabilizing; }
      state({ stabilizing = false, animating = false, justAnchored = false } = {}) {
        this.#stabilizing = stabilizing;
        this.#isAnimating = animating;
        this.#justAnchored = justAnchored;
      }
      finishLayout() { this.#stabilizing = false; }
      constructor() {
        ${scrollCallback.getText(ast)}
        this.scroll = debouncedScroll;
      }
      page() { this.#afterScroll('page'); }
      ${afterScroll.getText(ast)}
      ${render.getText(ast)}
    }
    globalThis.harness = new RestoreHarness();`,
    context,
  );
  return context.harness as {
    anchor: string;
    stabilizing: boolean;
    failLayout?: boolean;
    visible: string;
    events: Array<{ reason: string; range: string }>;
    state: (state: { stabilizing?: boolean; animating?: boolean; justAnchored?: boolean }) => void;
    scroll: () => void;
    page: () => void;
    finishLayout: () => void;
    render: () => void;
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("saved CFI survives paginated layout scroll events", () => {
  it("does not replace the saved anchor with a transient page while layout is stabilizing", async () => {
    const h = harness();
    h.state({ stabilizing: true, justAnchored: true });
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.anchor).toBe("saved-paragraph-17");
    expect(h.events).toEqual([]);
    h.finishLayout();
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.anchor).toBe("saved-paragraph-17");
    expect(h.events).toEqual([]);
  });

  it("ignores the deferred scroll echo of navigation so a late font load can reanchor exactly", async () => {
    const h = harness();
    h.state({ justAnchored: true });
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.anchor).toBe("saved-paragraph-17");
    expect(h.events).toEqual([]);
    h.visible = "user-page-18";
    h.page();
    expect(h.anchor).toBe("user-page-18");
    expect(h.events).toEqual([
      { reason: "page", range: "user-page-18", index: 1, fraction: 0.45, size: 0.025 },
    ]);
  });

  it("does not persist an intermediate animation frame as the reading position", async () => {
    const h = harness();
    h.state({ animating: true });
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.anchor).toBe("saved-paragraph-17");
    expect(h.events).toEqual([]);
  });

  it("still records an ordinary scroll after the one navigation echo has been consumed", async () => {
    const h = harness();
    h.state({ justAnchored: true });
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    h.visible = "manually-scrolled-page-18";
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.anchor).toBe("manually-scrolled-page-18");
    expect(h.events).toEqual([
      {
        reason: "container-scroll",
        range: "manually-scrolled-page-18",
        index: 1,
        fraction: 0.45,
        size: 0.025,
      },
    ]);
  });

  it("preserves an active async layout owner when ResizeObserver renders nested inside it", async () => {
    const h = harness();
    h.state({ stabilizing: true });
    h.render();
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    h.scroll();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.anchor).toBe("saved-paragraph-17");
    expect(h.stabilizing).toBe(true);
    expect(h.events).toEqual([]);
    h.finishLayout();
    h.visible = "user-page-18";
    h.page();
    expect(h.anchor).toBe("user-page-18");
  });

  it("does not leave ordinary resize rendering locked when no async layout owns stabilization", () => {
    const h = harness();
    h.render();
    expect(h.stabilizing).toBe(false);
  });

  it.each([false, true])(
    "restores the previous stabilization owner even if layout throws: %s",
    (stabilizing) => {
      const h = harness();
      h.state({ stabilizing });
      h.failLayout = true;
      expect(() => h.render()).toThrow("Layout failed");
      expect(h.stabilizing).toBe(stabilizing);
    },
  );
});
