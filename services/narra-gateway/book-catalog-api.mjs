import express from 'express'
import { createBookCatalogService } from './book-catalog-service.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const BOOK_FORMATS = new Set(['epub', 'fb2', 'txt', 'pdf'])
const BOOK_MIME_TYPES = Object.freeze({
  epub: 'application/epub+zip',
  fb2: 'application/x-fictionbook+xml',
  txt: 'text/plain',
  pdf: 'application/pdf'
})

function validation(message) {
  throw Object.assign(new Error(message), { code: 'VALIDATION', status: 400 })
}

function exactKeys(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation(`${name}: expected object`)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) validation(`${name}.${key}: unknown field`)
  }
}

function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) validation(`${name}: invalid UUID`)
  return value
}

function catalogKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) {
    validation('catalog_key: invalid value')
  }
  return value.trim()
}

function sha256(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) validation('content_sha256: invalid SHA-256')
  return value
}

export function parseBookResolveBody(body) {
  exactKeys(body, ['source', 'catalog_key', 'content_sha256'], 'body')
  if (body.source === 'catalog') {
    if (body.content_sha256 !== undefined) validation('content_sha256 is not allowed for catalog resolve')
    return { source: 'catalog', catalogKey: catalogKey(body.catalog_key) }
  }
  if (body.source === 'local') {
    if (body.catalog_key !== undefined) validation('catalog_key is not allowed for local resolve')
    return { source: 'local', contentSha256: sha256(body.content_sha256) }
  }
  validation('source: expected catalog or local')
}

export function parseReaderProgressBody(body) {
  exactKeys(body, ['progress_fraction', 'text_offset', 'chapter_key'], 'body')
  const hasFraction = body.progress_fraction !== undefined
  const hasTextOffset = body.text_offset !== undefined
  if (hasFraction === hasTextOffset) {
    validation('body: provide exactly one of progress_fraction or text_offset')
  }
  if (
    hasFraction &&
    (typeof body.progress_fraction !== 'number' ||
      !Number.isFinite(body.progress_fraction) ||
      body.progress_fraction < 0 ||
      body.progress_fraction > 1)
  ) {
    validation('progress_fraction: expected a finite number from 0 to 1')
  }
  if (hasTextOffset && (!Number.isSafeInteger(body.text_offset) || body.text_offset < 0)) {
    validation('text_offset: expected a non-negative safe integer')
  }
  if (
    body.chapter_key !== undefined &&
    (typeof body.chapter_key !== 'string' || body.chapter_key.length > 200 || /[\u0000-\u001f]/.test(body.chapter_key))
  ) {
    validation('chapter_key: invalid value')
  }
  return {
    progressFraction: hasFraction ? body.progress_fraction : null,
    textOffset: hasTextOffset ? body.text_offset : null,
    chapterKey: body.chapter_key?.trim() || null
  }
}

function boundedText(value, name, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) {
    validation(`${name}: invalid value`)
  }
  const normalized = value.trim()
  if (!allowEmpty && !normalized) validation(`${name}: required`)
  return normalized
}

export function parsePrivateUploadBody(body, maxBytes = 50 * 1024 * 1024) {
  exactKeys(body, ['content_sha256', 'title', 'author', 'format', 'byte_size'], 'body')
  const format = boundedText(body.format, 'format', 16)
  if (!BOOK_FORMATS.has(format)) validation('format: unsupported book format')
  if (!Number.isSafeInteger(body.byte_size) || body.byte_size < 1 || body.byte_size > maxBytes) {
    validation(`byte_size: expected 1-${maxBytes}`)
  }
  return {
    contentSha256: sha256(body.content_sha256),
    title: boundedText(body.title, 'title', 500),
    author: boundedText(body.author ?? '', 'author', 500, { allowEmpty: true }),
    format,
    mimeType: BOOK_MIME_TYPES[format],
    byteSize: body.byte_size
  }
}

export function encodeCatalogCursor(cursor) {
  if (!cursor) return null
  return Buffer.from(JSON.stringify({
    v: 1,
    created_at: cursor.createdAt,
    id: cursor.id
  })).toString('base64url')
}

export function decodeCatalogCursor(value) {
  if (!value) return null
  try {
    const cursor = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (
      cursor.v !== 1 ||
      typeof cursor.created_at !== 'string' ||
      !Number.isFinite(Date.parse(cursor.created_at)) ||
      !UUID.test(cursor.id)
    ) {
      validation('cursor: invalid value')
    }
    return { createdAt: cursor.created_at, id: cursor.id }
  } catch (error) {
    if (error?.code === 'VALIDATION') throw error
    validation('cursor: invalid value')
  }
}

function limit(value) {
  if (value === undefined) return 20
  if (!/^\d{1,3}$/.test(String(value))) validation('limit: invalid value')
  const parsed = Number(value)
  if (parsed < 1 || parsed > 100) validation('limit: expected 1-100')
  return parsed
}

function asyncRoute(operation) {
  return (req, res, next) => void operation(req, res).catch(next)
}

function bookJson(book) {
  return {
    resolution: book.resolution,
    book_edition_id: book.bookEditionId,
    catalog_key: book.catalogKey,
    title: book.title,
    author: book.author,
    format: book.format,
    content_sha256: book.contentSha256,
    generation_status: book.generationStatus,
    ready: book.ready,
    source_download_path: book.sourceDownloadPath
  }
}

function manifestJson(manifest) {
  return {
    book: bookJson(manifest.book),
    availability: manifest.availability,
    reader_text_offset: manifest.readerTextOffset,
    reading_fraction: manifest.readingFraction,
    markup: manifest.markup && {
      schema_version: manifest.markup.schemaVersion,
      analysis_version: manifest.markup.analysisVersion,
      revision: manifest.markup.revision,
      text_length: manifest.markup.textLength,
      published_at: manifest.markup.publishedAt
    },
    characters: manifest.characters.map((character) => ({
      character_key: character.characterKey,
      name: character.name,
      full_name: character.fullName,
      first_appearance_text_offset: character.firstAppearanceTextOffset,
      state: character.state,
      profile: character.profile,
      bundle: character.bundle && {
        version: character.bundle.version,
        assets: character.bundle.assets.map((asset) => ({
          asset_id: asset.assetId,
          type: asset.type,
          content_hash: asset.contentHash,
          mime_type: asset.mimeType,
          byte_size: asset.byteSize,
          download_path: asset.downloadPath
        }))
      }
    }))
  }
}

export function createBookCatalogRouter({
  repository,
  storage = null,
  uploadMaxBytes = 50 * 1024 * 1024
}) {
  const router = express.Router()
  const service = createBookCatalogService({ repository, storage })
  const subject = (req) => uuid(req.installation?.sub, 'installation subject')

  router.get('/catalog', asyncRoute(async (req, res) => {
    const result = await service.listCatalog({
      limit: limit(req.query.limit),
      cursor: decodeCatalogCursor(req.query.cursor)
    })
    res.json({
      items: result.items.map(bookJson),
      next_cursor: encodeCatalogCursor(result.nextCursor)
    })
  }))

  router.post('/resolve', express.json({ limit: '16kb' }), asyncRoute(async (req, res) => {
    const result = await service.resolve(subject(req), parseBookResolveBody(req.body))
    res.json(bookJson(result))
  }))

  router.post(
    '/private/uploads',
    express.json({ limit: '16kb' }),
    asyncRoute(async (req, res) => {
      const result = await service.beginPrivateUpload(
        subject(req),
        parsePrivateUploadBody(req.body, uploadMaxBytes)
      )
      res.status(result.upload ? 201 : 200).json({
        ...bookJson(result),
        upload: result.upload && {
          url: result.upload.url,
          method: result.upload.method,
          headers: result.upload.headers,
          expires_at: result.upload.expiresAt
        }
      })
    })
  )

  router.post(
    '/:bookEditionId/upload-complete',
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      if (req.body !== undefined && req.body !== null) exactKeys(req.body, [], 'body')
      const result = await service.completePrivateUpload(
        subject(req),
        uuid(req.params.bookEditionId, 'bookEditionId')
      )
      res.status(202).json(bookJson(result))
    })
  )

  router.get('/:bookEditionId/source/download', asyncRoute(async (req, res) => {
    const result = await service.sourceDownload(
      subject(req),
      uuid(req.params.bookEditionId, 'bookEditionId')
    )
    res.json({ download_url: result.url, expires_at: result.expiresAt })
  }))

  router.get('/:bookEditionId/media/:assetId/download', asyncRoute(async (req, res) => {
    const result = await service.mediaDownload(
      subject(req),
      uuid(req.params.bookEditionId, 'bookEditionId'),
      uuid(req.params.assetId, 'assetId')
    )
    res.json({ download_url: result.url, expires_at: result.expiresAt })
  }))

  router.get('/:bookEditionId/manifest', asyncRoute(async (req, res) => {
    const result = await service.manifest(
      subject(req),
      uuid(req.params.bookEditionId, 'bookEditionId')
    )
    res.status(result.availability === 'processing' ? 202 : 200).json(manifestJson(result))
  }))

  router.post(
    '/:bookEditionId/progress',
    express.json({ limit: '16kb' }),
    asyncRoute(async (req, res) => {
      const result = await service.advanceProgress(
        subject(req),
        uuid(req.params.bookEditionId, 'bookEditionId'),
        parseReaderProgressBody(req.body)
      )
      res.json({
        book_edition_id: result.bookEditionId,
        reader_text_offset: result.readerTextOffset,
        reading_fraction: result.readingFraction,
        chapter_key: result.chapterKey,
        warmup: result.warmup
      })
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
