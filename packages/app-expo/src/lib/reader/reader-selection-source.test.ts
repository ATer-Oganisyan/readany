import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../screens/ReaderScreen.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "ReaderScreen.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback: ts.VariableDeclaration | undefined;
let sourceKeyHelper: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleSelectionMenuAction")
    callback = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "selectionSourceKey")
    sourceKeyHelper = node;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!callback?.initializer) throw new Error("Actual Reader selection callback missing");
const code = ts.transpileModule(
  `${sourceKeyHelper?.getText(ast) ?? ""}\nglobalThis.invoke = ${callback.initializer.getText(ast)};`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  },
).outputText;

function invoke(key: string, text: string, cfi = "epubcfi(/6/8)", granularity?: "page" | "range") {
  const navigate = vi.fn();
  const openScene = vi.fn();
  const selectionRef = { current: { text, cfi, cfiGranularity: granularity } as unknown };
  const context = vm.createContext({
    useCallback: (fn: unknown) => fn,
    selectionRef,
    selection: null,
    setSelection: vi.fn(),
    bookId: "pdf-book",
    currentChapter: "Page 4",
    bookTitle: "Original PDF",
    book: undefined,
    navigation: { navigate },
    openScene,
    tts: { startSelectionTTS: vi.fn() },
  });
  vm.runInContext(code, context);
  context.invoke({ nativeEvent: { key, selectedText: text } });
  return { navigate, openScene, selectionRef };
}

function keyFor(action: string, text: string, cfi?: string, granularity?: "page" | "range") {
  const result = invoke(action, text, cfi, granularity);
  return action === "summarize"
    ? result.navigate.mock.calls[0]?.[1].sourceKey
    : result.openScene.mock.calls[0]?.[1];
}

describe("actual Reader selection action cache identity", () => {
  for (const platform of ["ios", "android"]) {
    it(`${platform}: transforms the page-key helper through the actual Expo Babel pipeline`, () => {
      if (!sourceKeyHelper) throw new Error("Selection identity helper missing");
      const require = createRequire(import.meta.url);
      const { transformSync } = require("@babel/core");
      const result = transformSync(
        `${sourceKeyHelper.getText(ast)}\nglobalThis.keyFor = selectionSourceKey;`,
        {
          filename: fileURLToPath(new URL("../../screens/ReaderScreen.tsx", import.meta.url)),
          configFile: fileURLToPath(new URL("../../../babel.config.js", import.meta.url)),
          babelrc: false,
          caller: {
            name: "metro",
            bundler: "metro",
            platform,
            engine: "hermes",
            isDev: true,
            isServer: false,
            supportsStaticESM: false,
            supportsExportNamespaceFrom: true,
          },
        },
      );
      const context = vm.createContext({});
      vm.runInContext(result.code, context);
      const selection = { cfi: "epubcfi(/6/8)", cfiGranularity: "page" };
      const key = context.keyFor(selection, "Дневник 📖", "Page 4");
      expect(key).toBe(keyFor("summarize", "Дневник 📖", undefined, "page"));
      expect(key).not.toBe(context.keyFor(selection, "Дневник 📚", "Page 4"));
    });
  }
  for (const action of ["summarize", "generate-scene"]) {
    it(`${action}: distinguishes two selected excerpts on the same fixed page`, () => {
      const prefix = "same visible words ".repeat(10);
      const first = keyFor(action, `${prefix}diary`, undefined, "page");
      const second = keyFor(action, `${prefix}river`, undefined, "page");
      expect(first).not.toBe(second);
      expect(first).toBe(keyFor(action, `${prefix}diary`, undefined, "page"));
      expect(first).not.toBe(keyFor(action, `${prefix}diary`, "epubcfi(/6/10)", "page"));
    });
    it(`${action}: keeps exact reflow range and legacy selection keys unchanged`, () => {
      const cfi = "epubcfi(/6/8!/4/2,/1:4,/1:12)";
      expect(keyFor(action, "first excerpt", cfi, "range")).toBe(`selection:${cfi}`);
      expect(keyFor(action, "first excerpt", cfi)).toBe(`selection:${cfi}`);
      expect(keyFor(action, "first excerpt", "")).toBe("selection:Page 4:first excerpt");
    });
  }
  it("passes the real page CFI unchanged to the note editor, not the excerpt cache fingerprint", () => {
    const result = invoke("add-note", "diary", "epubcfi(/6/8)", "page");
    expect(result.navigate).toHaveBeenCalledWith("ManualNote", {
      bookId: "pdf-book",
      cfi: "epubcfi(/6/8)",
      text: "diary",
      chapterTitle: "Page 4",
    });
    expect(result.selectionRef.current).toBe(null);
  });
});
