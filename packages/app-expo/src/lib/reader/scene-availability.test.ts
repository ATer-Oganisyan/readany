import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_SCENE_SUGGESTION_STATE, advanceSceneSuggestion } from "../narra/scene-suggestion";

const html = readFileSync(
  new URL("../../../assets/reader/reader.template.html", import.meta.url),
  "utf8",
);
const webScript = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
const webSource = ts.createSourceFile(
  "reader.js",
  webScript,
  ts.ScriptTarget.ESNext,
  true,
  ts.ScriptKind.JS,
);

function assignedHelper(name: string) {
  const node = webSource.statements.find(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.left.getText(webSource) === `window.${name}`,
  );
  if (!node) throw new Error(`Missing production window.${name}`);
  return node.getText(webSource);
}

function webHarness() {
  const slots: ReturnType<typeof slot>[] = [];
  const parent = {
    insertBefore: vi.fn((node: ReturnType<typeof slot>) => {
      slots.push(node);
    }),
    removeChild: vi.fn((node: ReturnType<typeof slot>) => {
      slots.splice(slots.indexOf(node), 1);
    }),
  };
  function slot(state: string, anchor: string) {
    const attributes = new Map([
      ["data-readany-scene-state", state],
      ["data-readany-scene-anchor", anchor],
    ]);
    const dispose = vi.fn();
    const disconnect = vi.fn();
    return {
      parentNode: parent,
      dispose,
      disconnect,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      querySelector: () => ({
        __readanyDisposeLoader: dispose,
        __readanyBorderObserver: { disconnect },
      }),
    };
  }
  const doc = { defaultView: {}, querySelectorAll: () => [...slots] };
  const block = { parentNode: parent, nextSibling: null };
  const create = vi.fn((_doc: unknown, anchor: string, state: string) => slot(state, anchor));
  const render = vi.fn();
  const stateDeclaration = webSource.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(webSource) === "_sceneSlotsEnabled",
      ),
  );
  if (!stateDeclaration) throw new Error("Missing production initial availability");
  const context = vm.createContext({
    window: {},
    view: {
      renderer: {},
      lastLocation: { cfi: "epubcfi(/6/2!/4/2:10)" },
      resolveCFI: () => ({ index: 0, anchor: () => ({}) }),
    },
    _sceneRestoreAnchors: [] as string[],
    _sceneSlotLabels: { idle: "Generate", loading: "Drawing", error: "Retry" },
    SCENE_INSERT_CLASS: "readany-scene-insert",
    SCENE_STATE_ATTR: "data-readany-scene-state",
    SCENE_ANCHOR_ATTR: "data-readany-scene-anchor",
    SCENE_PROGRESS_ATTR: "data-readany-scene-progress",
    sceneSlotLog: vi.fn(),
    console,
    getRendererContents: () => [{ doc, index: 0 }],
    getPrimaryRendererContent: () => ({ doc, index: 0 }),
    findLastVisibleSceneBlock: () => block,
    computeSceneAnchor: () => "new-anchor",
    findSceneInsertInDoc: (_doc: unknown, anchor: string) =>
      slots.find((item) => item.getAttribute("data-readany-scene-anchor") === anchor),
    findSceneInsert: (anchor: string) =>
      slots.find((item) => item.getAttribute("data-readany-scene-anchor") === anchor),
    sceneInsertHostForBlock: () => block,
    sceneHostFromRange: () => block,
    postToRN: vi.fn(),
    createSceneInsert: create,
    renderSceneInsert: render,
  });
  const remove = webSource.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "removeSceneInsertElement",
  );
  if (!remove) throw new Error("Missing actual scene DOM disposal helper");
  const restore = webSource.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "applySceneInserts",
  );
  if (!restore) throw new Error("Missing actual saved scene restoration helper");
  vm.runInContext(
    [
      stateDeclaration.getText(webSource),
      remove.getText(webSource),
      restore.getText(webSource),
      assignedHelper("insertSceneSlot"),
      assignedHelper("configureSceneSlots"),
      assignedHelper("removeSceneSlot"),
      assignedHelper("setSceneAnchors"),
    ].join("\n"),
    context,
  );
  return {
    context,
    slots,
    create,
    render,
    parent,
    add: (state: string, anchor: string) => {
      const item = slot(state, anchor);
      slots.push(item);
      return item;
    },
    configure: (enabled: boolean) =>
      context.window.configureSceneSlots(JSON.stringify({ enabled })),
    insert: () => context.window.insertSceneSlot(0.25),
  };
}

function rnHarness() {
  const text = readFileSync(new URL("../../screens/ReaderScreen.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile(
    "ReaderScreen.tsx",
    text,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  let statements: readonly ts.Statement[] = [];
  function visit(node: ts.Node) {
    if (ts.isBlock(node)) {
      const start = node.statements.findIndex(
        (statement) =>
          ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(
            (declaration) => declaration.name.getText(source) === "sceneAdvance",
          ),
      );
      if (start >= 0) statements = node.statements.slice(start, start + 3);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (statements.length !== 3) throw new Error("Missing actual Reader scene relocation statements");
  const insert = vi.fn();
  const context = vm.createContext({
    backendSceneEnabled: false,
    advanceSceneSuggestion,
    sceneSuggestionStateRef: { current: INITIAL_SCENE_SUGGESTION_STATE },
    sceneSuggestionInterval: 6,
    trackingSuppressed: false,
    absoluteFraction: 0.25,
    bridgeRef: { current: { insertSceneSlot: insert } },
    console: { log: vi.fn() },
  });
  vm.runInContext(
    `globalThis.relocate = (detail) => {${statements.map((statement) => statement.getText(source)).join("\n")}}`,
    context,
  );
  return {
    context,
    insert,
    page: (page: number) =>
      context.relocate({
        section: { current: 0, total: 3 },
        page: { current: page, total: 30 },
        fraction: page / 100,
      }),
  };
}

describe("unavailable scenes must not add empty pages to reading", () => {
  it("does not create a WebView placeholder before the first ready configuration", () => {
    const h = webHarness();
    h.insert();
    expect(h.slots).toHaveLength(0);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("rejects a late insert message after the backend became unavailable", () => {
    const h = webHarness();
    h.configure(true);
    h.configure(false);
    h.insert();
    expect(h.slots).toHaveLength(0);
  });
  it("removes only unsaved idle placeholders, preserving images and requested/saved slots", () => {
    const h = webHarness();
    const idle = h.add("idle", "unrequested");
    const savedIdle = h.add("idle", "saved");
    const image = h.add("image", "generated");
    const loading = h.add("loading", "pending");
    const error = h.add("error", "failed-request");
    h.context._sceneRestoreAnchors = ["saved", "generated", "pending", "failed-request"];
    const position = h.context.view.lastLocation;
    h.configure(false);
    expect(h.slots).toEqual([savedIdle, image, loading, error]);
    expect(idle.dispose).toHaveBeenCalledOnce();
    expect(idle.disconnect).toHaveBeenCalledOnce();
    expect(h.context.view.lastLocation).toBe(position);
    expect(h.context._sceneRestoreAnchors).toEqual([
      "saved",
      "generated",
      "pending",
      "failed-request",
    ]);
    for (const item of [savedIdle, image, loading, error])
      expect(item.dispose).not.toHaveBeenCalled();
  });
  it("still inserts ready suggestions and does not duplicate them", () => {
    const h = webHarness();
    h.configure(true);
    h.insert();
    h.insert();
    expect(h.slots).toHaveLength(1);
    expect(h.slots[0].getAttribute("data-readany-scene-state")).toBe("idle");
  });
  it("still restores saved scene anchors while new suggestions are unavailable", () => {
    const h = webHarness();
    h.configure(false);
    h.context.window.setSceneAnchors(JSON.stringify(["saved-image", "pending-request"]));
    expect(h.slots).toHaveLength(2);
    expect(h.slots.map((slot) => slot.getAttribute("data-readany-scene-state"))).toEqual([
      "loading",
      "loading",
    ]);
    expect(h.context.postToRN).toHaveBeenCalledWith("sceneSlotRestored", { anchor: "saved-image" });
    expect(h.context.postToRN).toHaveBeenCalledWith("sceneSlotRestored", {
      anchor: "pending-request",
    });
    h.configure(false);
    expect(h.slots).toHaveLength(2);
  });
  it("does not send suggestions from actual Reader relocation while backend is unavailable", () => {
    const h = rnHarness();
    for (let page = 0; page < 20; page++) h.page(page);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.context.sceneSuggestionStateRef.current.pagesTurned).toBe(0);
    expect(h.context.sceneSuggestionStateRef.current.firstSuggested).toBe(false);
  });
  it("does not accumulate a disabled backlog and recovers after two actual ready page turns", () => {
    const h = rnHarness();
    h.context.backendSceneEnabled = true;
    h.page(0);
    h.page(1);
    h.context.backendSceneEnabled = false;
    h.page(2);
    h.page(3);
    h.context.backendSceneEnabled = true;
    h.page(4);
    expect(h.insert).not.toHaveBeenCalled();
    h.page(5);
    expect(h.insert).toHaveBeenCalledOnce();
  });
});
