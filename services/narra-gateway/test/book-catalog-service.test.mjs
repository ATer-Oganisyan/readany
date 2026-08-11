import assert from 'node:assert/strict'
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

test('manifest exposes no partial media when a visible bundle is incomplete', async () => {
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
  assert.equal(manifest.characters[0].bundle, null)
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

test('local hash reuses a ready catalog edition and otherwise requests private upload', async () => {
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
    resolution: 'private_upload_required',
    contentSha256: 'b'.repeat(64),
    ready: false
  })
})

test('catalog listing never receives processing editions from the service contract', async () => {
  const catalog = { ...EDITION, id: 'catalog-1', scope: 'catalog', catalogKey: 'book' }
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
  assert.deepEqual(result.nextCursor, { createdAt: catalog.createdAt, id: catalog.id })
})

test('private upload is checksum-bound and completion idempotently queues full markup', async () => {
  const calls = []
  const privateEdition = { ...EDITION, id: 'book-private', status: 'uploading' }
  const store = repository({
    async beginPrivateBookUpload(input) {
      calls.push(['begin', input])
      return {
        edition: privateEdition,
        uploadRequired: true,
        fileReady: false,
        file: {
          objectKey: input.objectKey,
          contentSha256: input.contentSha256,
          mimeType: input.mimeType,
          byteSize: input.byteSize
        }
      }
    },
    async getPrivateBookUpload() {
      return {
        edition: privateEdition,
        file: {
          objectKey: 'books/private/reader/hash/source', contentSha256: HASH,
          mimeType: 'application/epub+zip', byteSize: 128, status: 'staging'
        }
      }
    },
    async completePrivateBookUpload() {
      calls.push(['complete'])
      return { ...privateEdition, status: 'marking_up' }
    },
    async enqueueBookMarkup(input) {
      calls.push(['enqueue', input])
      return { status: 'queued' }
    }
  })
  const storage = {
    async createUpload(file) {
      calls.push(['sign', file])
      return { url: 'https://storage/upload', method: 'PUT', headers: {}, expiresAt: '' }
    },
    async verifyUpload(file) {
      calls.push(['verify', file])
      return { verified: true }
    }
  }
  const service = createBookCatalogService({
    repository: store,
    storage,
    idFactory: () => 'edition-proposed'
  })
  const started = await service.beginPrivateUpload('reader', {
    contentSha256: HASH,
    title: 'Book', author: 'Author', format: 'epub',
    mimeType: 'application/epub+zip', byteSize: 128
  })
  assert.equal(started.upload.url, 'https://storage/upload')
  assert.equal(calls[0][1].objectKey, `books/private/reader/${HASH}/source`)
  const completed = await service.completePrivateUpload('reader', 'book-private')
  assert.equal(completed.generationStatus, 'marking_up')
  assert.deepEqual(calls.at(-1), ['enqueue', { bookEditionId: 'book-private' }])
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
