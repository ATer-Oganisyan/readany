import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  extractBookText,
  extractStructuredBookText,
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

test('structured EPUB extraction preserves spine sections and absolute offsets', async () => {
  const epub = zipSync({
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    'OPS/book.opf': strToU8(
      '<package><manifest><item id="cover" href="cover.xhtml"/><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest>' +
      '<spine><itemref idref="cover"/><itemref idref="one"/><itemref idref="two"/></spine></package>'
    ),
    'OPS/cover.xhtml': strToU8('<html><body><img src="cover.jpg"/></body></html>'),
    'OPS/one.xhtml': strToU8('<html><body><h1>Глава первая</h1><p>Первый текст.</p></body></html>'),
    'OPS/two.xhtml': strToU8('<html><body><h2>Глава вторая</h2><p>Второй текст.</p></body></html>')
  })
  const structured = await extractStructuredBookText({
    bytes: epub,
    format: 'epub',
    mimeType: 'application/epub+zip'
  })
  assert.equal(structured.textLength, structured.text.length)
  assert.equal(structured.sections.length, 2)
  assert.deepEqual(structured.sections.map(({ sourceIndex }) => sourceIndex), [1, 2])
  assert.equal(structured.sections[0].startOffset, 0)
  assert.equal(structured.sections[0].endOffset, structured.sections[1].startOffset)
  assert.equal(structured.sections[1].endOffset, structured.textLength)
  for (const section of structured.sections) {
    assert.ok(structured.text.slice(section.startOffset, section.endOffset).length > 0)
  }
  assert.deepEqual(structured.sections.map(({ title }) => title), [
    'Глава первая',
    'Глава вторая'
  ])
  assert.equal(structured.navigation.source, 'fixed')
  assert.equal(structured.navigation.segments.length, 1)
  assert.equal(structured.navigation.segments[0].endByte, Buffer.byteLength(structured.text, 'utf8'))
})

test('EPUB 3 navigation anchors become reader chapter boundaries', async () => {
  const epub = zipSync({
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    'OPS/book.opf': strToU8(
      '<package version="3.0"><manifest>' +
      '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>' +
      '<item id="book" href="book.xhtml" media-type="application/xhtml+xml"/>' +
      '</manifest><spine><itemref idref="book"/></spine></package>'
    ),
    'OPS/nav.xhtml': strToU8(
      '<html xmlns:epub="http://www.idpf.org/2007/ops"><body>' +
      '<nav epub:type="toc"><ol>' +
      '<li><a href="book.xhtml#one">Chapter One</a></li>' +
      '<li><a href="book.xhtml#two">Chapter Two</a></li>' +
      '</ol></nav></body></html>'
    ),
    'OPS/book.xhtml': strToU8(
      '<html><body><h1 id="one">Chapter One</h1><p>Alpha.</p>' +
      '<h1 id="two">Chapter Two</h1><p>Beta.</p></body></html>'
    )
  })
  const structured = await extractStructuredBookText({
    bytes: epub, format: 'epub', mimeType: 'application/epub+zip'
  })
  assert.equal(structured.navigation.source, 'nav')
  assert.deepEqual(structured.navigation.items.map(({ title }) => title), [
    'Chapter One', 'Chapter Two'
  ])
  assert.equal(structured.navigation.segments.length, 2)
  assert.match(structured.text.slice(
    structured.navigation.segments[1].startOffset,
    structured.navigation.segments[1].endOffset
  ), /^Chapter Two/)
  assert.equal(structured.navigation.segments[0].startByte, 0)
  assert.equal(
    structured.navigation.segments.at(-1).endByte,
    Buffer.byteLength(structured.text, 'utf8')
  )
})

test('EPUB 2 NCX anchors become reader chapter boundaries', async () => {
  const epub = zipSync({
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    'OPS/book.opf': strToU8(
      '<package version="2.0"><manifest>' +
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
      '<item id="book" href="book.xhtml" media-type="application/xhtml+xml"/>' +
      '</manifest><spine toc="ncx"><itemref idref="book"/></spine></package>'
    ),
    'OPS/toc.ncx': strToU8(
      '<ncx><navMap>' +
      '<navPoint><navLabel><text>One</text></navLabel><content src="book.xhtml#one"/></navPoint>' +
      '<navPoint><navLabel><text>Two</text></navLabel><content src="book.xhtml#two"/></navPoint>' +
      '</navMap></ncx>'
    ),
    'OPS/book.xhtml': strToU8(
      '<html><body><h1 id="one">One</h1><p>Alpha.</p>' +
      '<h1 id="two">Two</h1><p>Beta.</p></body></html>'
    )
  })
  const structured = await extractStructuredBookText({
    bytes: epub, format: 'epub', mimeType: 'application/epub+zip'
  })
  assert.equal(structured.navigation.source, 'ncx')
  assert.deepEqual(structured.navigation.items.map(({ title }) => title), ['One', 'Two'])
  assert.match(structured.text.slice(structured.navigation.segments[1].startOffset), /^Two/)
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

test('structured TXT extraction builds a contiguous chapter skeleton without changing text', async () => {
  const source = [
    'Предисловие.',
    '',
    'Глава 1. Встреча',
    '',
    'Анна вошла в комнату.',
    '',
    'Глава II',
    '',
    'Борис ответил ей.'
  ].join('\n')
  const structured = await extractStructuredBookText({
    bytes: Buffer.from(source),
    format: 'txt',
    mimeType: 'text/plain'
  })
  assert.equal(structured.text, source)
  assert.equal(structured.sections.length, 3)
  assert.equal(structured.sections[0].startOffset, 0)
  assert.equal(structured.sections.at(-1).endOffset, source.length)
  assert.deepEqual(structured.sections.slice(1).map(({ title }) => title), [
    'Глава 1. Встреча',
    'Глава II'
  ])
  assert.equal(structured.navigation.source, 'fixed')
  assert.equal(structured.navigation.segments.length, 1)
  for (let index = 1; index < structured.sections.length; index += 1) {
    assert.equal(
      structured.sections[index - 1].endOffset,
      structured.sections[index].startOffset
    )
  }
})

test('structured TXT extraction recognizes English paratext and decorated chapter headings', async () => {
  const source = [
    'PRIDE AND PREJUDICE',
    '',
    'PREFACE.',
    '',
    'Critical discussion of another Austen novel.',
    '',
    'Chapter I.]',
    '',
    'It is a truth universally acknowledged.',
    '',
    'CHAPTER II.',
    '',
    'Mr. Bennet was among the earliest of those who waited on Mr. Bingley.'
  ].join('\n')
  const structured = await extractStructuredBookText({
    bytes: Buffer.from(source),
    format: 'txt',
    mimeType: 'text/plain'
  })
  assert.equal(structured.text, source)
  assert.deepEqual(structured.sections.slice(1).map(({ title }) => title), [
    'PREFACE.',
    'Chapter I.]',
    'CHAPTER II.'
  ])
  for (let index = 1; index < structured.sections.length; index += 1) {
    assert.equal(structured.sections[index - 1].endOffset, structured.sections[index].startOffset)
  }
})

test('structured TXT extraction does not treat prose beginning with introduction as a heading', async () => {
  const source = [
    'PREFACE.',
    '',
    'Editorial text.',
    '',
    'Chapter I.]',
    '',
    'The introduction at Rosings had already been made.',
    '',
    'CHAPTER II.',
    '',
    'The story continues.'
  ].join('\n')
  const structured = await extractStructuredBookText({
    bytes: Buffer.from(source),
    format: 'txt',
    mimeType: 'text/plain'
  })
  assert.deepEqual(structured.sections.slice(1).map(({ title }) => title), [
    'Chapter I.]',
    'CHAPTER II.'
  ])
})
