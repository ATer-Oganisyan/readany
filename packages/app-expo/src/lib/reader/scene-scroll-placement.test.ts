import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";

it("places a scene after the visible paragraph, not at the end of the scrolled chapter", () => {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const ast = ts.createSourceFile("reader.js", script, ts.ScriptTarget.ESNext, true);
  const helpers = new Set([
    "getReaderViewportRect",
    "mapIframeRectToHost",
    "isHostRectVisible",
    "isRectVisibleInReader",
    "findLastVisibleSceneBlock",
  ]);
  const sources: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && helpers.has(node.name?.text ?? "")) {
      sources.push(node.getText(ast));
    } else ts.forEachChild(node, visit);
  };
  visit(ast);
  const rect = (top: number, height: number) => ({
    left: 0,
    right: 400,
    width: 400,
    top,
    bottom: top + height,
    height,
  });
  const blocks = [2200, 2600, 2900, 11_000].map((top) => ({
    textContent: "Book paragraph",
    getBoundingClientRect: () => rect(top, 100),
    closest: () => null,
  }));
  const win = {
    innerWidth: 400,
    innerHeight: 12_000, // The iframe is as tall as the whole chapter.
    frameElement: {
      clientWidth: 400,
      clientHeight: 12_000,
      getBoundingClientRect: () => rect(-2500, 12_000),
    },
  };
  const doc = { defaultView: win, querySelectorAll: () => blocks };
  const context = vm.createContext({
    view: { renderer: { scrolled: true }, getBoundingClientRect: () => rect(0, 600) },
    window: { innerWidth: 400, innerHeight: 600 },
    document: { documentElement: {} },
    SCENE_BLOCK_SELECTOR: "p",
    SCENE_INSERT_CLASS: "readany-scene-insert",
  });
  vm.runInContext(sources.join("\n"), context);
  expect(context.findLastVisibleSceneBlock(doc, win)).toBe(blocks[2]);
});
