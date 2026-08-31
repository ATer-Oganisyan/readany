import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { extractEmbeddedBookCover } from '../book-source-cover.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function epub({ cover = PNG, properties = 'cover-image' } = {}) {
  return Buffer.from(zipSync({
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>'
    ),
    'OPS/content.opf': strToU8(
      `<package><manifest><item id="front" href="images/front.png" media-type="image/png" properties="${properties}"/></manifest></package>`
    ),
    'OPS/images/front.png': cover
  }))
}

test('extracts and validates the EPUB cover-image entry', () => {
  const cover = extractEmbeddedBookCover({
    bytes: epub(), format: 'epub', mimeType: 'application/epub+zip'
  })
  assert.equal(cover.mimeType, 'image/png')
  assert.deepEqual(cover.bytes, PNG)
})

test('supports the EPUB 2 meta cover convention', () => {
  const bytes = Buffer.from(zipSync({
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
    ),
    'book.opf': strToU8(
      '<package><metadata><meta name="cover" content="cover-id"/></metadata><manifest><item id="cover-id" href="cover.jpg" media-type="image/jpeg"/></manifest></package>'
    ),
    'cover.jpg': JPEG
  }))
  const cover = extractEmbeddedBookCover({ bytes, format: 'epub' })
  assert.equal(cover.mimeType, 'image/jpeg')
  assert.deepEqual(cover.bytes, JPEG)
})

test('extracts an FB2 coverpage binary', () => {
  const bytes = Buffer.from(
    `<FictionBook><description><title-info><coverpage><image l:href="#cover"/></coverpage></title-info></description><binary id="cover" content-type="image/jpeg">${JPEG.toString('base64')}</binary></FictionBook>`
  )
  const cover = extractEmbeddedBookCover({ bytes, format: 'fb2' })
  assert.equal(cover.mimeType, 'image/jpeg')
  assert.deepEqual(cover.bytes, JPEG)
})

test('rejects missing and non-image embedded cover data', () => {
  assert.equal(extractEmbeddedBookCover({ bytes: epub({ properties: '' }), format: 'epub' }), null)
  assert.equal(extractEmbeddedBookCover({
    bytes: Buffer.from('<FictionBook><coverpage><image href="#cover"/></coverpage><binary id="cover" content-type="image/jpeg">dGV4dA==</binary></FictionBook>'),
    format: 'fb2'
  }), null)
})
