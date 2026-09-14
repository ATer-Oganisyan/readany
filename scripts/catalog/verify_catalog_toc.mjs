/** Verify every catalog EPUB through the real extractor and content/toc route. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractStructuredBookText } from '../../services/narra-gateway/books/book-source-text.mjs';
import { createBookCatalogRouter } from '../../services/narra-gateway/catalog/book-catalog-api.mjs';

const [snapshot, directory, output] = process.argv.slice(2);
if (!output) throw Error('Usage: node verify_catalog_toc.mjs snapshot.json books-directory report.json');
const books = JSON.parse(await readFile(snapshot, 'utf8'));
const reviews = JSON.parse(await readFile(new URL('./reviewed-sections.json', import.meta.url), 'utf8'));
const report = { checked: 0, items: 0, recoveredBooks: 0, failures: [], payloads: [] };
for (const book of books) {
  const id = book.book_edition_id;
  try {
    const bytes = await readFile(path.join(directory, `${id}.epub`));
    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    const extracted = await extractStructuredBookText({ bytes, format: 'epub', mimeType: 'application/epub+zip' });
    const byteSize = Buffer.byteLength(extracted.text, 'utf8');
    // Persistence and object storage are fixtures; extraction, service and route are real.
    const router = createBookCatalogRouter({
      repository: {
        async listCatalogBooks() {}, async resolveBook() {}, async getReaderBookManifest() {}, async advanceReaderPosition() {},
        async getReaderBookContent() {
          return { bookEditionId: id, objectKey: 'fixture', contentHash: createHash('sha256').update(extracted.text).digest('hex'),
            sourceContentHash: sourceHash, textLength: extracted.textLength, normalizationVersion: 'normalized-text-v2', navigation: extracted.navigation };
        },
      },
      storage: { async getObjectInfo() { return { byteSize }; } },
    });
    const route = router.stack.find(layer => layer.route?.path === '/:bookEditionId/content/toc').route;
    const payload = await new Promise((resolve, reject) => route.stack[0].handle(
      { params: { bookEditionId: id }, installation: { sub: id } }, { json: resolve }, reject));
    assert.equal(payload.source_content_hash, sourceHash);
    assert.notEqual(payload.source, 'fixed', 'Empty fallback TOC');
    assert.equal(payload.items.length, extracted.navigation.items.length, 'Route dropped chapter entries');
    const keys = new Set();
    for (const [index, item] of payload.items.entries()) {
      assert.ok(item.title.trim(), 'Blank chapter title');
      assert.ok(!/^(?:chapter|глава|section|раздел)$/iu.test(item.title.trim()), 'Contents column leaked into chapters');
      assert.ok(!/[*✱✳✻⁎∗]/u.test(item.title), 'Export stars in chapter title');
      assert.ok(item.reader_href && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(item.reader_href));
      assert.equal(item.anchor_resolved, true, 'Chapter anchor did not resolve');
      assert.ok(item.end_byte_exclusive > item.start_byte && item.end_byte_exclusive <= byteSize);
      assert.ok(item.parent_key === null || keys.has(item.parent_key), 'Parent must precede its children');
      assert.equal(item.key, extracted.navigation.items[index].key, 'Chapter order changed');
      assert.equal(item.reader_href, extracted.navigation.items[index].readerHref);
      keys.add(item.key);
    }
    const repair = reviews[id]?.navigation_repair;
    if (repair) {
      assert.equal(payload.items.length, repair.expected_entries, 'Recovered chapter count differs from reviewed source');
      for (let i = 1; i < payload.items.length; i++) assert.ok(payload.items[i].start_byte >= payload.items[i-1].start_byte);
      report.recoveredBooks++;
    }
    report.items += payload.items.length;
    report.payloads.push(payload);
  } catch (error) { report.failures.push({ id, title: book.title, error: error.message }); }
  report.checked++;
  if (report.checked % 100 === 0) console.log(`Verified TOC ${report.checked}/${books.length}`);
}
await writeFile(output, JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify({ ...report, payloads: undefined }));
if (report.failures.length) process.exitCode = 1;
