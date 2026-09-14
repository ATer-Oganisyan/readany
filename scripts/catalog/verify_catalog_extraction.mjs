/** Exercise the real server extractor against every cleaned catalog edition. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractStructuredBookText } from '../../services/narra-gateway/books/book-source-text.mjs'
const [snapshotPath, booksDirectory, reportPath] = process.argv.slice(2)
if (!snapshotPath || !booksDirectory || !reportPath) throw new Error('Usage: node verify_catalog_extraction.mjs snapshot.json books-directory report.json')
const books = JSON.parse(await readFile(snapshotPath, 'utf8'))
const results = []
for (const book of books) {
  try {
    const bytes = await readFile(path.join(booksDirectory, `${book.book_edition_id}.epub`))
    const extracted = await extractStructuredBookText({ bytes, format: 'epub', mimeType: 'application/epub+zip' })
    assert.ok(extracted.textLength > 0)
    assert.ok(extracted.sections.length > 0)
    assert.ok(!extracted.sections.some(section => /(?:about\.xhtml|Narra\/source-notices\.xhtml)(?:$|#)/.test(section.key || '')))
    for (const section of extracted.sections) {
      assert.ok(section.endOffset > section.startOffset)
      assert.ok(section.endOffset <= extracted.text.length)
    }
    results.push({ id: book.book_edition_id, title: book.title, textLength: extracted.textLength, sections: extracted.sections.length })
  } catch (error) {
    results.push({ id: book.book_edition_id, title: book.title, error: `${error.code || error.name}: ${error.message}` })
  }
  if (results.length % 100 === 0) console.log(`Extracted ${results.length}/${books.length}`)
}
await writeFile(reportPath, JSON.stringify(results, null, 2)+'\n')
const failures = results.filter(result => result.error)
console.log(JSON.stringify({ checked: results.length, failures }, null, 2))
if (failures.length) process.exitCode = 1
