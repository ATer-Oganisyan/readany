import {
  CHARACTER_BUNDLE_VERSION,
  ensureCharacterBundle,
  readerCharacterState
} from './book-markup.mjs'
import { randomUUID } from 'node:crypto'

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
    sourceDownloadPath: `/v2/books/${edition.id}/source/download`
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
          resolution: 'private_upload_required',
          contentSha256: input.contentSha256,
          ready: false
        }
      }
      return bookBinding(edition)
    },

    async beginPrivateUpload(subjectId, input) {
      if (typeof store.beginPrivateBookUpload !== 'function') {
        throw new TypeError('repository.beginPrivateBookUpload is required')
      }
      const proposedBookEditionId = idFactory()
      const objectKey = `books/private/${subjectId}/${input.contentSha256}/source`
      const prepared = await store.beginPrivateBookUpload({
        subjectId,
        proposedBookEditionId,
        objectKey,
        ...input
      })
      const binding = bookBinding(prepared.edition)
      if (!prepared.uploadRequired) {
        if (
          prepared.edition.scope === 'private' &&
          prepared.fileReady &&
          !binding.ready &&
          typeof store.enqueueBookMarkup === 'function'
        ) {
          await store.enqueueBookMarkup({ bookEditionId: prepared.edition.id })
        }
        return { ...binding, upload: null }
      }
      if (!storage) {
        throw serviceError('UPLOAD_UNAVAILABLE', 'Загрузка личных книг временно недоступна', 503)
      }
      return {
        ...binding,
        upload: await storage.createUpload(prepared.file)
      }
    },

    async completePrivateUpload(subjectId, bookEditionId) {
      if (
        typeof store.getPrivateBookUpload !== 'function' ||
        typeof store.completePrivateBookUpload !== 'function'
      ) {
        throw new TypeError('private upload repository methods are required')
      }
      if (!storage) {
        throw serviceError('UPLOAD_UNAVAILABLE', 'Загрузка личных книг временно недоступна', 503)
      }
      const upload = await store.getPrivateBookUpload({ subjectId, bookEditionId })
      if (!upload) throw serviceError('NOT_FOUND', 'Личная книга не найдена', 404)
      await storage.verifyUpload(upload.file)
      const edition = await store.completePrivateBookUpload({ subjectId, bookEditionId })
      if (!edition) throw serviceError('NOT_FOUND', 'Личная книга не найдена', 404)
      await store.enqueueBookMarkup({ bookEditionId })
      return bookBinding(edition)
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
