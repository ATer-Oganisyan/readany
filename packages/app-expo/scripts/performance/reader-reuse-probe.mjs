// Browser-only comparison. Excludes RN navigation, native WebView creation and downloads.
// Run from app-expo: NODE_PATH=/path/to/node_modules node scripts/performance/reader-reuse-probe.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const { chromium, webkit } = createRequire(import.meta.url)("playwright");
const root = new URL("../../", import.meta.url);
const html = await readFile(new URL("assets/reader/reader.html", root));
const books = ["eugene-onegin.epub", "crime-and-punishment.epub"];
const faces = [["Regular", "normal", 400], ["Italic", "italic", 400],
  ["Bold", "normal", 700], ["BoldItalic", "italic", 700]];
const files = new Map([["/", html]]);
for (const book of books) files.set(`/${book}`, await readFile(new URL(`assets/catalog/${book}`, root)));
for (const [face] of faces) {
  files.set(`/SBSerifText-${face}.otf`, await readFile(new URL(`../deslop-primitives/fonts/SBSerifText-${face}.otf`, root)));
}
let fontRequests = 0;
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const bytes = files.get(path);
  if (!bytes) { res.writeHead(404).end(); return; }
  const font = path.endsWith(".otf");
  if (font) fontRequests++;
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  res.writeHead(range ? 206 : 200, {
    "Content-Type": font ? "font/otf" : path === "/" ? "text/html; charset=utf-8" : "application/epub+zip",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
    "Cache-Control": "no-store",
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const settings = {
  fontSize: 20, lineHeight: 1.5, pageMargin: 16,
  viewMode: "paginated", paginatedLayout: "single", customFontFamily: "Probe Serif",
  customFontFaceCSS: faces.map(([face, style, weight]) =>
    `@font-face{font-family:"Probe Serif";src:url("${origin}/SBSerifText-${face}.otf");font-style:${style};font-weight:${weight};font-display:swap;}`).join("\n"),
};
const samples = [];
const browserVersions = {};
try {
  for (const engine of [webkit, chromium]) {
    const browser = await engine.launch({ headless: true });
    browserVersions[engine.name()] = browser.version();
    try {
      const context = await browser.newContext({ viewport: { width: 393, height: 740 }, hasTouch: true });
      const errors = [];
      async function shell() {
        const page = await context.newPage();
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript(() => {
          window.__messages = [];
          window.ReactNativeWebView = { postMessage: text => window.__messages.push({ ...JSON.parse(text), at: performance.now() }) };
        });
        await page.goto(origin);
        await page.waitForFunction(() => window.__messages.some(m => m.type === "ready"));
        return page;
      }
      const persistent = await shell();
      await persistent.evaluate(async settings => {
        updateSettingsState(settings);
        await waitForBundledReaderFontWarmup();
      }, settings);
      // Alternate order to reduce the effect of drift. 12 opens per mode, 6 per book.
      for (let i = 0; i < 12; i++) {
        for (const mode of i % 2 ? ["reuse", "new-document"] : ["new-document", "reuse"]) {
          const page = mode === "reuse" ? persistent : await shell();
          const beforeFonts = fontRequests;
          const book = books[i % books.length];
          const result = await page.evaluate(async params => {
            const start = performance.now();
            await openBook(params);
            const loaded = window.__messages.find(m => m.type === "loaded" && m.loadId === params.loadId);
            const errors = window.__messages.filter(m => m.type === "error");
            return {
              shellMs: window.__messages.find(m => m.type === "ready").at,
              openMs: (loaded?.at ?? performance.now()) - start,
              loaded: !!loaded,
              errors,
              textCharacters: getRendererContents().reduce((sum, { doc }) => sum + (doc.body?.textContent.length || 0), 0),
              readerViews: document.querySelectorAll("foliate-view").length,
            };
          }, { uri: `${origin}/${book}`, fileName: book, loadId: `${mode}-${i}`, fallbackFraction: 0.35, settings });
          assert.equal(result.loaded, true, JSON.stringify(result));
          assert.deepEqual(result.errors, []);
          assert.ok(result.textCharacters > 100);
          assert.equal(result.readerViews, 1);
          samples.push({ engine: engine.name(), mode, book, ...result,
            totalMs: result.openMs + (mode === "new-document" ? result.shellMs : 0),
            fontRequests: fontRequests - beforeFonts });
          if (mode === "new-document") await page.close();
        }
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const median = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
};
const summary = ["webkit", "chromium"].flatMap(engine => books.flatMap(book => ["new-document", "reuse"].map(mode => {
  const group = samples.filter(s => s.engine === engine && s.book === book && s.mode === mode);
  return { engine, book, mode, n: group.length,
    medianTotalMs: median(group.map(s => s.totalMs)), medianOpenMs: median(group.map(s => s.openMs)),
    medianShellMs: median(group.map(s => s.shellMs)), medianFontRequests: median(group.map(s => s.fontRequests)) };
})));
console.log(JSON.stringify({ capturedAt: new Date().toISOString(),
  htmlSha256: createHash("sha256").update(html).digest("hex"),
  browsers: browserVersions,
  cache: "no-store", summary, samples }, null, 2));
