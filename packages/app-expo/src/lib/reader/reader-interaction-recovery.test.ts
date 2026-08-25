import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const readerTemplatePath = new URL("../../../assets/reader/reader.template.html", import.meta.url);
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
  type: "pointerdown" | "pointerup",
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
    mouseClick() {
      const start = clock;
      clock += 50;
      doc.dispatch("pointerdown", pointerEvent("pointerdown", start));
      doc.dispatch("pointerup", pointerEvent("pointerup", start + 40));
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
  it("показывает страницу только после загрузки финального шрифта", () => {
    const script = readReaderMainScript();
    const loadListenerStart = script.indexOf("el.addEventListener('load'");
    const loadListenerEnd = script.indexOf("var snippetTimer", loadListenerStart);
    const loadListener = script.slice(loadListenerStart, loadListenerEnd);
    const loadedIndex = loadListener.indexOf("markLoaded();");
    const tapIndex = loadListener.indexOf("attachTapListener(doc);");
    const fontReadyIndex = loadListener.indexOf("await doc.fonts.ready;");

    expect(fontReadyIndex).toBeGreaterThan(-1);
    expect(loadedIndex).toBeGreaterThan(-1);
    expect(loadedIndex).toBeGreaterThan(fontReadyIndex);
    expect(tapIndex).toBeGreaterThan(loadedIndex);
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
