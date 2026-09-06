import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DOMParser } from "@xmldom/xmldom";
import ts from "typescript";
import { expect, it, vi } from "vitest";

function capture(
  visible = "Сейчас виден этот текст.",
  options: { missingRange?: boolean; invalidCfi?: boolean } = {},
) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const source = ts.createSourceFile(
    "reader.js",
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const names = new Set(["getVisibleTextSnippet", "doGetVisibleReadingContext"]);
  const statements = source.statements.filter(
    (node) =>
      (ts.isFunctionDeclaration(node) && names.has(node.name?.text || "")) ||
      (ts.isExpressionStatement(node) &&
        ts.isBinaryExpression(node.expression) &&
        node.expression.left.getText(source) === "window.requestPageSnippet"),
  );
  if (statements.length !== 3) throw new Error("Missing actual bookmark request functions");
  const doc = new DOMParser().parseFromString(
    `<p>Текст за предыдущим экраном. ${visible} Дальше за экраном.</p>`,
    "text/xml",
  );
  const node = doc.documentElement.firstChild;
  if (!node) throw new Error("Missing paragraph fixture");
  // One text node spans columns: its whole-node box intersects the viewport,
  // although its beginning is offscreen. The resolved CFI clips that node.
  Object.assign(doc, {
    body: doc.documentElement,
    defaultView: { innerWidth: 100, innerHeight: 200 },
    createTreeWalker: () => {
      let visited = false;
      return {
        nextNode: () => {
          if (visited) return null;
          visited = true;
          return node;
        },
      };
    },
    createRange: () => ({
      selectNodeContents: () => {},
      getBoundingClientRect: () => ({
        left: 0,
        right: 300,
        width: 300,
        top: 0,
        bottom: 200,
        height: 200,
      }),
    }),
  });
  const range = {
    commonAncestorContainer: node,
    cloneContents: () => {
      const fragment = doc.createDocumentFragment();
      fragment.appendChild(doc.createTextNode(visible));
      return fragment;
    },
  };
  const cfi = "epubcfi(/6/2!/4/2,/1:29,/1:55)";
  const postToRN = vi.fn();
  const location = { cfi, range: options.missingRange ? undefined : range };
  const view = {
    lastLocation: location,
    renderer: {
      getContents: () => [{ index: 0, doc }],
      scrolled: false,
      start: 100,
      end: 200,
      size: 100,
    },
    resolveCFI: () => ({ index: 0, anchor: () => range }),
    getCFI: () => (options.invalidCfi ? "broad-fallback-cfi" : cfi),
  };
  const runtime = vm.createContext({
    view,
    window: {},
    postToRN,
    getPrimaryRendererContent: () => ({ index: 0, doc }),
    NodeFilter: { SHOW_TEXT: 4, FILTER_SKIP: 3, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    isTTSFootnoteMarker: () => false,
    shouldSkipTTSNode: () => false,
    normalizeTTSText: (text: string) => text.replace(/\s+/g, " ").trim(),
  });
  vm.runInContext(
    statements.map((node) => script.slice(node.getStart(source), node.end)).join("\n"),
    runtime,
  );
  runtime.window.requestPageSnippet("bookmark-request");
  return { message: postToRN.mock.calls[0], cfi, location, view };
}

it("labels the bookmark from the visible CFI slice, not the offscreen paragraph start", () => {
  const result = capture();
  expect(result.message).toEqual([
    "bookmarkSnippet",
    { textSnippet: "Сейчас виден этот текст.", requestId: "bookmark-request", cfi: result.cfi },
  ]);
  expect(result.view.lastLocation).toBe(result.location);
});
it("limits the exact visible label to 80 characters", () => {
  expect(capture("я".repeat(120)).message[1].textSnippet).toBe("я".repeat(80));
});
it.each([{ missingRange: true }, { invalidCfi: true }])(
  "returns an empty optional label when exact context cannot be proven: %j",
  (options) => {
    const result = capture("visible", options);
    expect(result.message[1].textSnippet).toBe("");
    expect(result.message[1].requestId).toBe("bookmark-request");
  },
);
