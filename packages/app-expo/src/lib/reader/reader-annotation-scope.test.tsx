import { readFileSync } from "node:fs";
import vm from "node:vm";
import type { Highlight } from "@readany/core/types";
import { type ComponentType, createElement, useEffect, useMemo } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create as createStore } from "zustand";

const annotations = createStore(() => ({
  highlights: [] as Highlight[],
  loadAnnotations: vi.fn(),
}));
const bridge = { addAnnotation: vi.fn() };
const source = readFileSync(new URL("../../screens/ReaderScreen.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "ReaderScreen.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let subscription: ts.VariableStatement | undefined;
let scopedHighlights: ts.VariableStatement | undefined;
let annotationEffect: ts.ExpressionStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isObjectBindingPattern(declaration.name) &&
        declaration.name.elements.some((element) => element.name.getText(ast) === "loadAnnotations")
      )
        subscription = node;
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "highlights")
        scopedHighlights = node;
    }
  }
  if (
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === "useEffect" &&
    node.expression.arguments[0]?.getText(ast).includes("bridge.addAnnotation")
  )
    annotationEffect = node;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!subscription || !annotationEffect) throw new Error("Actual Reader annotation code missing");
const context = vm.createContext({
  useAnnotationStore: annotations,
  useMemo,
  useEffect,
  createElement,
  bridge,
});
// Mount the actual Reader store selection and annotation effect together; the
// expensive WebView/layout boundary is replaced by the actual bridge call port.
const fragment = `function ReaderAnnotations({bookId}) {
  const webViewReady=true, loading=false;
  ${subscription.getText(ast)}
  ${scopedHighlights?.getText(ast) ?? ""}
  ${annotationEffect.getText(ast)}
  return createElement('AnnotationSnapshot',{highlights});
}; globalThis.ReaderAnnotations=ReaderAnnotations;`;
vm.runInContext(
  ts.transpileModule(fragment, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText,
  context,
);
const ReaderAnnotations = context.ReaderAnnotations as ComponentType<{ bookId: string }>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
const highlight = (bookId: string): Highlight => ({
  id: `note-${bookId}`,
  bookId,
  cfi: "epubcfi(/6/2!/4/2/2)",
  text: `Only ${bookId}`,
  note: `Note ${bookId}`,
  color: "yellow",
  createdAt: 1,
  updatedAt: 1,
});
beforeEach(() => {
  vi.clearAllMocks();
  annotations.setState({ highlights: [] });
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});
function mount(bookId: string) {
  act(() => {
    tree = create(<ReaderAnnotations bookId={bookId} />);
  });
}
function selected() {
  return tree?.root.find((node) => String(node.type) === "AnnotationSnapshot").props
    .highlights as Highlight[];
}

describe("Reader annotation consumers stay bound to their own book", () => {
  it("does not paint a late saved annotation from another book at the same CFI", () => {
    annotations.setState({ highlights: [highlight("book-b")] });
    mount("book-b");
    bridge.addAnnotation.mockClear();
    act(() => annotations.setState({ highlights: [highlight("book-b"), highlight("book-a")] }));
    expect(selected().map((h) => h.bookId)).toEqual(["book-b"]);
    expect(bridge.addAnnotation.mock.calls.map(([entry]) => entry.note)).toEqual(["Note book-b"]);
  });
  it("does not show foreign annotations while a new book's load is pending", () => {
    annotations.setState({ highlights: [highlight("book-a")] });
    mount("book-b");
    expect(selected()).toEqual([]);
    expect(bridge.addAnnotation).not.toHaveBeenCalled();
  });
  it("reselects the correct annotations when bookId changes without a store update", () => {
    annotations.setState({ highlights: [highlight("book-a"), highlight("book-b")] });
    mount("book-a");
    bridge.addAnnotation.mockClear();
    act(() => tree?.update(<ReaderAnnotations bookId="book-b" />));
    expect(selected().map((h) => h.bookId)).toEqual(["book-b"]);
    expect(bridge.addAnnotation.mock.calls.map(([entry]) => entry.note)).toEqual(["Note book-b"]);
  });
  it("continues to paint and expose the current book's annotation", () => {
    annotations.setState({ highlights: [highlight("book-a")] });
    mount("book-a");
    expect(selected()).toEqual([highlight("book-a")]);
    expect(bridge.addAnnotation).toHaveBeenCalledWith({
      value: "epubcfi(/6/2!/4/2/2)",
      type: "highlight",
      color: "yellow",
      note: "Note book-a",
    });
  });
});
