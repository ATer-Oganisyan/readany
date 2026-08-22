import {
  CHARACTER_BUNDLE_VERSION,
  LOCAL_MARKUP_ANALYSIS_VERSION,
  LOCAL_MARKUP_PROGRESS_SCALE,
  ensureCharacterBundle,
  isCompleteCharacterBundle,
  readerCharacterState
} from './book-markup.mjs'
import {
  BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION,
  BOOK_ANALYSIS_MARKUP_VERSION,
  normalizeBookMarkupV3
} from './book-analysis-contracts.mjs'
import {
  BOOK_CONTENT_CHUNK_BYTES,
  BOOK_CONTENT_CONTRACT_VERSION,
  decodeBookContentCursor,
  encodeBookContentCursor,
  utf8ChunkPrefixLength
} from './book-content.mjs'
import { voiceForGender } from './voices.mjs'
import { createHash, randomUUID } from 'node:crypto'

function serviceError(code, message, status) {
  return Object.assign(new Error(message), { code, status })
}

function requiredRepository(repository) {
  const methods = [
    'listCatalogBooks',
    'resolveBook',
    'getReaderBookManifest',
    'advanceReaderPosition'
  ]
  if (!repository || methods.some((method) => typeof repository[method] !== 'function')) {
    throw new TypeError('book catalog repository is incomplete')
  }
  return repository
}

function bookBinding(edition) {
  const binding = {
    resolution: edition.scope,
    bookEditionId: edition.id,
    catalogKey: edition.catalogKey ?? undefined,
    title: edition.title,
    author: edition.author,
    format: edition.format,
    contentSha256: edition.contentSha256,
    generationStatus: edition.status,
    ready: ['base_ready', 'published'].includes(edition.status),
    sourceDownloadPath: edition.sourceStorage === 'stored'
      ? `/v2/books/${edition.id}/source/download`
      : undefined,
    expiresAt: edition.expiresAt ?? undefined
  }
  if (edition.cover) {
    binding.cover = {
      contentHash: edition.cover.contentHash,
      mimeType: edition.cover.mimeType,
      byteSize: edition.cover.byteSize,
      downloadPath: `/v2/books/${edition.id}/cover/download`
    }
  }
  return binding
}

function publicAsset(asset) {
  return {
    assetId: asset.assetId,
    type: asset.type,
    contentHash: asset.contentHash,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    downloadPath: asset.downloadPath
  }
}

function claimValue(claim) {
  return typeof claim?.value === 'string' ? claim.value : ''
}

function analysisCharacterProfile(character, analysisSource) {
  const gender = claimValue(character.gender)
  const normalizedGender = gender === 'male' || gender === 'female' ? gender : undefined
  const appearancePrompt = character.creative?.appearancePrompt || character.appearance
    .map(claimValue)
    .filter(Boolean)
    .join(', ')
  return {
    role: claimValue(character.role) || 'Персонаж истории',
    gender: normalizedGender,
    traits: character.traits.map(claimValue).filter(Boolean).slice(0, 5),
    personalityTimelineVersion: character.personalityTimelineVersion || undefined,
    personalitySnapshots: character.personalitySnapshots.map((snapshot) => ({
      cutoffTextOffset: snapshot.cutoffTextOffset,
      status: snapshot.status,
      traits: snapshot.traits.map((trait) => ({
        value: claimValue(trait),
        confidence: trait.confidence,
        evidenceLevel: trait.evidenceLevel
      })).filter(({ value }) => value).slice(0, 5)
    })),
    speechStyle: claimValue(character.speechStyle),
    speechExamples: character.speechExamples.map(claimValue).filter(Boolean).slice(0, 3),
    appearancePrompt,
    greeting: character.creative?.greeting || '',
    voice: voiceForGender(character.creative?.voice, normalizedGender),
    analysisSource
  }
}

function analysisReaderTextOffset(snapshot, textLength) {
  if (typeof snapshot.readingFraction === 'number' && Number.isFinite(snapshot.readingFraction)) {
    return Math.round(Math.min(1, Math.max(0, snapshot.readingFraction)) * textLength)
  }
  const publicTextLength = Number(snapshot.markup?.textLength)
  if (Number.isSafeInteger(publicTextLength) && publicTextLength > 0) {
    return Math.round(Math.min(1, snapshot.readerTextOffset / publicTextLength) * textLength)
  }
  return Math.min(textLength, Math.max(0, Number(snapshot.readerTextOffset) || 0))
}

export function createBookCatalogService({
  repository,
  analysisRepository = null,
  storage = null,
  bundleVersion = CHARACTER_BUNDLE_VERSION,
  idFactory = randomUUID,
  contentChunkBytes = BOOK_CONTENT_CHUNK_BYTES
}) {
  const store = requiredRepository(repository)
  if (!Number.isSafeInteger(contentChunkBytes) || contentChunkBytes < 4 || contentChunkBytes > 1024 * 1024) {
    throw new RangeError('contentChunkBytes must be between 4 bytes and 1 MiB')
  }

  async function preparedCatalogContent(subjectId, bookEditionId) {
    if (typeof store.getReaderBookContent !== 'function') {
      throw new TypeError('repository.getReaderBookContent is required')
    }
    if (!storage) throw serviceError('DOWNLOAD_UNAVAILABLE', 'Скачивание временно недоступно', 503)
    const content = await store.getReaderBookContent({ subjectId, bookEditionId })
    if (!content) throw serviceError('NOT_FOUND', 'Содержимое книги не найдено', 404)
    return content
  }

  async function ensureCanonicalAnalysis(edition) {
    if (!analysisRepository || typeof analysisRepository.ensureAnalysisRun !== 'function') {
      throw serviceError('ANALYSIS_UNAVAILABLE', 'Разметка v3 временно недоступна', 503)
    }
    const analysis = await analysisRepository.ensureAnalysisRun({
      bookEditionId: edition.id,
      inputHash: edition.contentSha256,
      priority: 50
    })
    return {
      analysisRunId: analysis.run.id,
      analysisStage: analysis.run.stage,
      analysisStatus: analysis.run.status,
      analysisCreated: analysis.created,
      jobId: analysis.prepareJob.id,
      jobStatus: analysis.prepareJob.status
    }
  }

  async function v3Manifest(snapshot, bookEditionId, source = 'v3') {
    if (!analysisRepository || typeof analysisRepository.getLatestShadowAnalysisPublication !== 'function') {
      throw serviceError('ANALYSIS_UNAVAILABLE', 'Разметка v3 временно недоступна', 503)
    }
    const publication = await analysisRepository.getLatestShadowAnalysisPublication(bookEditionId)
    if (!publication?.data?.markup) {
      const preview = typeof analysisRepository.getLatestAnalysisPreview === 'function'
        ? await analysisRepository.getLatestAnalysisPreview(bookEditionId)
        : null
      const textLength = Number(preview?.run?.textLength)
      const readerTextOffset = Number.isSafeInteger(textLength) && textLength > 0
        ? analysisReaderTextOffset(snapshot, textLength)
        : Math.max(0, Number(snapshot.readerTextOffset) || 0)
      return {
        source,
        book: bookBinding(snapshot.edition),
        availability: 'processing',
        runId: preview?.run?.id,
        readerTextOffset,
        readingFraction: snapshot.readingFraction,
        readerSectionIndex: snapshot.readerSectionIndex,
        readerSectionFraction: snapshot.readerSectionFraction,
        markup: null,
        analysis: preview
          ? {
              stage: preview.run.stage,
              status: preview.run.status,
              textLength: preview.run.textLength,
              completedScanChunks: preview.scan.completedChunks,
              totalScanChunks: preview.scan.totalChunks
            }
          : null,
        characters: (preview?.characters ?? [])
          .filter((character) => character.firstAppearanceTextOffset <= readerTextOffset)
          .map((character) => ({
            characterKey: character.characterKey,
            name: character.name,
            fullName: character.fullName,
            firstAppearanceTextOffset: character.firstAppearanceTextOffset,
            provisional: true,
            state: 'preparing',
            profile: {
              role: 'Профиль формируется',
              traits: [],
              speechStyle: '',
              speechExamples: [],
              appearancePrompt: '',
              greeting: '',
              analysisSource: source,
              provisional: true
            },
            bundle: null
          }))
      }
    }
    const markup = normalizeBookMarkupV3(publication.data.markup)
    const readerTextOffset = analysisReaderTextOffset(snapshot, markup.textLength)
    const mediaByCharacterKey = new Map(
      (snapshot.characters || []).map((character) => [character.characterKey, character])
    )
    return {
      source,
      book: bookBinding(snapshot.edition),
      availability: 'ready',
      publicationId: publication.id,
      runId: publication.runId,
      contentHash: publication.contentHash,
      publishedAt: publication.publishedAt,
      readerTextOffset,
      readingFraction: snapshot.readingFraction,
      readerSectionIndex: snapshot.readerSectionIndex,
      readerSectionFraction: snapshot.readerSectionFraction,
      markup: {
        schemaVersion: markup.schemaVersion,
        analysisVersion: markup.analysisVersion,
        textLength: markup.textLength,
        scenePolicy: markup.scenePolicy,
        publishedAt: publication.publishedAt
      },
      characters: markup.characters
        .map((character) => {
          const media = mediaByCharacterKey.get(character.characterKey)
          const state = isCompleteCharacterBundle(media?.bundle) ? 'ready' : 'preparing'
          return {
            characterKey: character.characterKey,
            name: character.name,
            fullName: character.fullName,
            firstAppearanceTextOffset: character.firstAppearanceTextOffset,
            provisional: false,
            state,
            profile: analysisCharacterProfile(character, source),
            bundle: media?.bundle?.assets?.length
              ? {
                  version: media.bundle.version,
                  assets: media.bundle.assets.map((asset) => publicAsset({
                    ...asset,
                    downloadPath: `/v2/books/${bookEditionId}/media/${asset.assetId}/download`
                  }))
                }
              : null
          }
        })
    }
  }

  function legacyManifest(snapshot, bookEditionId) {
    if (!snapshot.markup) {
      return {
        book: bookBinding(snapshot.edition),
        availability: 'processing',
        readerTextOffset: snapshot.readerTextOffset,
        readingFraction: snapshot.readingFraction,
        readerSectionIndex: snapshot.readerSectionIndex,
        readerSectionFraction: snapshot.readerSectionFraction,
        markup: null,
        characters: []
      }
    }
    const characters = []
    for (const character of snapshot.characters) {
      const state = readerCharacterState(character, character.bundle, {
        textOffset: snapshot.readerTextOffset,
        sectionIndex: snapshot.readerSectionIndex,
        sectionFraction: snapshot.readerSectionFraction
      })
      if (state === 'hidden') continue
      characters.push({
        characterKey: character.characterKey,
        name: character.name,
        fullName: character.fullName,
        firstAppearanceTextOffset: character.firstAppearanceTextOffset,
        state,
        profile: character.data,
        bundle: character.bundle?.assets?.length
          ? {
              version: character.bundle.version,
              assets: character.bundle.assets.map((asset) => publicAsset({
                ...asset,
                downloadPath: `/v2/books/${bookEditionId}/media/${asset.assetId}/download`
              }))
            }
          : null
      })
    }
    return {
      book: bookBinding(snapshot.edition),
      availability: 'ready',
      readerTextOffset: snapshot.readerTextOffset,
      readingFraction: snapshot.readingFraction,
      readerSectionIndex: snapshot.readerSectionIndex,
      readerSectionFraction: snapshot.readerSectionFraction,
      markup: {
        schemaVersion: snapshot.markup.schemaVersion,
        analysisVersion: snapshot.markup.analysisVersion,
        revision: snapshot.markup.revision,
        textLength: snapshot.markup.textLength,
        publishedAt: snapshot.markup.publishedAt
      },
      characters
    }
  }

  return {
    async listCatalog({ limit, cursor }) {
      const result = await store.listCatalogBooks({ limit, cursor })
      return {
        items: result.items.map((edition) => bookBinding(edition)),
        nextCursor: result.nextCursor
      }
    },

    async resolve(subjectId, input) {
      const edition = await store.resolveBook({ subjectId, ...input })
      if (!edition && input.source === 'catalog') {
        throw serviceError('NOT_FOUND', 'Книга каталога не найдена', 404)
      }
      if (!edition) {
        return {
          resolution: 'local_registration_required',
          contentSha256: input.contentSha256,
          ready: false
        }
      }
      return bookBinding(edition)
    },

    async registerLocalBook(subjectId, input) {
      if (typeof store.registerLocalBook !== 'function') {
        throw new TypeError('repository.registerLocalBook is required')
      }
      const proposedBookEditionId = idFactory()
      const edition = await store.registerLocalBook({
        subjectId,
        proposedBookEditionId,
        ...input
      })
      return bookBinding(edition)
    },

    async uploadLocalSource(subjectId, bookEditionId, bytes, contentType) {
      if (typeof store.beginPrivateBookUpload !== 'function' ||
          typeof store.completePrivateBookUpload !== 'function') {
        throw new TypeError('private book upload repository is incomplete')
      }
      if (!storage) throw serviceError('UPLOAD_UNAVAILABLE', 'Загрузка книги временно недоступна', 503)
      const sourceBytes = Buffer.from(bytes)
      if (!sourceBytes.byteLength) {
        throw serviceError('VALIDATION', 'Файл книги пуст', 400)
      }
      const contentSha256 = createHash('sha256').update(sourceBytes).digest('hex')
      const objectKey = `books/private/${subjectId}/${contentSha256}/source`
      const prepared = await store.beginPrivateBookUpload({
        subjectId,
        bookEditionId,
        contentSha256,
        objectKey,
        mimeType: contentType,
        byteSize: sourceBytes.byteLength
      })
      if (!prepared) throw serviceError('NOT_FOUND', 'Локальная книга не найдена', 404)
      if (prepared.uploadRequired) {
        const stored = await storage.putBytes({
          objectKey: prepared.file.objectKey,
          bytes: sourceBytes,
          mimeType: prepared.file.mimeType
        })
        if (stored.contentHash !== prepared.file.contentSha256 ||
            stored.byteSize !== prepared.file.byteSize) {
          throw serviceError('UPLOAD_INTEGRITY', 'Хранилище вернуло другой checksum', 409)
        }
      }
      const edition = prepared.uploadRequired
        ? await store.completePrivateBookUpload({ subjectId, bookEditionId })
        : prepared.edition
      if (!edition) throw serviceError('NOT_FOUND', 'Локальная книга не найдена', 404)
      await store.enqueueBookIdentity?.({ bookEditionId })
      const analysis = await ensureCanonicalAnalysis(edition)
      return {
        ...bookBinding(edition),
        sourceUploaded: true,
        ...analysis
      }
    },

    async publishLocalMarkup(subjectId, bookEditionId, input) {
      if (typeof store.publishLocalBookMarkup !== 'function') {
        throw new TypeError('repository.publishLocalBookMarkup is required')
      }
      const canonical = JSON.stringify({
        analysisVersion: LOCAL_MARKUP_ANALYSIS_VERSION,
        characters: input.characters
      })
      const published = await store.publishLocalBookMarkup({
        subjectId,
        bookEditionId,
        analysisVersion: LOCAL_MARKUP_ANALYSIS_VERSION,
        inputHash: createHash('sha256').update(canonical).digest('hex'),
        textLength: LOCAL_MARKUP_PROGRESS_SCALE,
        characters: input.characters.map((character) => ({
          ...character,
          firstAppearanceTextOffset: Math.round(
            LOCAL_MARKUP_PROGRESS_SCALE * character.firstAppearanceFraction
          ),
          warmupTextOffset: Math.round(
            LOCAL_MARKUP_PROGRESS_SCALE * character.warmupFraction
          )
        }))
      })
      if (!published) throw serviceError('NOT_FOUND', 'Локальная книга не найдена', 404)
      return {
        ...bookBinding(published.edition),
        markupRevision: published.revision,
        created: published.created
      }
    },

    async sourceDownload(subjectId, bookEditionId) {
      if (typeof store.getReaderBookSource !== 'function') {
        throw new TypeError('repository.getReaderBookSource is required')
      }
      if (!storage) throw serviceError('DOWNLOAD_UNAVAILABLE', 'Скачивание временно недоступно', 503)
      const source = await store.getReaderBookSource({ subjectId, bookEditionId })
      if (!source) throw serviceError('NOT_FOUND', 'Файл книги не найден', 404)
      return storage.createDownload(source)
    },

    async fullContent(subjectId, bookEditionId) {
      const content = await preparedCatalogContent(subjectId, bookEditionId)
      if (typeof storage.getObjectInfo !== 'function') {
        throw new TypeError('storage.getObjectInfo is required')
      }
      const info = await storage.getObjectInfo({ objectKey: content.objectKey })
      const download = await storage.createDownload({
        objectKey: content.objectKey,
        mimeType: 'text/plain; charset=utf-8',
        filename: `${bookEditionId}.txt`
      })
      return {
        contractVersion: BOOK_CONTENT_CONTRACT_VERSION,
        representation: content.normalizationVersion,
        bookEditionId,
        contentHash: content.contentHash,
        textLength: content.textLength,
        byteSize: info.byteSize,
        ...download
      }
    },

    async contentChunk(subjectId, bookEditionId, rawCursor) {
      const content = await preparedCatalogContent(subjectId, bookEditionId)
      if (typeof storage.getObjectInfo !== 'function' || typeof storage.getBytesRange !== 'function') {
        throw new TypeError('storage range reads are required')
      }
      const info = await storage.getObjectInfo({ objectKey: content.objectKey })
      if (info.byteSize < 1) throw serviceError('CONTENT_INVALID', 'Содержимое книги пусто', 500)
      const cursor = rawCursor ? decodeBookContentCursor(rawCursor) : null
      if (cursor && cursor.contentHash !== content.contentHash) {
        throw serviceError('CONTENT_VERSION_CHANGED', 'Версия содержимого книги изменилась', 409)
      }
      const startByte = cursor?.byteOffset ?? 0
      if (startByte < 0 || startByte >= info.byteSize) {
        throw serviceError('VALIDATION', 'content cursor: offset is outside the book', 400)
      }
      const requestedEnd = Math.min(info.byteSize, startByte + contentChunkBytes + 3)
      const stored = await storage.getBytesRange({
        objectKey: content.objectKey,
        startByte,
        endByteExclusive: requestedEnd,
        maxBytes: contentChunkBytes + 3
      })
      const safeLength = utf8ChunkPrefixLength(stored.bytes, contentChunkBytes)
      if (safeLength < 1) throw serviceError('CONTENT_INVALID', 'Не удалось прочитать фрагмент книги', 500)
      const chunkBytes = stored.bytes.subarray(0, safeLength)
      const endByteExclusive = startByte + safeLength
      return {
        contractVersion: BOOK_CONTENT_CONTRACT_VERSION,
        representation: content.normalizationVersion,
        bookEditionId,
        contentHash: content.contentHash,
        textLength: content.textLength,
        byteSize: info.byteSize,
        chunk: {
          startByte,
          endByteExclusive,
          contentHash: createHash('sha256').update(chunkBytes).digest('hex'),
          text: chunkBytes.toString('utf8')
        },
        nextCursor: endByteExclusive < info.byteSize
          ? encodeBookContentCursor({
              contentHash: content.contentHash,
              byteOffset: endByteExclusive
            })
          : null
      }
    },

    async coverDownload(subjectId, bookEditionId) {
      if (typeof store.getCatalogBookCover !== 'function') {
        throw new TypeError('repository.getCatalogBookCover is required')
      }
      if (!storage) throw serviceError('DOWNLOAD_UNAVAILABLE', 'Скачивание временно недоступно', 503)
      const cover = await store.getCatalogBookCover({ subjectId, bookEditionId })
      if (!cover) throw serviceError('NOT_FOUND', 'Обложка книги не найдена', 404)
      return storage.createDownload(cover)
    },

    async mediaDownload(subjectId, bookEditionId, assetId) {
      if (typeof store.getReaderMediaAsset !== 'function') {
        throw new TypeError('repository.getReaderMediaAsset is required')
      }
      if (!storage) throw serviceError('DOWNLOAD_UNAVAILABLE', 'Скачивание временно недоступно', 503)
      const asset = await store.getReaderMediaAsset({
        subjectId,
        bookEditionId,
        assetId,
        bundleVersion: analysisRepository
          ? BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION
          : bundleVersion
      })
      if (!asset) throw serviceError('NOT_FOUND', 'Материал не найден', 404)
      return storage.createDownload(asset)
    },

    async sceneAt(subjectId, bookEditionId, { readerTextOffset, progressFraction }) {
      if (typeof store.ensureReaderBookScene !== 'function') {
        throw new TypeError('repository.ensureReaderBookScene is required')
      }
      if (typeof analysisRepository?.ensureLatestMediaProjection === 'function') {
        await analysisRepository.ensureLatestMediaProjection(bookEditionId)
      }
      const scene = await store.ensureReaderBookScene({
        subjectId,
        bookEditionId,
        readerTextOffset,
        progressFraction
      })
      if (!scene) throw serviceError('NOT_FOUND', 'Книга или сцена не найдена', 404)
      const result = {
        status: scene.status,
        sceneKey: scene.sceneKey,
        slotIndex: scene.slotIndex,
        anchorTextOffset: scene.anchorTextOffset,
        pollAfterMs: scene.status === 'ready' ? undefined : 2_000
      }
      if (scene.status !== 'ready' || !scene.asset) return result
      if (!storage) throw serviceError('DOWNLOAD_UNAVAILABLE', 'Скачивание временно недоступно', 503)
      const download = await storage.createDownload(scene.asset)
      return {
        ...result,
        imageUrl: download.url,
        expiresAt: download.expiresAt,
        mimeType: scene.asset.mimeType
      }
    },

    async manifest(subjectId, bookEditionId) {
      if (typeof analysisRepository?.ensureLatestMediaProjection === 'function') {
        await analysisRepository.ensureLatestMediaProjection(bookEditionId)
      }
      const snapshot = await store.getReaderBookManifest({
        subjectId,
        bookEditionId,
        bundleVersion: analysisRepository
          ? BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION
          : bundleVersion
      })
      if (!snapshot) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)
      await store.ensureBookScenesThrough?.({
        subjectId,
        bookEditionId,
        readerTextOffset: snapshot.readerTextOffset
      })
      return analysisRepository?.getLatestShadowAnalysisPublication
        ? v3Manifest(snapshot, bookEditionId)
        : legacyManifest(snapshot, bookEditionId)
    },

    async shadowManifest(subjectId, bookEditionId) {
      if (!analysisRepository || typeof analysisRepository.getLatestShadowAnalysisPublication !== 'function') {
        throw serviceError('PREVIEW_UNAVAILABLE', 'Теневая разметка недоступна', 503)
      }
      if (typeof analysisRepository.ensureLatestMediaProjection === 'function') {
        await analysisRepository.ensureLatestMediaProjection(bookEditionId)
      }
      const snapshot = await store.getReaderBookManifest({
        subjectId,
        bookEditionId,
        bundleVersion: BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION
      })
      if (!snapshot || snapshot.edition?.scope !== 'catalog') {
        throw serviceError('NOT_FOUND', 'Книга каталога не найдена', 404)
      }
      const manifest = await v3Manifest(snapshot, bookEditionId, 'shadow-v3')
      if (manifest.availability !== 'ready') {
        throw serviceError('SHADOW_NOT_READY', 'Для книги ещё нет готовой v3-разметки', 404)
      }
      return manifest
    },

    async advanceProgress(
      subjectId,
      bookEditionId,
      { progressFraction, textOffset, chapterKey, sectionIndex, sectionFraction }
    ) {
      if (typeof analysisRepository?.ensureLatestMediaProjection === 'function') {
        await analysisRepository.ensureLatestMediaProjection(bookEditionId)
      }
      const progress = await store.advanceReaderPosition({
        subjectId,
        bookEditionId,
        progressFraction,
        textOffset,
        chapterKey,
        sectionIndex,
        sectionFraction
      })
      if (!progress) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)

      const charactersDue = analysisRepository
        ? progress.analysisVersion === BOOK_ANALYSIS_MARKUP_VERSION
          ? progress.charactersDue
          : []
        : progress.scope === 'catalog' ? [] : progress.charactersDue
      const requests = await Promise.allSettled(charactersDue.map((character) =>
        ensureCharacterBundle(store, {
          bookEditionId,
          characterKey: character.characterKey,
          bundleVersion: analysisRepository
            ? BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION
            : bundleVersion
        })
      ))
      const warmed = { ready: 0, pending: 0, failed: 0 }
      for (const request of requests) {
        if (request.status === 'rejected') warmed.failed += 1
        else if (request.value.status === 'ready') warmed.ready += 1
        else warmed.pending += 1
      }
      const sceneWarmup = typeof store.ensureBookScenesThrough === 'function'
        ? await store.ensureBookScenesThrough({
            subjectId,
            bookEditionId,
            readerTextOffset: progress.readerTextOffset
          })
        : { requested: 0, ready: 0, pending: 0, failed: 0 }
      return {
        bookEditionId,
        readerTextOffset: progress.readerTextOffset,
        readingFraction: progress.readingFraction,
        chapterKey: progress.chapterKey,
        readerSectionIndex: progress.readerSectionIndex,
        readerSectionFraction: progress.readerSectionFraction,
        warmup: {
          requested: requests.length,
          ...warmed
        },
        sceneWarmup
      }
    }
  }
}
