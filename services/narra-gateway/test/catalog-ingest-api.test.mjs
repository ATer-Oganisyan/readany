import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCatalogCoverUploadBody } from '../catalog-ingest-api.mjs'

test('catalog cover upload accepts only bounded image metadata', () => {
  assert.deepEqual(parseCatalogCoverUploadBody({
    content_sha256: 'a'.repeat(64),
    mime_type: 'image/jpeg',
    byte_size: 42
  }), {
    contentSha256: 'a'.repeat(64),
    mimeType: 'image/jpeg',
    byteSize: 42
  })
  assert.throws(() => parseCatalogCoverUploadBody({
    content_sha256: 'a'.repeat(64), mime_type: 'image/svg+xml', byte_size: 42
  }), /unsupported cover format/)
  assert.throws(() => parseCatalogCoverUploadBody({
    content_sha256: 'a'.repeat(64), mime_type: 'image/png', byte_size: 0
  }), /byte_size/)
})
