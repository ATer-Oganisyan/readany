import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

const html = readFileSync("assets/reader/reader.template.html", "utf8");
const code = html.slice(
  html.indexOf("    var _readerNoteRange"),
  html.indexOf("    window.copyReaderSelection"),
);

it.each([false, true])("preserves the quote after native selection dismissal: %s", (dismissed) => {
  const range = { toString: () => "Selected quote", cloneRange: () => range };
  const doc = { getSelection: () => (dismissed ? null : range) };
  const postToRN = vi.fn();
  const context = vm.createContext({
    window: {},
    doc,
    range,
    postToRN,
    getRendererContents: () => [{ doc, index: 3 }],
    getSelectionRange: (value: unknown) => value,
    getRangeTextWithoutRuby: (_range: unknown, text: string) => text,
    view: {
      getCFI: (index: number, value: unknown) => {
        expect(index).toBe(3);
        expect(value).toBe(range);
        return "quote-cfi";
      },
    },
  });
  vm.runInContext(
    `${code}\n_readerNoteRange = { doc, range }; window.noteReaderSelection();`,
    context,
  );
  expect(postToRN).toHaveBeenCalledExactlyOnceWith("noteSelection", {
    text: "Selected quote",
    cfi: "quote-cfi",
  });
  if (dismissed) {
    vm.runInContext("window.noteReaderSelection();", context);
    expect(postToRN).toHaveBeenCalledTimes(1);
  }
});

it("keeps verse line breaks and paragraph boundaries without separating inline words or ruby", async () => {
  const { DOMParser } = await import("@xmldom/xmldom");
  const doc = new DOMParser().parseFromString(
    "<div><p>Нашел он полон двор услуги;<br/>К покойнику со всех сторон<br/>Съезжались недруги и други,</p><p>По<span>койника</span> похоронили.<ruby>漢<rt>かん</rt></ruby></p></div>",
    "text/xml",
  );
  const fragment = doc.createDocumentFragment();
  for (const child of Array.from(doc.documentElement.childNodes))
    fragment.appendChild(child.cloneNode(true));
  const helper = html.slice(
    html.indexOf("    function getRangeTextWithoutRuby"),
    html.indexOf("    function getVisibleTextSnippet"),
  );
  const context = vm.createContext({ range: { cloneContents: () => fragment } });
  const text = vm.runInContext(`${helper}\ngetRangeTextWithoutRuby(range, "fallback")`, context);
  expect(text).toBe(
    "Нашел он полон двор услуги;\nК покойнику со всех сторон\nСъезжались недруги и други,\n\nПокойника похоронили.漢",
  );
});
