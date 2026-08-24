import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bookJson,
  catalogGenresJson,
  createBookCatalogRouter,
  decodeCatalogCursor,
  encodeCatalogCursor,
  parseBookResolveBody,
  parseBookContentCursor,
  parseLocalBookBody,
  parseLocalMarkupBody,
  parseReaderProgressBody,
  parseSceneAtBody
} from '../book-catalog-api.mjs'

const ID = '123e4567-e89b-42d3-a456-426614174000'

test('genres endpoint contract exposes the fixed bilingual taxonomy', () => {
  const result = catalogGenresJson()
  assert.equal(result.version, 'catalog-genres-v1')
  assert.equal(result.items.length, 20)
  assert.deepEqual(result.items[4], {
    id: 'science-fiction',
    label_ru: 'Научная фантастика',
    label_en: 'Science Fiction',
    order: 4
  })
  assert.equal(new Set(result.items.map(({ id }) => id)).size, 20)
  assert.deepEqual(result.items.map(({ order }) => order), [...Array(20).keys()])
})

test('book catalog router exposes a separate genres endpoint', () => {
  const repository = {
    async listCatalogBooks() {},
    async resolveBook() {},
    async getReaderBookManifest() {},
    async advanceReaderPosition() {}
  }
  const router = createBookCatalogRouter({ repository })
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: layer.route.methods }))
  assert.ok(routes.some(({ path, methods }) => path === '/genres' && methods.get))
})

test('catalog JSON adds normalized genres without changing existing fields', () => {
  const book = {
    resolution: 'catalog', bookEditionId: ID, catalogKey: 'seagull',
    title: 'Чайка', author: 'Антон Чехов', genres: ['drama'], format: 'epub',
    contentSha256: 'a'.repeat(64), generationStatus: 'base_ready', ready: true,
    sourceDownloadPath: `/v2/books/${ID}/source/download`
  }
  const json = bookJson(book)
  assert.deepEqual(json.genres, ['drama'])
  assert.equal(json.book_edition_id, ID)
  assert.equal(json.catalog_key, 'seagull')

  assert.deepEqual(bookJson({ ...book, genres: undefined }).genres, [])
})

test('catalog cursor round-trips without accepting arbitrary input', () => {
  const cursor = { createdAt: '2026-08-10T00:00:00.000Z', id: ID }
  assert.deepEqual(decodeCatalogCursor(encodeCatalogCursor(cursor)), cursor)
  assert.throws(() => decodeCatalogCursor('not-a-cursor'), /cursor: invalid value/)
})

test('book content cursor is optional but bounded', () => {
  assert.equal(parseBookContentCursor(undefined), null)
  assert.equal(parseBookContentCursor('next-page'), 'next-page')
  assert.throws(() => parseBookContentCursor(['cursor']), /cursor/)
  assert.throws(() => parseBookContentCursor('x'.repeat(1025)), /cursor/)
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
    progressFraction: 0.42, textOffset: null, chapterKey: 'chapter-1',
    sectionIndex: null, sectionFraction: null
  })
  assert.deepEqual(parseReaderProgressBody({ text_offset: 42, chapter_key: 'chapter-1' }), {
    progressFraction: null, textOffset: 42, chapterKey: 'chapter-1',
    sectionIndex: null, sectionFraction: null
  })
  assert.deepEqual(parseReaderProgressBody({
    progress_fraction: 0.42,
    section_index: 3,
    section_fraction: 0.25
  }), {
    progressFraction: 0.42, textOffset: null, chapterKey: null,
    sectionIndex: 3, sectionFraction: 0.25
  })
  assert.throws(() => parseReaderProgressBody({}), /exactly one/)
  assert.throws(() => parseReaderProgressBody({ progress_fraction: 1.1 }), /from 0 to 1/)
  assert.throws(() => parseReaderProgressBody({ progress_fraction: 0.1, text_offset: 42 }), /exactly one/)
  assert.throws(() => parseReaderProgressBody({ text_offset: -1 }), /non-negative/)
  assert.throws(() => parseReaderProgressBody({ text_offset: 1.5 }), /safe integer/)
  assert.throws(
    () => parseReaderProgressBody({ progress_fraction: 0.1, section_index: 1 }),
    /provided together/
  )
})

test('scene lookup accepts a canonical position and no client-provided excerpt', () => {
  assert.deepEqual(parseSceneAtBody({ reader_text_offset: 42 }), {
    readerTextOffset: 42,
    progressFraction: null
  })
  assert.deepEqual(parseSceneAtBody({ progress_fraction: 0.42 }), {
    readerTextOffset: null,
    progressFraction: 0.42
  })
  assert.throws(() => parseSceneAtBody({}), /exactly one/)
  assert.throws(
    () => parseSceneAtBody({ reader_text_offset: 42, excerpt: 'client-controlled text' }),
    /unknown field/
  )
})

test('local book registration accepts metadata and rejects source-file fields', () => {
  assert.deepEqual(parseLocalBookBody({
    content_sha256: 'a'.repeat(64),
    title: 'Book',
    author: 'Author',
    format: 'epub'
  }), {
    contentSha256: 'a'.repeat(64),
    title: 'Book',
    author: 'Author',
    format: 'epub'
  })
  assert.throws(() => parseLocalBookBody({
    content_sha256: 'a'.repeat(64), title: 'Book', author: '', format: 'mobi'
  }), /unsupported book format/)
  assert.throws(() => parseLocalBookBody({
    content_sha256: 'a'.repeat(64), title: 'Book', author: '', format: 'epub', bytes: 'leak'
  }), /unknown field/)
})

test('local markup accepts derived profiles but rejects text excerpts', () => {
  const parsed = parseLocalMarkupBody({
    characters: [{
      character_key: 'hero',
      name: 'Hero',
      full_name: 'The Hero',
      first_appearance_fraction: 0.2,
      warmup_fraction: 0.15,
      profile: { role: 'protagonist', unlockProgress: 0.2 }
    }]
  })
  assert.equal(parsed.characters[0].characterKey, 'hero')
  assert.equal(parsed.characters[0].firstAppearanceFraction, 0.2)
  assert.throws(() => parseLocalMarkupBody({
    characters: [{
      character_key: 'hero', name: 'Hero', full_name: 'Hero',
      first_appearance_fraction: 0, warmup_fraction: 0,
      profile: { role: 'hero' }, excerpt: 'source text'
    }]
  }), /unknown field/)
})
