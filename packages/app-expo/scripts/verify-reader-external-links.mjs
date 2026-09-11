/** Real reader + catalog EPUB regression; no requests to external websites. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const html = await readFile(new URL("../assets/reader/reader.html", import.meta.url), "utf8");
const original = html.replace(/el\.addEventListener\('external-link', \(e\) => \{\s*e\.preventDefault\(\);\s*\}\);/, "");
assert.notEqual(original, html, "The real reader contains its external-link guard");
const bytes = await readFile(new URL("../../../scripts/catalog/fixtures/brigadir-original.epub", import.meta.url));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(req.url === "/before" ? original : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  for (const before of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 393, height: 740 }, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__opened = [];
      window.__messages = [];
      window.open = (url) => { window.__opened.push(url); return null; };
      window.ReactNativeWebView = { postMessage: (value) => window.__messages.push(JSON.parse(value)) };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/${before ? "before" : "after"}`);
    const result = await page.evaluate(async (base64) => {
      await openBook({ base64, fileName: "brigadir.epub", loadId: "brigadir",
        settings: { fontSize: 20, lineHeight: 1.5, pageMargin: 16, viewMode: "paginated", paginatedLayout: "single" } });
      for (let index = 0; index < currentBook.sections.length; index++) {
        const doc = await currentBook.sections[index].createDocument();
        if (!doc.querySelector('a[href="https://ru.wiktionary.org/wiki/сюртук"]')) continue;
        await view.renderer.goTo({ index });
        for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
        const active = getRendererContents().find(({ doc }) => doc.querySelector('a[href="https://ru.wiktionary.org/wiki/сюртук"]'));
        if (!active) throw new Error("First act was not rendered");
        active.doc.querySelector('a[href="https://ru.wiktionary.org/wiki/сюртук"]').click();
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
        await view.next();
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
        return { opened: window.__opened, readable: getRendererContents().some(({ doc }) => doc.body.textContent.includes("Бригадир")) };
      }
      throw new Error("Reported link was not found in the catalog fixture");
    }, bytes.toString("base64"));
    assert.equal(result.opened.length, before ? 1 : 0);
    if (before) assert.equal(result.opened[0], new URL("https://ru.wiktionary.org/wiki/сюртук").href);
    assert.equal(result.readable, true);
    assert.deepEqual(errors, []);
    console.log(`${before ? "Before" : "After"}: external opens=${result.opened.length}; book remains readable after turning the page`);
    if (!before && process.env.READER_SCREENSHOT) await page.screenshot({ path: process.env.READER_SCREENSHOT });
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
