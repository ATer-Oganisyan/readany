import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  CATALOG_BOOK_GENRES,
  CATALOG_GENRES,
  CATALOG_GENRE_IDS,
  genresForCatalogBook,
  normalizeCatalogSourceKey
} from '../catalog-book-genres.mjs'

test('hardcoded catalog data covers all RU and EN books with no more than 20 genres', () => {
  assert.equal(CATALOG_GENRES.length, 20)
  assert.equal(new Set(CATALOG_GENRE_IDS).size, CATALOG_GENRE_IDS.length)
  assert.equal(CATALOG_BOOK_GENRES.length, 1_500)
  assert.equal(CATALOG_BOOK_GENRES.filter((book) => book.language === 'ru').length, 500)
  assert.equal(CATALOG_BOOK_GENRES.filter((book) => book.language === 'en').length, 1_000)

  const allowed = new Set(CATALOG_GENRE_IDS)
  for (const book of CATALOG_BOOK_GENRES) {
    assert.ok(book.genres.length >= 1, `${book.language}:${book.sourceKey}`)
    assert.ok(book.genres.every((genre) => allowed.has(genre)), book.sourceKey)
  }
})

test('catalog key normalization resolves bulk, evaluation and legacy aliases', () => {
  assert.equal(normalizeCatalogSourceKey('narra-ru-027-aelita'), 'aelita')
  assert.equal(normalizeCatalogSourceKey('narra-en-0001-a-day-with-keats'), 'a-day-with-keats')
  assert.equal(normalizeCatalogSourceKey('eval-v17-b50-aelita'), 'aelita')
  assert.deepEqual(genresForCatalogBook({ catalogKey: 'narra-ru-027-aelita' }), [
    'science-fiction', 'romance'
  ])
  assert.deepEqual(genresForCatalogBook({
    catalogKey: 'narra-ru-038-kavkazskij-plennik-pushkin'
  }), ['poetry'])
  assert.deepEqual(genresForCatalogBook({ catalogKey: 'seagull' }), ['drama'])
  assert.deepEqual(genresForCatalogBook({ catalogKey: 'not-in-catalog' }), [])
})

test('migration seed is generated from the checked-in catalog table', async () => {
  const data = await readFile(new URL('../data/catalog-book-genres.json', import.meta.url))
  const migration = await readFile(
    new URL('../migrations/016_book_genres.sql', import.meta.url),
    'utf8'
  )
  const checksum = createHash('sha256').update(data).digest('hex')
  assert.match(migration, new RegExp(`catalog_genres_data_sha256: ${checksum}`))
})
