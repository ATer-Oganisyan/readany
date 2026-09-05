import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function actualCallbacks() {
  const text = readFileSync(
    new URL("../../screens/reader/useReaderTTS.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("tts.ts", text, ts.ScriptTarget.Latest, true);
  const names = new Set([
    "startPageTTS",
    "startPageTTSFromCfi",
    "startSelectionTTS",
    "handleTTSStop",
    "handleTTSPageEnd",
    "handleToggleTTS",
  ]);
  const callbacks: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]
    ) {
      const callback = node.arguments[0].getText(ast);
      if (callback.includes("const shouldKeepContinuousIntent"))
        callbacks.push(`globalThis.installContinuation = ${callback};`);
      if (callback.includes("previousReaderBookIdRef.current = bookId"))
        callbacks.push(`globalThis.resetBook = ${callback};`);
      if (
        callback.includes("ttsSetOnEnd(null)") &&
        callback.includes("return () =>") &&
        callback.includes("bridgeRef.current?.setTTSHighlight(null)")
      )
        callbacks.push(`globalThis.unmount = (${callback})();`);
    }
    if (
      ts.isVariableDeclaration(node) &&
      names.has(node.name.getText(ast)) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      callbacks.push(
        `globalThis.${node.name.getText(ast)} = ${node.initializer.arguments[0].getText(ast)};`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (callbacks.length !== names.size + 3) throw new Error("Missing actual TTS callbacks");
  const ports: Record<string, unknown> = {
    __DEV__: false,
    bookId: "book-a",
    bookTitle: "Book A",
    currentChapter: "Chapter",
    currentCfi: "page-a",
    ttsCoverUri: undefined,
    ttsContinuousEnabled: false,
    ttsCurrentBookId: "book-a",
    ttsPlayState: "stopped",
    getNormalizedVisibleTTSSegments: vi.fn(),
    getCachedTTSSegmentContext: vi.fn().mockResolvedValue({ before: [], after: [] }),
    prefetchNextChapterTTSSegments: vi.fn().mockResolvedValue([]),
    filterDistinctTTSSegments: (items: unknown[]) => items,
    mergeUniqueTTSSegments: (a: unknown[], b: unknown[]) => [...a, ...b],
    splitNarrationText: (text: string) => [text],
    TTS_DYNAMIC_APPEND_SEGMENTS: 72,
    TTS_DYNAMIC_APPEND_THRESHOLD: 18,
    clearTimeout,
    setTimeout,
    TTS_CONTEXT_WINDOW: 12,
    ttsSourceKind: "page",
    currentTTSSegment: null,
    currentSectionIndex: 0,
    normalizeTTSDebugText: (text: string) => text || "",
    previewTTSQueue: () => [],
    dedupeTTSSegments: (segments: unknown[]) => segments,
    bridgeRef: { current: { setTTSHighlight: vi.fn(), goToCFI: vi.fn() } },
  };
  for (const match of text.matchAll(/\b(\w+Ref)\.current/g)) {
    if (!(match[1] in ports)) ports[match[1]] = { current: 0 };
  }
  for (const name of ["ttsExhaustedAboveAnchorsRef", "ttsExhaustedBelowAnchorsRef"])
    ports[name] = { current: new Set() };
  for (const name of ["ttsContextCacheRef", "ttsContextInflightRef"])
    ports[name] = { current: new Map() };
  ports.clearReaderVoicePlan = vi.fn();
  ports.setTtsChapterSegments = vi.fn();
  ports.setTtsChunkOffset = vi.fn();
  ports.setIsTTSPreparing = vi.fn();
  ports.setTTSPreparationError = vi.fn();
  ports.ttsPreparingIntentRef = { current: null };
  for (const name of ["ttsSegmentsRef", "ttsPrevPageSegmentsRef", "ttsFutureSegmentsRef"])
    ports[name] = { current: [] };
  for (const name of [
    "ttsPlay",
    "ttsStop",
    "ttsSetOnEnd",
    "ttsSetCurrentBook",
    "ttsSetCurrentLocation",
    "syncTTSChunkOffset",
    "setShowControls",
    "setShowTTS",
    "setTtsSourceKind",
    "setTtsContinuousEnabled",
    "setTtsLastText",
    "setTtsSegments",
    "setTtsPrevPageSegments",
    "setTtsFutureSegments",
    "primeTTSLyricContext",
    "logTTSExtractionDiagnostics",
    "handleTTSPageEnd",
  ])
    ports[name] = vi.fn();
  const runtime = vm.createContext(ports);
  vm.runInContext(
    ts.transpileModule(callbacks.join("\n"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    runtime,
  );
  return runtime;
}
const segments = [{ text: "Старая страница.", cfi: "page-a" }];

it("does not start audio after Stop while visible-page extraction is pending", async () => {
  const runtime = actualCallbacks();
  const visible = deferred<typeof segments>();
  runtime.getNormalizedVisibleTTSSegments.mockReturnValue(visible.promise);
  const starting = runtime.startPageTTS(false);
  runtime.handleTTSStop();
  visible.resolve(segments);
  await starting;
  expect(runtime.ttsStop).toHaveBeenCalledOnce();
  expect(runtime.ttsPlay).not.toHaveBeenCalled();
  expect(runtime.setShowTTS).not.toHaveBeenCalledWith(true);
});
it("shows preparation immediately and a repeated toolbar toggle cancels it", async () => {
  const runtime = actualCallbacks();
  const visible = deferred<typeof segments>();
  runtime.getNormalizedVisibleTTSSegments.mockReturnValue(visible.promise);
  const starting = runtime.handleToggleTTS();
  expect(runtime.setIsTTSPreparing).toHaveBeenCalledWith(true);
  expect(runtime.setShowControls).toHaveBeenCalledWith(true);
  await runtime.handleToggleTTS();
  visible.resolve(segments);
  await starting;
  expect(runtime.getNormalizedVisibleTTSSegments).toHaveBeenCalledOnce();
  expect(runtime.ttsPlay).not.toHaveBeenCalled();
  expect(runtime.setIsTTSPreparing).toHaveBeenLastCalledWith(false);
});
it.each(["empty", "failed"])(
  "clears preparation and reports %s without starting audio",
  async (reason) => {
    const runtime = actualCallbacks();
    if (reason === "failed")
      runtime.getNormalizedVisibleTTSSegments.mockRejectedValue(new Error("bridge unavailable"));
    else runtime.getNormalizedVisibleTTSSegments.mockResolvedValue([]);
    await runtime.startPageTTS(false);
    expect(runtime.setIsTTSPreparing).toHaveBeenLastCalledWith(false);
    expect(runtime.setTTSPreparationError).toHaveBeenLastCalledWith(reason);
    expect(runtime.ttsPlay).not.toHaveBeenCalled();
  },
);
it("does not overwrite a newer selection with an older pending page start", async () => {
  const runtime = actualCallbacks();
  const visible = deferred<typeof segments>();
  runtime.getNormalizedVisibleTTSSegments.mockReturnValue(visible.promise);
  const starting = runtime.startPageTTS(false);
  runtime.startSelectionTTS("Выбранный новый текст.", "selection-cfi");
  visible.resolve(segments);
  await starting;
  expect(runtime.ttsPlay).toHaveBeenCalledExactlyOnceWith(["Выбранный новый текст."]);
});
it("does not start audio after Stop during chapter prefetch", async () => {
  const runtime = actualCallbacks();
  runtime.getNormalizedVisibleTTSSegments.mockResolvedValue(segments);
  const prefetch = deferred<typeof segments>();
  runtime.prefetchNextChapterTTSSegments.mockReturnValue(prefetch.promise);
  const starting = runtime.startPageTTS(true);
  await vi.waitFor(() => expect(runtime.prefetchNextChapterTTSSegments).toHaveBeenCalledOnce());
  runtime.handleTTSStop();
  prefetch.resolve([]);
  await starting;
  expect(runtime.ttsPlay).not.toHaveBeenCalled();
});
it.each(["unmount", "resetBook"])(
  "invalidates a pending page when the reader lifecycle calls %s",
  async (action) => {
    const runtime = actualCallbacks();
    const visible = deferred<typeof segments>();
    runtime.getNormalizedVisibleTTSSegments.mockReturnValue(visible.promise);
    const starting = runtime.startPageTTS(false);
    if (action === "resetBook") runtime.bookId = "book-b";
    runtime[action]();
    visible.resolve(segments);
    await starting;
    expect(runtime.ttsPlay).not.toHaveBeenCalled();
    expect(runtime.ttsSetCurrentBook).not.toHaveBeenCalled();
  },
);
it("invalidates an explicit CFI seek stopped during its navigation wait", async () => {
  vi.useFakeTimers();
  try {
    const runtime = actualCallbacks();
    const starting = runtime.startPageTTSFromCfi("seek-cfi", "Target");
    runtime.handleTTSStop();
    await vi.advanceTimersByTimeAsync(320);
    await starting;
    expect(runtime.getNormalizedVisibleTTSSegments).not.toHaveBeenCalled();
    expect(runtime.ttsPlay).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("still starts an uncancelled page intent", async () => {
  const runtime = actualCallbacks();
  runtime.getNormalizedVisibleTTSSegments.mockResolvedValue(segments);
  await runtime.startPageTTS(false);
  expect(runtime.ttsPlay).toHaveBeenCalledExactlyOnceWith(["Старая страница."]);
});
it("only the newest of two pending page starts may play", async () => {
  const runtime = actualCallbacks();
  const old = deferred<typeof segments>();
  runtime.getNormalizedVisibleTTSSegments
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([{ text: "Новая страница.", cfi: "page-b" }]);
  const stale = runtime.startPageTTS(false);
  await runtime.startPageTTS(false);
  old.resolve(segments);
  await stale;
  expect(runtime.ttsPlay).toHaveBeenCalledExactlyOnceWith(["Новая страница."]);
});
it("an older start finishing cannot clear the newer preparation indicator", async () => {
  const runtime = actualCallbacks();
  const old = deferred<typeof segments>();
  const next = deferred<typeof segments>();
  runtime.getNormalizedVisibleTTSSegments
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  const stale = runtime.startPageTTS(false);
  const current = runtime.startPageTTS(false);
  old.resolve(segments);
  await stale;
  expect(runtime.setIsTTSPreparing).toHaveBeenLastCalledWith(true);
  expect(runtime.ttsPlay).not.toHaveBeenCalled();
  next.resolve([{ text: "New text", cfi: "new-cfi" }]);
  await current;
  expect(runtime.setIsTTSPreparing).toHaveBeenLastCalledWith(false);
  expect(runtime.ttsPlay).toHaveBeenCalledExactlyOnceWith(["New text"]);
});
it("continues naturally into the next CFI without leaving the continuation lock stuck", async () => {
  vi.useFakeTimers();
  try {
    const runtime = actualCallbacks();
    runtime.ttsContinuousEnabled = true;
    runtime.ttsContinuousRef.current = true;
    runtime.ttsSegmentsRef.current = segments;
    runtime.ttsLastTextRef.current = segments[0].text;
    runtime.startPageTTSFromCfiRef.current = runtime.startPageTTSFromCfi;
    const next = [{ text: "Следующая страница.", cfi: "page-next" }];
    runtime.getCachedTTSSegmentContext
      .mockResolvedValueOnce({ after: next })
      .mockResolvedValue({ before: [], after: [] });
    runtime.getNormalizedVisibleTTSSegments.mockResolvedValue(next);
    runtime.handleTTSPageEnd();
    await vi.advanceTimersByTimeAsync(320);
    expect(runtime.ttsPlay).toHaveBeenCalledExactlyOnceWith(["Следующая страница."]);
    expect(runtime.ttsContinuousRef.current).toBe(true);
    expect(runtime.ttsHandlingPageEndRef.current).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it.each(["page", "seek"])("an old EOF cannot steal a newer %s preparation", async (mode) => {
  vi.useFakeTimers();
  try {
    const runtime = actualCallbacks();
    runtime.ttsContinuousEnabled = true;
    runtime.ttsContinuousRef.current = true;
    runtime.ttsSegmentsRef.current = segments;
    runtime.ttsLastTextRef.current = segments[0].text;
    const oldEndCallback = runtime.handleTTSPageEnd;
    runtime.startPageTTSFromCfiRef.current = vi.fn(async () =>
      runtime.ttsPlay(["Old continuation"]),
    );
    runtime.getCachedTTSSegmentContext.mockResolvedValue({
      before: [],
      after: [{ text: "Old continuation", cfi: "old-next" }],
    });
    const visible = deferred<typeof segments>();
    runtime.getNormalizedVisibleTTSSegments.mockReturnValue(visible.promise);
    const starting =
      mode === "page"
        ? runtime.startPageTTS(true)
        : runtime.startPageTTSFromCfi("page-a", "Старая страница.");
    // A relocation/render during preparation must not reinstall old onEnd.
    runtime.isTTSPreparing = true;
    runtime.installContinuation();
    oldEndCallback();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.ttsPlay).not.toHaveBeenCalled();
    expect(runtime.startPageTTSFromCfiRef.current).not.toHaveBeenCalled();
    expect(runtime.ttsSetOnEnd).toHaveBeenCalledWith(null);
    runtime.getCachedTTSSegmentContext.mockResolvedValue({ before: [], after: [] });
    visible.resolve(segments);
    await vi.advanceTimersByTimeAsync(320);
    await starting;
    expect(runtime.ttsPlay).toHaveBeenCalledExactlyOnceWith(["Старая страница."]);
    runtime.isTTSPreparing = false;
    runtime.ttsPlayState = "playing";
    runtime.installContinuation();
    expect(runtime.ttsContinuousRef.current).toBe(true);
    expect(runtime.ttsSetOnEnd).toHaveBeenLastCalledWith(runtime.handleTTSPageEnd);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  ["explicit", "preparation"],
  ["natural", "preparation"],
  ["pause", "preparation"],
  ["sleep", "preparation"],
  ["pause", "eof"],
  ["sleep", "eof"],
])(
  "handles %s during %s without confusing cancellation with playback completion",
  async (mode, phase) => {
    const runtime = actualCallbacks();
    vi.useFakeTimers();
    const state = createStore(() => ({
      playState: "stopped",
      explicitStopEpoch: 0,
      explicitCancellationEpoch: 0,
    }));
    const source = readFileSync(new URL("../../stores/tts-store.ts", import.meta.url), "utf8");
    const ast = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true);
    const actions: Record<string, ts.Expression> = {};
    function find(node: ts.Node) {
      if (
        ts.isPropertyAssignment(node) &&
        ["stop", "pause", "setSleepTimer"].includes(node.name.getText(ast)) &&
        ts.isArrowFunction(node.initializer)
      )
        actions[node.name.getText(ast)] = node.initializer;
      ts.forEachChild(node, find);
    }
    find(ast);
    if (Object.keys(actions).length !== 3) throw new Error("Missing actual store actions");
    Object.assign(runtime, {
      useTTSStore: state,
      set: state.setState,
      get: state.getState,
      clearSleepTimerHandle: vi.fn(),
      clearRespeakTimer: vi.fn(),
      detachAndStopAllPlayers: vi.fn(),
      _sessionGeneration: 0,
      _sessionSegments: [],
      _sessionCurrentIndex: 0,
      _activeTTS: { pause: vi.fn() },
      _sleepTimerHandle: null,
      setTimeout,
      Date,
    });
    const hookText = readFileSync(
      new URL("../../screens/reader/useReaderTTS.ts", import.meta.url),
      "utf8",
    );
    const hookAst = ts.createSourceFile("hook.ts", hookText, ts.ScriptTarget.Latest, true);
    const effects: ts.Expression[] = [];
    function findSubscription(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(hookAst) === "useEffect" &&
        /explicit(?:Stop|Cancellation)Epoch/.test(node.arguments[0]?.getText(hookAst) ?? "")
      )
        effects.push(node.arguments[0]);
      ts.forEachChild(node, findSubscription);
    }
    findSubscription(hookAst);
    for (const effect of effects)
      vm.runInContext(
        ts.transpileModule(`(${effect.getText(hookAst)})();`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
        runtime,
      );
    for (const [name, action] of Object.entries(actions))
      vm.runInContext(
        ts.transpileModule(`globalThis.${name} = ${action.getText(ast)};`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
        runtime,
      );
    state.setState({ pause: runtime.pause } as never);
    const visible = deferred<typeof segments>();
    runtime.getNormalizedVisibleTTSSegments.mockReturnValue(visible.promise);
    const context = deferred<{ before: typeof segments; after: typeof segments }>();
    let starting: Promise<void> | undefined;
    if (phase === "eof") {
      runtime.ttsContinuousRef.current = true;
      runtime.ttsSegmentsRef.current = segments;
      runtime.getCachedTTSSegmentContext.mockReturnValue(context.promise);
      runtime.startPageTTSFromCfiRef.current = vi.fn(async () => runtime.ttsPlay(["next page"]));
      runtime.handleTTSPageEnd();
    } else starting = runtime.startPageTTS(false);
    if (mode === "explicit") runtime.stop();
    else if (mode === "pause") runtime.pause();
    else if (mode === "sleep") {
      runtime.setSleepTimer(1);
      await vi.advanceTimersByTimeAsync(60_000);
    } else state.setState({ playState: "stopped" });
    visible.resolve(segments);
    context.resolve({ before: [], after: [{ text: "next page", cfi: "next" }] });
    await starting;
    await vi.advanceTimersByTimeAsync(0);
    try {
      if (mode !== "natural") expect(runtime.ttsPlay).not.toHaveBeenCalled();
      else expect(runtime.ttsPlay).toHaveBeenCalledExactlyOnceWith(["Старая страница."]);
    } finally {
      vi.useRealTimers();
    }
  },
);
