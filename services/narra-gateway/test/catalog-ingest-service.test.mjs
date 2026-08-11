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

test('catalog ingestion verifies bytes, stores the source and queues markup', async () => {
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
    async enqueueBookMarkup(input) {
      calls.push(['enqueue', input])
      return { id: 'job-1', status: 'queued' }
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
  assert.deepEqual(calls.at(-1), ['enqueue', { bookEditionId: 'book-1' }])
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
