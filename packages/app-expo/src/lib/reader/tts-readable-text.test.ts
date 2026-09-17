import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

const template = readFileSync("assets/reader/reader.template.html", "utf8");
const normalizeSource = template.slice(
  template.indexOf("    function normalizeTTSText("),
  template.indexOf("    function isTTSFootnoteMarker("),
);

it("rejects separators but preserves speech, numbers and non-Latin text", () => {
  const context = vm.createContext({ TTS_FOOTNOTE_MARKER_PATTERN: /\uFFFC/g });
  vm.runInContext(normalizeSource, context);
  for (const text of ["* * *", "…", "—", "   "]) {
    expect(context.normalizeTTSText(text)).toBe("");
  }
  for (const text of ["Вы же знаете, что они думают о подобных книгах…", "1967", "中文", "Hello!"]) {
    expect(context.normalizeTTSText(text)).toBe(text);
  }
});

it("trims Foliate's sentence range to the same CFI the page extractor produces", () => {
  const source = template.slice(
    template.indexOf("    function trimTTSDetailCfi("),
    template.indexOf("    function getTTSSegmentContextFromEngine("),
  );
  const node = { nodeType: 3, nodeValue: "   — Я, пожалуй, пойду. " };
  const range = {
    startContainer: node,
    endContainer: node,
    startOffset: 1,
    endOffset: node.nodeValue.length,
    cloneRange() {
      return { ...this };
    },
    setStart(_: unknown, offset: number) {
      this.startOffset = offset;
    },
    setEnd(_: unknown, offset: number) {
      this.endOffset = offset;
    },
  };
  const context = vm.createContext({
    view: { getCFI: (_: number, r: typeof range) => `epubcfi(/6/6!/4/2,/1:${r.startOffset},/1:${r.endOffset})` },
    resolveRangeForCfi: () => ({ index: 2, range }),
  });
  vm.runInContext(source, context);
  expect(context.trimTTSDetailCfi("epubcfi(/6/6!/4/2,/1:1,/1:25)")).toBe("epubcfi(/6/6!/4/2,/1:3,/1:23)");
  // Unresolvable CFI (another section) is returned untouched.
  context.resolveRangeForCfi = () => null;
  expect(context.trimTTSDetailCfi("epubcfi(/6/8!/4/2,/1:0,/1:8)")).toBe("epubcfi(/6/8!/4/2,/1:0,/1:8)");
});

it("excludes scene controls and translations in Foliate's fallback walker", () => {
  const source = readFileSync("../foliate-js/text-walker.js", "utf8");
  const context = vm.createContext({ NodeFilter: { FILTER_REJECT: 2, FILTER_SKIP: 3, FILTER_ACCEPT: 1 } });
  vm.runInContext(source.slice(source.indexOf("const acceptNode ="), source.indexOf("export const textWalker")) + "\nglobalThis.accept = acceptNode;", context);
  for (const className of ["readany-scene-insert", "readany-translation"]) {
    const element = { tagName: "SPAN", closest: (selector: string) => selector.includes(className) };
    expect(context.accept({ nodeType: 3, parentElement: element })).toBe(2);
    expect(context.accept({ nodeType: 1, ...element })).toBe(2);
  }
  expect(context.accept({ nodeType: 3, parentElement: { closest: () => null } })).toBe(1);
});
