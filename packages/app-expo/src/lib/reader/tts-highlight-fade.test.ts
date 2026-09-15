import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

it("holds for 2 seconds, fades for 1 second, and cancels pending frames", () => {
  const template = readFileSync("assets/reader/reader.template.html", "utf8");
  const code = template.slice(template.indexOf("    let ttsFadeTimer"), template.indexOf("    function clearTTSHighlight()"));
  const style = { textContent: "::highlight(tts) { background-color: transparent !important; color: #FF8D28 !important; }" };
  let delay = 0;
  let timer: () => void = () => {};
  let frame: (time: number) => void = () => {};
  let cleared = false;
  let cancelled = false;
  const context = vm.createContext({
    setTimeout: (fn: () => void, ms: number) => { timer = fn; delay = ms; return 1; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn: (time: number) => void) => { frame = fn; return 2; },
    cancelAnimationFrame: () => { cancelled = true; },
    performance: { now: () => 0 },
    getRendererContents: () => [{ doc: { getElementById: () => style } }],
    TTS_CSS_HIGHLIGHT_STYLE_ID: "tts",
    currentThemeColors: { fg: "#111111" },
    clearTTSHighlight: () => { cleared = true; },
  });
  vm.runInContext(code + "\nfadeTTSHighlight();", context);
  expect(delay).toBe(2000);
  expect(style.textContent).not.toContain("color-mix");
  timer();
  frame(500);
  expect(style.textContent).toContain("color-mix(in srgb, #FF8D28");
  expect(cleared).toBe(false);
  frame(1000);
  expect(cleared).toBe(true);
  vm.runInContext("cancelTTSHighlightFade()", context);
  expect(cancelled).toBe(true);
});
