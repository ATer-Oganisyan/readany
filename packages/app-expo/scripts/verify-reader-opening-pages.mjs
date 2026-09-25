// Real Foliate regression: prepare the large text section behind a title without
// blocking ordinary books. Build first: pnpm build:reader; then run with Playwright.
// An optional first argument selects another reader.html for a before/after check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const { webkit, chromium } = createRequire(import.meta.url)("playwright");
const html = await readFile(process.argv[2] ?? new URL("../assets/reader/reader.html", import.meta.url));
// The real catalog fixture has a one-page title and a >300 KiB text section.
const base64 = (await readFile(new URL("../assets/catalog/hero-of-our-time.epub", import.meta.url))).toString("base64");
const smallChapterBook = (await readFile(new URL("../assets/catalog/crime-and-punishment.epub", import.meta.url))).toString("base64");
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

try {
  for (const engine of [webkit, chromium]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 430, height: 766 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__loaded = [];
        window.__errors = [];
        window.ReactNativeWebView = { postMessage: text => {
          const message = JSON.parse(text);
          if (message.type === "error") window.__errors.push(message);
          if (message.type === "loaded") window.__loaded.push({
            loadId: message.loadId,
            index: view.lastLocation.section.current,
            sections: getRendererContents().map(({ index, doc }) => ({
              index, text: doc.body.textContent.length, fonts: doc.fonts.status,
            })),
          });
        } };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await page.evaluate(async base64 => {
        const settings = {
          fontSize: 22, lineHeight: 1.5, pageMargin: 40,
          viewMode: "paginated", paginatedLayout: "single",
        };
        setThemeColors({ background: "#fff", foreground: "#222" });
        await openBook({ base64, fileName: "opening.epub", loadId: "title", settings });
        const contents = getRendererContents();
        const title = window.__loaded.at(-1);
        const turns = [];
        for (let i = 0; i < 3; i++) {
          await goNextByMode();
          const doc = getRendererContents().find(({ index }) => index === 1)?.doc;
          turns.push({
            index: view.lastLocation.section.current,
            fraction: view.lastLocation.fraction,
            readyBeforeTurn: contents.some(entry => entry.doc === doc),
            visible: doc?.defaultView.frameElement.parentElement.parentElement.style.opacity,
          });
        }
        for (let i = 0; i < 3; i++) await goPrevByMode();
        const returnedIndex = view.lastLocation.section.current;

        // A resumed book opens in its long text section; it must keep its place
        // and must not start loading the title as an extra opening buffer.
        await view.goToFraction(0.35);
        const saved = { cfi: view.lastLocation.cfi, fraction: view.lastLocation.fraction };
        await openBook({ base64, fileName: "opening.epub", loadId: "resume",
          lastLocation: saved.cfi, fallbackFraction: saved.fraction, settings });
        return {
          title, turns, returnedIndex, saved,
          resumed: window.__loaded.at(-1),
          resumedFraction: view.lastLocation.fraction,
          errors: window.__errors,
        };
      }, base64);
      const label = engine.name();
      assert.deepEqual(errors, [], `${label}: browser errors`);
      assert.deepEqual(result.errors, [], `${label}: reader errors`);
      assert.equal(result.title.index, 0, `${label}: opening stays on the title`);
      assert.deepEqual(result.title.sections.map(s => s.index), [0, 1],
        `${label}: ready must include the first text section`);
      assert.ok(result.title.sections.every(s => s.fonts === "loaded"));
      assert.ok(result.title.sections[1].text > 100_000);
      for (const turn of result.turns) {
        assert.equal(turn.index, 1, `${label}: first turns show text`);
        assert.equal(turn.readyBeforeTurn, true, `${label}: no section load on first turns`);
        assert.equal(turn.visible, "1", `${label}: text container stays visible`);
      }
      assert.ok(result.turns[1].fraction > result.turns[0].fraction);
      assert.ok(result.turns[2].fraction > result.turns[1].fraction);
      assert.equal(result.returnedIndex, 0, `${label}: three backward turns return to title`);
      assert.deepEqual(result.resumed.sections.map(s => s.index), [1],
        `${label}: reopening text does not warm unrelated sections`);
      assert.ok(Math.abs(result.resumedFraction - result.saved.fraction) < 0.01,
        `${label}: saved position survives reopening`);

      // Keep an ordinary next chapter pending: unlike an oversized one, it
      // must remain background work and must not delay the opening signal.
      await page.evaluate(base64 => {
        const makeBook = window.makeBook;
        window.makeBook = async file => {
          const book = await makeBook(file);
          const section = book.sections[1];
          const load = section.load;
          const pending = new Promise(resolve => { window.__releaseChapter = resolve; });
          section.load = async () => { await pending; return load(); };
          return book;
        };
        window.__ordinaryOpen = openBook({ base64, fileName: "ordinary.epub", loadId: "ordinary",
          settings: { fontSize: 22, viewMode: "paginated", paginatedLayout: "single" } });
      }, smallChapterBook);
      await page.waitForFunction(() => window.__loaded.some(m => m.loadId === "ordinary"),
        null, { timeout: 5000 });
      const ordinary = await page.evaluate(() => window.__loaded.at(-1));
      assert.deepEqual(ordinary.sections.map(s => s.index), [0],
        `${label}: an ordinary next chapter does not delay opening`);
      await page.evaluate(async () => { window.__releaseChapter(); await window.__ordinaryOpen; });
      await page.waitForFunction(() => getRendererContents().some(({ index, doc }) =>
        index === 1 && doc.body?.textContent.length > 100));
      assert.deepEqual(errors, [], `${label}: browser errors after ordinary opening`);
      assert.deepEqual(await page.evaluate(() => window.__errors), []);
      console.log(`${label}: prepared first turns, saved position, non-blocking ordinary opening passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
