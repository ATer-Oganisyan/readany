const SHA256 = /^[0-9a-f]{64}$/

export const BOOK_CONTENT_CONTRACT_VERSION = 'book-content-v1'
export const BOOK_CONTENT_TOC_CONTRACT_VERSION = 'book-content-toc-v1'
export const BOOK_CONTENT_PAGE_CHARS = 1_800
export const BOOK_CONTENT_CHUNK_PAGES = 50
export const BOOK_CONTENT_CHUNK_CHARS = BOOK_CONTENT_PAGE_CHARS * BOOK_CONTENT_CHUNK_PAGES

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

function validUtf8Prefix(rawBytes) {
  const bytes = Buffer.from(rawBytes)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let trim = 0; trim <= Math.min(3, bytes.byteLength); trim += 1) {
    const end = bytes.byteLength - trim
    try {
      return { bytes: bytes.subarray(0, end), text: decoder.decode(bytes.subarray(0, end)) }
    } catch {
      // A ranged object read can end in the middle of a UTF-8 code point.
    }
  }
  throw Object.assign(new Error('content range does not contain valid UTF-8'), {
    code: 'CONTENT_INVALID',
    status: 500
  })
}

/** Returns at most maxChars UTF-16 code units without splitting a Unicode code point. */
export function utf8CharacterChunk(rawBytes, maxChars) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new TypeError('maxChars must be a positive safe integer')
  }
  const decoded = validUtf8Prefix(rawBytes)
  let end = Math.min(decoded.text.length, maxChars)
  if (
    end > 0 && end < decoded.text.length &&
    /[\uDC00-\uDFFF]/.test(decoded.text[end]) &&
    /[\uD800-\uDBFF]/.test(decoded.text[end - 1])
  ) end -= 1
  const text = decoded.text.slice(0, end)
  return {
    text,
    bytes: Buffer.from(text, 'utf8')
  }
}
