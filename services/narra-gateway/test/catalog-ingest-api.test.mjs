import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCatalogCoverUploadBody, parseCatalogUploadBody } from '../catalog-ingest-api.mjs'

test('catalog upload keeps language optional and normalizes future metadata', () => {
  const body = {
    catalog_key: 'seagull',
    content_sha256: 'a'.repeat(64),
    title: 'Чайка',
    author: 'Антон Чехов',
    format: 'epub',
    byte_size: 42
  }
  assert.equal(parseCatalogUploadBody(body).language, null)
  assert.equal(parseCatalogUploadBody({ ...body, language: 'EN-us' }).language, 'en')
  assert.throws(() => parseCatalogUploadBody({ ...body, language: 'english' }), /language/)
})

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
