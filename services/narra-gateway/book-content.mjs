const SHA256 = /^[0-9a-f]{64}$/

export const BOOK_CONTENT_CONTRACT_VERSION = 'book-content-v1'
export const BOOK_CONTENT_CHUNK_BYTES = 64 * 1024

function invalidCursor() {
  throw Object.assign(new Error('content cursor: invalid value'), {
    code: 'VALIDATION',
    status: 400
  })
}

export function encodeBookContentCursor({ contentHash, byteOffset }) {
  if (!SHA256.test(contentHash) || !Number.isSafeInteger(byteOffset) || byteOffset < 1) {
    invalidCursor()
  }
  return Buffer.from(JSON.stringify({ v: 1, h: contentHash, o: byteOffset })).toString('base64url')
}

export function decodeBookContentCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (
      parsed?.v !== 1 ||
      !SHA256.test(parsed.h) ||
      !Number.isSafeInteger(parsed.o) ||
      parsed.o < 1 ||
      Object.keys(parsed).some((key) => !['v', 'h', 'o'].includes(key))
    ) {
      invalidCursor()
    }
    return { contentHash: parsed.h, byteOffset: parsed.o }
  } catch (error) {
    if (error?.code === 'VALIDATION') throw error
    invalidCursor()
  }
}

/** Returns the largest prefix no longer than maxBytes that contains whole UTF-8 code points. */
export function utf8ChunkPrefixLength(rawBytes, maxBytes) {
  const bytes = Buffer.from(rawBytes)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive safe integer')
  }
  const limit = Math.min(bytes.byteLength, maxBytes)
  if (limit === bytes.byteLength) return limit
  let boundary = limit
  while (boundary > 0 && (bytes[boundary] & 0xc0) === 0x80) boundary -= 1
  return boundary
}
