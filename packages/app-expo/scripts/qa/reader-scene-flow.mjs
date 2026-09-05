/**
 * Run inside the loaded native reader WebView (Runtime.evaluate, returnByValue).
 * Uses the actual sceneSlotStyleText() from that bundle and real CSS columns.
 * Isolated, disposable iframes do not touch the book, its selection, or its CFI.
 *
 * Print the expression: node scripts/qa/reader-scene-flow.mjs --print-expression
 * Acceptance: report.passed === true; retain the full geometry as QA evidence.
 * `forced` reproduces the old layout; `flow` is the candidate; `current` tests
 * the installed bundle, so a stale/pre-fix reader fails the fitting case.
 */
import { pathToFileURL } from "node:url";

export function measureSceneFlow(doc, sceneStyles) {
  const configurations = [
    { name: "four-lines-fit", width: 320, height: 640, lines: 4, shouldFit: true },
    { name: "insufficient-space", width: 320, height: 480, lines: 8, shouldFit: false },
    { name: "landscape-clamp", width: 740, height: 260, lines: 1, shouldFit: false },
  ];
  const errors = [];
  const cases = [];
  for (const config of configurations) {
    const layouts = {};
    for (const mode of ["forced", "flow", "current"]) {
      const frame = doc.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText =
        `position:fixed;left:-10000px;top:0;width:${config.width}px;` +
        `height:${config.height}px;border:0;pointer-events:none;visibility:hidden;`;
      doc.body.appendChild(frame);
      try {
        const inner = frame.contentDocument;
        if (!inner?.body) throw new Error("Native WebView probe iframe is unavailable");
        const style = inner.createElement("style");
        const breakOverride =
          mode === "current"
            ? ""
            : `.readany-scene-insert { break-before:${mode === "forced" ? "column" : "auto"} !important;` +
              `-webkit-column-break-before:${mode === "forced" ? "always" : "auto"} !important; }`;
        style.textContent = `
          html { box-sizing:border-box; width:${config.width}px; height:${config.height}px;
            column-width:${config.width}px; column-gap:20px; column-fill:auto;
            -webkit-column-width:${config.width}px; -webkit-column-gap:20px;
            -webkit-column-fill:auto; margin:0; padding:0; overflow:hidden;
            --page-content-width:${config.width}px; --page-content-height:${config.height}px; }
          body { margin:0; padding:0; font:16px/30px sans-serif; }
          p { margin:0; padding:0; }
          ${sceneStyles}
          ${breakOverride}
        `;
        inner.head.appendChild(style);
        const before = inner.createElement("p");
        for (let line = 0; line < config.lines; line++) {
          if (line) before.appendChild(inner.createElement("br"));
          before.appendChild(inner.createTextNode(`Original book line ${line + 1}`));
        }
        const scene = inner.createElement("div");
        scene.className = "readany-scene-insert";
        scene.setAttribute("cfi-inert", "");
        const after = inner.createElement("p");
        after.textContent = "Text after the scene";
        inner.body.append(before, scene, after);
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            bottom: value.bottom,
          };
        };
        layouts[mode] = {
          before: rect(before),
          scene: rect(scene),
          after: rect(after),
          fragments: scene.getClientRects().length,
          breakBefore: inner.defaultView.getComputedStyle(scene).breakBefore,
        };
      } finally {
        frame.remove();
      }
    }
    const check = (condition, message) => {
      if (!condition) errors.push(`${config.name}: ${message}`);
    };
    check(layouts.forced.scene.x >= config.width, "old forced break must reproduce a new column");
    for (const mode of ["flow", "current"]) {
      const { before, scene, after, fragments } = layouts[mode];
      const fits = scene.x < config.width;
      check(fits === config.shouldFit, `${mode}: incorrect column for the available space`);
      check(fragments === 1, `${mode}: scene is fragmented`);
      check(
        scene.width > 100 && Math.abs(scene.width - scene.height) < 1,
        `${mode}: not a useful square`,
      );
      check(scene.bottom <= config.height + 1, `${mode}: scene exceeds the page bottom`);
      if (fits) check(scene.y >= before.bottom - 1, `${mode}: scene overlaps previous text`);
      else check(Math.abs(scene.y) < 1, `${mode}: carried scene must start at the next column top`);
      const followingTextOverlaps =
        after.x < scene.x + scene.width - 1 &&
        after.x + after.width > scene.x + 1 &&
        after.y < scene.bottom - 1 &&
        after.bottom > scene.y + 1;
      check(!followingTextOverlaps, `${mode}: following text overlaps scene`);
    }
    cases.push({ ...config, layouts });
  }
  return { passed: errors.length === 0, errors, cases };
}

export function readerSceneFlowExpression() {
  return `(${measureSceneFlow.toString()})(document, sceneSlotStyleText())`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes("--print-expression")) {
    throw new Error("Use --print-expression and evaluate it in the already loaded reader WebView");
  }
  console.log(readerSceneFlowExpression());
}
