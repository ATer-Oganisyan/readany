import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const html = readFileSync(
  new URL("../../../assets/reader/reader.template.html", import.meta.url),
  "utf8",
);
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
const ast = ts.createSourceFile(
  "reader.js",
  script,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const names = new Set([
  "extractTTSSegmentsFromDocument",
  "extractVisibleTTSSegments",
  "resolveTextPosition",
  "getTTSSegmentBoundaryNode",
  "getTTSCfiStartIdentity",
  "stripCfiAssertions",
  "getTTSSegmentIdentity",
]);
const code = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ""))
  .map((node) => node.getText(ast))
  .join("\n");

// Controlled DOM boundary port: execute the real segmentation/CFI functions,
// with deterministic range comparisons rather than source-string assertions.
function setup(text: string, visibleStart: number, visibleEnd = text.length) {
  const block = { contains: () => true };
  const node = { nodeType: 3, nodeValue: text, parentElement: block };
  class TestRange {
    static START_TO_START = 0;
    startContainer = node;
    endContainer = node;
    startOffset = 0;
    endOffset = text.length;
    get collapsed() {
      return this.startOffset === this.endOffset;
    }
    setStart(_node: typeof node, offset: number) {
      this.startOffset = offset;
    }
    setEnd(_node: typeof node, offset: number) {
      this.endOffset = offset;
    }
    cloneRange() {
      const range = new TestRange();
      range.startOffset = this.startOffset;
      range.endOffset = this.endOffset;
      return range;
    }
    collapse(start: boolean) {
      if (start) this.endOffset = this.startOffset;
      else this.startOffset = this.endOffset;
    }
    compareBoundaryPoints(_how: number, other: TestRange) {
      return Math.sign(this.startOffset - other.startOffset);
    }
    comparePoint(_node: typeof node, offset: number) {
      return offset < this.startOffset ? -1 : offset > this.endOffset ? 1 : 0;
    }
  }
  const doc = {
    documentElement: { lang: "ru" },
    body: {},
    defaultView: { Node: { TEXT_NODE: 3 }, Range: TestRange },
    createRange: () => new TestRange(),
  };
  const visible = new TestRange();
  visible.startOffset = visibleStart;
  visible.endOffset = visibleEnd;
  const cfi = `epubcfi(/6/2!/4/2,/1:${visibleStart},/1:${visibleEnd})`;
  const runtime = vm.createContext({
    console,
    Intl,
    navigator: { language: "ru" },
    window: {},
    view: {
      renderer: {},
      lastLocation: { cfi, range: visible },
      getCFI: (_section: number, range: TestRange) => `${range.startOffset}:${range.endOffset}`,
    },
    getRendererContents: () => [{ doc, index: 0 }],
    resolveRangeForCfi: (value: string) =>
      value === cfi ? { doc, index: 0, range: visible } : null,
    getReadableBlocksForTTS: () => [block],
    getTTSTextNodes: () => [node],
    normalizeTTSText: (value: string) => value.replace(/\s+/g, " ").trim(),
    getVisibleContentsForTTS: () => [],
    summarizeTTSSegmentsForLog: () => [],
    collectTTSSegmentsFromEngine: () => [],
  });
  vm.runInContext(code, runtime);
  return {
    direct: () => runtime.extractTTSSegmentsFromDocument(doc, 0, 500, visible, null, visible),
    visible: (align?: string) => runtime.extractVisibleTTSSegments(align),
    cfi,
  };
}

describe("reader TTS starts at the visible text boundary", () => {
  it("keeps the visible continuation of a sentence whose beginning is on the previous page", () => {
    const text = "Начало осталось за экраном, а продолжение видно сейчас. Следующее предложение.";
    const start = text.indexOf("а продолжение");
    const segments = setup(text, start).direct();
    expect(segments.map((s: { text: string }) => s.text)).toEqual([
      "а продолжение видно сейчас.",
      "Следующее предложение.",
    ]);
    expect(segments[0].cfi.split(":")[0]).toBe(String(start));
  });
  it("does not repeat a sentence ending before the viewport", () => {
    const text = "Уже прочитано. Сейчас видно.";
    expect(
      setup(text, text.indexOf("Сейчас"))
        .direct()
        .map((s: { text: string }) => s.text),
    ).toEqual(["Сейчас видно."]);
  });
  it("does not truncate the end of the last spoken sentence at the page boundary", () => {
    const text = "Начало за экраном и видимое продолжение заканчивается на следующей странице.";
    expect(
      setup(text, text.indexOf("видимое"), text.indexOf("заканчивается")).direct()[0]?.text,
    ).toBe("видимое продолжение заканчивается на следующей странице.");
  });
  it("trims whitespace at the clipped start and gives the first spoken character its own CFI", () => {
    const text = "Начало за экраном,   теперь видно.";
    const segments = setup(text, text.indexOf(",") + 1).direct();
    expect(segments[0]?.text).toBe("теперь видно.");
    expect(segments[0]?.cfi.split(":")[0]).toBe(String(text.indexOf("теперь")));
  });
  it("uses the WebView's current location when the toolbar does not supply an old native CFI", () => {
    const text = "Старая часть предложения, теперь текущая страница. Следующая фраза.";
    const fixture = setup(text, text.indexOf("теперь"));
    expect(fixture.visible()[0]?.text).toBe("теперь текущая страница.");
  });
  it("keeps an explicit CFI request on the same precise range path", () => {
    const text = "Старая часть предложения, теперь текущая страница. Следующая фраза.";
    const fixture = setup(text, text.indexOf("теперь"));
    expect(fixture.visible(fixture.cfi)[0]?.text).toBe("теперь текущая страница.");
  });
});
