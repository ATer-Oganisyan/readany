import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function findWindowAssignment(root: ts.Node, name: string): ts.BinaryExpression {
  let found: ts.BinaryExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === "window" &&
      node.left.name.text === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  if (!found) throw new Error(`window.${name} assignment was not found`);
  return found;
}

function findFunction(root: ts.Node, name: string): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  if (!found) throw new Error(`${name} function was not found`);
  return found;
}

function harness(enabled: boolean, isPDF = true) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const ast = ts.createSourceFile("reader.js", script, ts.ScriptTarget.ESNext, true);
  const setInterstitials = vi.fn();
  const sceneSlotLog = vi.fn();
  const insertBefore = vi.fn();
  const position = { index: 4 };
  const context = vm.createContext({
    currentBook: { isPDF, sections: Array.from({ length: 8 }) },
    view: { renderer: { setInterstitials } },
    _sceneSlotsEnabled: enabled,
    _sceneRestoreAnchors: [],
    _pdfSceneProposals: [],
    _pdfScenePendingProposals: [],
    _pdfSceneProgress: Object.create(null),
    _sceneSlotLabels: { idle: "Сгенерировать сцену" },
    SCENE_INSERT_CLASS: "readany-scene-insert",
    SCENE_PROGRESS_ATTR: "data-readany-scene-progress",
    getPrimaryRendererContent: () => ({
      index: position.index,
      doc: {
        defaultView: {},
        documentElement: { hasAttribute: (name: string) => isPDF && name === "data-readany-pdf" },
        querySelectorAll: () => [],
      },
    }),
    getRendererContents: () => [],
    pdfSceneAnchorForPage: (index: number) => `readany-pdf-page-v1:${index}`,
    pdfScenePageIndex: (anchor: string) => Number(anchor.split(":")[1]),
    pdfSceneEntry: (anchor: string, afterIndex: number) => ({ key: anchor, afterIndex }),
    findLastVisibleSceneBlock: () => ({ textContent: "Page text" }),
    computeSceneAnchor: () => "epubcfi(/6/4)",
    findSceneInsertInDoc: () => null,
    sceneInsertHostForBlock: () => ({ parentNode: { insertBefore }, nextSibling: null }),
    createSceneInsert: () => ({ setAttribute: vi.fn() }),
    sceneSlotLog,
  });
  vm.runInContext(findFunction(ast, "syncPDFScenePages").getText(ast), context);
  for (const name of ["insertSceneSlot", "configureSceneSlots", "setSceneAnchors"]) {
    const assignment = findWindowAssignment(ast, name);
    vm.runInContext(`globalThis.${name} = ${assignment.right.getText(ast)}`, context);
  }
  return { context, setInterstitials, sceneSlotLog, insertBefore, position };
}

describe("PDF scene pages", () => {
  it("keeps the original PDF position pending until scene generation is available", () => {
    const { context, setInterstitials, sceneSlotLog, position } = harness(false);

    context.insertSceneSlot(0.42);
    context.insertSceneSlot(0.42);

    expect(Array.from(context._pdfSceneProposals)).toEqual([]);
    expect(Array.from(context._pdfScenePendingProposals)).toEqual(["readany-pdf-page-v1:4"]);
    expect(setInterstitials).not.toHaveBeenCalled();
    expect(sceneSlotLog).toHaveBeenCalledWith(
      "deferred PDF scene page at readany-pdf-page-v1:4 until generation is available",
    );

    position.index = 6;
    context.configureSceneSlots(JSON.stringify({ enabled: true }));

    expect(Array.from(context._pdfScenePendingProposals)).toEqual([]);
    expect(Array.from(context._pdfSceneProposals)).toEqual(["readany-pdf-page-v1:4"]);
    expect(setInterstitials).toHaveBeenCalledWith([
      { key: "readany-pdf-page-v1:4", afterIndex: 4 },
    ]);
    context.configureSceneSlots(JSON.stringify({ enabled: true }));
    expect(setInterstitials).toHaveBeenCalledTimes(1);
  });

  it("creates one stable PDF page when scene generation is available", () => {
    const { context, setInterstitials } = harness(true);

    context.insertSceneSlot(0.42);
    context.insertSceneSlot(0.42);

    expect(Array.from(context._pdfSceneProposals)).toEqual(["readany-pdf-page-v1:4"]);
    expect(context._pdfSceneProgress["readany-pdf-page-v1:4"]).toBe(0.42);
    expect(setInterstitials).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a saved scene when a pending PDF proposal becomes available", () => {
    const { context, setInterstitials } = harness(false);
    context.insertSceneSlot(0.42);
    context.setSceneAnchors(JSON.stringify(["readany-pdf-page-v1:4"]));
    expect(setInterstitials).toHaveBeenCalledWith([
      { key: "readany-pdf-page-v1:4", afterIndex: 4 },
    ]);

    context.configureSceneSlots(JSON.stringify({ enabled: true }));

    expect(Array.from(context._pdfScenePendingProposals)).toEqual([]);
    expect(Array.from(context._pdfSceneProposals)).toEqual([]);
    expect(setInterstitials).toHaveBeenCalledTimes(1);
  });

  it("leaves the non-PDF insertion path unchanged while generation is unavailable", () => {
    const { context, insertBefore } = harness(false, false);

    context.insertSceneSlot(0.42);

    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(Array.from(context._pdfScenePendingProposals)).toEqual([]);
  });
});
