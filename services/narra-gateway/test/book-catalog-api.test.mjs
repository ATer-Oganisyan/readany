import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  parseBookResolveBody,
  parsePrivateUploadBody,
  parseReaderProgressBody
} from '../book-catalog-api.mjs'

const ID = '123e4567-e89b-42d3-a456-426614174000'

test('catalog cursor round-trips without accepting arbitrary input', () => {
  const cursor = { createdAt: '2026-08-10T00:00:00.000Z', id: ID }
  assert.deepEqual(decodeCatalogCursor(encodeCatalogCursor(cursor)), cursor)
  assert.throws(() => decodeCatalogCursor('not-a-cursor'), /cursor: invalid value/)
})

test('resolve contract separates catalog keys from local content hashes', () => {
  assert.deepEqual(parseBookResolveBody({ source: 'catalog', catalog_key: 'anna-karenina' }), {
    source: 'catalog', catalogKey: 'anna-karenina'
  })
  assert.deepEqual(parseBookResolveBody({ source: 'local', content_sha256: 'a'.repeat(64) }), {
    source: 'local', contentSha256: 'a'.repeat(64)
  })
  assert.throws(
    () => parseBookResolveBody({ source: 'local', content_sha256: 'a'.repeat(64), title: 'leak' }),
    /unknown field/
  )
})

test('reader progress contract prefers a fraction but keeps legacy text offsets', () => {
  assert.deepEqual(parseReaderProgressBody({
    progress_fraction: 0.42,
    chapter_key: 'chapter-1'
  }), {
    progressFraction: 0.42, textOffset: null, chapterKey: 'chapter-1'
  })
  assert.deepEqual(parseReaderProgressBody({ text_offset: 42, chapter_key: 'chapter-1' }), {
    progressFraction: null, textOffset: 42, chapterKey: 'chapter-1'
  })
  assert.throws(() => parseReaderProgressBody({}), /exactly one/)
  assert.throws(() => parseReaderProgressBody({ progress_fraction: 1.1 }), /from 0 to 1/)
  assert.throws(() => parseReaderProgressBody({ progress_fraction: 0.1, text_offset: 42 }), /exactly one/)
  assert.throws(() => parseReaderProgressBody({ text_offset: -1 }), /non-negative/)
  assert.throws(() => parseReaderProgressBody({ text_offset: 1.5 }), /safe integer/)
})

test('private upload contract derives MIME type and enforces the size ceiling', () => {
  assert.deepEqual(parsePrivateUploadBody({
    content_sha256: 'a'.repeat(64),
    title: 'Book',
    author: 'Author',
    format: 'epub',
    byte_size: 128
  }), {
    contentSha256: 'a'.repeat(64),
    title: 'Book',
    author: 'Author',
    format: 'epub',
    mimeType: 'application/epub+zip',
    byteSize: 128
  })
  assert.throws(() => parsePrivateUploadBody({
    content_sha256: 'a'.repeat(64), title: 'Book', author: '', format: 'mobi', byte_size: 10
  }), /unsupported book format/)
  assert.throws(() => parsePrivateUploadBody({
    content_sha256: 'a'.repeat(64), title: 'Book', author: '', format: 'epub', byte_size: 129
  }, 128), /expected 1-128/)
})
