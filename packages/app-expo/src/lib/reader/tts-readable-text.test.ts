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
