import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const { webkit, chromium } = createRequire(import.meta.url)("playwright");
const template = await readFile(
  new URL("../assets/reader/reader.template.html", import.meta.url),
  "utf8",
);
const baseStyles = template
  .match(/const baseStyles = `([\s\S]*?)`;/)[1]
  .replace(/\$\{fontFamily\}/g, "serif")
  .replace(/\$\{fSize\}/g, "20")
  .replace(/\$\{lh\}/g, "1.5")
  .replace(/\$\{ps\}/g, "16")
  .replace(/\$\{getVerticalWritingCompatibilityStyles\(\)\}/g, "");
const markupCode = template.slice(
  template.indexOf("    var _characterNameSpec = null;"),
  template.indexOf("    // Разметка порциями через setTimeout"),
);

for (const [name, engine] of Object.entries({ webkit, chromium })) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style id="reader-styles">${baseStyles}</style>
      <h1>Анна Каренина</h1><h2>Анна</h2><p>Анна в тексте</p><p><em>Анна</em></p>`);
    await page.addScriptTag({ content: markupCode });
    const results = await page.evaluate(() => {
      window._readanyFindCharacterNameMatches = (text) => {
        const start = text.indexOf("Анна");
        return start < 0 ? [] : [{ start, end: start + 4, characterId: "anna" }];
      };
      const blocks = [...document.querySelectorAll("h1, h2, p")];
      const typography = (element) => {
        const style = getComputedStyle(element);
        return {
          size: style.fontSize,
          line: style.lineHeight,
          weight: style.fontWeight,
          fontStyle: style.fontStyle,
        };
      };
      const before = blocks.map((block) => typography(block.querySelector("em") || block));
      characterNameInjectStyles(document);
      for (const block of blocks) markCharacterNamesInBlock(document, block);
      const marks = [...document.querySelectorAll(".readany-character-name")];
      const after = marks.map(typography);
      const underline = marks.map((mark) => getComputedStyle(mark).textDecorationLine);
      document.querySelector("#reader-styles").textContent = document
        .querySelector("#reader-styles")
        .textContent.replaceAll("20px", "28px");
      return {
        before,
        after,
        underline,
        resized: marks.map(typography),
        parents: marks.map((mark) => typography(mark.parentElement)),
      };
    });
    assert.equal(results.after.length, 4);
    assert.deepEqual(results.after, results.before, `${name}: markup changes typography`);
    assert.ok(results.underline.every((value) => value.includes("underline")));
    assert.deepEqual(
      results.resized,
      results.parents,
      `${name}: font size setting breaks inheritance`,
    );
    console.log(`${name}: heading, paragraph, emphasis, underline and font resizing passed`);
  } finally {
    await browser.close();
  }
}
