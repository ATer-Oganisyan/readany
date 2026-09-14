/** Resolve every recovered chapter and navigate representative anchors in the real reader. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [directory, reportPath, output] = process.argv.slice(2);
if (!output) throw Error('Usage: node verify-recovered-toc.mjs books toc.json output.json');
const reviews = JSON.parse(await readFile(new URL('../../../scripts/catalog/reviewed-sections.json', import.meta.url)));
const report = JSON.parse(await readFile(reportPath));
const html = await readFile(new URL('../assets/reader/reader.html', import.meta.url));
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const results = [];
try {
  browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}: {})});
  for (const payload of report.payloads.filter(p => reviews[p.book_edition_id]?.navigation_repair)) {
    const bytes = await readFile(path.join(directory, payload.book_edition_id+'.epub'));
    const page = await browser.newPage({viewport:{width:393,height:740}});
    await page.addInitScript(() => { window.ReactNativeWebView = {postMessage(){}}; });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async ({base64,items}) => {
      setThemeColors({background:'#ffffff',foreground:'#111827'});
      await openBook({base64,fileName:'catalog.epub',loadId:'catalog',settings:{fontSize:20,lineHeight:1.5,pageMargin:16,viewMode:'paginated',paginatedLayout:'single'}});
      const docs = new Map();
      for (const item of items) {
        const target = currentBook.resolveHref(item.reader_href);
        if (!target || target.index < 0) throw Error('Unresolved href '+item.reader_href);
        if (!docs.has(target.index)) docs.set(target.index, await currentBook.sections[target.index].createDocument());
        if (!target.anchor(docs.get(target.index))) throw Error('Missing anchor '+item.reader_href);
      }
      let navigated = 0;
      for (const index of new Set([0,Math.floor(items.length/2),items.length-1])) {
        await view.goTo(items[index].reader_href);
        for (let tick=0;tick<6;tick++) await new Promise(requestAnimationFrame);
        const fragment = decodeURIComponent(items[index].reader_href.split('#')[1]);
        if (!getRendererContents().some(({doc}) => doc.getElementById(fragment))) throw Error('Target chapter not rendered');
        navigated++;
      }
      return {resolved:items.length,navigated};
    }, {base64:bytes.toString('base64'),items:payload.items});
    assert.equal(result.resolved, reviews[payload.book_edition_id].navigation_repair.expected_entries);
    results.push({id:payload.book_edition_id,...result});
    await page.close();
  }
  assert.equal(results.length,14);
  await writeFile(output,JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({books:results.length,resolved:results.reduce((n,r)=>n+r.resolved,0),navigated:results.reduce((n,r)=>n+r.navigated,0)}));
} finally { await browser?.close(); server.close(); }
