import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function harness() {
  const source = readFileSync(
    new URL("../../../../foliate-js/paginator.js", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "paginator.js",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const paginator = ast.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === "Paginator",
  );
  if (!paginator) throw new Error("Paginator class missing");
  const names = new Set(["#turnPage", "#adjacentIndex", "#canGoToIndex", "next", "prev"]);
  const methods = paginator.members
    .filter((node) => node.name && names.has(node.name.getText(ast)))
    .map((node) => node.getText(ast));
  // Run the actual navigation and queue methods; the port below simulates
  // section visibility changing while background preload is in flight.
  const context = vm.createContext({ AbortController });
  vm.runInContext(
    `class TurnHarness {
    sections = [{}, {}, {}, {}];
    visible = [[0, {}]];
    navigated = [];
    #primaryIndex = 0;
    #locked = false;
    #pendingTurns = 0;
    #pendingDistance;
    #lifecycle = new AbortController();
    #fillPromise;
    get #sortedViews() { return this.visible; }
    #scrollNext() { return true; }
    #scrollPrev() { return true; }
    #goTo({index}) { this.navigated.push(index); this.visible = [[index, {}]]; this.#primaryIndex = index; }
    preload(promise) { this.#fillPromise = promise; }
    ${methods.join("\n")}
  }
  globalThis.harness = new TurnHarness();`,
    context,
  );
  return context.harness as {
    visible: Array<[number, object]>;
    navigated: number[];
    preload: (promise: Promise<void>) => void;
    next: () => Promise<void>;
    prev: () => Promise<void>;
  };
}

describe("queued page navigation", () => {
  it("does not skip a section that finishes preloading during a next-page request", async () => {
    const h = harness();
    let finish!: () => void;
    h.preload(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const turn = h.next();
    await Promise.resolve();
    h.visible = [
      [0, {}],
      [1, {}],
    ];
    finish();
    await turn;
    expect(h.navigated).toEqual([1]);
  });

  it("does not skip a previous section that finishes preloading during a back-page request", async () => {
    const h = harness();
    h.visible = [[2, {}]];
    let finish!: () => void;
    h.preload(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const turn = h.prev();
    await Promise.resolve();
    h.visible = [
      [1, {}],
      [2, {}],
    ];
    finish();
    await turn;
    expect(h.navigated).toEqual([1]);
  });

  it("preserves three rapid next taps while a section is loading", async () => {
    const h = harness();
    let finish!: () => void;
    h.preload(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const first = h.next();
    void h.next();
    void h.next();
    finish();
    await first;
    expect(h.navigated).toEqual([1, 2, 3]);
  });
});
