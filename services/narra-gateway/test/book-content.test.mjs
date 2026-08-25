import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_CONTENT_CHUNK_CHARS,
  decodeBookContentCursor,
  encodeBookContentCursor,
  utf8CharacterChunk,
  utf8ChunkPrefixLength
} from '../book-content.mjs'

const HASH = 'a'.repeat(64)

test('book content cursor keeps the content version and next byte offset', () => {
  const cursor = encodeBookContentCursor({ contentHash: HASH, byteOffset: 42 })
  assert.deepEqual(decodeBookContentCursor(cursor), {
    contentHash: HASH,
    byteOffset: 42
  })
  assert.throws(() => decodeBookContentCursor('not-a-cursor'), /cursor/)
})

test('reader chunks never split a UTF-8 code point', () => {
  const bytes = Buffer.from('абв')
  const prefixLength = utf8ChunkPrefixLength(bytes, 5)
  assert.equal(prefixLength, 4)
  assert.equal(bytes.subarray(0, prefixLength).toString('utf8'), 'аб')
})

test('reader chunks use fifty conventional pages and preserve Unicode boundaries', () => {
  assert.equal(BOOK_CONTENT_CHUNK_CHARS, 90_000)
  const chunk = utf8CharacterChunk(Buffer.from('а😀б'), 2)
  assert.equal(chunk.text, 'а')
  assert.equal(chunk.bytes.toString('utf8'), 'а')
})
