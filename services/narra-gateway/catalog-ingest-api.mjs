import express from 'express'
import { normalizeBookLanguage } from './book-language.mjs'
import { createCatalogIngestService } from './catalog-ingest-service.mjs'
import { requireOperatorAuth } from './security.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const CATALOG_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/
const FORMATS = Object.freeze({
  epub: 'application/epub+zip',
  fb2: 'application/x-fictionbook+xml',
  txt: 'text/plain',
  pdf: 'application/pdf'
})
const COVER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function validation(message) {
  throw Object.assign(new Error(message), { code: 'VALIDATION', status: 400 })
}

function exactKeys(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation(`${name}: expected object`)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) validation(`${name}.${key}: unknown field`)
  }
}

function text(value, name, max, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) {
    validation(`${name}: invalid value`)
  }
  const normalized = value.trim()
  if (!empty && !normalized) validation(`${name}: required`)
  return normalized
}

export function parseCatalogUploadBody(body, maxBytes = 50 * 1024 * 1024) {
  exactKeys(body, [
    'catalog_key', 'content_sha256', 'title', 'author', 'format', 'byte_size', 'language'
  ], 'body')
  const catalogKey = text(body.catalog_key, 'catalog_key', 128)
  if (!CATALOG_KEY.test(catalogKey)) validation('catalog_key: invalid value')
  const format = text(body.format, 'format', 16)
  if (!FORMATS[format]) validation('format: unsupported book format')
  if (typeof body.content_sha256 !== 'string' || !SHA256.test(body.content_sha256)) {
    validation('content_sha256: invalid SHA-256')
  }
  if (!Number.isSafeInteger(body.byte_size) || body.byte_size < 1 || body.byte_size > maxBytes) {
    validation(`byte_size: expected 1-${maxBytes}`)
  }
  const language = normalizeBookLanguage(body.language)
  if (body.language !== undefined && body.language !== null && body.language !== '' && !language) {
    validation('language: expected an ISO language tag')
  }
  return {
    catalogKey,
    contentSha256: body.content_sha256,
    title: text(body.title, 'title', 500),
    author: text(body.author ?? '', 'author', 500, { empty: true }),
    format,
    mimeType: FORMATS[format],
    byteSize: body.byte_size,
    language
  }
}

export function parseCatalogCoverUploadBody(body, maxBytes = 10 * 1024 * 1024) {
  exactKeys(body, ['content_sha256', 'mime_type', 'byte_size'], 'body')
  if (typeof body.content_sha256 !== 'string' || !SHA256.test(body.content_sha256)) {
    validation('content_sha256: invalid SHA-256')
  }
  const mimeType = text(body.mime_type, 'mime_type', 64)
  if (!COVER_MIME_TYPES.has(mimeType)) validation('mime_type: unsupported cover format')
  if (!Number.isSafeInteger(body.byte_size) || body.byte_size < 1 || body.byte_size > maxBytes) {
    validation(`byte_size: expected 1-${maxBytes}`)
  }
  return { contentSha256: body.content_sha256, mimeType, byteSize: body.byte_size }
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) validation('bookEditionId: invalid UUID')
  return value
}

function asyncRoute(operation) {
  return (req, res, next) => void operation(req, res).catch(next)
}

function responseJson(value) {
  return {
    book_edition_id: value.bookEditionId,
    catalog_key: value.catalogKey,
    language: value.language ?? null,
    content_sha256: value.contentSha256,
    generation_status: value.status,
    ready: value.ready,
    upload_required: value.uploadRequired,
    upload_path: value.uploadPath,
    complete_path: value.completePath,
    byte_size: value.byteSize,
    analysis_run_id: value.analysisRunId,
    analysis_stage: value.analysisStage,
    analysis_status: value.analysisStatus,
    analysis_created: value.analysisCreated,
    job_id: value.jobId,
    job_status: value.jobStatus
  }
}

function coverResponseJson(value) {
  return {
    book_edition_id: value.bookEditionId,
    content_sha256: value.contentSha256,
    mime_type: value.mimeType,
    byte_size: value.byteSize,
    ready: value.ready,
    upload_required: value.uploadRequired,
    upload_path: value.uploadPath,
    complete_path: value.completePath
  }
}

export function createCatalogIngestRouter({
  token,
  service: providedService,
  repository,
  analysisRepository,
  storage,
  uploadMaxBytes = 50 * 1024 * 1024
}) {
  const router = express.Router()
  const service = providedService ?? createCatalogIngestService({
    repository,
    analysisRepository,
    storage
  })
  router.use(requireOperatorAuth(token))

  router.post('/books/uploads', express.json({ limit: '16kb' }), asyncRoute(async (req, res) => {
    const value = await service.begin(parseCatalogUploadBody(req.body, uploadMaxBytes))
    res.status(value.uploadRequired ? 201 : 200).json(responseJson(value))
  }))

  router.post(
    '/books/:bookEditionId/content',
    express.raw({ type: () => true, limit: uploadMaxBytes }),
    asyncRoute(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.byteLength) validation('book content: required')
      const value = await service.upload(
        uuid(req.params.bookEditionId),
        req.body,
        String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
      )
      res.status(201).json(responseJson(value))
    })
  )

  router.post(
    '/books/:bookEditionId/cover/uploads',
    express.json({ limit: '16kb' }),
    asyncRoute(async (req, res) => {
      const value = await service.beginCover(
        uuid(req.params.bookEditionId),
        parseCatalogCoverUploadBody(req.body)
      )
      res.status(value.uploadRequired ? 201 : 200).json(coverResponseJson(value))
    })
  )

  router.post(
    '/books/:bookEditionId/cover/content',
    express.raw({ type: () => true, limit: '10mb' }),
    asyncRoute(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.byteLength) validation('cover content: required')
      const value = await service.uploadCover(
        uuid(req.params.bookEditionId),
        req.body,
        String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
      )
      res.status(201).json(coverResponseJson(value))
    })
  )

  router.post(
    '/books/:bookEditionId/cover/upload-complete',
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      exactKeys(req.body ?? {}, [], 'body')
      const value = await service.completeCover(uuid(req.params.bookEditionId))
      res.json(coverResponseJson(value))
    })
  )

  router.post(
    '/books/:bookEditionId/upload-complete',
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      exactKeys(req.body ?? {}, [], 'body')
      const value = await service.complete(uuid(req.params.bookEditionId))
      res.status(202).json(responseJson(value))
    })
  )

  router.use((error, _req, res, next) => {
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code || 'VALIDATION'
      })
    }
    next(error)
  })
  return router
}
