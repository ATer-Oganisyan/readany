import { createHash, randomUUID } from 'node:crypto'
import { genresForCatalogBook } from './catalog-book-genres.mjs'

function serviceError(code, message, status) {
  return Object.assign(new Error(message), { code, status })
}

function result(edition, extra = {}) {
  return {
    bookEditionId: edition.id,
    catalogKey: edition.catalogKey,
    contentSha256: edition.contentSha256,
    status: edition.status,
    ready: ['base_ready', 'published'].includes(edition.status),
    ...extra
  }
}

function coverResult(cover, extra = {}) {
  return {
    bookEditionId: cover.bookEditionId,
    contentSha256: cover.contentHash,
    mimeType: cover.mimeType,
    byteSize: cover.byteSize,
    ready: cover.status === 'ready',
    ...extra
  }
}

export function createCatalogIngestService({
  repository,
  analysisRepository = null,
  storage,
  idFactory = randomUUID
}) {
  if (!repository || !storage) throw new TypeError('catalog repository and storage are required')
  const assignCatalogGenres = async (edition) => {
    if (typeof repository.replaceBookEditionGenres !== 'function') return
    const genres = genresForCatalogBook({
      catalogKey: edition.catalogKey,
      title: edition.title
    })
    if (genres.length === 0) return
    await repository.replaceBookEditionGenres({ bookEditionId: edition.id, genres })
  }
  const ensureCanonicalAnalysis = async (edition) => {
    if (!analysisRepository || typeof analysisRepository.ensureAnalysisRun !== 'function') {
      throw new TypeError('book analysis repository is required for catalog ingestion')
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
  return {
    async begin(input) {
      const proposedBookEditionId = idFactory()
      const objectKey = `books/catalog/${input.catalogKey}/${input.contentSha256}/source`
      const prepared = await repository.beginCatalogBookUpload({
        proposedBookEditionId,
        objectKey,
        ...input
      })
      if (!prepared.uploadRequired) {
        await assignCatalogGenres(prepared.edition)
      }
      const analysis = prepared.uploadRequired
        ? {}
        : await ensureCanonicalAnalysis(prepared.edition)
      return result(prepared.edition, {
        ...analysis,
        uploadRequired: prepared.uploadRequired,
        uploadPath: prepared.uploadRequired
          ? `/v2/admin/catalog/books/${prepared.edition.id}/content`
          : undefined,
        completePath: prepared.uploadRequired
          ? `/v2/admin/catalog/books/${prepared.edition.id}/upload-complete`
          : undefined
      })
    },

    async upload(bookEditionId, bytes, contentType) {
      const upload = await repository.getCatalogBookUpload({ bookEditionId })
      if (!upload) throw serviceError('NOT_FOUND', 'Загрузка каталожной книги не найдена', 404)
      if (contentType !== upload.file.mimeType) {
        throw serviceError('UPLOAD_INTEGRITY', 'Content-Type не совпадает с форматом книги', 409)
      }
      if (bytes.byteLength !== upload.file.byteSize) {
        throw serviceError('UPLOAD_INTEGRITY', 'Размер файла книги не совпадает', 409)
      }
      const contentSha256 = createHash('sha256').update(bytes).digest('hex')
      if (contentSha256 !== upload.file.contentSha256) {
        throw serviceError('UPLOAD_INTEGRITY', 'SHA-256 файла книги не совпадает', 409)
      }
      const stored = await storage.putBytes({
        objectKey: upload.file.objectKey,
        bytes,
        mimeType: upload.file.mimeType
      })
      if (stored.contentHash !== upload.file.contentSha256) {
        throw serviceError('UPLOAD_INTEGRITY', 'Хранилище вернуло другой checksum', 409)
      }
      return { bookEditionId, byteSize: stored.byteSize, contentSha256: stored.contentHash }
    },

    async complete(bookEditionId) {
      const upload = await repository.getCatalogBookUpload({ bookEditionId })
      if (!upload) throw serviceError('NOT_FOUND', 'Загрузка каталожной книги не найдена', 404)
      await storage.verifyUpload(upload.file)
      const edition = await repository.completeCatalogBookUpload({ bookEditionId })
      if (!edition) throw serviceError('NOT_FOUND', 'Каталожная книга не найдена', 404)
      await repository.enqueueBookIdentity?.({ bookEditionId })
      await assignCatalogGenres(edition)
      const analysis = await ensureCanonicalAnalysis(edition)
      return result(edition, analysis)
    },

    async beginCover(bookEditionId, input) {
      const objectKey = `books/catalog/${bookEditionId}/cover/${input.contentSha256}`
      const prepared = await repository.beginCatalogCoverUpload({
        bookEditionId,
        objectKey,
        ...input
      })
      if (!prepared) throw serviceError('NOT_FOUND', 'Каталожная книга не найдена', 404)
      return coverResult(prepared.cover, {
        uploadRequired: prepared.uploadRequired,
        uploadPath: prepared.uploadRequired
          ? `/v2/admin/catalog/books/${bookEditionId}/cover/content`
          : undefined,
        completePath: prepared.uploadRequired
          ? `/v2/admin/catalog/books/${bookEditionId}/cover/upload-complete`
          : undefined
      })
    },

    async uploadCover(bookEditionId, bytes, contentType) {
      const upload = await repository.getCatalogCoverUpload({ bookEditionId })
      if (!upload) throw serviceError('NOT_FOUND', 'Загрузка обложки не найдена', 404)
      if (contentType !== upload.mimeType) {
        throw serviceError('UPLOAD_INTEGRITY', 'Content-Type обложки не совпадает', 409)
      }
      if (bytes.byteLength !== upload.byteSize) {
        throw serviceError('UPLOAD_INTEGRITY', 'Размер обложки не совпадает', 409)
      }
      const contentHash = createHash('sha256').update(bytes).digest('hex')
      if (contentHash !== upload.contentHash) {
        throw serviceError('UPLOAD_INTEGRITY', 'SHA-256 обложки не совпадает', 409)
      }
      const stored = await storage.putBytes({
        objectKey: upload.objectKey,
        bytes,
        mimeType: upload.mimeType
      })
      if (stored.contentHash !== upload.contentHash) {
        throw serviceError('UPLOAD_INTEGRITY', 'Хранилище вернуло другой checksum', 409)
      }
      return coverResult(upload)
    },

    async completeCover(bookEditionId) {
      const upload = await repository.getCatalogCoverUpload({ bookEditionId })
      if (!upload) throw serviceError('NOT_FOUND', 'Загрузка обложки не найдена', 404)
      await storage.verifyUpload({
        ...upload,
        contentSha256: upload.contentHash
      })
      const cover = await repository.completeCatalogCoverUpload({ bookEditionId })
      if (!cover) throw serviceError('NOT_FOUND', 'Обложка каталога не найдена', 404)
      return coverResult(cover)
    }
  }
}
