import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const readerTemplatePath = new URL("../../../assets/reader/reader.template.html", import.meta.url);
const readerScreenPath = new URL("../../screens/ReaderScreen.tsx", import.meta.url);
const functionNames = new Set([
  "getActiveSelectionRange",
  "recoverStaleSelectionInteraction",
  "clearDocumentSelection",
  "getReaderViewportX",
  "attachTapListener",
]);

function readReaderMainScript() {
  const html = fs.readFileSync(readerTemplatePath, "utf8");
  const scriptStart = html.indexOf("<script>") + "<script>".length;
  const scriptEnd = html.indexOf("\n  </script>", scriptStart);
  return html.slice(scriptStart, scriptEnd);
}

type Listener = { capture: boolean; callback: (event: FakeTouchEvent) => void };

class FakeWindow {
  frameElement: {
    clientWidth: number;
    getBoundingClientRect: () => { left: number; width: number };
    ownerDocument?: { defaultView: unknown };
  } | null = null;
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, callback: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }
}

class FakeSelection {
  isCollapsed = true;
  rangeCount = 0;
  text = "";

  getRangeAt() {
    return { collapsed: false };
  }

  removeAllRanges() {
    this.isCollapsed = true;
    this.rangeCount = 0;
    this.text = "";
  }

  toString() {
    return this.text;
  }
}

type FakeTouchEvent = {
  button?: number;
  changedTouches: Array<{ clientX: number; clientY: number }>;
  clientX?: number;
  clientY?: number;
  detail?: number;
  isTrusted?: boolean;
  isPrimary?: boolean;
  pointerId?: number;
  pointerType?: string;
  preventDefault: () => void;
  stopPropagation: () => void;
  target: { closest: () => null };
  timeStamp: number;
  touches: Array<{ clientX: number; clientY: number }>;
};

class FakeDocument {
  __readany_selection_interaction = false;
  defaultView = new FakeWindow();
  selection = new FakeSelection();
  visibilityState = "visible";
  private listeners = new Map<string, Listener[]>();

  addEventListener(
    type: string,
    callback: (event: FakeTouchEvent) => void,
    options?: boolean | { capture?: boolean },
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({
      callback,
      capture: typeof options === "object" && options.capture === true,
    });
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: FakeTouchEvent) {
    const listeners = [...(this.listeners.get(type) ?? [])].sort(
      (left, right) => Number(right.capture) - Number(left.capture),
    );
    for (const listener of listeners) listener.callback(event);
  }

  getSelection() {
    return this.selection;
  }
}

function extractReaderFunctions() {
  const script = readReaderMainScript();
  const sourceFile = ts.createSourceFile(
    "reader.js",
    script,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const functions: string[] = [];

  for (const node of sourceFile.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && functionNames.has(node.name.text)) {
      functions.push(script.slice(node.getStart(sourceFile), node.end));
    }
  }

  expect(functions).toHaveLength(functionNames.size);
  return functions.join("\n");
}

function extractDocumentLoadListener() {
  const script = readReaderMainScript();
  const sourceFile = ts.createSourceFile(
    "reader.js",
    script,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  let listener: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "el" &&
      node.expression.name.text === "addEventListener" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "load" &&
      ts.isArrowFunction(node.arguments[1])
    ) {
      listener = node.arguments[1];
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!listener) throw new Error("Reader document load listener was not found");
  return script.slice(listener.getStart(sourceFile), listener.end);
}

function touchEvent(
  type: "touchstart" | "touchmove" | "touchend",
  timeStamp: number,
  x = 184,
  y = 400,
): FakeTouchEvent {
  const touch = { clientX: x, clientY: y };
  return {
    changedTouches: type === "touchend" ? [touch] : [],
    preventDefault() {},
    stopPropagation() {},
    target: { closest: () => null },
    timeStamp,
    touches: type === "touchend" ? [] : [touch],
  };
}

function pointerEvent(
  _type: "pointerdown" | "pointerup",
  timeStamp: number,
  x = 184,
  y = 400,
  pointerType = "mouse",
): FakeTouchEvent {
  return {
    button: 0,
    changedTouches: [],
    clientX: x,
    clientY: y,
    isPrimary: true,
    pointerId: 1,
    pointerType,
    preventDefault() {},
    stopPropagation() {},
    target: { closest: () => null },
    timeStamp,
    touches: [],
  };
}

function clickEvent(timeStamp: number, x = 184, y = 400): FakeTouchEvent {
  return {
    changedTouches: [],
    clientX: x,
    clientY: y,
    detail: 1,
    isTrusted: true,
    preventDefault() {},
    stopPropagation() {},
    target: { closest: () => null },
    timeStamp,
    touches: [],
  };
}

// Wall clock the reader must not consult when timing a tap: it reads far past
// MAX_TAP_MS, so any Date-based measurement would discard every tap here.
const STALLED_CLOCK = {
  now: () => 5_000_000,
};

function createHarness(
  userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)",
  attachDocument = true,
) {
  const messages: string[] = [];
  const turns: string[] = [];
  const runtime: Record<string, unknown> = {
    CHARACTER_NAME_ATTR: "data-character",
    Date: STALLED_CLOCK,
    SCENE_ANCHOR_ATTR: "data-anchor",
    SCENE_INSERT_CLASS: "scene",
    SCENE_STATE_ATTR: "data-state",
    armNoteTapGuard() {},
    clearTimeout,
    console,
    currentViewMode: "paginated",
    getSelectionRange(selection: FakeSelection | null) {
      return selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt() : null;
    },
    goNextByMode() {
      turns.push("next");
    },
    goPrevByMode() {
      turns.push("prev");
    },
    hideFootnoteTip() {},
    isNoteTapGuardActive: () => false,
    isPointInAnnotationRange: () => null,
    isPointInNoteRange: () => null,
    navigator: { userAgent },
    postShowAnnotation() {},
    postToRN(type: string) {
      messages.push(type);
    },
    renderSceneInsert() {},
    setTimeout,
    view: {},
    window: {
      innerWidth: 368,
      setNavigationLocked() {},
      top: { innerWidth: 368 },
    },
  };

  vm.createContext(runtime);
  vm.runInContext(extractReaderFunctions(), runtime);

  const doc = new FakeDocument();
  if (attachDocument) {
    (runtime.attachTapListener as (document: FakeDocument) => void)(doc);
  }

  let clock = 1000;

  return {
    doc,
    messages,
    runtime,
    turns,
    // `heldMs` is how long the finger stayed down, as the engine reports it in
    // the event timestamps — independent of when the handlers get to run.
    tap({ heldMs = 40, x = 184 }: { heldMs?: number; x?: number } = {}) {
      const start = clock;
      clock += heldMs + 10;
      doc.dispatch("touchstart", touchEvent("touchstart", start, x));
      doc.dispatch("touchend", touchEvent("touchend", start + heldMs, x));
    },
    mouseClick({ x = 184 }: { x?: number } = {}) {
      const start = clock;
      clock += 50;
      doc.dispatch("pointerdown", pointerEvent("pointerdown", start, x));
      doc.dispatch("pointerup", pointerEvent("pointerup", start + 40, x));
      doc.dispatch("click", clickEvent(start + 41, x));
    },
    touchPointerTap({ x = 184 }: { x?: number } = {}) {
      const start = clock;
      clock += 50;
      doc.dispatch("pointerdown", pointerEvent("pointerdown", start, x, 400, "touch"));
      doc.dispatch("pointerup", pointerEvent("pointerup", start + 40, x, 400, "touch"));
    },
    syntheticClick({ x = 184 }: { x?: number } = {}) {
      const start = clock;
      clock += 50;
      doc.dispatch("click", clickEvent(start, x));
    },
    drag({ dx = 0, dy = 0, heldMs = 200 }: { dx?: number; dy?: number; heldMs?: number } = {}) {
      const start = clock;
      clock += heldMs + 10;
      const fromX = 200;
      const fromY = 400;
      doc.dispatch("touchstart", touchEvent("touchstart", start, fromX, fromY));
      doc.dispatch(
        "touchmove",
        touchEvent("touchmove", start + heldMs / 2, fromX + dx / 2, fromY + dy / 2),
      );
      doc.dispatch("touchend", touchEvent("touchend", start + heldMs, fromX + dx, fromY + dy));
    },
  };
}

describe("Reader interaction recovery", () => {
  it.each([
    [160, "prev"],
    [800, "tap"],
    [890, "next"],
  ] as const)("routes scaled Android comic tap at physical x=%s to %s", (physicalX, expected) => {
    // Observed Android fixture: device1080px at420dpi (DPR2.625), image595px.
    // Pointer coordinates inside the scaled iframe are in its unscaled CSS
    // viewport, while frame bounds and reader width are in outer CSS pixels.
    const harness = createHarness("Mozilla/5.0 (Linux; Android 16)");
    const viewportWidth = 1080 / 2.625;
    const outerWindow = harness.runtime.window as {
      innerWidth: number;
      top: { innerWidth: number };
    };
    outerWindow.innerWidth = outerWindow.top.innerWidth = viewportWidth;
    harness.doc.defaultView.frameElement = {
      clientWidth: 595,
      getBoundingClientRect: () => ({ left: 0, width: viewportWidth }),
    };
    harness.touchPointerTap({ x: (physicalX / 1080) * 595 });
    expect(harness.turns).toEqual(expected === "tap" ? [] : [expected]);
    expect(harness.messages).toEqual(expected === "tap" ? ["tap"] : []);
  });

  it("keeps unscaled reflow chapter coordinates aligned after seven offscreen columns", () => {
    const harness = createHarness();
    harness.doc.defaultView.frameElement = {
      clientWidth: 368 * 20,
      getBoundingClientRect: () => ({ left: -368 * 7, width: 368 * 20 }),
    };
    harness.tap({ x: 368 * 7 + 340 });
    expect(harness.turns).toEqual(["next"]);
  });

  it.each(["tap", "syntheticClick"] as const)(
    "projects scaled, centered iOS page coordinates for %s input",
    (input) => {
      const harness = createHarness();
      harness.doc.defaultView.frameElement = {
        clientWidth: 595,
        getBoundingClientRect: () => ({ left: 24, width: 320 }),
      };
      harness[input]({ x: ((340 - 24) * 595) / 320 });
      expect(harness.turns).toEqual(["next"]);
      expect(harness.messages).toEqual([]);
    },
  );

  it("composes nested frame scale and offset before deciding the tap zone", () => {
    const harness = createHarness();
    const parentWindow = new FakeWindow();
    parentWindow.frameElement = {
      clientWidth: 500,
      getBoundingClientRect: () => ({ left: 34, width: 300 }),
    };
    harness.doc.defaultView.frameElement = {
      clientWidth: 400,
      getBoundingClientRect: () => ({ left: 50, width: 200 }),
      ownerDocument: { defaultView: parentWindow },
    };
    harness.tap({ x: 350 }); // outer x = 34 + (50 + 350 * .5) * .6 = 169
    expect(harness.turns).toEqual([]);
    expect(harness.messages).toEqual(["tap"]);
  });

  it("does not wrap a fractional right-edge coordinate into the previous-page zone", () => {
    const harness = createHarness();
    harness.tap({ x: 368.00001 });
    expect(harness.turns).toEqual(["next"]);
  });

  it("слушает жесты и внутри EPUB, и на внешней оболочке Foliate", () => {
    const html = fs.readFileSync(readerTemplatePath, "utf8");
    const outerListenerIndex = html.lastIndexOf("attachTapListener(document);");
    const readyIndex = html.lastIndexOf("postToRN('ready', {});");

    expect(outerListenerIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(outerListenerIndex);
  });

  it("подключает ввод и стили EPUB синхронно, даже если fonts.ready не завершается", () => {
    const harness = createHarness(undefined, false);
    const doc = Object.assign(harness.doc, { fonts: { ready: new Promise(() => {}) } });
    const selectedDocuments: FakeDocument[] = [];
    const styledDocuments: FakeDocument[] = [];
    const longPressDocuments: FakeDocument[] = [];
    Object.assign(harness.runtime, {
      isCurrent: () => true,
      el: { isFixedLayout: false, renderer: {} },
      msg: {},
      attachSelectionListener: (target: FakeDocument) => selectedDocuments.push(target),
      attachNoteLongPress: (target: FakeDocument) => longPressDocuments.push(target),
      normalizeBrOnlyParagraphs() {},
      isVerticalDoc: () => false,
      applyRendererFlowMode() {},
      applyDocStyles: (target: FakeDocument) => styledDocuments.push(target),
      refreshUserAnnotations() {},
      _rubyMode: null,
      _characterNameSpec: null,
      applySceneInserts() {},
    });
    const onLoad = vm.runInContext(
      `(${extractDocumentLoadListener()})`,
      harness.runtime,
    ) as (event: { detail: { doc: FakeDocument; index: number; primary: boolean } }) => void;

    onLoad({ detail: { doc, index: 0, primary: true } });

    // No microtask, timer or font completion: a real touch must already reach
    // the actual gesture handler. Reader readiness is separately gated on init.
    harness.tap();
    expect(harness.messages).toEqual(["tap"]);
    expect(selectedDocuments).toEqual([doc]);
    expect(longPressDocuments).toEqual([doc]);
    expect(styledDocuments).toEqual([doc]);
  });

  it("прогревает четыре начертания SB Serif один раз с ограниченным ожиданием", () => {
    const script = readReaderMainScript();
    const warmupStart = script.indexOf("function warmBundledReaderFontOnce()");
    const waitStart = script.indexOf(
      "async function waitForBundledReaderFontWarmup()",
      warmupStart,
    );
    const warmupBlock = script.slice(warmupStart, waitStart);
    const openStart = script.indexOf("async function openBook(msg)");
    const openEnd = script.indexOf("// ─── Settings ───", openStart);
    const openBlock = script.slice(openStart, openEnd);
    const timeoutMatch = script.match(/BUNDLED_READER_FONT_WARMUP_TIMEOUT_MS\s*=\s*(\d+)/);
    const waitIndex = openBlock.indexOf("await waitForBundledReaderFontWarmup();");
    const openReaderIndex = openBlock.indexOf("await el.open(book);");

    expect(warmupStart).toBeGreaterThan(-1);
    expect(warmupBlock).toContain("if (bundledReaderFontWarmup) return bundledReaderFontWarmup;");
    expect(warmupBlock.match(/document\.fonts\.load\(/g)).toHaveLength(4);
    expect(Number(timeoutMatch?.[1])).toBeGreaterThan(0);
    expect(Number(timeoutMatch?.[1])).toBeLessThanOrEqual(1500);
    expect(waitIndex).toBeGreaterThan(-1);
    expect(openReaderIndex).toBeGreaterThan(-1);
    expect(waitIndex).toBeLessThan(openReaderIndex);
  });

  it("снимает экран загрузки только по loaded, а не по раннему relocate", () => {
    const source = fs.readFileSync(readerScreenPath, "utf8");
    const loadedBlock = source.slice(
      source.indexOf("onLoaded:"),
      source.indexOf("onBookTextMetrics:"),
    );
    const relocateBlock = source.slice(
      source.indexOf("onRelocate:"),
      source.indexOf("onTocReady:"),
    );

    expect(loadedBlock).toMatch(/\bsetLoading\s*\(\s*false\s*\)/);
    expect(relocateBlock).not.toMatch(/\bsetLoading\s*\(\s*false\s*\)/);
  });

  it("не теряет тап из-за устаревшего флага выделения", () => {
    const harness = createHarness();
    harness.doc.__readany_selection_interaction = true;

    harness.tap();

    expect(harness.messages).toContain("tap");
    expect(harness.doc.__readany_selection_interaction).toBe(false);
  });

  it("принимает клик мышью из Device Hub", () => {
    const harness = createHarness();

    harness.mouseClick();

    expect(harness.messages).toContain("tap");
  });

  it("принимает Android-тап, пришедший только как touch pointer", () => {
    const harness = createHarness("Mozilla/5.0 (Linux; Android 16)");

    harness.touchPointerTap();

    expect(harness.messages).toContain("tap");
  });

  it("принимает синтетический click от WKWebView без touch и pointer событий", () => {
    const harness = createHarness();

    harness.syntheticClick({ x: 340 });

    expect(harness.turns).toEqual(["next"]);
  });

  it("принимает доверенный accessibility click с detail равным нулю", () => {
    const harness = createHarness();
    const event = clickEvent(1000, 340);
    event.detail = 0;

    harness.doc.dispatch("click", event);

    expect(harness.turns).toEqual(["next"]);
  });

  it("игнорирует программный click", () => {
    const harness = createHarness();
    const event = clickEvent(1000, 340);
    event.isTrusted = false;

    harness.doc.dispatch("click", event);

    expect(harness.turns).toEqual([]);
  });

  it("не обрабатывает синтетический click второй раз после pointerup", () => {
    const harness = createHarness();

    harness.mouseClick({ x: 340 });

    expect(harness.turns).toEqual(["next"]);
  });

  it("первым тапом закрывает настоящее выделение, а следующим открывает контролы", () => {
    const harness = createHarness();
    harness.doc.selection.isCollapsed = false;
    harness.doc.selection.rangeCount = 1;
    harness.doc.selection.text = "выделение";
    harness.doc.__readany_selection_interaction = true;

    harness.tap();
    expect(harness.messages).toContain("selectionCleared");
    expect(harness.messages).not.toContain("tap");

    harness.tap();
    expect(harness.messages).toContain("tap");
  });

  it("листает подряд идущие тапы, не глотая ни одного", () => {
    const harness = createHarness();

    harness.tap({ x: 340 });
    harness.tap({ x: 340 });
    harness.tap({ x: 340 });

    expect(harness.turns).toEqual(["next", "next", "next"]);
  });

  it("листает быстрый тап, даже когда обработчик выполнился с задержкой", () => {
    const harness = createHarness();

    harness.tap({ heldMs: 40, x: 340 });

    expect(harness.turns).toEqual(["next"]);
  });

  it("не листает по долгому нажатию", () => {
    const harness = createHarness();

    harness.tap({ heldMs: 600, x: 340 });

    expect(harness.turns).toEqual([]);
  });

  it("не теряет спокойный Android-тап длительностью до порога long press", () => {
    const harness = createHarness("Mozilla/5.0 (Linux; Android 16)");

    harness.tap({ heldMs: 350 });

    expect(harness.messages).toContain("tap");
  });

  it("свайпом влево листает вперед, вправо — назад", () => {
    const harness = createHarness();

    harness.drag({ dx: -120 });
    harness.drag({ dx: 120 });

    expect(harness.turns).toEqual(["next", "prev"]);
  });

  it("листает ровно одну страницу, как бы быстро ни был свайп", () => {
    const harness = createHarness();

    harness.drag({ dx: -300, heldMs: 40 });

    expect(harness.turns).toEqual(["next"]);
  });

  it("не листает по вертикальному и слишком короткому жесту", () => {
    const harness = createHarness();

    harness.drag({ dy: -200 });
    harness.drag({ dx: -20 });

    expect(harness.turns).toEqual([]);
  });
});
