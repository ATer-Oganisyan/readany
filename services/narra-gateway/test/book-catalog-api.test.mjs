import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_CATALOG_LANGUAGE_CONTRACT_VERSION,
  bookIdentityJson,
  bookJson,
  catalogGenresJson,
  createBookCatalogRouter,
  decodeCatalogCursor,
  decodeLanguageCatalogCursor,
  encodeCatalogCursor,
  encodeLanguageCatalogCursor,
  parseBookResolveBody,
  parseBookContentCursor,
  parseCatalogLanguage,
  parseLocalBookBody,
  parseLocalMarkupBody,
  parseReaderProgressBody,
  parseSceneAtBody,
  manifestJson,
  ttsSectionJson
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
  assert.ok(routes.some(({ path, methods }) => path === '/catalog/languages/:language' && methods.get))
  assert.ok(routes.some(({ path, methods }) => path === '/:bookEditionId/identity' && methods.get))
  assert.ok(routes.some(({ path, methods }) =>
    path === '/:bookEditionId/content/toc' && methods.get))
  assert.ok(routes.some(({ path, methods }) =>
    path === '/:bookEditionId/tts-script/sections/:sectionIndex' && methods.get))
})

test('manifest polling exposes additive TTS markup state without changing book markup', () => {
  const json = manifestJson({
    source: 'v3', book: {}, availability: 'ready', readerTextOffset: 0,
    readingFraction: 0, markup: null, characters: [],
    ttsMarkup: {
      status: 'processing', version: 'book-tts-script-v1', revision: null,
      retryAfterMs: 10_000
    }
  })
  assert.deepEqual(json.tts_markup, {
    status: 'processing', version: 'book-tts-script-v1', revision: null,
    retry_after_ms: 10_000
  })
})

test('TTS section JSON carries exact source ranges and canonical character keys', () => {
  const result = ttsSectionJson({
    status: 'ready', version: 'book-tts-script-v1', revision: 2,
    normalizedTextHash: 'a'.repeat(64),
    section: {
      key: 'chapter-1', title: 'Глава 1', index: 0, startOffset: 0, endOffset: 6,
      segments: [{
        id: 'tts:0:0', startOffset: 0, endOffset: 6, text: 'Привет',
        kind: 'speech', characterKey: 'character:ivan', confidence: 0.95
      }]
    }
  })
  assert.equal(result.contract_version, 'book-tts-script-v1')
  assert.equal(result.section.segments[0].character_key, 'character:ivan')
  assert.equal(result.section.segments[0].start_offset, 0)
})

test('language catalog endpoint returns its versioned filtered protocol', async () => {
  const repository = {
    async listCatalogBooks(input) {
      assert.equal(input.language, 'en')
      return {
        items: [{
          id: ID,
          scope: 'catalog',
          catalogKey: 'narra-en-example',
          contentSha256: 'a'.repeat(64),
          title: 'Example',
          author: 'Author',
          genres: [],
          language: 'en',
          format: 'epub',
          status: 'base_ready',
          sourceStorage: 'stored',
          createdAt: '2026-08-10T00:00:00.000Z'
        }],
        nextCursor: null
      }
    },
    async resolveBook() {},
    async getReaderBookManifest() {},
    async advanceReaderPosition() {}
  }
  const router = createBookCatalogRouter({ repository })
  const route = router.stack.find((layer) => layer.route?.path === '/catalog/languages/:language')
  const payload = await new Promise((resolve, reject) => {
    route.route.stack[0].handle(
      { params: { language: 'en' }, query: { limit: '24' } },
      { json: resolve },
      reject
    )
  })
  assert.equal(payload.contract_version, BOOK_CATALOG_LANGUAGE_CONTRACT_VERSION)
  assert.equal(payload.language, 'en')
  assert.equal(payload.items[0].language, 'en')
  assert.equal(payload.next_cursor, null)
})

test('book identity polling JSON is independent from the markup manifest', () => {
  assert.deepEqual(bookIdentityJson({
    version: 'book-identity-v1',
    bookEditionId: ID,
    status: 'ready',
    title: 'Мертвое озеро',
    author: 'Николай Некрасов',
    source: 'llm',
    updatedAt: '2026-08-25T10:00:00.000Z'
  }), {
    version: 'book-identity-v1',
    book_edition_id: ID,
    status: 'ready',
    title: 'Мертвое озеро',
    author: 'Николай Некрасов',
    source: 'llm',
    updated_at: '2026-08-25T10:00:00.000Z',
    poll_after_ms: undefined,
    error_code: undefined
  })
})

test('catalog JSON adds nullable language and normalized genres without changing existing fields', () => {
  const book = {
    resolution: 'catalog', bookEditionId: ID, catalogKey: 'seagull',
    title: 'Чайка', author: 'Антон Чехов', genres: ['drama'], language: 'ru', format: 'epub',
    contentSha256: 'a'.repeat(64), generationStatus: 'base_ready', ready: true,
    sourceDownloadPath: `/v2/books/${ID}/source/download`
  }
  const json = bookJson(book)
  assert.deepEqual(json.genres, ['drama'])
  assert.equal(json.language, 'ru')
  assert.equal(json.book_edition_id, ID)
  assert.equal(json.catalog_key, 'seagull')

  assert.deepEqual(bookJson({ ...book, genres: undefined }).genres, [])
  assert.equal(bookJson({ ...book, language: undefined }).language, null)
})

test('catalog cursor round-trips without accepting arbitrary input', () => {
  const cursor = { popularityRank: 7, createdAt: '2026-08-10T00:00:00.000Z', id: ID }
  const encoded = encodeCatalogCursor(cursor)
  assert.deepEqual(decodeCatalogCursor(encoded), cursor)
  assert.equal(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).v, 1)
  const legacy = Buffer.from(JSON.stringify({
    v: 1, created_at: cursor.createdAt, id: cursor.id
  })).toString('base64url')
  assert.deepEqual(decodeCatalogCursor(legacy), {
    popularityRank: null, createdAt: cursor.createdAt, id: cursor.id
  })
  assert.throws(() => decodeCatalogCursor('not-a-cursor'), /cursor: invalid value/)
  assert.throws(() => decodeCatalogCursor(Buffer.from(JSON.stringify({
    v: 1, popularity_rank: 0, created_at: cursor.createdAt, id: cursor.id
  })).toString('base64url')), /cursor: invalid value/)
})

test('language catalog cursor is opaque and cannot cross language categories', () => {
  const cursor = { popularityRank: null, createdAt: '2026-08-10T00:00:00.000Z', id: ID }
  const encoded = encodeLanguageCatalogCursor(cursor, 'ru')
  assert.equal(
    JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).v,
    BOOK_CATALOG_LANGUAGE_CONTRACT_VERSION
  )
  assert.deepEqual(decodeLanguageCatalogCursor(encoded, 'ru'), cursor)
  assert.throws(() => decodeLanguageCatalogCursor(encoded, 'en'), /cursor: language mismatch/)
  assert.throws(() => decodeCatalogCursor(encoded), /cursor: invalid value/)
  assert.equal(parseCatalogLanguage('EN'), 'en')
  assert.throws(() => parseCatalogLanguage('fr'), /expected ru or en/)
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
    format: 'epub',
    language: null
  })
  assert.equal(parseLocalBookBody({
    content_sha256: 'a'.repeat(64), title: 'Book', author: 'Author',
    format: 'epub', language: 'ru-RU'
  }).language, 'ru')
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
