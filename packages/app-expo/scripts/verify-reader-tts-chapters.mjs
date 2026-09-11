/** Real browser DOM extraction; no speech provider, native player or backend calls. */
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
try {
  for (const engine of [webkit, chromium]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await page.evaluate(async () => {
        // Only book navigation and CFI encoding are faked; DOM ranges, sentence
        // extraction, document boundaries and the production chapter loop are real.
        const sources = [
          '<p>Before chapter.</p><p id="start">First sentence. Second sentence.</p>',
          "<p>Third sentence.</p>",
          '<p>Fourth sentence.</p><p id="next">Next chapter.</p>',
        ];
        currentBook = {
          sections: sources.map((source, index) => ({
            href: `${index}.xhtml`,
            createDocument: async () =>
              new DOMParser().parseFromString(
                `<html lang="en"><body>${source}</body></html>`,
                "text/html",
              ),
          })),
        };
        view = {
          getCFI: (index, range) => `${index}:${range.toString()}`,
          resolveNavigation: (href) => {
            const [file, id] = href.split("#");
            return {
              index: Number.parseInt(file, 10),
              ...(id ? { anchor: (doc) => doc.getElementById(id) } : {}),
            };
          },
        };
        const extract = async (start, end, count = 100) =>
          (await getChapterTTSSegmentsFromBook(start, end, count)).map((segment) => segment.text);
        return {
          sameDocument: await extract("0.xhtml", "0.xhtml#start"),
          acrossDocuments: await extract("0.xhtml#start", "2.xhtml#next"),
          nextDocumentStart: await extract("0.xhtml#start", "2.xhtml"),
          limited: await extract("0.xhtml#start", "2.xhtml#next", 2),
          lastChapter: await extract("0.xhtml#start", null),
          unknownStart: await extract("99.xhtml", null),
          backwardsEnd: await extract("2.xhtml", "0.xhtml"),
          zeroCount: await extract("0.xhtml#start", "2.xhtml#next", 0),
        };
      });
      assert.deepEqual(result.sameDocument, ["Before chapter."]);
      assert.deepEqual(result.acrossDocuments, [
        "First sentence.",
        "Second sentence.",
        "Third sentence.",
        "Fourth sentence.",
      ]);
      assert.deepEqual(result.nextDocumentStart, [
        "First sentence.",
        "Second sentence.",
        "Third sentence.",
      ]);
      assert.deepEqual(result.limited, ["First sentence.", "Second sentence."]);
      assert.deepEqual(result.lastChapter, [
        "First sentence.",
        "Second sentence.",
        "Third sentence.",
        "Fourth sentence.",
        "Next chapter.",
      ]);
      assert.deepEqual(result.unknownStart, []);
      assert.deepEqual(result.backwardsEnd, []);
      assert.deepEqual(result.zeroCount, []);
      console.log(`${engine.name()}: 8 chapter extraction scenarios passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
