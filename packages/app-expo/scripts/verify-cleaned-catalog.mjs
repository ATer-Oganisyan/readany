/** Render representative cleaned catalog books in the real reader browser engine. */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node verify-cleaned-catalog.mjs cleaned/books [screenshots-directory]');
const screenshots = process.argv[3];
if (screenshots) await mkdir(screenshots, { recursive: true });
const cases = [
  ['6ad8ac5d-648b-4783-a6ed-89a585d46068', 'Бригадир', 'сюртуке'],
  ['89e4b0d0-fcff-4b8b-a74b-faf043db3246', 'Сказка о царе Салтане', 'Три девицы под окном'],
  ['57546569-e108-4213-83cb-fc1450fb55e8', 'Герой нашего времени', 'Во всякой книге предисловие'],
  ['f1faebf1-3045-4f5f-b209-4a917cc3618b', 'The Story of My Life', 'HELEN A. KELLER'],
  ['f59bb019-fd4c-4087-87d1-f6ca180b6a19', 'Alcibiades I', 'SOCRATES:'],
];
const html = await readFile(new URL('../assets/reader/reader.html', import.meta.url), 'utf8');
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  for (const [id, title, expected] of cases) {
    const bytes = await readFile(path.join(directory, `${id}.epub`));
    const page = await browser.newPage({ viewport: { width: 393, height: 740 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async ({ base64, expected }) => {
      setThemeColors({ background: '#ffffff', foreground: '#111827' });
      await openBook({ base64, fileName: 'catalog.epub', loadId: 'catalog',
        settings: { fontSize: 20, lineHeight: 1.5, pageMargin: 16, viewMode: 'paginated', paginatedLayout: 'single' } });
      let selected = -1;
      let sections = 0;
      for (let index = 0; index < currentBook.sections.length; index++) {
        const section = currentBook.sections[index];
        if (section.linear === 'no') continue;
        const doc = await section.createDocument();
        const value = doc.body.textContent.replace(/\s+/g, ' ');
        if (/<\/?(?:span|div|br)\b[^>]*>/i.test(value)) throw new Error('Visible export markup');
        if ([...doc.querySelectorAll('a[href]')].some(a => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(a.getAttribute('href')))) throw new Error('External chapter link');
        if (selected === -1 && value.toLowerCase().includes(expected.toLowerCase())) selected = index;
        sections++;
      }
      if (selected < 0) throw new Error(`Author text is missing: ${expected}`);
      await view.renderer.goTo({ index: selected });
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      const rendered = getRendererContents().some(({ doc }) => doc.body.textContent.trim().length > 0);
      await view.next();
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      return { sections, rendered, stillReadable: getRendererContents().some(({ doc }) => doc.body.textContent.trim().length > 0) };
    }, { base64: bytes.toString('base64'), expected });
    assert.ok(result.rendered && result.stillReadable);
    assert.deepEqual(errors, []);
    console.log(`${title}: ${result.sections} reading sections, author text present, render and page turn passed`);
    if (screenshots) await page.screenshot({ path: path.join(screenshots, `${id}.png`) });
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
