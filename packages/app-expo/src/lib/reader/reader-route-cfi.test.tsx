import { readFileSync } from "node:fs";
import vm from "node:vm";
import { type ComponentType, useEffect, useRef } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../screens/ReaderScreen.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "ReaderScreen.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const statements: string[] = [];
function visit(node: ts.Node) {
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === "lastNavigatedCfiRef",
    )
  )
    statements.push(node.getText(ast));
  if (
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === "useEffect" &&
    node.expression.arguments[0]?.getText(ast).includes("lastNavigatedCfiRef.current")
  ) {
    statements.push(node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (statements.length !== 3)
  throw new Error("Expected actual Reader CFI ref/reset/navigation effects");

const goToCFISafely = vi.fn();
const navigation = { setParams: vi.fn() };
const bridge = { flashHighlight: vi.fn() };
const context = vm.createContext({
  useRef,
  useEffect,
  goToCFISafely,
  navigation,
  bridge,
  setTimeout,
});
// Execute the actual Reader request-consumption effects. Native stack param
// acknowledgement and renderer movement are ports; no copied navigation logic.
vm.runInContext(
  ts.transpileModule(
    `function RouteReader({bookId,cfi,webViewReady,loading,error,isFocused,shouldHighlight}) {
${statements.join("\n")}
return null;
};globalThis.RouteReader=RouteReader;`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    },
  ).outputText,
  context,
);
type Props = {
  bookId: string;
  cfi?: string;
  webViewReady: boolean;
  loading: boolean;
  error: string | null;
  isFocused: boolean;
  shouldHighlight: boolean;
};
const RouteReader = context.RouteReader as ComponentType<Props>;
let props: Props;
let tree: ReactTestRenderer | undefined;
const page4 = "epubcfi(/6/8)";
const page5 = "epubcfi(/6/10)";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.clearAllMocks();
  props = {
    bookId: "pdf-a",
    webViewReady: true,
    loading: false,
    error: null,
    isFocused: true,
    shouldHighlight: false,
  };
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});
function render(updates: Partial<Props> = {}) {
  props = { ...props, ...updates };
  act(() => {
    if (tree) tree.update(<RouteReader {...props} />);
    else tree = create(<RouteReader {...props} />);
  });
}

describe("Reader route CFI is a repeatable request, not a lifetime destination", () => {
  it("does not consume a note destination on failed initial load and retries it after recovery", () => {
    render({ cfi: page4, loading: false, error: "Initial navigation timed out" });
    expect(goToCFISafely).not.toHaveBeenCalled();
    expect(navigation.setParams).not.toHaveBeenCalled();
    render({ loading: true, error: null });
    expect(goToCFISafely).not.toHaveBeenCalled();
    render({ loading: false });
    expect(goToCFISafely).toHaveBeenCalledExactlyOnceWith(page4);
    expect(navigation.setParams).toHaveBeenCalledOnce();
  });
  it("returns to the same PDF note again after the first request was cleared and the reader moved", () => {
    let renderedPage = page5;
    goToCFISafely.mockImplementation((cfi: string) => {
      renderedPage = cfi;
    });
    render({ cfi: page4 });
    expect(renderedPage).toBe(page4);
    expect(navigation.setParams).toHaveBeenLastCalledWith({
      bookId: "pdf-a",
      cfi: undefined,
      highlight: undefined,
    });
    render({ cfi: undefined }); // Native stack applies Reader's setParams acknowledgement.
    renderedPage = page5; // A normal physical next; the route has no CFI request.
    render({ isFocused: false }); // Reader remains mounted underneath Notes.
    render({ isFocused: true, cfi: page4 }); // Tap the same note / another note on page 4.
    expect(renderedPage).toBe(page4);
    expect(goToCFISafely).toHaveBeenCalledTimes(2);
    expect(navigation.setParams).toHaveBeenCalledTimes(2);
  });

  it("retries the same acknowledged destination after a reader reload has completed", () => {
    render({ cfi: page4 });
    render({ cfi: undefined });
    render({ loading: true, cfi: page4 });
    expect(goToCFISafely).toHaveBeenCalledTimes(1);
    render({ loading: false });
    expect(goToCFISafely).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate an unacknowledged request on repeated renders or readiness changes", () => {
    render({ cfi: page4 });
    render();
    render({ loading: true });
    render({ loading: false });
    expect(goToCFISafely).toHaveBeenCalledTimes(1);
  });

  it("waits until ready and handles the same CFI for another book", () => {
    render({ cfi: page4, webViewReady: false });
    expect(goToCFISafely).not.toHaveBeenCalled();
    render({ webViewReady: true });
    render({ bookId: "pdf-b" });
    expect(goToCFISafely).toHaveBeenCalledTimes(2);
    expect(navigation.setParams).toHaveBeenLastCalledWith({
      bookId: "pdf-b",
      cfi: undefined,
      highlight: undefined,
    });
  });
});
