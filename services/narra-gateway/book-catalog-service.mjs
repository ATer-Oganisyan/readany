import {
  CHARACTER_BUNDLE_VERSION,
  LOCAL_MARKUP_ANALYSIS_VERSION,
  LOCAL_MARKUP_PROGRESS_SCALE,
  ensureCharacterBundle,
  readerCharacterState
} from './book-markup.mjs'
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
  return {
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

export function createBookCatalogService({
  repository,
  storage = null,
  bundleVersion = CHARACTER_BUNDLE_VERSION,
  idFactory = randomUUID
}) {
  const store = requiredRepository(repository)

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

    async mediaDownload(subjectId, bookEditionId, assetId) {
      if (typeof store.getReaderMediaAsset !== 'function') {
        throw new TypeError('repository.getReaderMediaAsset is required')
      }
      if (!storage) throw serviceError('DOWNLOAD_UNAVAILABLE', 'Скачивание временно недоступно', 503)
      const asset = await store.getReaderMediaAsset({
        subjectId,
        bookEditionId,
        assetId,
        bundleVersion
      })
      if (!asset) throw serviceError('NOT_FOUND', 'Материал не найден', 404)
      return storage.createDownload(asset)
    },

    async manifest(subjectId, bookEditionId) {
      const snapshot = await store.getReaderBookManifest({
        subjectId,
        bookEditionId,
        bundleVersion
      })
      if (!snapshot) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)
      if (!snapshot.markup) {
        return {
          book: bookBinding(snapshot.edition),
          availability: 'processing',
          readerTextOffset: snapshot.readerTextOffset,
          readingFraction: snapshot.readingFraction,
          markup: null,
          characters: []
        }
      }

      const characters = []
      for (const character of snapshot.characters) {
        const state = readerCharacterState(
          character,
          character.bundle,
          snapshot.readerTextOffset
        )
        if (state === 'hidden') continue
        characters.push({
          characterKey: character.characterKey,
          name: character.name,
          fullName: character.fullName,
          firstAppearanceTextOffset: character.firstAppearanceTextOffset,
          state,
          profile: character.data,
          bundle: state === 'ready'
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
        markup: {
          schemaVersion: snapshot.markup.schemaVersion,
          analysisVersion: snapshot.markup.analysisVersion,
          revision: snapshot.markup.revision,
          textLength: snapshot.markup.textLength,
          publishedAt: snapshot.markup.publishedAt
        },
        characters
      }
    },

    async advanceProgress(
      subjectId,
      bookEditionId,
      { progressFraction, textOffset, chapterKey }
    ) {
      const progress = await store.advanceReaderPosition({
        subjectId,
        bookEditionId,
        progressFraction,
        textOffset,
        chapterKey
      })
      if (!progress) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)

      const requests = await Promise.allSettled(progress.charactersDue.map((character) =>
        ensureCharacterBundle(store, {
          bookEditionId,
          characterKey: character.characterKey,
          bundleVersion
        })
      ))
      const warmed = { ready: 0, pending: 0, failed: 0 }
      for (const request of requests) {
        if (request.status === 'rejected') warmed.failed += 1
        else if (request.value.status === 'ready') warmed.ready += 1
        else warmed.pending += 1
      }
      return {
        bookEditionId,
        readerTextOffset: progress.readerTextOffset,
        readingFraction: progress.readingFraction,
        chapterKey: progress.chapterKey,
        warmup: {
          requested: requests.length,
          ...warmed
        }
      }
    }
  }
}
