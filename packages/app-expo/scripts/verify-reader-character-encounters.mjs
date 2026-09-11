/** Real EPUB/reader integration. Build first; run with node --import tsx.
 * NODE_PATH can point to the bundled Playwright installation. No backend calls.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { buildCharacterNameMatcherSpec } from "../src/lib/narra/character-name-matcher.ts";
const { webkit, chromium } = createRequire(import.meta.url)("playwright");
const html = await readFile(new URL("../assets/reader/reader.html", import.meta.url));
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const books = [
  {
    file: "crime-and-punishment",
    name: "Раскольников",
    others: ["Пульхерия Александровна Раскольникова", "Порфирий Петрович"],
  },
  { file: "anna-karenina", name: "Облонский", others: ["Анна Каренина", "Алексей Каренин"] },
  { file: "eugene-onegin", name: "Онегин", others: ["Ленский", "Татьяна"] },
];
try {
  for (const engine of [webkit, chromium]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const book of books) {
        const page = await browser.newPage({
          viewport: { width: 393, height: 740 },
          hasTouch: true,
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.addInitScript(() => {
          window.__messages = [];
          window.ReactNativeWebView = {
            postMessage: (value) => window.__messages.push(JSON.parse(value)),
          };
        });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const base64 = (
          await readFile(new URL(`../assets/catalog/${book.file}.epub`, import.meta.url))
        ).toString("base64");
        const spec = buildCharacterNameMatcherSpec([
          { id: "target", name: book.name },
          ...book.others.map((name, i) => ({ id: `other-${i}`, name })),
        ]);
        await page.evaluate(
          async ({ base64, spec, file, name }) => {
            await openBook({
              base64,
              fileName: file + ".epub",
              loadId: file,
              settings: {
                fontSize: 20,
                lineHeight: 1.5,
                pageMargin: 16,
                viewMode: "paginated",
                paginatedLayout: "single",
              },
            });
            for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
            window.setCharacterNames(spec);
            // Navigate to an actual paragraph containing the character in this EPUB.
            for (let index = 0; index < currentBook.sections.length; index++) {
              const doc = await currentBook.sections[index].createDocument();
              const paragraph = [...doc.querySelectorAll("p")].find((p) =>
                p.textContent.includes(name),
              );
              if (!paragraph) continue;
              await view.renderer.goTo({ index });
              for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
              await view.renderer.goTo({
                index,
                anchor: (loaded) => loaded.querySelector('[data-readany-character-id="target"]'),
              });
              return;
            }
            throw new Error("No character paragraph: " + name);
          },
          { base64, spec, file: book.file, name: book.name },
        );
        await page
          .waitForFunction(
            () =>
              window.__messages.some(
                (m) => m.type === "charactersEncountered" && m.characterIds.includes("target"),
              ),
            null,
            { timeout: 10000 },
          )
          .catch(async (error) => {
            console.log(
              await page.evaluate(() => ({
                messages: window.__messages.slice(-6),
                hasRange: !!view.lastLocation?.range,
                range: view.lastLocation?.range?.toString().slice(0, 200),
                docs: getRendererContents().map(({ doc }) => ({
                  spans: doc.querySelectorAll("[data-readany-character-id]").length,
                  target: doc.querySelector("[data-readany-character-id=target]")?.textContent,
                })),
              })),
            );
            throw error;
          });
        const result = await page.evaluate(() => ({
          messages: window.__messages.filter((m) => m.type === "charactersEncountered"),
          clickable: getRendererContents().some(
            ({ doc }) => !!doc.querySelector('[data-readany-character-id="target"]'),
          ),
        }));
        const target = page
          .frames()
          .flatMap((frame) => [frame.locator('[data-readany-character-id="target"]').first()]);
        let tapped = false;
        for (const locator of target) {
          if ((await locator.count()) && (await locator.isVisible())) {
            try {
              await locator.click({ timeout: 2000 });
              tapped = true;
              break;
            } catch {}
          }
        }
        assert.ok(tapped, "Visible character can be tapped");
        await page.waitForFunction(
          () =>
            window.__messages.some((m) => m.type === "characterTap" && m.characterId === "target"),
          null,
          { timeout: 3000 },
        );
        assert.ok(result.clickable);
        assert.ok(result.messages.every((m) => m.loadId === book.file));
        assert.deepEqual(errors, []);
        console.log(
          `${engine.name()} ${book.file}: visible name marked, encounter delivered with correct book identity`,
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
