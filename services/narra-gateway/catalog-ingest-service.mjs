import { createHash, randomUUID } from 'node:crypto'

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

export function createCatalogIngestService({ repository, storage, idFactory = randomUUID }) {
  if (!repository || !storage) throw new TypeError('catalog repository and storage are required')
  return {
    async begin(input) {
      const proposedBookEditionId = idFactory()
      const objectKey = `books/catalog/${input.catalogKey}/${input.contentSha256}/source`
      const prepared = await repository.beginCatalogBookUpload({
        proposedBookEditionId,
        objectKey,
        ...input
      })
      if (!prepared.uploadRequired && !['base_ready', 'published'].includes(prepared.edition.status)) {
        await repository.enqueueBookMarkup({ bookEditionId: prepared.edition.id })
      }
      return result(prepared.edition, {
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
      const job = await repository.enqueueBookMarkup({ bookEditionId })
      return result(edition, { jobId: job.id, jobStatus: job.status })
    }
  }
}
