/** Real EPUB/reader integration. Build first; run with node --import tsx.
 * NODE_PATH can point to the bundled Playwright installation. No backend calls.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
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
  },
  { file: "anna-karenina", name: "Облонский" },
  { file: "eugene-onegin", name: "Онегин" },
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
        await page.evaluate(
          async ({ base64, file, name }) => {
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
            // Navigate to an actual paragraph containing the character in this EPUB.
            for (let index = 0; index < currentBook.sections.length; index++) {
              const doc = await currentBook.sections[index].createDocument();
              const paragraph = [...doc.querySelectorAll("p")].find((p) =>
                p.textContent.includes(name),
              );
              if (!paragraph) continue;
              await view.renderer.goTo({ index });
              for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
              return;
            }
            throw new Error("No character paragraph: " + name);
          },
          { base64, file: book.file, name: book.name },
        );
        const copied = await page.evaluate(async () => {
          const { doc } = getRendererContents().find(
            ({ doc }) => doc.body?.textContent.trim().length > 300,
          );
          const first =
            [...doc.querySelectorAll("p")].find((p) => p.textContent.trim().length > 80) ||
            doc.body;
          const next = first.nextElementSibling || first;
          const range = doc.createRange();
          range.setStart(first, 0);
          range.setEnd(next, next.childNodes.length);
          const selection = doc.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const expected = selection.toString();
          const nativeCopySucceeded = doc.execCommand("copy");
          await new Promise((resolve) => setTimeout(resolve, 20));
          const nativeCopies = window.__messages.filter(
            (m) => m.type === "copySelection" && m.nativeCopied,
          );
          if (
            !nativeCopySucceeded ||
            nativeCopies.length !== 1 ||
            nativeCopies[0].text !== expected
          ) {
            throw new Error(
              "Native copy must report exactly one toast with the complete selection",
            );
          }
          // Snapshot synchronously, then emulate the native menu dismissing handles.
          doc.dispatchEvent(new Event("selectionchange"));
          selection.removeAllRanges();
          window.copyReaderSelection();
          const message = window.__messages.filter((m) => m.type === "copySelection").at(-1);
          const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
          first.dispatchEvent(context);
          return { expected, actual: message?.text, prevented: context.defaultPrevented };
        });
        assert.ok(copied.expected.split(/\s+/).length > 3);
        assert.equal(
          copied.actual,
          copied.expected,
          "Copy preserves the complete multi-paragraph selection",
        );
        assert.equal(copied.prevented, false, "Native context menu is not blocked");
        assert.deepEqual(errors, []);
        console.log(
          `${engine.name()} ${book.file}: native and custom copy preserve full selected text`,
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
