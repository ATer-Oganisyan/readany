const LOWERCASE_LETTER_AT_WORD_START = /(^|[^\p{L}\p{M}\p{N}])(\p{Ll})/gu

/**
 * Formats a character name for public display without rewriting source identity data.
 * Only word-start letters are uppercased; existing inner casing stays untouched.
 */
export function formatCharacterDisplayName(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')

  return normalized.replace(
    LOWERCASE_LETTER_AT_WORD_START,
    (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`
  )
}
