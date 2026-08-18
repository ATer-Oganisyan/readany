import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { REQUIRED_CHARACTER_MEDIA } from '../book-markup.mjs'
import { createBookCatalogService } from '../book-catalog-service.mjs'

const HASH = 'a'.repeat(64)
const EDITION = {
  id: 'book-1',
  scope: 'private',
  contentSha256: HASH,
  title: 'Book',
  author: 'Author',
  format: 'epub',
  status: 'base_ready',
  createdAt: '2026-08-10T00:00:00.000Z'
}

function repository(overrides = {}) {
  return {
    async listCatalogBooks() { return { items: [], nextCursor: null } },
    async resolveBook() { return null },
    async getReaderBookManifest() { return null },
    async advanceReaderPosition() { return null },
    async ensureCharacterBundle() { return { status: 'queued' } },
    ...overrides
  }
}

function readyBundle(characterKey) {
  return {
    version: 'character-bundle-v1',
    status: 'ready',
    assets: REQUIRED_CHARACTER_MEDIA.map((type) => ({
      assetId: `${characterKey}-${type}`,
      type,
      contentHash: HASH,
      mimeType: 'application/octet-stream',
      byteSize: 10,
      status: 'ready'
    }))
  }
}

test('manifest never leaks a future character even when its global bundle is ready', async () => {
  const service = createBookCatalogService({
    repository: repository({
      async getReaderBookManifest() {
        return {
          edition: EDITION,
          readerTextOffset: 50,
          readingFraction: 0.05,
          markup: {
            schemaVersion: 2,
            analysisVersion: 'book-markup-v2',
            revision: 1,
            textLength: 1_000,
            publishedAt: '2026-08-10T00:00:00.000Z'
          },
          characters: [
            {
              characterKey: 'visible', name: 'Visible', fullName: 'Visible Hero',
              warmupTextOffset: 0, firstAppearanceTextOffset: 20, data: { role: 'hero' },
              bundle: readyBundle('visible')
            },
            {
              characterKey: 'future', name: 'Future', fullName: 'Future Hero',
              warmupTextOffset: 30, firstAppearanceTextOffset: 100, data: { spoiler: true },
              bundle: readyBundle('future')
            }
          ]
        }
      }
    })
  })
  const manifest = await service.manifest('reader-1', 'book-1')
  assert.deepEqual(manifest.characters.map(({ characterKey }) => characterKey), ['visible'])
  assert.equal(manifest.characters[0].state, 'ready')
  assert.equal(manifest.characters[0].bundle.assets.length, REQUIRED_CHARACTER_MEDIA.length)
})

test('manifest exposes ready assets while the remaining character media is still preparing', async () => {
  const partial = readyBundle('hero')
  partial.assets.pop()
  const service = createBookCatalogService({
    repository: repository({
      async getReaderBookManifest() {
        return {
          edition: EDITION,
          readerTextOffset: 100,
          readingFraction: 0.1,
          markup: {
            schemaVersion: 2, analysisVersion: 'book-markup-v2', revision: 1,
            textLength: 1_000, publishedAt: ''
          },
          characters: [{
            characterKey: 'hero', name: 'Hero', fullName: 'The Hero',
            warmupTextOffset: 0, firstAppearanceTextOffset: 10, data: {}, bundle: partial
          }]
        }
      }
    })
  })
  const manifest = await service.manifest('reader-1', 'book-1')
  assert.equal(manifest.characters[0].state, 'preparing')
  assert.equal(manifest.characters[0].bundle.assets.length, REQUIRED_CHARACTER_MEDIA.length - 1)
})

test('catalog manifest exposes validated v3 as the canonical markup', async () => {
  const calls = []
  const publicSnapshot = {
    edition: { ...EDITION, scope: 'catalog', catalogKey: 'book' },
    readerTextOffset: 100,
    readingFraction: 0.5,
    markup: {
      schemaVersion: 2,
      analysisVersion: 'book-markup-v2',
      revision: 7,
      textLength: 1_000,
      publishedAt: '2026-08-10T00:00:00.000Z'
    },
    characters: [{
      characterKey: 'visible', name: 'Visible', fullName: 'Visible Hero',
      warmupTextOffset: 850, firstAppearanceTextOffset: 900,
      data: { analysisSource: 'v3' }, bundle: readyBundle('visible')
    }]
  }
  const service = createBookCatalogService({
    repository: repository({
      async getReaderBookManifest(input) {
        calls.push(['manifest', input.bundleVersion])
        return publicSnapshot
      }
    }),
    analysisRepository: {
      async ensureLatestMediaProjection(bookEditionId) {
        calls.push(['projection', bookEditionId])
        return { projected: true }
      },
      async getLatestShadowAnalysisPublication(bookEditionId) {
        assert.equal(bookEditionId, EDITION.id)
        return {
          id: 'publication-v3',
          runId: 'run-v3',
          bookEditionId,
          channel: 'shadow',
          analysisVersion: 'book-markup-v3',
          contentHash: HASH,
          publishedAt: '2026-08-13T12:00:00.000Z',
          data: {
            markup: {
              schemaVersion: 3,
              analysisVersion: 'book-markup-v3',
              snapshotId: 'snapshot-v3',
              textLength: 2_000,
              characters: [
                {
                  characterKey: 'visible',
                  name: 'Visible',
                  fullName: 'Visible Hero',
                  aliases: [],
                  identityEvidenceIds: ['identity-visible'],
                  firstAppearanceTextOffset: 900,
                  warmupTextOffset: 850,
                  role: { value: 'Главный герой', evidenceIds: ['role-1'], confidence: 0.9 },
                  age: null,
                  gender: null,
                  description: null,
                  traits: [{ value: 'смелый', evidenceIds: ['trait-1'], confidence: 0.8 }],
                  speechStyle: null,
                  speechExamples: [],
                  appearance: [],
                  creative: { greeting: 'Здравствуйте', appearancePrompt: '', voice: 'Che' }
                },
                {
                  characterKey: 'future',
                  name: 'Future',
                  fullName: 'Future Hero',
                  aliases: [],
                  identityEvidenceIds: ['identity-future'],
                  firstAppearanceTextOffset: 1_500,
                  warmupTextOffset: 1_400,
                  role: null,
                  age: null,
                  gender: null,
                  description: null,
                  traits: [],
                  speechStyle: null,
                  speechExamples: [],
                  appearance: [],
                  creative: {}
                }
              ],
              locations: [],
              events: [],
              relationships: [],
              storyArcs: []
            }
          }
        }
      }
    }
  })

  const preview = await service.manifest('reader-1', EDITION.id)

  assert.equal(preview.source, 'v3')
  assert.equal(preview.availability, 'ready')
  assert.equal(preview.publicationId, 'publication-v3')
  assert.equal(preview.readerTextOffset, 1_000)
  assert.deepEqual(preview.characters, [{
    characterKey: 'visible',
    name: 'Visible',
    fullName: 'Visible Hero',
    firstAppearanceTextOffset: 900,
    provisional: false,
    state: 'ready',
    profile: {
      role: 'Главный герой',
      gender: undefined,
      traits: ['смелый'],
      speechStyle: '',
      speechExamples: [],
      appearancePrompt: '',
      greeting: 'Здравствуйте',
      voice: 'Erm',
      analysisSource: 'v3'
    },
    bundle: {
      version: 'character-bundle-v1',
      assets: REQUIRED_CHARACTER_MEDIA.map((type) => ({
        assetId: `visible-${type}`,
        type,
        contentHash: HASH,
        mimeType: 'application/octet-stream',
        byteSize: 10,
        downloadPath: `/v2/books/${EDITION.id}/media/visible-${type}/download`
      }))
    }
  }])
  assert.equal(preview.markup.analysisVersion, 'book-markup-v3')
  assert.deepEqual(calls.slice(0, 2), [
    ['projection', EDITION.id],
    ['manifest', 'character-bundle-v3']
  ])
})

test('catalog manifest does not fall back to legacy v2 while v3 is processing', async () => {
  const service = createBookCatalogService({
    repository: repository({
      async getReaderBookManifest() {
        return {
          edition: { ...EDITION, scope: 'catalog', catalogKey: 'book' },
          readerTextOffset: 100,
          readingFraction: 0.1,
          markup: {
            schemaVersion: 2,
            analysisVersion: 'book-markup-v2',
            revision: 7,
            textLength: 1_000,
            publishedAt: '2026-08-10T00:00:00.000Z'
          },
          characters: [{ characterKey: 'legacy-character' }]
        }
      }
    }),
    analysisRepository: {
      async getLatestShadowAnalysisPublication() { return null }
    }
  })

  const manifest = await service.manifest('reader-1', EDITION.id)

  assert.equal(manifest.source, 'v3')
  assert.equal(manifest.availability, 'processing')
  assert.equal(manifest.markup, null)
  assert.deepEqual(manifest.characters, [])
})

test('processing v3 manifest exposes only reader-visible provisional characters', async () => {
  const service = createBookCatalogService({
    repository: repository({
      async getReaderBookManifest() {
        return {
          edition: { ...EDITION, sourceStorage: 'temporary' },
          readerTextOffset: 500,
          readingFraction: 0.25,
          markup: null,
          characters: []
        }
      }
    }),
    analysisRepository: {
      async getLatestShadowAnalysisPublication() { return null },
      async getLatestAnalysisPreview() {
        return {
          run: {
            id: 'run-v3', stage: 'scan', status: 'running', textLength: 2_000
          },
          scan: { completedChunks: 12, totalChunks: 50 },
          characters: [
            {
              characterKey: 'provisional:visible',
              name: 'Джейн', fullName: 'Джейн',
              firstAppearanceTextOffset: 100
            },
            {
              characterKey: 'provisional:future',
              name: 'Рочестер', fullName: 'Рочестер',
              firstAppearanceTextOffset: 900
            }
          ]
        }
      }
    }
  })

  const manifest = await service.manifest('reader-1', EDITION.id)

  assert.equal(manifest.availability, 'processing')
  assert.equal(manifest.runId, 'run-v3')
  assert.equal(manifest.readerTextOffset, 500)
  assert.deepEqual(manifest.analysis, {
    stage: 'scan', status: 'running', textLength: 2_000,
    completedScanChunks: 12, totalScanChunks: 50
  })
  assert.deepEqual(manifest.characters, [{
    characterKey: 'provisional:visible',
    name: 'Джейн',
    fullName: 'Джейн',
    firstAppearanceTextOffset: 100,
    provisional: true,
    state: 'preparing',
    profile: {
      role: 'Профиль формируется',
      traits: [], speechStyle: '', speechExamples: [], appearancePrompt: '', greeting: '',
      analysisSource: 'v3', provisional: true
    },
    bundle: null
  }])
})

test('private manifest uses canonical v3 and never falls back to client-derived v2', async () => {
  const service = createBookCatalogService({
    repository: repository({
      async getReaderBookManifest() {
        return {
          edition: { ...EDITION, sourceStorage: 'temporary' },
          readerTextOffset: 154_110,
          readingFraction: 0.15411,
          markup: {
            schemaVersion: 2,
            analysisVersion: 'book-markup-v2',
            revision: 1,
            textLength: 1_000_000,
            publishedAt: '2026-08-10T00:00:00.000Z'
          },
          characters: []
        }
      }
    }),
    analysisRepository: {
      async getLatestShadowAnalysisPublication() { return null }
    }
  })

  const manifest = await service.manifest('reader-1', EDITION.id)

  assert.equal(manifest.source, 'v3')
  assert.equal(manifest.availability, 'processing')
  assert.equal(manifest.markup, null)
  assert.deepEqual(manifest.characters, [])
})

test('private source upload verifies bytes, persists a temporary source and starts v3', async () => {
  const bytes = Buffer.from('private epub fixture')
  const contentSha256 = createHash('sha256').update(bytes).digest('hex')
  const calls = []
  const edition = {
    ...EDITION,
    contentSha256,
    status: 'marking_up',
    sourceStorage: 'temporary',
    expiresAt: '2026-08-17T00:00:00.000Z'
  }
  const service = createBookCatalogService({
    repository: repository({
      async beginPrivateBookUpload(input) {
        calls.push(['begin', input])
        return {
          edition: { ...edition, sourceStorage: 'local_only' },
          uploadRequired: true,
          file: {
            objectKey: `books/private/reader-1/${contentSha256}/source`,
            contentSha256,
            mimeType: 'application/epub+zip',
            byteSize: bytes.byteLength
          }
        }
      },
      async completePrivateBookUpload(input) {
        calls.push(['complete', input])
        return edition
      }
    }),
    analysisRepository: {
      async ensureAnalysisRun(input) {
        calls.push(['analysis', input])
        return {
          run: { id: 'run-v3', stage: 'prepare', status: 'queued' },
          prepareJob: { id: 'job-v3', status: 'queued' },
          created: true
        }
      }
    },
    storage: {
      async putBytes(input) {
        calls.push(['store', input])
        return {
          objectKey: input.objectKey,
          contentHash: contentSha256,
          mimeType: input.mimeType,
          byteSize: input.bytes.byteLength
        }
      }
    }
  })

  const result = await service.uploadLocalSource(
    'reader-1',
    EDITION.id,
    bytes,
    'application/epub+zip'
  )

  assert.equal(result.sourceUploaded, true)
  assert.equal(result.analysisRunId, 'run-v3')
  assert.deepEqual(calls.map(([name]) => name), ['begin', 'store', 'complete', 'analysis'])
})

test('progress requests every character behind the markup warmup frontier', async () => {
  const ensured = []
  const service = createBookCatalogService({
    repository: repository({
      async advanceReaderPosition() {
        return {
          readerTextOffset: 90,
          readingFraction: 0.09,
          chapterKey: 'chapter-2',
          charactersDue: [
            { characterKey: 'hero', warmupTextOffset: 0, firstAppearanceTextOffset: 10 },
            { characterKey: 'future', warmupTextOffset: 80, firstAppearanceTextOffset: 120 }
          ]
        }
      },
      async ensureCharacterBundle(input) {
        ensured.push(input)
        return { status: input.characterKey === 'hero' ? 'ready' : 'running' }
      }
    })
  })
  const result = await service.advanceProgress('reader-1', 'book-1', {
    progressFraction: 0.09,
    textOffset: null,
    chapterKey: 'chapter-2'
  })
  assert.deepEqual(ensured.map(({ characterKey }) => characterKey), ['hero', 'future'])
  assert.equal(result.readingFraction, 0.09)
  assert.deepEqual(result.warmup, { requested: 2, ready: 1, pending: 1, failed: 0 })
})

test('catalog progress never queues legacy v2 character bundles', async () => {
  const service = createBookCatalogService({
    repository: repository({
      async advanceReaderPosition() {
        return {
          scope: 'catalog',
          readerTextOffset: 90,
          readingFraction: 0.09,
          chapterKey: 'chapter-2',
          charactersDue: [{ characterKey: 'legacy-v2-character' }]
        }
      },
      async ensureCharacterBundle() {
        throw new Error('legacy v2 character bundle must not be queued for catalog books')
      }
    })
  })

  const result = await service.advanceProgress('reader-1', 'book-1', {
    progressFraction: 0.09,
    textOffset: null,
    chapterKey: 'chapter-2'
  })

  assert.deepEqual(result.warmup, { requested: 0, ready: 0, pending: 0, failed: 0 })
})

test('canonical v3 progress queues media for characters behind the warmup frontier', async () => {
  const ensured = []
  const service = createBookCatalogService({
    repository: repository({
      async advanceReaderPosition() {
        return {
          scope: 'private',
          analysisVersion: 'book-markup-v3',
          readerTextOffset: 90,
          readingFraction: 0.09,
          chapterKey: 'chapter-2',
          charactersDue: [{
            characterKey: 'character:hero',
            warmupTextOffset: 80,
            firstAppearanceTextOffset: 120
          }]
        }
      },
      async ensureCharacterBundle(input) {
        ensured.push(input)
        return { status: 'queued' }
      }
    }),
    analysisRepository: {
      async ensureLatestMediaProjection() { return { projected: true } }
    }
  })

  const result = await service.advanceProgress('reader-1', 'book-1', {
    progressFraction: 0.09,
    textOffset: null,
    chapterKey: 'chapter-2'
  })

  assert.equal(ensured.length, 1)
  assert.equal(ensured[0].bookEditionId, 'book-1')
  assert.equal(ensured[0].characterKey, 'character:hero')
  assert.equal(ensured[0].bundleVersion, 'character-bundle-v3')
  assert.deepEqual(result.warmup, { requested: 1, ready: 0, pending: 1, failed: 0 })
})

test('local hash reuses a ready catalog edition and otherwise requests local registration', async () => {
  const catalog = { ...EDITION, id: 'catalog-1', scope: 'catalog', catalogKey: 'book' }
  const service = createBookCatalogService({
    repository: repository({
      async resolveBook({ contentSha256 }) {
        return contentSha256 === HASH ? catalog : null
      }
    })
  })
  assert.equal((await service.resolve('reader-1', {
    source: 'local', contentSha256: HASH
  })).resolution, 'catalog')
  assert.deepEqual(await service.resolve('reader-1', {
    source: 'local', contentSha256: 'b'.repeat(64)
  }), {
    resolution: 'local_registration_required',
    contentSha256: 'b'.repeat(64),
    ready: false
  })
})

test('catalog listing never receives processing editions from the service contract', async () => {
  const catalog = {
    ...EDITION,
    id: 'catalog-1',
    scope: 'catalog',
    catalogKey: 'book',
    cover: {
      objectKey: 'catalog/book/cover',
      contentHash: HASH,
      mimeType: 'image/jpeg',
      byteSize: 42
    }
  }
  const service = createBookCatalogService({
    repository: repository({
      async listCatalogBooks() {
        return {
          items: [catalog],
          nextCursor: { createdAt: catalog.createdAt, id: catalog.id }
        }
      }
    })
  })
  const result = await service.listCatalog({ limit: 1, cursor: null })
  assert.equal(result.items[0].ready, true)
  assert.deepEqual(result.items[0].cover, {
    contentHash: HASH,
    mimeType: 'image/jpeg',
    byteSize: 42,
    downloadPath: '/v2/books/catalog-1/cover/download'
  })
  assert.deepEqual(result.nextCursor, { createdAt: catalog.createdAt, id: catalog.id })
})

test('catalog cover download is authorized before storage signing', async () => {
  const calls = []
  const service = createBookCatalogService({
    repository: repository({
      async getCatalogBookCover(input) {
        calls.push(['authorize-cover', input])
        return { objectKey: 'catalog/cover', mimeType: 'image/jpeg' }
      }
    }),
    storage: {
      async createDownload(input) {
        calls.push(['sign-cover', input])
        return { url: 'https://storage/cover', expiresAt: '' }
      }
    }
  })
  assert.equal((await service.coverDownload('reader', 'book')).url, 'https://storage/cover')
  assert.equal(calls[0][0], 'authorize-cover')
  assert.equal(calls[1][0], 'sign-cover')
})

test('local registration and markup store only metadata and derived character profiles', async () => {
  const calls = []
  const privateEdition = {
    ...EDITION,
    id: 'book-private',
    status: 'draft',
    sourceStorage: 'local_only',
    expiresAt: '2026-08-17T00:00:00.000Z'
  }
  const store = repository({
    async registerLocalBook(input) {
      calls.push(['register', input])
      return privateEdition
    },
    async publishLocalBookMarkup(input) {
      calls.push(['publish', input])
      return {
        edition: { ...privateEdition, status: 'base_ready' },
        revision: 1,
        created: true
      }
    }
  })
  const service = createBookCatalogService({
    repository: store,
    idFactory: () => 'edition-proposed'
  })
  const registered = await service.registerLocalBook('reader', {
    contentSha256: HASH,
    title: 'Book', author: 'Author', format: 'epub'
  })
  assert.equal(registered.sourceDownloadPath, undefined)
  assert.equal(calls[0][1].proposedBookEditionId, 'edition-proposed')

  const published = await service.publishLocalMarkup('reader', 'book-private', {
    characters: [{
      characterKey: 'hero', name: 'Hero', fullName: 'The Hero',
      firstAppearanceFraction: 0.2, warmupFraction: 0.15,
      profile: { role: 'protagonist' }
    }]
  })
  assert.equal(published.ready, true)
  const payload = calls.at(-1)[1]
  assert.equal(payload.characters[0].firstAppearanceTextOffset, 200_000)
  assert.equal(payload.characters[0].warmupTextOffset, 150_000)
  assert.equal('source' in payload, false)
})

test('media download is authorized by the repository before storage signing', async () => {
  const calls = []
  const service = createBookCatalogService({
    repository: repository({
      async getReaderMediaAsset(input) {
        calls.push(['authorize', input])
        return { objectKey: 'private/media', mimeType: 'image/png' }
      }
    }),
    storage: {
      async createDownload(input) {
        calls.push(['sign', input])
        return { url: 'https://storage/signed', expiresAt: '' }
      }
    }
  })
  assert.equal((await service.mediaDownload('reader', 'book', 'asset')).url, 'https://storage/signed')
  assert.equal(calls[0][0], 'authorize')
  assert.equal(calls[1][0], 'sign')
})
