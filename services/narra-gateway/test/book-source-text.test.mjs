import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  extractBookText,
  extractStructuredBookText,
  representativeTextSample,
  representativeTextSelection
} from '../books/book-source-text.mjs'

function encodeWindows1251(value) {
  return Buffer.from([...value].map((symbol) => {
    const codePoint = symbol.codePointAt(0)
    if (codePoint <= 0x7f) return codePoint
    if (codePoint >= 0x0410 && codePoint <= 0x042f) return 0xc0 + codePoint - 0x0410
    if (codePoint >= 0x0430 && codePoint <= 0x044f) return 0xe0 + codePoint - 0x0430
    if (codePoint === 0x0401) return 0xa8
    if (codePoint === 0x0451) return 0xb8
    throw new Error(`test character is not representable in Windows-1251: ${symbol}`)
  }))
}

const russianTxt = 'Мастер и Маргарита\nМихаил Булгаков\n\nГлава 1\n' +
  'Он вошёл в комнату и увидел, что на столе лежит книга. Это был её подарок.\n\n' +
  'Глава 2\nОна взяла книгу и пошла к окну, но он остался у двери.';

test('TXT detects Russian Windows-1251 without changing the source or section offsets', async () => {
  const bytes = encodeWindows1251(russianTxt);
  const original = Buffer.from(bytes);
  const result = await extractStructuredBookText({ bytes, format: 'txt' });
  assert.equal(result.text, russianTxt);
  assert.deepEqual(bytes, original);
  assert.equal(result.sections.length, 3);
  assert.equal(result.sections.at(-1).endOffset, russianTxt.length);
  assert.doesNotMatch(result.text, /[\u4e00-\u9fff\uFFFD]/);
});

test('TXT preserves UTF-8, including Russian, Chinese, Japanese and ASCII', async () => {
  for (const text of [russianTxt, '第一章\n这是一本中文小说。', '第一章\nこれは日本語の本です。', 'Chapter 1\nAn English book.']) {
    assert.equal(await extractBookText({ bytes: Buffer.from(text), format: 'txt' }), text);
  }
});

test('TXT honors Unicode BOMs before legacy encoding detection', async () => {
  const littleEndian = Buffer.from(russianTxt, 'utf16le');
  for (const bytes of [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(russianTxt)]),
    Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian]),
    Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(littleEndian).swap16()])
  ]) {
    assert.equal(await extractBookText({ bytes, format: 'txt' }), russianTxt);
  }
});

test('TXT does not reinterpret malformed marked UTF-8 as Windows-1251', async () => {
  await assert.rejects(extractBookText({
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encodeWindows1251(russianTxt)]),
    format: 'txt'
  }), { code: 'BOOK_TEXT_INVALID' });
});

test('TXT does not guess Windows-1251 for Chinese GBK or arbitrary high bytes', async () => {
  for (const bytes of [
    Buffer.from('d5e2cac7d2bbb1bed6d0cec4d0a1cbb5a3acced2c3c7d4dab6c1cae9a3ac', 'hex'),
    Buffer.alloc(100, 0xff)
  ]) {
    await assert.rejects(extractBookText({ bytes, format: 'txt' }), { code: 'BOOK_TEXT_INVALID' });
  }
});

test('FB2 extraction removes embedded binary payloads before text normalization', async () => {
  const payload = 'A'.repeat(12_000)
  const source = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<FictionBook>',
    '<description><title-info><book-title>Тестовая книга</book-title></title-info></description>',
    '<body><section><title><p>Глава первая</p></title><p>Анна вошла.</p></section></body>',
    `<binary id="cover" content-type="image/jpeg">${payload}</binary>`,
    '</FictionBook>'
  ].join('')

  const structured = await extractStructuredBookText({
    bytes: Buffer.from(source, 'utf8'),
    format: 'fb2',
    mimeType: 'application/x-fictionbook+xml'
  })

  assert.match(structured.text, /Тестовая книга/)
  assert.match(structured.text, /Анна вошла\./)
  assert.doesNotMatch(structured.text, /A{100}/)
  assert.ok(structured.textLength < 1_000)
})

test('FB2 extraction honors a Windows-1251 XML declaration', async () => {
  const source = [
    '<?xml version="1.0" encoding="windows-1251"?>',
    '<FictionBook>',
    '<description><title-info><book-title>Наследие</book-title>',
    '<author><first-name>Стивен</first-name><last-name>Сэвил</last-name></author>',
    '</title-info></description>',
    '<body><section><title><p>Глава первая</p></title><p>Иван вошёл.</p></section></body>',
    '</FictionBook>'
  ].join('')

  const structured = await extractStructuredBookText({
    bytes: encodeWindows1251(source),
    format: 'fb2',
    mimeType: 'application/x-fictionbook+xml'
  })

  assert.match(structured.text, /Наследие/)
  assert.match(structured.text, /Стивен/)
  assert.match(structured.text, /Сэвил/)
  assert.match(structured.text, /Иван вошёл\./)
  assert.doesNotMatch(structured.text, /\uFFFD/)
})

test('text extraction rejects replacement-heavy corrupted input before analysis', async () => {
  await assert.rejects(
    extractStructuredBookText({
      bytes: Buffer.from(`Глава\n${'\uFFFD'.repeat(20)} повреждённый текст`, 'utf8'),
      format: 'txt',
      mimeType: 'text/plain'
    }),
    (error) => error.code === 'BOOK_TEXT_INVALID'
  )
})

test('text extraction rejects an unremoved binary-like payload before analysis', async () => {
  await assert.rejects(
    extractStructuredBookText({
      bytes: Buffer.from(`Глава\n${'A'.repeat(8_192)}`, 'utf8'),
      format: 'txt',
      mimeType: 'text/plain'
    }),
    (error) => error.code === 'BOOK_TEXT_INVALID'
  )
})

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

test('FB2 honors UTF-16 byte order marks before the XML declaration', async () => {
  const text = '<?xml version="1.0" encoding="UTF-16"?><FictionBook><body><section><p>Иван вошёл в дом.</p></section></body></FictionBook>'
  for (const little of [true, false]) {
    const content = Buffer.from(text, 'utf16le')
    const bytes = Buffer.concat([Buffer.from(little ? [0xff, 0xfe] : [0xfe, 0xff]), little ? content : content.swap16()])
    assert.match(await extractBookText({ bytes, format: 'fb2' }), /Иван вошёл в дом\./)
  }
})

test('FBZ extracts the actual FB2 entry, ignoring folders and archive metadata', async () => {
  const xml = '<?xml version="1.0" encoding="windows-1251"?><FictionBook><body><section><p>Иван вошёл в дом.</p></section></body></FictionBook>'
  const bytes = zipSync({
    'books/': new Uint8Array(),
    '__MACOSX/._BOOK.FB2': strToU8('metadata'),
    'books/BOOK.FB2': encodeWindows1251(xml)
  })
  const result = await extractStructuredBookText({ bytes, format: 'fbz', mimeType: 'application/zip' })
  assert.match(result.text, /Иван вошёл в дом\./)
  assert.equal(result.sections.at(-1).endOffset, result.textLength)
})

test('FBZ rejects malformed, empty, ambiguous and oversized archives', async () => {
  for (const bytes of [Buffer.from('broken'), zipSync({ 'cover.jpg': strToU8('image') }), zipSync({
    'a.fb2': strToU8('<FictionBook/>'), 'b.fb2': strToU8('<FictionBook/>')
  })]) {
    await assert.rejects(extractBookText({ bytes, format: 'fbz' }), { code: 'BOOK_PARSE_FAILED' })
  }
  const bytes = zipSync({ 'book.fb2': strToU8('small') }, { level: 0 })
  const central = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  new DataView(bytes.buffer).setUint32(central + 24, 65 * 1024 * 1024, true)
  await assert.rejects(extractBookText({ bytes, format: 'fbz' }), { code: 'BOOK_TOO_LARGE' })
})

test('PDF extraction cancels before starting a subprocess', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled import'))
  await assert.rejects(extractBookText({ bytes: Buffer.from('%PDF-1.4'), format: 'pdf', signal: controller.signal }), /cancelled import/)
})

function pdfFixture(content) {
  const stream = content ? `BT /F1 12 Tf 72 720 Td (${content}) Tj ET` : ''
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

// The production worker includes poppler-utils. No parser mock is used here.
const { spawnSync } = await import('node:child_process')
const hasPdfToText = spawnSync('pdftotext', ['-v']).status === 0

test('PDF extracts real page text and rejects a PDF without a text layer', { skip: !hasPdfToText }, async () => {
  const result = await extractStructuredBookText({ bytes: pdfFixture('Hello Narra reader'), format: 'pdf' })
  assert.equal(result.text, 'Hello Narra reader')
  assert.equal(result.sections.at(-1).endOffset, result.textLength)
  await assert.rejects(extractBookText({ bytes: pdfFixture(''), format: 'pdf' }), { code: 'BOOK_PARSE_FAILED' })
})

test('a PDF parser closing its input early does not crash the worker', { skip: !hasPdfToText }, async () => {
  await assert.rejects(extractBookText({ bytes: Buffer.alloc(2 * 1024 * 1024, 'x'), format: 'pdf' }), { code: 'BOOK_PARSE_FAILED' })
  assert.equal(await extractBookText({ bytes: pdfFixture('Still running'), format: 'pdf' }), 'Still running')
})

test('EPUB with namespace-prefixed package tags retains spine order for markup', async () => {
  const bytes = zipSync({
    'META-INF/container.xml': strToU8('<c:container xmlns:c="urn:oasis:names:tc:opendocument:xmlns:container"><c:rootfiles><c:rootfile full-path="OPS/book.opf"/></c:rootfiles></c:container>'),
    'OPS/book.opf': strToU8('<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="z" href="z.xhtml"/><opf:item id="a" href="a.xhtml"/></opf:manifest><opf:spine><opf:itemref idref="z"/><opf:itemref idref="a"/></opf:spine></opf:package>'),
    'OPS/a.xhtml': strToU8('<p>The last chapter.</p>'),
    'OPS/z.xhtml': strToU8('<p>The first chapter.</p>')
  })
  const result = await extractStructuredBookText({ bytes, format: 'epub' })
  assert.equal(result.text, 'The first chapter.\n\nThe last chapter.')
  assert.deepEqual(result.sections.map(({ key }) => key), ['epub:OPS/z.xhtml', 'epub:OPS/a.xhtml'])
})

function dualNavigationEpub(navLinks, ncxLinks) {
  return zipSync({
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>'),
    'OPS/content.opf': strToU8('<package><manifest>' +
      '<item id="nav" href="nav/nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>' +
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
      '<item id="one" href="text/one.xhtml"/><item id="two" href="text/two.xhtml"/>' +
      '</manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    'OPS/nav/nav.xhtml': strToU8('<html><body><nav epub:type="toc"><ol>' + navLinks + '</ol></nav></body></html>'),
    'OPS/toc.ncx': strToU8('<ncx><navMap>' + ncxLinks.map(([title, href]) =>
      `<navPoint><navLabel><text>${title}</text></navLabel><content src="${href}"/></navPoint>`).join('') + '</navMap></ncx>'),
    'OPS/text/one.xhtml': strToU8('<html><body><h1 id="one">One</h1><p>First chapter.</p><h2 id="sub">Subchapter</h2><p>More text.</p></body></html>'),
    'OPS/text/two.xhtml': strToU8('<html><body><h1>Two</h1><p>Second chapter.</p></body></html>'),
  })
}

const sparseNav = '<li><a href="../text/one.xhtml">Текст</a></li>'

test('EPUB selects complete NCX over abbreviated NAV without changing text or source sections', async () => {
  const abbreviated = await extractStructuredBookText({ format: 'epub', bytes: dualNavigationEpub(sparseNav, []) })
  const complete = await extractStructuredBookText({ format: 'epub', bytes: dualNavigationEpub(sparseNav, [
    ['One', 'text/one.xhtml'], ['Two', 'text/two.xhtml']
  ]) })
  assert.equal(complete.navigation.source, 'ncx')
  assert.equal(complete.navigation.selectionVersion, 2)
  assert.equal(complete.text, abbreviated.text)
  assert.deepEqual(complete.sections, abbreviated.sections)
  assert.deepEqual(complete.navigation.items.map(i => [i.title, i.readerHref]), [
    ['One', 'OPS/text/one.xhtml'], ['Two', 'OPS/text/two.xhtml']
  ])
  assert.equal(complete.navigation.segments.length, 2)
})

test('EPUB keeps complete hierarchical NAV when NCX has fewer destinations', async () => {
  const result = await extractStructuredBookText({ format: 'epub', bytes: dualNavigationEpub(
    '<li><a href="../text/one.xhtml">One</a><ol><li><a href="../text/one.xhtml#sub">Subchapter</a></li></ol></li>' +
    '<li><a href="../text/two.xhtml">Two</a></li>', [['One', 'text/one.xhtml']]
  ) })
  assert.equal(result.navigation.source, 'nav')
  assert.equal(result.navigation.items[1].parentKey, result.navigation.items[0].key)
  assert.equal(result.navigation.items[1].readerHref, 'OPS/text/one.xhtml#sub')
  assert.equal(result.navigation.items[1].anchorResolved, true)
})

test('EPUB does not mistake duplicate, missing-file or broken-anchor NCX entries for more chapters', async () => {
  const result = await extractStructuredBookText({ format: 'epub', bytes: dualNavigationEpub(sparseNav, [
    ['One', 'text/one.xhtml'], ['Duplicate', 'text/one.xhtml'],
    ['Missing file', 'missing.xhtml'], ['Missing anchor', 'text/two.xhtml#missing']
  ]) })
  assert.equal(result.navigation.source, 'nav')
  assert.equal(result.navigation.items.length, 1)
})

test('EPUB does not replace NAV with a longer NCX that omits an existing chapter', async () => {
  const result = await extractStructuredBookText({ format: 'epub', bytes: dualNavigationEpub(
    '<li><a href="../text/two.xhtml">Two</a></li>', [
      ['One', 'text/one.xhtml'], ['Subchapter', 'text/one.xhtml#sub']
    ]
  ) })
  assert.equal(result.navigation.source, 'nav')
})


test('EPUB excludes non-linear publisher notices from markup and never falls back to them', async () => {
  for (const onlyNotices of [false, true]) for (const prefix of ['', 'opf:']) {
    const markup = '<package><manifest><item id="story" href="story.xhtml"/><item id="notice" href="notice.xhtml"/></manifest><spine>' +
      (onlyNotices ? '' : '<itemref idref="story"/>') +
      '<itemref idref="notice" linear="no"/></spine></package>'
    const epub = zipSync({
      'book.opf': strToU8(markup.replace(/<(\/?)(package|manifest|item|itemref|spine)\b/g, `<$1${prefix}$2`)),
      'story.xhtml': strToU8('<html><body><h1>Действие первое</h1><p>Бригадир, в сюртуке, ходит и курит табак.</p></body></html>'),
      'notice.xhtml': strToU8('<html><body><p>Экспортировано из Викитеки. Служебное пояснение.</p></body></html>')
    })
    if (onlyNotices) {
      await assert.rejects(extractBookText({ bytes: epub, format: 'epub' }), { code: 'BOOK_PARSE_FAILED' })
    } else {
      const result = await extractBookText({ bytes: epub, format: 'epub' })
      assert.match(result, /Бригадир, в сюртуке/)
      assert.doesNotMatch(result, /Викитеки|Служебное пояснение/)
    }
  }
})
