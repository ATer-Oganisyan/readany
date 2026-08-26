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
  frameElement = null;
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
): FakeTouchEvent {
  return {
    button: 0,
    changedTouches: [],
    clientX: x,
    clientY: y,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
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

function createHarness() {
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
  (runtime.attachTapListener as (document: FakeDocument) => void)(doc);

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
  it("слушает жесты и внутри EPUB, и на внешней оболочке Foliate", () => {
    const html = fs.readFileSync(readerTemplatePath, "utf8");
    const outerListenerIndex = html.lastIndexOf("attachTapListener(document);");
    const readyIndex = html.lastIndexOf("postToRN('ready', {});");

    expect(outerListenerIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(outerListenerIndex);
  });

  it("подключает ввод и показывает EPUB без ожидания шрифтов документа", () => {
    const script = readReaderMainScript();
    const loadListenerStart = script.indexOf("el.addEventListener('load'");
    const loadListenerEnd = script.indexOf("var snippetTimer", loadListenerStart);
    const loadListener = script.slice(loadListenerStart, loadListenerEnd);
    const loadedIndex = loadListener.indexOf("markLoaded();");
    const tapIndex = loadListener.indexOf("attachTapListener(doc);");
    const selectionIndex = loadListener.indexOf("attachSelectionListener(doc);");

    expect(loadListener).not.toContain("doc.fonts");
    expect(loadListener).not.toContain("await ");
    expect(loadedIndex).toBeGreaterThan(-1);
    expect(tapIndex).toBeGreaterThan(-1);
    expect(selectionIndex).toBeGreaterThan(-1);
    expect(tapIndex).toBeLessThan(loadedIndex);
    expect(selectionIndex).toBeLessThan(loadedIndex);
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
