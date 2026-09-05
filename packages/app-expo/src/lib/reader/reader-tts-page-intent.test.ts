import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

it("asks the live WebView for page-start speech instead of forcing a stale React CFI", async () => {
  const source = readFileSync(
    new URL("../../screens/reader/useReaderTTS.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("tts.ts", source, ts.ScriptTarget.Latest, true);
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "startPageTTS" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!callback) throw new Error("Missing actual page-start callback");
  // Stop at the empty-page exit: exercise the production choice of input to
  // the WebView without requesting speech or mocking a second implementation.
  const getNormalizedVisibleTTSSegments = vi.fn().mockResolvedValue([]);
  const runtime = vm.createContext({
    __DEV__: false,
    ttsContinuousEnabled: false,
    currentCfi: "previous-page-react-cfi",
    ttsStartIntentRef: { current: 0 },
    ttsHandlingPageEndRef: { current: false },
    ttsPreparingIntentRef: { current: null },
    setIsTTSPreparing: vi.fn(),
    setTTSPreparationError: vi.fn(),
    setShowControls: vi.fn(),
    ttsContinuousRef: { current: false },
    ttsSetOnEnd: vi.fn(),
    getNormalizedVisibleTTSSegments,
  });
  const compiled = ts.transpileModule(`globalThis.start = ${callback.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(compiled, runtime);
  await runtime.start();
  expect(getNormalizedVisibleTTSSegments).toHaveBeenCalledExactlyOnceWith();
});
