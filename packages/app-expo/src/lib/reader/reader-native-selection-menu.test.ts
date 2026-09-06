import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(
  new URL("../../../assets/reader/reader.template.html", import.meta.url),
  "utf8",
);
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
const ast = ts.createSourceFile("reader.js", script, ts.ScriptTarget.ESNext, true);
const apply = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "applyDocStyles",
);
if (!apply) throw new Error("Actual applyDocStyles function missing");
const applySource = apply.getText(ast);

class DocumentPort extends EventTarget {
  listeners = 0;
  head = { appendChild: vi.fn() };
  querySelectorAll() {
    return [];
  }
  createElement() {
    return { textContent: "" };
  }
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    if (args[0] === "contextmenu") this.listeners++;
    super.addEventListener(...args);
  }
}

function harness(userAgent?: string) {
  const context = vm.createContext({
    ...(userAgent === undefined ? {} : { navigator: { userAgent } }),
    syncCustomFontStylesForDoc: vi.fn(),
    currentCustomFontFaceCSS: "",
    isVerticalDoc: () => false,
    currentThemeColors: { bg: "#fff", fg: "#111", primary: "#ff7900" },
    lastRendererStyles: "",
  });
  vm.runInContext(applySource, context);
  return { doc: new DocumentPort(), apply: context.applyDocStyles as (doc: DocumentPort) => void };
}

function dispatch(doc: DocumentPort) {
  const event = new Event("contextmenu", { cancelable: true, bubbles: true });
  const stop = vi.spyOn(event, "stopPropagation");
  const accepted = doc.dispatchEvent(event);
  return { event, stop, accepted };
}

describe("native reader text-selection menu dispatch", () => {
  it("does not cancel Android WebView contextmenu, allowing its native selection ActionMode", () => {
    const h = harness(
      "Mozilla/5.0 (Linux; Android 16; Pixel 8 Build/BP2A; wv) AppleWebKit/537.36 Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36",
    );
    h.apply(h.doc);
    const result = dispatch(h.doc);
    expect(result.event.defaultPrevented).toBe(false);
    expect(result.accepted).toBe(true);
    expect(result.stop).not.toHaveBeenCalled();
  });
  it("keeps Android selection actions available after repeated theme/style application", () => {
    const h = harness("Mozilla/5.0 Android 16 wv");
    for (let index = 0; index < 5; index++) h.apply(h.doc);
    expect(dispatch(h.doc).event.defaultPrevented).toBe(false);
    expect(h.doc.listeners).toBe(0);
  });
  it("preserves the existing iOS contextmenu suppression", () => {
    const h = harness(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    );
    h.apply(h.doc);
    const result = dispatch(h.doc);
    expect(result.event.defaultPrevented).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.stop).toHaveBeenCalledOnce();
  });
  it("attaches only one iOS suppression listener when applying styles repeatedly", () => {
    const h = harness("Mozilla/5.0 iPhone");
    for (let index = 0; index < 5; index++) h.apply(h.doc);
    const result = dispatch(h.doc);
    expect(h.doc.listeners).toBe(1);
    expect(result.event.defaultPrevented).toBe(true);
    expect(result.stop).toHaveBeenCalledOnce();
  });
  it("keeps non-Android fallback behavior when no browser identity is available", () => {
    const h = harness();
    h.apply(h.doc);
    expect(dispatch(h.doc).event.defaultPrevented).toBe(true);
  });
});
