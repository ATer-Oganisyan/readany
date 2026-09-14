import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function findInsertSceneSlot(root: ts.Node): ts.BinaryExpression {
  let found: ts.BinaryExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === "window" &&
      node.left.name.text === "insertSceneSlot"
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  if (!found) throw new Error("window.insertSceneSlot assignment was not found");
  return found;
}

function harness(enabled: boolean) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const ast = ts.createSourceFile("reader.js", script, ts.ScriptTarget.ESNext, true);
  const assignment = findInsertSceneSlot(ast);
  const syncPDFScenePages = vi.fn();
  const sceneSlotLog = vi.fn();
  const context = vm.createContext({
    view: { renderer: {} },
    _sceneSlotsEnabled: enabled,
    _sceneRestoreAnchors: [],
    _pdfSceneProposals: [],
    _pdfSceneProgress: Object.create(null),
    getPrimaryRendererContent: () => ({
      index: 4,
      doc: {
        defaultView: {},
        documentElement: { hasAttribute: (name: string) => name === "data-readany-pdf" },
      },
    }),
    pdfSceneAnchorForPage: (index: number) => `readany-pdf-page-v1:${index}`,
    syncPDFScenePages,
    sceneSlotLog,
  });
  vm.runInContext(`globalThis.insertSceneSlot = ${assignment.right.getText(ast)}`, context);
  return { context, syncPDFScenePages, sceneSlotLog };
}

describe("PDF scene pages", () => {
  it("does not create an empty page while scene generation is unavailable", () => {
    const { context, syncPDFScenePages, sceneSlotLog } = harness(false);

    context.insertSceneSlot(0.42);

    expect(Array.from(context._pdfSceneProposals)).toEqual([]);
    expect(syncPDFScenePages).not.toHaveBeenCalled();
    expect(sceneSlotLog).toHaveBeenCalledWith("skip: PDF scene generation is unavailable");
  });

  it("creates one stable PDF page when scene generation is available", () => {
    const { context, syncPDFScenePages } = harness(true);

    context.insertSceneSlot(0.42);
    context.insertSceneSlot(0.42);

    expect(Array.from(context._pdfSceneProposals)).toEqual(["readany-pdf-page-v1:4"]);
    expect(context._pdfSceneProgress["readany-pdf-page-v1:4"]).toBe(0.42);
    expect(syncPDFScenePages).toHaveBeenCalledTimes(1);
  });
});
