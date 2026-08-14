import express from 'express'
import { createBookCatalogService } from './book-catalog-service.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const CHARACTER_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const BOOK_FORMATS = new Set(['epub', 'fb2', 'txt', 'pdf'])

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
  exactKeys(body, [
    'progress_fraction', 'text_offset', 'chapter_key', 'section_index', 'section_fraction'
  ], 'body')
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
  const hasSectionIndex = body.section_index !== undefined
  const hasSectionFraction = body.section_fraction !== undefined
  if (hasSectionIndex !== hasSectionFraction) {
    validation('body: section_index and section_fraction must be provided together')
  }
  if (hasSectionIndex && (!Number.isSafeInteger(body.section_index) || body.section_index < 0)) {
    validation('section_index: expected a non-negative safe integer')
  }
  if (
    hasSectionFraction &&
    (typeof body.section_fraction !== 'number' ||
      !Number.isFinite(body.section_fraction) ||
      body.section_fraction < 0 ||
      body.section_fraction > 1)
  ) {
    validation('section_fraction: expected a finite number from 0 to 1')
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
    chapterKey: body.chapter_key?.trim() || null,
    sectionIndex: hasSectionIndex ? body.section_index : null,
    sectionFraction: hasSectionFraction ? body.section_fraction : null
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

export function parseLocalBookBody(body) {
  exactKeys(body, ['content_sha256', 'title', 'author', 'format'], 'body')
  const format = boundedText(body.format, 'format', 16)
  if (!BOOK_FORMATS.has(format)) validation('format: unsupported book format')
  return {
    contentSha256: sha256(body.content_sha256),
    title: boundedText(body.title, 'title', 500),
    author: boundedText(body.author ?? '', 'author', 500, { allowEmpty: true }),
    format
  }
}

function fraction(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    validation(`${name}: expected a finite number from 0 to 1`)
  }
  return value
}

function stringArray(value, name, maxItems, maxLength) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) validation(`${name}: invalid array`)
  return value.map((item, index) => boundedText(item, `${name}[${index}]`, maxLength))
}

function localCharacterProfile(value) {
  exactKeys(value, [
    'clientCharacterId', 'role', 'gender', 'voice', 'traits', 'speechStyle', 'speechExamples',
    'appearancePrompt', 'passport', 'expression', 'greeting', 'isNarrator',
    'unlockProgress'
  ], 'profile')
  const profile = {
    clientCharacterId: boundedText(
      value.clientCharacterId ?? '',
      'profile.clientCharacterId',
      200,
      { allowEmpty: true }
    ),
    role: boundedText(value.role ?? 'Персонаж истории', 'profile.role', 500),
    gender: value.gender === 'female' ? 'female' : 'male',
    voice: boundedText(value.voice ?? 'She', 'profile.voice', 32),
    traits: stringArray(value.traits, 'profile.traits', 5, 120),
    speechStyle: boundedText(value.speechStyle ?? '', 'profile.speechStyle', 1_000, { allowEmpty: true }),
    speechExamples: stringArray(value.speechExamples, 'profile.speechExamples', 3, 500),
    appearancePrompt: boundedText(value.appearancePrompt ?? '', 'profile.appearancePrompt', 4_000, { allowEmpty: true }),
    expression: boundedText(value.expression ?? '', 'profile.expression', 300, { allowEmpty: true }),
    greeting: boundedText(value.greeting ?? '', 'profile.greeting', 2_000, { allowEmpty: true }),
    isNarrator: value.isNarrator === true,
    unlockProgress: fraction(value.unlockProgress ?? 0, 'profile.unlockProgress')
  }
  if (value.passport !== undefined) {
    exactKeys(value.passport, ['age', 'gender', 'build', 'hair', 'eyes', 'face', 'outfit'], 'profile.passport')
    profile.passport = {
      age: Math.max(1, Math.min(150, Number(value.passport.age) || 30)),
      gender: value.passport.gender === 'female' ? 'female' : 'male',
      build: boundedText(value.passport.build ?? '', 'profile.passport.build', 300, { allowEmpty: true }),
      hair: boundedText(value.passport.hair ?? '', 'profile.passport.hair', 300, { allowEmpty: true }),
      eyes: boundedText(value.passport.eyes ?? '', 'profile.passport.eyes', 300, { allowEmpty: true }),
      face: boundedText(value.passport.face ?? '', 'profile.passport.face', 500, { allowEmpty: true }),
      outfit: boundedText(value.passport.outfit ?? '', 'profile.passport.outfit', 500, { allowEmpty: true })
    }
  }
  return profile
}

export function parseLocalMarkupBody(body) {
  exactKeys(body, ['characters'], 'body')
  if (!Array.isArray(body.characters) || body.characters.length < 1 || body.characters.length > 12) {
    validation('characters: expected 1-12 items')
  }
  const seen = new Set()
  return {
    characters: body.characters.map((candidate, index) => {
      exactKeys(candidate, [
        'character_key', 'name', 'full_name', 'first_appearance_fraction',
        'warmup_fraction', 'profile'
      ], `characters[${index}]`)
      const characterKey = boundedText(candidate.character_key, `characters[${index}].character_key`, 128)
      if (!CHARACTER_KEY.test(characterKey) || seen.has(characterKey)) {
        validation(`characters[${index}].character_key: invalid or duplicate`)
      }
      seen.add(characterKey)
      const firstAppearanceFraction = fraction(
        candidate.first_appearance_fraction,
        `characters[${index}].first_appearance_fraction`
      )
      const warmupFraction = fraction(
        candidate.warmup_fraction,
        `characters[${index}].warmup_fraction`
      )
      if (warmupFraction > firstAppearanceFraction) {
        validation(`characters[${index}].warmup_fraction: must not be after first appearance`)
      }
      return {
        characterKey,
        name: boundedText(candidate.name, `characters[${index}].name`, 300),
        fullName: boundedText(candidate.full_name, `characters[${index}].full_name`, 500),
        firstAppearanceFraction,
        warmupFraction,
        profile: localCharacterProfile(candidate.profile)
      }
    })
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
  const value = {
    resolution: book.resolution,
    book_edition_id: book.bookEditionId,
    catalog_key: book.catalogKey,
    title: book.title,
    author: book.author,
    format: book.format,
    content_sha256: book.contentSha256,
    generation_status: book.generationStatus,
    ready: book.ready,
    source_download_path: book.sourceDownloadPath,
    expires_at: book.expiresAt
  }
  if (book.cover) {
    value.cover = {
      content_hash: book.cover.contentHash,
      mime_type: book.cover.mimeType,
      byte_size: book.cover.byteSize,
      download_path: book.cover.downloadPath
    }
  }
  return value
}

function manifestJson(manifest) {
  return {
    book: bookJson(manifest.book),
    availability: manifest.availability,
    reader_text_offset: manifest.readerTextOffset,
    reading_fraction: manifest.readingFraction,
    reader_section_index: manifest.readerSectionIndex,
    reader_section_fraction: manifest.readerSectionFraction,
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

function shadowManifestJson(manifest) {
  return {
    source: manifest.source,
    availability: 'ready',
    publication_id: manifest.publicationId,
    run_id: manifest.runId,
    content_hash: manifest.contentHash,
    published_at: manifest.publishedAt,
    reader_text_offset: manifest.readerTextOffset,
    reading_fraction: manifest.readingFraction,
    reader_section_index: manifest.readerSectionIndex,
    reader_section_fraction: manifest.readerSectionFraction,
    markup: {
      schema_version: manifest.markup.schemaVersion,
      analysis_version: manifest.markup.analysisVersion,
      text_length: manifest.markup.textLength
    },
    characters: manifest.characters.map((character) => ({
      character_key: character.characterKey,
      name: character.name,
      full_name: character.fullName,
      first_appearance_text_offset: character.firstAppearanceTextOffset,
      state: character.state,
      profile: character.profile,
      bundle: null
    }))
  }
}

export function createBookCatalogRouter({
  repository,
  analysisRepository = null,
  shadowPreviewEnabled = false,
  storage = null
}) {
  const router = express.Router()
  const service = createBookCatalogService({ repository, analysisRepository, storage })
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
    '/local',
    express.json({ limit: '16kb' }),
    asyncRoute(async (req, res) => {
      const result = await service.registerLocalBook(
        subject(req),
        parseLocalBookBody(req.body)
      )
      res.status(result.resolution === 'catalog' ? 200 : 201).json(bookJson(result))
    })
  )

  router.post(
    '/:bookEditionId/local-markup',
    express.json({ limit: '128kb' }),
    asyncRoute(async (req, res) => {
      const result = await service.publishLocalMarkup(
        subject(req),
        uuid(req.params.bookEditionId, 'bookEditionId'),
        parseLocalMarkupBody(req.body)
      )
      res.status(result.created ? 201 : 200).json({
        ...bookJson(result),
        markup_revision: result.markupRevision
      })
    })
  )

  router.get('/:bookEditionId/source/download', asyncRoute(async (req, res) => {
    const result = await service.sourceDownload(
      subject(req),
      uuid(req.params.bookEditionId, 'bookEditionId')
    )
    res.json({ download_url: result.url, expires_at: result.expiresAt })
  }))

  router.get('/:bookEditionId/cover/download', asyncRoute(async (req, res) => {
    const result = await service.coverDownload(
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

  router.get('/:bookEditionId/analysis-shadow/manifest', asyncRoute(async (req, res) => {
    if (!shadowPreviewEnabled) {
      throw Object.assign(new Error('Предпросмотр v3-разметки выключен'), {
        code: 'PREVIEW_DISABLED',
        status: 404
      })
    }
    const result = await service.shadowManifest(
      subject(req),
      uuid(req.params.bookEditionId, 'bookEditionId')
    )
    res.json(shadowManifestJson(result))
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
        section_index: result.readerSectionIndex,
        section_fraction: result.readerSectionFraction,
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
