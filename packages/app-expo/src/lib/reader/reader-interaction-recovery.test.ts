import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const readerTemplatePath = new URL("../../../assets/reader/reader.template.html", import.meta.url);
const functionNames = new Set([
  "clearTapNavigationLock",
  "armTapNavigationLock",
  "isTapNavigationLocked",
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

function touchEvent(type: "touchstart" | "touchend", x = 184, y = 400): FakeTouchEvent {
  const touch = { clientX: x, clientY: y };
  return {
    changedTouches: type === "touchend" ? [touch] : [],
    preventDefault() {},
    stopPropagation() {},
    target: { closest: () => null },
    touches: type === "touchstart" ? [touch] : [],
  };
}

function pointerEvent(type: "pointerdown" | "pointerup", x = 184, y = 400): FakeTouchEvent {
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
    touches: [],
  };
}

function createHarness() {
  const messages: string[] = [];
  const runtime: Record<string, unknown> = {
    CHARACTER_NAME_ATTR: "data-character",
    Date,
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
    goNextByMode() {},
    goPrevByMode() {},
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
    tapNavigationInFlight: false,
    tapNavigationLockDeadline: 0,
    tapNavigationResetTimer: null,
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

  return {
    doc,
    messages,
    runtime,
    tap() {
      doc.dispatch("touchstart", touchEvent("touchstart"));
      doc.dispatch("touchend", touchEvent("touchend"));
    },
    mouseClick() {
      doc.dispatch("pointerdown", pointerEvent("pointerdown"));
      doc.dispatch("pointerup", pointerEvent("pointerup"));
    },
  };
}

describe("Reader interaction recovery", () => {
  it("подключает ввод и убирает лоудер до фоновой загрузки шрифтов", () => {
    const script = readReaderMainScript();
    const loadListenerStart = script.indexOf("el.addEventListener('load'");
    const loadListenerEnd = script.indexOf("var snippetTimer", loadListenerStart);
    const loadListener = script.slice(loadListenerStart, loadListenerEnd);
    const loadedIndex = loadListener.indexOf("markLoaded();");
    const tapIndex = loadListener.indexOf("attachTapListener(doc);");
    const backgroundFontIndex = loadListener.indexOf("void (async () =>");

    expect(loadedIndex).toBeGreaterThan(-1);
    expect(tapIndex).toBeGreaterThan(loadedIndex);
    expect(backgroundFontIndex).toBeGreaterThan(tapIndex);
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

  it("сам снимает просроченную блокировку перелистывания", () => {
    const harness = createHarness();
    harness.runtime.tapNavigationInFlight = true;
    harness.runtime.tapNavigationLockDeadline = Date.now() - 1;

    harness.tap();

    expect(harness.messages).toContain("tap");
    expect(harness.runtime.tapNavigationInFlight).toBe(false);
  });
});
