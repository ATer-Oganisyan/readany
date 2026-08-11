import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  extractBookText,
  representativeTextSample,
  representativeTextSelection
} from '../book-source-text.mjs'

test('extractBookText reads EPUB spine order and normalizes markup', async () => {
  const epub = zipSync({
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    'OPS/book.opf': strToU8(
      '<package><manifest><item id="two" href="two.xhtml"/><item id="one" href="one.xhtml"/></manifest>' +
      '<spine><itemref idref="one"/><itemref idref="two"/></spine></package>'
    ),
    'OPS/one.xhtml': strToU8('<html><body><h1>Первая глава</h1><p>Анна вошла.</p></body></html>'),
    'OPS/two.xhtml': strToU8('<html><body><p>Вторая &amp; последняя.</p></body></html>')
  })
  const text = await extractBookText({ bytes: epub, format: 'epub', mimeType: 'application/epub+zip' })
  assert.match(text, /Первая глава\nАнна вошла\./)
  assert.ok(text.indexOf('Первая глава') < text.indexOf('Вторая & последняя.'))
})

test('representativeTextSample keeps beginning, middle and ending within its bound markers', () => {
  const text = 'a'.repeat(10_000) + 'MIDDLE' + 'b'.repeat(10_000) + 'ENDING'
  const sample = representativeTextSample(text, 1_000)
  assert.match(sample, /ФРАГМЕНТ ИЗ СЕРЕДИНЫ/)
  assert.match(sample, /ENDING$/)
  assert.ok(sample.length < 1_200)
  const selection = representativeTextSelection(text, 1_000)
  assert.deepEqual(selection.chunks.map((chunk) => chunk.section), ['beginning', 'middle', 'ending'])
  assert.deepEqual(selection.chunks.map((chunk) => chunk.end - chunk.start), [520, 240, 240])
  assert.equal(selection.chunks[0].start, 0)
  assert.equal(selection.chunks[2].end, text.length)
})
