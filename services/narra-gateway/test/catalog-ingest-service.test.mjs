import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createCatalogIngestService } from '../catalog-ingest-service.mjs'

const BYTES = Buffer.from('catalog epub bytes')
const HASH = createHash('sha256').update(BYTES).digest('hex')
const EDITION = {
  id: 'book-1', catalogKey: 'catalog-book', contentSha256: HASH,
  status: 'uploading'
}

test('catalog ingestion verifies bytes, stores the source and queues canonical v3 analysis', async () => {
  const calls = []
  const repository = {
    async beginCatalogBookUpload(input) {
      calls.push(['begin', input])
      return {
        edition: EDITION,
        uploadRequired: true,
        file: {
          objectKey: input.objectKey,
          contentSha256: HASH,
          mimeType: 'application/epub+zip',
          byteSize: BYTES.byteLength
        }
      }
    },
    async getCatalogBookUpload() {
      return {
        edition: EDITION,
        file: {
          objectKey: `books/catalog/catalog-book/${HASH}/source`,
          contentSha256: HASH,
          mimeType: 'application/epub+zip',
          byteSize: BYTES.byteLength
        }
      }
    },
    async completeCatalogBookUpload() {
      calls.push(['complete'])
      return { ...EDITION, status: 'marking_up' }
    },
    async enqueueBookMarkup() {
      throw new Error('legacy v2 markup must not be queued')
    }
  }
  const analysisRepository = {
    async ensureAnalysisRun(input) {
      calls.push(['ensure-analysis', input])
      return {
        created: true,
        run: { id: 'run-v3', stage: 'prepare', status: 'running' },
        prepareJob: { id: 'prepare-v3', status: 'queued' }
      }
    }
  }
  const storage = {
    async putBytes(input) {
      calls.push(['put', input])
      return { contentHash: HASH, byteSize: BYTES.byteLength }
    },
    async verifyUpload(input) {
      calls.push(['verify', input])
      return { verified: true }
    }
  }
  const service = createCatalogIngestService({
    repository,
    analysisRepository,
    storage,
    idFactory: () => 'book-1'
  })
  const begun = await service.begin({
    catalogKey: 'catalog-book', contentSha256: HASH, title: 'Book', author: 'Author',
    format: 'epub', mimeType: 'application/epub+zip', byteSize: BYTES.byteLength
  })
  assert.equal(begun.uploadPath, '/v2/admin/catalog/books/book-1/content')
  assert.match(calls[0][1].objectKey, /^books\/catalog\/catalog-book\/[a-f0-9]{64}\/source$/)
  await service.upload('book-1', BYTES, 'application/epub+zip')
  assert.equal(calls[1][0], 'put')
  const completed = await service.complete('book-1')
  assert.equal(completed.jobStatus, 'queued')
  assert.equal(completed.analysisRunId, 'run-v3')
  assert.deepEqual(calls.at(-1), ['ensure-analysis', {
    bookEditionId: 'book-1',
    inputHash: HASH,
    priority: 50
  }])
})

test('repeated catalog ingestion ensures v3 analysis without creating a v2 job', async () => {
  const calls = []
  const service = createCatalogIngestService({
    repository: {
      async beginCatalogBookUpload() {
        return { edition: { ...EDITION, status: 'base_ready' }, uploadRequired: false }
      },
      async enqueueBookMarkup() {
        throw new Error('legacy v2 markup must not be queued')
      }
    },
    analysisRepository: {
      async ensureAnalysisRun(input) {
        calls.push(input)
        return {
          created: false,
          run: { id: 'run-v3', stage: 'done', status: 'ready' },
          prepareJob: { id: 'prepare-v3', status: 'ready' }
        }
      }
    },
    storage: {},
    idFactory: () => 'book-1'
  })

  const begun = await service.begin({
    catalogKey: 'catalog-book', contentSha256: HASH, title: 'Book', author: 'Author',
    format: 'epub', mimeType: 'application/epub+zip', byteSize: BYTES.byteLength
  })

  assert.equal(begun.uploadRequired, false)
  assert.equal(begun.analysisRunId, 'run-v3')
  assert.deepEqual(calls, [{ bookEditionId: 'book-1', inputHash: HASH, priority: 50 }])
})

test('catalog ingestion rejects source bytes with a different checksum', async () => {
  const service = createCatalogIngestService({
    repository: {
      async getCatalogBookUpload() {
        return {
          edition: EDITION,
          file: {
            objectKey: 'books/catalog/book/hash/source', contentSha256: HASH,
            mimeType: 'application/epub+zip', byteSize: BYTES.byteLength
          }
        }
      }
    },
    storage: { async putBytes() { throw new Error('must not store') } }
  })
  await assert.rejects(
    service.upload('book-1', Buffer.from('different bytes!'), 'application/epub+zip'),
    (error) => error.code === 'UPLOAD_INTEGRITY'
  )
})

test('catalog cover ingestion verifies and stores cover bytes independently', async () => {
  const coverBytes = Buffer.from('jpeg cover bytes')
  const coverHash = createHash('sha256').update(coverBytes).digest('hex')
  const calls = []
  const cover = {
    bookEditionId: 'book-1',
    objectKey: `books/catalog/book-1/cover/${coverHash}`,
    contentHash: coverHash,
    mimeType: 'image/jpeg',
    byteSize: coverBytes.byteLength,
    status: 'staging'
  }
  const service = createCatalogIngestService({
    repository: {
      async beginCatalogCoverUpload(input) {
        calls.push(['begin-cover', input])
        return { cover, uploadRequired: true }
      },
      async getCatalogCoverUpload() { return cover },
      async completeCatalogCoverUpload() {
        calls.push(['complete-cover'])
        return { ...cover, status: 'ready' }
      }
    },
    storage: {
      async putBytes(input) {
        calls.push(['put-cover', input])
        return { contentHash: coverHash, byteSize: coverBytes.byteLength }
      },
      async verifyUpload(input) {
        calls.push(['verify-cover', input])
      }
    }
  })
  const begun = await service.beginCover('book-1', {
    contentSha256: coverHash,
    mimeType: 'image/jpeg',
    byteSize: coverBytes.byteLength
  })
  assert.equal(begun.uploadPath, '/v2/admin/catalog/books/book-1/cover/content')
  await service.uploadCover('book-1', coverBytes, 'image/jpeg')
  const completed = await service.completeCover('book-1')
  assert.equal(completed.ready, true)
  assert.deepEqual(calls.map(([name]) => name), [
    'begin-cover', 'put-cover', 'verify-cover', 'complete-cover'
  ])
})
