import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(
  new URL('./data/catalog-book-genres.json', import.meta.url),
  'utf8'
))

function fail(message) {
  throw new Error(`invalid catalog book genre data: ${message}`)
}

if (!Array.isArray(data.genres) || data.genres.length < 1 || data.genres.length > 20) {
  fail('genres must contain between 1 and 20 items')
}

export const CATALOG_GENRES = Object.freeze(data.genres.map((genre, index) => {
  if (
    !genre || typeof genre.id !== 'string' || !genre.id ||
    typeof genre.labelRu !== 'string' || !genre.labelRu ||
    typeof genre.labelEn !== 'string' || !genre.labelEn ||
    genre.order !== index
  ) {
    fail(`genre at index ${index} is malformed`)
  }
  return Object.freeze({ ...genre })
}))

export const CATALOG_GENRE_IDS = Object.freeze(CATALOG_GENRES.map(({ id }) => id))
const genreIdSet = new Set(CATALOG_GENRE_IDS)

function validatedGenres(value, context) {
  if (!Array.isArray(value) || value.length < 1 || new Set(value).size !== value.length) {
    fail(`${context} must have at least one unique genre`)
  }
  for (const genre of value) {
    if (!genreIdSet.has(genre)) fail(`${context} uses unknown genre ${genre}`)
  }
  return Object.freeze([...value])
}

if (!Array.isArray(data.books) || data.books.length !== 1_500) {
  fail('books must contain all 1500 catalog EPUBs')
}

const bookKeys = new Set()
export const CATALOG_BOOK_GENRES = Object.freeze(data.books.map((book, index) => {
  if (
    !book || typeof book.sourceKey !== 'string' || !book.sourceKey ||
    !['ru', 'en'].includes(book.language) || typeof book.title !== 'string' || !book.title ||
    typeof book.author !== 'string'
  ) {
    fail(`book at index ${index} is malformed`)
  }
  const uniqueKey = `${book.language}:${book.sourceKey}`
  if (bookKeys.has(uniqueKey)) fail(`duplicate book ${uniqueKey}`)
  bookKeys.add(uniqueKey)
  return Object.freeze({
    ...book,
    subjects: book.subjects ? Object.freeze([...book.subjects]) : undefined,
    genres: validatedGenres(book.genres, uniqueKey)
  })
}))

export const CATALOG_GENRE_DATA_VERSION = String(data.version)

const booksBySourceKey = new Map()
for (const book of CATALOG_BOOK_GENRES) {
  const candidates = booksBySourceKey.get(book.sourceKey) ?? []
  candidates.push(book)
  booksBySourceKey.set(book.sourceKey, candidates)
}

const aliasesByCatalogKey = new Map()
for (const alias of data.catalogKeyAliases ?? []) {
  if (!alias || typeof alias.catalogKey !== 'string' || !alias.catalogKey) {
    fail('catalog key alias is malformed')
  }
  if (aliasesByCatalogKey.has(alias.catalogKey)) fail(`duplicate alias ${alias.catalogKey}`)
  if (alias.sourceKey && !booksBySourceKey.has(alias.sourceKey)) {
    fail(`alias ${alias.catalogKey} refers to an unknown source key`)
  }
  aliasesByCatalogKey.set(alias.catalogKey, Object.freeze({
    ...alias,
    genres: alias.genres ? validatedGenres(alias.genres, alias.catalogKey) : undefined
  }))
}

export function normalizeCatalogSourceKey(value) {
  return String(value || '')
    .trim()
    .replace(/^narra-(?:ru|en)-top100-(.+)-[0-9a-f]{8}$/, '$1')
    .replace(/^narra-(?:ru|en)-\d+-/, '')
    .replace(/^eval-v\d+(?:-b\d+)?-/, '')
}

function inferredLanguage(catalogKey) {
  if (/^narra-en-/.test(catalogKey)) return 'en'
  if (/^(?:narra-ru-|eval-)/.test(catalogKey)) return 'ru'
  return null
}

export function genresForCatalogBook({ catalogKey, title = '' }) {
  const normalizedCatalogKey = String(catalogKey || '').trim()
  const alias = aliasesByCatalogKey.get(normalizedCatalogKey)
  if (alias?.genres) return [...alias.genres]

  const sourceKey = alias?.sourceKey ?? normalizeCatalogSourceKey(normalizedCatalogKey)
  const candidates = booksBySourceKey.get(sourceKey) ?? []
  if (candidates.length === 0) return []
  if (candidates.length === 1) return [...candidates[0].genres]

  const normalizedTitle = String(title || '').trim().toLocaleLowerCase()
  const titleMatch = candidates.find((candidate) => (
    candidate.title.toLocaleLowerCase() === normalizedTitle
  ))
  if (titleMatch) return [...titleMatch.genres]

  const language = inferredLanguage(normalizedCatalogKey)
  const languageMatch = candidates.find((candidate) => candidate.language === language)
  return languageMatch ? [...languageMatch.genres] : []
}
