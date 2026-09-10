import { createHash } from 'node:crypto'

export const BOOK_IDENTITY_VERSION = 'book-identity-v1'

const MAX_IDENTITY_CHARS = 180
const TRAILING_CATALOG_REFERENCE = /(?:\s*\[\s*\d+\s*\])+\s*$/u
const TRAILING_PARENTHESIZED_VOLUME = /\s*\(\s*(?:часть|том)(?!\p{L})[^)]*\)\s*$/iu
const TRAILING_DOTTED_VOLUME = /\s*\.\s*(?:часть|том)(?!\p{L})[\s\S]*$/iu
const TRAILING_AUTHOR_LIFESPAN =
  /\s*\(\s*\d{3,4}\s*[-–—]\s*\d{3,4}\s*(?:гг?\.?)?\s*\)\s*$/iu
const TRAILING_ILLUSTRATOR_CREDIT =
  /\s*,\s*(?:илл\.|иллюстр(?:ации?|атор(?:ы?)?))(?:\s|$)[\s\S]*$/iu

export function normalizeBookIdentityValue(value, maxChars = MAX_IDENTITY_CHARS) {
  if (typeof value !== 'string') return ''
  return Array.from(
    value
      .normalize('NFC')
      .replace(/[\p{Cc}\u200B\u202A-\u202E\u2066-\u2069\uFEFF]+/gu, ' ')
      .replace(/[\p{Z}\s]+/gu, ' ')
      .trim()
  ).slice(0, maxChars).join('')
}

export function normalizeBookDisplayTitle(value) {
  let title = normalizeBookIdentityValue(value)
  while (title) {
    const stripped = title
      .replace(TRAILING_CATALOG_REFERENCE, '')
      .replace(TRAILING_PARENTHESIZED_VOLUME, '')
      .replace(TRAILING_DOTTED_VOLUME, '')
      .trimEnd()
    if (stripped === title) return title
    title = stripped
  }
  return title
}

export function normalizeBookDisplayAuthor(value) {
  return normalizeBookIdentityValue(value)
    .replace(TRAILING_ILLUSTRATOR_CREDIT, '')
    .replace(TRAILING_AUTHOR_LIFESPAN, '')
    .trimEnd()
}

export function normalizeBookDisplayIdentity(input = {}) {
  return {
    title: normalizeBookDisplayTitle(input.title),
    author: normalizeBookDisplayAuthor(input.author)
  }
}

export function bookIdentityTargetVersion({ contentSha256, title, author }) {
  const identityHash = createHash('sha256')
    .update(JSON.stringify({ contentSha256, title, author }))
    .digest('hex')
    .slice(0, 16)
  return `${BOOK_IDENTITY_VERSION}-${identityHash}`
}
