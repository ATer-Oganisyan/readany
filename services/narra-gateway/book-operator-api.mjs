import express from 'express'
import { createCatalogIngestService } from './catalog-ingest-service.mjs'
import {
  parseCatalogCoverUploadBody,
  parseCatalogUploadBody
} from './catalog-ingest-api.mjs'
import { requireBasicAuth } from './security.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function serviceError(code, message, status) {
  return Object.assign(new Error(message), { code, status })
}

function uuid(value, name = 'bookEditionId') {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw serviceError('VALIDATION', `${name}: invalid UUID`, 400)
  }
  return value.toLowerCase()
}

function exactEmptyBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
    throw serviceError('VALIDATION', 'body: expected empty object', 400)
  }
}

function asyncRoute(operation) {
  return (req, res, next) => void operation(req, res).catch(next)
}

function contentType(req) {
  return String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
}

function missingBook(value) {
  if (!value) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)
  return value
}

export function createBookOperatorRouter({
  username = 'narra',
  password,
  dashboardRepository,
  catalogService,
  repository,
  analysisRepository,
  storage,
  uploadMaxBytes = 50 * 1024 * 1024,
  uiDirectory = new URL('./operator-ui/', import.meta.url).pathname
}) {
  if (!dashboardRepository || [
    'listBooks',
    'getBookDetails',
    'getBookJson',
    'getBookOperations'
  ].some((method) => typeof dashboardRepository[method] !== 'function')) {
    throw new TypeError('book operator dashboard repository is required')
  }
  const ingest = catalogService ?? createCatalogIngestService({
    repository,
    analysisRepository,
    storage
  })
  const router = express.Router()
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
    next()
  })
  router.use(requireBasicAuth({ username, password, realm: 'Narra books' }))

  router.get('/api/books', asyncRoute(async (_req, res) => {
    res.json({ books: await dashboardRepository.listBooks() })
  }))

  router.get('/api/books/:bookEditionId', asyncRoute(async (req, res) => {
    res.json(missingBook(await dashboardRepository.getBookDetails(uuid(req.params.bookEditionId))))
  }))

  router.get('/api/books/:bookEditionId/json', asyncRoute(async (req, res) => {
    res.json(missingBook(await dashboardRepository.getBookJson(uuid(req.params.bookEditionId))))
  }))

  router.get('/api/books/:bookEditionId/operations', asyncRoute(async (req, res) => {
    const operations = missingBook(
      await dashboardRepository.getBookOperations(uuid(req.params.bookEditionId))
    )
    res.json({ operations })
  }))

  router.post('/api/uploads', express.json({ limit: '16kb' }), asyncRoute(async (req, res) => {
    const value = await ingest.begin(parseCatalogUploadBody(req.body, uploadMaxBytes))
    res.status(value.uploadRequired ? 201 : 200).json(value)
  }))

  router.post(
    '/api/uploads/:bookEditionId/content',
    express.raw({ type: () => true, limit: uploadMaxBytes }),
    asyncRoute(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.byteLength) {
        throw serviceError('VALIDATION', 'book content: required', 400)
      }
      const value = await ingest.upload(
        uuid(req.params.bookEditionId),
        req.body,
        contentType(req)
      )
      res.status(201).json(value)
    })
  )

  router.post(
    '/api/uploads/:bookEditionId/complete',
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      exactEmptyBody(req.body ?? {})
      res.status(202).json(await ingest.complete(uuid(req.params.bookEditionId)))
    })
  )

  router.post(
    '/api/uploads/:bookEditionId/cover',
    express.json({ limit: '16kb' }),
    asyncRoute(async (req, res) => {
      const value = await ingest.beginCover(
        uuid(req.params.bookEditionId),
        parseCatalogCoverUploadBody(req.body)
      )
      res.status(value.uploadRequired ? 201 : 200).json(value)
    })
  )

  router.post(
    '/api/uploads/:bookEditionId/cover/content',
    express.raw({ type: () => true, limit: '10mb' }),
    asyncRoute(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.byteLength) {
        throw serviceError('VALIDATION', 'cover content: required', 400)
      }
      res.status(201).json(await ingest.uploadCover(
        uuid(req.params.bookEditionId),
        req.body,
        contentType(req)
      ))
    })
  )

  router.post(
    '/api/uploads/:bookEditionId/cover/complete',
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      exactEmptyBody(req.body ?? {})
      res.json(await ingest.completeCover(uuid(req.params.bookEditionId)))
    })
  )

  router.use('/assets', express.static(uiDirectory, {
    etag: true,
    fallthrough: false,
    index: false,
    maxAge: 0
  }))
  router.get('/', (_req, res) => res.sendFile('index.html', { root: uiDirectory }))

  router.use((error, _req, res, next) => {
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code || 'VALIDATION'
      })
    }
    console.error('[book-operator] request failed', error)
    if (res.headersSent) return next(error)
    return res.status(500).json({ error: 'Внутренняя ошибка оператора', code: 'INTERNAL' })
  })
  return router
}
