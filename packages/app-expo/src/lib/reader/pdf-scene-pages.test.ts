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
  const createSceneInsert = vi.fn(() => ({ setAttribute: vi.fn() }));
  const renderSceneInsert = vi.fn();
  const contents: { doc: object; index: number }[] = [];
  const position = { index: 4 };
  const context = vm.createContext({
    currentBook: { isPDF, sections: Array.from({ length: 8 }) },
    view: { renderer: { setInterstitials } },
    _sceneSlotsEnabled: enabled,
    _sceneRestoreAnchors: [],
    _pdfSceneProposals: [],
    _pdfSceneProgress: Object.create(null),
    _sceneSlotLabels: { idle: "Сгенерировать сцену" },
    SCENE_INSERT_CLASS: "readany-scene-insert",
    SCENE_PROGRESS_ATTR: "data-readany-scene-progress",
    SCENE_STATE_ATTR: "data-readany-scene-state",
    PDF_SCENE_PAGE_ATTR: "data-readany-scene-page",
    getPrimaryRendererContent: () => ({
      index: position.index,
      doc: {
        defaultView: {},
        documentElement: { hasAttribute: (name: string) => isPDF && name === "data-readany-pdf" },
        querySelectorAll: () => [],
      },
    }),
    getRendererContents: () => contents,
    pdfSceneAnchorForPage: (index: number) => `readany-pdf-page-v1:${index}`,
    pdfScenePageIndex: (anchor: string) => Number(anchor.split(":")[1]),
    pdfSceneEntry: (anchor: string, afterIndex: number) => ({ key: anchor, afterIndex }),
    findLastVisibleSceneBlock: () => ({ textContent: "Page text" }),
    computeSceneAnchor: () => "epubcfi(/6/4)",
    findSceneInsertInDoc: () => null,
    sceneInsertHostForBlock: () => ({ parentNode: { insertBefore }, nextSibling: null }),
    createSceneInsert,
    renderSceneInsert,
    sceneSlotLog,
  });
  vm.runInContext(findFunction(ast, "syncPDFScenePages").getText(ast), context);
  vm.runInContext(findFunction(ast, "applySceneInserts").getText(ast), context);
  for (const name of ["insertSceneSlot", "configureSceneSlots", "setSceneAnchors"]) {
    const assignment = findWindowAssignment(ast, name);
    vm.runInContext(`globalThis.${name} = ${assignment.right.getText(ast)}`, context);
  }
  return {
    context,
    setInterstitials,
    sceneSlotLog,
    insertBefore,
    createSceneInsert,
    renderSceneInsert,
    contents,
    position,
  };
}

describe("PDF scene pages", () => {
  it("shows an idle PDF scene page immediately and unlocks it when generation is available", () => {
    const { context, setInterstitials, sceneSlotLog, position } = harness(false);

    context.insertSceneSlot(0.42);
    context.insertSceneSlot(0.42);

    expect(Array.from(context._pdfSceneProposals)).toEqual(["readany-pdf-page-v1:4"]);
    expect(setInterstitials).toHaveBeenCalledWith([
      { key: "readany-pdf-page-v1:4", afterIndex: 4 },
    ]);
    expect(setInterstitials).toHaveBeenCalledTimes(1);
    expect(sceneSlotLog).toHaveBeenCalledWith("inserted PDF scene page at readany-pdf-page-v1:4");

    position.index = 6;
    context.configureSceneSlots(JSON.stringify({ enabled: true }));

    expect(Array.from(context._pdfSceneProposals)).toEqual(["readany-pdf-page-v1:4"]);
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

  it("renders the PDF page in the same idle state, then refreshes it when ready", () => {
    const { context, contents, createSceneInsert, renderSceneInsert } = harness(false);
    context.insertSceneSlot(0.42);

    const slot = { getAttribute: () => "idle" };
    const host = { appendChild: vi.fn() };
    const doc = {
      documentElement: {
        getAttribute: (name: string) =>
          name === "data-readany-scene-page" ? "readany-pdf-page-v1:4" : null,
      },
      getElementById: () => host,
      querySelectorAll: () => [slot],
    };
    contents.push({ doc, index: 4 });
    context.applySceneInserts(doc, 4);

    expect(createSceneInsert).toHaveBeenCalledWith(doc, "readany-pdf-page-v1:4", "idle");
    expect(host.appendChild).toHaveBeenCalledTimes(1);
    context.configureSceneSlots(JSON.stringify({ enabled: true }));
    expect(context._sceneSlotsEnabled).toBe(true);
    expect(renderSceneInsert).toHaveBeenCalledWith(slot, "idle", null);
  });

  it("does not duplicate a saved PDF scene while generation is unavailable", () => {
    const { context, setInterstitials } = harness(false);
    context.setSceneAnchors(JSON.stringify(["readany-pdf-page-v1:4"]));
    expect(setInterstitials).toHaveBeenCalledWith([
      { key: "readany-pdf-page-v1:4", afterIndex: 4 },
    ]);

    context.insertSceneSlot(0.42);
    context.configureSceneSlots(JSON.stringify({ enabled: true }));

    expect(Array.from(context._pdfSceneProposals)).toEqual([]);
    expect(setInterstitials).toHaveBeenCalledTimes(1);
  });

  it("leaves the non-PDF insertion path unchanged while generation is unavailable", () => {
    const { context, insertBefore } = harness(false, false);

    context.insertSceneSlot(0.42);

    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(Array.from(context._pdfSceneProposals)).toEqual([]);
  });
});
