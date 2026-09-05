import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const code = readFileSync(new URL("../../../../foliate-js/pdf.js", import.meta.url), "utf8");
const source = ts.createSourceFile("pdf.js", code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
function declaration(name: string) {
  const statement = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((item) => item.name.getText(source) === name),
  );
  if (!statement) throw new Error(`Missing production PDF declaration: ${name}`);
  return statement.getText(source);
}

function harness(dpr: number) {
  const properties = new Map<string, string>();
  const textLayer = {
    replaceChildren: vi.fn(),
    append: vi.fn(),
    style: {},
    classList: { add() {}, remove() {} },
  };
  const canvasContainer = { replaceChildren: vi.fn() };
  const viewport = { width: 0, height: 0, scale: 0 };
  const renderedTextLayers: Array<{ cssScale: string | undefined; viewportScale: number }> = [];
  const doc = {
    documentElement: {
      style: { setProperty: (name: string, value: unknown) => properties.set(name, String(value)) },
    },
    querySelector: (selector: string) =>
      selector === "#canvas" ? canvasContainer : selector === ".textLayer" ? textLayer : null,
    adoptNode: (node: unknown) => node,
    addEventListener: vi.fn(),
  };
  const context = vm.createContext({
    devicePixelRatio: dpr,
    document: {
      createElement: (tag: string) => (tag === "canvas" ? { getContext: () => ({}) } : {}),
      querySelectorAll: () => [],
    },
    pdfjsLib: {
      // Models the installed v4 TextLayer's documented CSS-variable input.
      // Browser cascade/selection is verified in native WebView, not this stub.
      TextLayer: class {
        render = async () => {
          renderedTextLayers.push({
            cssScale: properties.get("--scale-factor"),
            viewportScale: viewport.scale,
          });
        };
      },
    },
  });
  vm.runInContext(`${declaration("render")};globalThis.renderPDFPage=render`, context);
  const page = {
    getViewport: ({ scale }: { scale: number }) =>
      Object.assign(viewport, { scale, width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    streamTextContent: async () => ({}),
  };
  return {
    properties,
    renderedTextLayers,
    canvasContainer,
    doc,
    render: (zoom: number) => context.renderPDFPage(page, doc, zoom) as Promise<void>,
  };
}

describe("PDF canvas and selectable text layer scale contract", () => {
  it.each([1, 2, 3])(
    "passes the same scale to PDF.js text CSS and canvas at DPR=%s",
    async (dpr) => {
      const h = harness(dpr);
      for (const zoom of [1, 0.5, 1.5]) {
        await h.render(zoom);
        expect(h.renderedTextLayers.at(-1)).toEqual({
          cssScale: String(zoom * dpr),
          viewportScale: zoom * dpr,
        });
        expect(h.properties.get("--total-scale-factor")).toBe(String(zoom * dpr));
        expect(h.canvasContainer.replaceChildren).toHaveBeenLastCalledWith(
          expect.objectContaining({ width: 595 * zoom * dpr, height: 842 * zoom * dpr }),
        );
      }
    },
  );
  it("retains selectable transparent text even under the reader's important color override (CSS contract supplement)", () => {
    const context = vm.createContext({});
    vm.runInContext(`${declaration("TEXT_LAYER_CSS")};globalThis.css=TEXT_LAYER_CSS`, context);
    expect(context.css).toMatch(
      /\.textLayer\s+:is\(span,\s*br\)\s*\{[^}]*color:\s*transparent\s*!important/,
    );
    expect(context.css).not.toMatch(/\.textLayer\s+--min-font-size/);
    expect(context.css).not.toMatch(
      /\.textLayer\s*\{[^}]*(?:display:\s*none|pointer-events:\s*none|user-select:\s*none)/,
    );
  });
});

function readerStyles(pdf: boolean, existing = false) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const parsed = ts.createSourceFile(
    "reader.js",
    script,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const helper = parsed.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "syncReaderOverrideStylesForDoc",
  );
  if (!helper) throw new Error("Production reader override helper missing");
  const children: Array<{ id: string; textContent: string; remove: () => void }> = [];
  const createElement = vi.fn(() => {
    const element = {
      id: "",
      textContent: "",
      remove: () => {
        const index = children.indexOf(element);
        if (index >= 0) children.splice(index, 1);
      },
    };
    return element;
  });
  const doc = {
    documentElement: { hasAttribute: (name: string) => pdf && name === "data-readany-pdf" },
    getElementById: (id: string) => children.find((child) => child.id === id),
    createElement,
    head: {
      appendChild: (child: (typeof children)[number]) => {
        child.remove();
        children.push(child);
      },
    },
  };
  if (existing) {
    const old = createElement();
    old.id = "__readany_reader_overrides__";
    old.textContent = "span { font-size: 16px !important; }";
    children.push(old);
  }
  createElement.mockClear();
  const context = vm.createContext({});
  vm.runInContext(helper.getText(parsed), context);
  return {
    children,
    createElement,
    sync: (css: string) => context.syncReaderOverrideStylesForDoc(doc, css),
  };
}

describe("PDF typography is isolated from reflow settings", () => {
  it("marks the actual generated PDF document so the reader can keep its text geometry", async () => {
    const context = vm.createContext({ Blob, URL: { createObjectURL: () => "blob:test" } });
    vm.runInContext(
      `${declaration("TEXT_LAYER_CSS")};${declaration("ANNOTATION_LAYER_CSS")};${declaration("renderPage")};globalThis.page=renderPage`,
      context,
    );
    const result = await context.page({ getViewport: () => ({ width: 595, height: 842 }) });
    expect(result.data).toMatch(/<html\b[^>]*\bdata-readany-pdf(?:[\s=>])/);
  });
  it.each([false, true])(
    "never installs reflow font settings on a PDF, including stale existing=%s styles",
    (existing) => {
      const h = readerStyles(true, existing);
      h.sync("span { font-size: 16px !important; }");
      h.sync("span { font-size: 64px !important; line-height: 2 !important; }");
      expect(h.children).toHaveLength(0);
      expect(h.createElement).not.toHaveBeenCalled();
    },
  );
  it("still applies and updates reflow settings to an ordinary EPUB", () => {
    const h = readerStyles(false);
    h.sync("span { font-size: 16px !important; }");
    const latest = "span { font-size: 64px !important; line-height: 2 !important; }";
    h.sync(latest);
    expect(h.children).toHaveLength(1);
    expect(h.children[0].textContent).toBe(latest);
    expect(h.createElement).toHaveBeenCalledTimes(1);
  });
});
