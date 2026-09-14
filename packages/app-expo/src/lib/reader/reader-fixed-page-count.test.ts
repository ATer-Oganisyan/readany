import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function findNode(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(root);
  if (!found) throw new Error("Reader relocation listener was not found");
  return found;
}

function runRelocation(fixed: boolean) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const ast = ts.createSourceFile("reader.js", script, ts.ScriptTarget.ESNext, true);
  const listener = findNode(
    ast,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "relocate",
  ) as ts.CallExpression;

  const messages: Record<string, unknown>[] = [];
  const renderer = { index: 3, page: 2, pages: 10 };
  const book = { sections: Array.from({ length: 127 }, () => ({ size: 1000 })) };
  const context = vm.createContext({
    view: { isFixedLayout: fixed, renderer, book },
    currentSectionIndex: 0,
    totalSections: 85,
    msg: { loadId: "book" },
    snippetTimer: null,
    setTimeout: () => 1,
    clearTimeout() {},
    hideFootnoteTip() {},
    refreshUserAnnotations() {},
    postToRN: (type: string, detail: Record<string, unknown>) => {
      if (type === "relocate") messages.push(detail);
    },
  });
  vm.runInContext(`globalThis.relocate = ${listener.arguments[1].getText(ast)}`, context);
  context.relocate({
    detail: {
      fraction: 0.03,
      section: { current: 3, total: 85 },
      location: { current: 3, next: 4, total: 85 },
      cfi: "epubcfi(/6/8)",
    },
  });
  return messages.at(-1);
}

describe("fixed-layout page reporting", () => {
  it("reports physical PDF pages instead of byte-estimated locations", () => {
    expect(runRelocation(true)).toMatchObject({
      isFixedLayout: true,
      section: { current: 3, total: 127 },
      page: { current: 4, total: 127 },
      location: undefined,
    });
  });

  it("keeps reflowable location reporting unchanged", () => {
    expect(runRelocation(false)).toMatchObject({
      isFixedLayout: false,
      section: { current: 3, total: 85 },
      page: { current: 2, total: 8 },
      location: { current: 3, next: 4, total: 85 },
    });
  });
});
