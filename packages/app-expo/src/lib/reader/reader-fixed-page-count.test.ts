import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function parse(source: string, name: string) {
  return ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
}
function findNode(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(root);
  if (!found) throw new Error("Production relocation method was not found");
  return found;
}

function harness(fixed: boolean, sizes = [2_000, 3_000, 5_000, 2_500]) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const readerAst = parse(script, "reader.js");
  const listener = findNode(
    readerAst,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "relocate",
  ) as ts.CallExpression;
  const progressSource = readFileSync(
    new URL("../../../../foliate-js/progress.js", import.meta.url),
    "utf8",
  );
  const progressAst = parse(progressSource, "progress.js");
  const progressClass = findNode(
    progressAst,
    (node) => ts.isClassDeclaration(node) && node.name?.text === "SectionProgress",
  );
  const messages: Record<string, unknown>[] = [];
  const renderer = { index: 0, page: 2, pages: 10 };
  const book = { sections: sizes.map((size) => ({ size })) };
  const context = vm.createContext({
    view: { isFixedLayout: fixed, renderer, book },
    currentBook: book,
    currentSectionIndex: 0,
    totalSections: sizes.length,
    msg: { loadId: "book" },
    snippetTimer: null,
    setTimeout: () => 1,
    clearTimeout() {},
    isCurrent: () => true,
    hideFootnoteTip() {},
    refreshUserAnnotations() {},
    postToRN: (type: string, detail: Record<string, unknown>) => {
      if (type === "relocate") messages.push(detail);
    },
  });
  vm.runInContext(
    `${progressClass.getText(progressAst).replace(/^export\s+/, "")}; globalThis.Progress = SectionProgress;`,
    context,
  );
  vm.runInContext(`globalThis.relocate = ${listener.arguments[1].getText(readerAst)}`, context);
  const progress = new context.Progress(book.sections, 1500, 1600);

  const screenSource = readFileSync(
    new URL("../../screens/ReaderScreen.tsx", import.meta.url),
    "utf8",
  );
  const screenAst = parse(screenSource, "ReaderScreen.tsx");
  const property = findNode(
    screenAst,
    (node) => ts.isPropertyAssignment(node) && node.name.getText(screenAst) === "onRelocate",
  ) as ts.PropertyAssignment;
  const callback = property.initializer as ts.ArrowFunction;
  const body = callback.body as ts.Block;
  const end = body.statements.findIndex((node) =>
    node.getText(screenAst).startsWith("if (detail.tocItem"),
  );
  if (end < 0) throw new Error("Progress accounting boundary missing");
  const constants = screenAst.statements.filter(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((declaration) =>
        /^(MAX_TRACKED_|REFLOWABLE_CHARACTERS)/.test(declaration.name.getText(screenAst)),
      ),
  );
  const pages = vi.fn();
  const characters = vi.fn();
  let displayed: { current: number; total: number } | null = null;
  const screen = vm.createContext({
    activeReaderLoadIdRef: { current: "book" },
    lastDiagnosticRelocateRef: { current: Date.now() },
    recordDiagnostic() {},
    currentSectionIndex: 0,
    setCurrentSectionIndex() {},
    setTranslationReady() {},
    chapterTranslation: { reset() {} },
    setProgress() {},
    setBookLocation: (value: typeof displayed) => {
      displayed = value;
    },
    progressTrackingGuardUntilRef: { current: 0 },
    totalBookCharactersRef: { current: null },
    sessionProgressRef: { current: null },
    incrementPagesRead: pages,
    incrementCharactersRead: characters,
  });
  const executed = `${constants.map((node) => node.getText(screenAst)).join("\n")}
    globalThis.onRelocate = (detail) => {${body.statements
      .slice(0, end)
      .map((node) => node.getText(screenAst))
      .join("\n")}};`;
  vm.runInContext(ts.transpile(executed, { target: ts.ScriptTarget.ESNext }), screen);
  return {
    pages,
    characters,
    screen,
    displayed: () => displayed,
    relocate(index: number, withoutSection = false) {
      renderer.index = index;
      const detail = {
        ...progress.getProgress(index, 0, 1),
        cfi: `epubcfi(/6/${(index + 1) * 2})`,
      };
      if (withoutSection) detail.section = undefined;
      context.relocate({ detail });
      const result = messages.at(-1);
      screen.onRelocate(result);
      return { sent: result, original: detail };
    },
  };
}

describe("fixed-layout pages are not image-byte locations", () => {
  it.each([0, 3])("reports the actual physical page at index %s", (index) => {
    const h = harness(true, [92_500, 92_500, 92_500, 92_500]);
    const { sent, original } = h.relocate(index);
    expect(sent?.page).toEqual({ current: index + 1, total: 4 });
    expect(sent?.location).toBeUndefined();
    expect(sent?.fraction).toBe(original.fraction);
    expect(sent?.cfi).toBe(original.cfi);
    expect(h.displayed()).toEqual({ current: index, total: 4 });
  });
  it("restores the last fixed page from the renderer even without generic section progress", () => {
    const h = harness(true);
    const { sent } = h.relocate(3, true);
    expect(sent?.section).toEqual({ current: 3, total: 4 });
    expect(h.displayed()).toEqual({ current: 3, total: 4 });
  });
  it("counts physical page turns, never image bytes as read characters", () => {
    const h = harness(true);
    for (const index of [0, 1, 2, 3]) h.relocate(index);
    expect(h.characters).not.toHaveBeenCalled();
    expect(h.pages.mock.calls).toEqual([[1], [1], [1]]);
  });
  it("does not treat restoring an unread position as newly read pages", () => {
    const h = harness(true);
    h.relocate(3);
    h.relocate(3);
    expect(h.characters).not.toHaveBeenCalled();
    expect(h.pages).not.toHaveBeenCalled();
  });
  it("ignores stale byte locations and cached text metrics on fixed-layout events", () => {
    const h = harness(true);
    h.screen.totalBookCharactersRef.current = 100_000;
    for (const index of [0, 1]) {
      const { sent, original } = h.relocate(index);
      h.screen.onRelocate({ ...sent, location: original.location });
    }
    expect(h.characters).not.toHaveBeenCalled();
    expect(h.pages.mock.calls).toEqual([[1]]);
    expect(h.displayed()).toEqual({ current: 1, total: 4 });
  });
  it("reports twelve PDF pages without estimating their byte weights", () => {
    const h = harness(
      true,
      Array.from({ length: 12 }, () => 1_000),
    );
    h.relocate(3);
    expect(h.displayed()).toEqual({ current: 3, total: 12 });
    h.relocate(11);
    expect(h.displayed()).toEqual({ current: 11, total: 12 });
  });
  it("keeps reflowable byte locations and section-local renderer pages unchanged", () => {
    const h = harness(false);
    const { sent, original } = h.relocate(2);
    expect(sent?.location).toEqual(original.location);
    expect(sent?.page).toEqual({ current: 2, total: 8 });
    expect(h.displayed()).toEqual(original.location);
    h.relocate(3);
    expect(h.pages).not.toHaveBeenCalled();
    expect(h.characters).toHaveBeenCalled();
  });
});
