const BASE_LANGUAGE = /^[a-z]{2,3}$/
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/

export const CATALOG_BOOK_LANGUAGES = Object.freeze(['ru', 'en'])

export function normalizeBookLanguage(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) return null
  const normalized = value.trim().toLowerCase().replaceAll('_', '-')
  if (!LANGUAGE_TAG.test(normalized)) return null
  const base = normalized.split('-', 1)[0]
  return BASE_LANGUAGE.test(base) ? base : null
}

export function isCatalogBookLanguage(value) {
  return CATALOG_BOOK_LANGUAGES.includes(value)
}
