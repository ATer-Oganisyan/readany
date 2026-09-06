import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DOMParser } from "@xmldom/xmldom";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function capture(location: unknown, overrides: Record<string, unknown> = {}) {
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
  const fn = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "doGetVisibleReadingContext",
  );
  if (!fn) throw new Error("Missing exact viewport capture");
  const range = (location as { range?: { commonAncestorContainer?: Node } } | null)?.range;
  const doc = range?.commonAncestorContainer?.ownerDocument;
  const runtime = vm.createContext({
    view: {
      lastLocation: location,
      renderer: { getContents: () => [{ index: 0, doc }] },
      resolveCFI: () => ({ index: 0, anchor: () => range }),
      getCFI: () => (location as { cfi?: string } | null)?.cfi,
      ...overrides,
    },
  });
  vm.runInContext(script.slice(fn.getStart(source), fn.end), runtime);
  return runtime.doGetVisibleReadingContext();
}

const cfi = "epubcfi(/6/2!/4/2:8)";

describe("exact visible reading context", () => {
  it("resolves the immutable CFI again instead of cloning a live range moved by name wrappers", () => {
    const doc = new DOMParser().parseFromString("<p>Visible only.</p>", "text/xml");
    const movedLiveRange = {
      commonAncestorContainer: doc.documentElement,
      cloneContents: vi.fn(() => doc.createTextNode("OFFSCREEN earlier paragraph")),
    };
    const freshRange = {
      commonAncestorContainer: doc.documentElement,
      cloneContents: vi.fn(() => doc.documentElement.cloneNode(true)),
    };
    const anchor = vi.fn(() => freshRange);
    const resolveCFI = vi.fn(() => ({ index: 0, anchor }));
    expect(capture({ cfi, range: movedLiveRange }, { resolveCFI })).toEqual({
      text: "Visible only.",
      cfi,
    });
    expect(resolveCFI).toHaveBeenCalledWith(cfi);
    expect(anchor).toHaveBeenCalledWith(doc);
    expect(freshRange.cloneContents).toHaveBeenCalledOnce();
    expect(movedLiveRange.cloneContents).not.toHaveBeenCalled();
  });

  it.each([
    { resolveCFI: undefined },
    { resolveCFI: () => ({ index: 1, anchor: vi.fn() }) },
    { resolveCFI: () => ({ index: 0, anchor: undefined }) },
    { renderer: { getContents: () => [] } },
    { getCFI: () => "epubcfi(/6/2!/4)" },
  ])("fails closed for an unloaded or non-roundtripping CFI: %j", (overrides) => {
    const doc = new DOMParser().parseFromString(
      "<p>Do not fall back to full chapter.</p>",
      "text/xml",
    );
    const cloneContents = vi.fn(() => doc.documentElement.cloneNode(true));
    expect(
      capture(
        { cfi, range: { commonAncestorContainer: doc.documentElement, cloneContents } },
        overrides,
      ),
    ).toBeNull();
    expect(cloneContents).not.toHaveBeenCalled();
  });

  it("reads only the viewport slice of a long text node, never its future tail", () => {
    const doc = new DOMParser().parseFromString(
      "<p>Прочитано. Сейчас видно. Будущий секрет.</p>",
      "text/xml",
    );
    const node = doc.documentElement.firstChild;
    if (!node?.nodeValue) throw new Error("Missing text fixture");
    const paragraph = node.nodeValue;
    const start = paragraph.indexOf("Сейчас");
    const end = paragraph.indexOf(" Будущий");
    const cloneContents = vi.fn(() => {
      const fragment = doc.createDocumentFragment();
      fragment.appendChild(doc.createTextNode(paragraph.slice(start, end)));
      return fragment;
    });
    expect(capture({ cfi, range: { commonAncestorContainer: node, cloneContents } })).toEqual({
      text: "Сейчас видно.",
      cfi,
    });
    expect(cloneContents).toHaveBeenCalledOnce();
  });

  it("removes pronunciation, scripts and styles from the cloned fragment without altering the book", () => {
    const doc = new DOMParser().parseFromString(
      "<main><p>Герой <ruby>идёт<rt>FUTURE</rt><rp>FUTURE</rp></ruby>.</p><script>FUTURE</script><style>FUTURE</style><p>Он здесь.</p></main>",
      "text/xml",
    );
    const before = doc.toString();
    const range = {
      commonAncestorContainer: doc.documentElement,
      cloneContents: () => doc.documentElement.cloneNode(true),
    };
    expect(capture({ cfi, range })).toEqual({ text: "Герой идёт. Он здесь.", cfi });
    expect(doc.toString()).toBe(before);
  });

  it("rejects a range inside an excluded element even when cloning drops its wrapper", () => {
    const doc = new DOMParser().parseFromString("<rt>Pronunciation</rt>", "text/xml");
    const node = doc.documentElement.firstChild;
    if (!node) throw new Error("Missing pronunciation fixture");
    expect(
      capture({
        cfi,
        range: { commonAncestorContainer: node, cloneContents: () => node.cloneNode(true) },
      }),
    ).toBeNull();
  });

  it("caps context at 4000 characters", () => {
    const doc = new DOMParser().parseFromString(`<p>${"я".repeat(5000)}</p>`, "text/xml");
    expect(
      capture({
        cfi,
        range: {
          commonAncestorContainer: doc.documentElement,
          cloneContents: () => doc.documentElement.cloneNode(true),
        },
      }).text,
    ).toBe("я".repeat(4000));
  });

  it.each([null, {}, { cfi }, { range: {} }, { cfi: "", range: {} }])(
    "returns no context when the exact range or CFI is missing: %j",
    (location) => {
      expect(capture(location)).toBeNull();
    },
  );
});
