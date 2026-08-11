import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { createBookCatalogService } from '../book-catalog-service.mjs'
import { createBookObjectStorage } from '../book-object-storage.mjs'
import { REQUIRED_CHARACTER_MEDIA } from '../book-markup.mjs'
import { createGenerationWorker } from '../generation-worker.mjs'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const databaseUrl = process.env.BOOK_MARKUP_E2E_DATABASE_URL
const s3Endpoint = process.env.BOOK_MARKUP_E2E_S3_ENDPOINT
const s3AccessKey = process.env.BOOK_MARKUP_E2E_S3_ACCESS_KEY
const s3SecretKey = process.env.BOOK_MARKUP_E2E_S3_SECRET_KEY
const enabled = databaseUrl && s3Endpoint && s3AccessKey && s3SecretKey

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('local-only book flows through derived markup, warmup and temporary media download', {
  skip: !enabled
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 4 })
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: s3Endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey }
  })
  const bucket = `readany-e2e-${randomUUID()}`
  const subjectId = randomUUID()
  const contentSha256 = sha256('A deterministic local-only EPUB fixture for backend E2E testing.')
  let bookEditionId
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    const repository = createPostgresBookMarkupRepository(pool)
    const storage = createBookObjectStorage({
      client,
      bucket,
      uploadExpiresSeconds: 60,
      downloadExpiresSeconds: 60
    })
    const service = createBookCatalogService({ repository, storage })
    const prepared = await service.registerLocalBook(subjectId, {
      contentSha256,
      title: 'E2E Book',
      author: 'ReadAny',
      format: 'epub'
    })
    bookEditionId = prepared.bookEditionId
    assert.ok(bookEditionId)
    assert.equal(prepared.sourceDownloadPath, undefined)
    assert.equal((await service.publishLocalMarkup(subjectId, bookEditionId, {
      characters: [{
        characterKey: 'hero',
        name: 'Hero',
        fullName: 'The Hero',
        firstAppearanceFraction: 0.15,
        warmupFraction: 0.1,
        profile: { role: 'protagonist' }
      }]
    })).ready, true)

    const generator = {
      async generateBookMarkup() {
        throw new Error('local source must never be processed by the backend')
      },
      async generateCharacterBundle(input) {
        const assets = []
        for (const type of REQUIRED_CHARACTER_MEDIA) {
          const body = Buffer.from(`${input.characterKey}:${type}:v1`)
          const contentHash = sha256(body)
          const objectKey = `books/private/${subjectId}/${contentSha256}/hero/${type}`
          await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: body,
            ContentType: type === 'primary_portrait' ? 'image/png' : 'application/octet-stream',
            ChecksumSHA256: Buffer.from(contentHash, 'hex').toString('base64')
          }))
          assets.push({
            type,
            objectKey,
            contentHash,
            mimeType: type === 'primary_portrait' ? 'image/png' : 'application/octet-stream',
            byteSize: body.byteLength
          })
        }
        return { assets }
      }
    }
    const worker = createGenerationWorker({
      repository,
      generator,
      workerId: 'book-backend-e2e',
      logger: { error() {} },
      leaseRenewMs: 60_000
    })

    const warmed = await service.advanceProgress(subjectId, bookEditionId, {
      progressFraction: 0.11,
      textOffset: null,
      chapterKey: 'chapter-1'
    })
    assert.equal(warmed.readerTextOffset, 110_000)
    assert.equal(warmed.warmup.requested, 1)
    assert.equal((await worker.runOnce()).status, 'completed')
    assert.deepEqual((await service.manifest(subjectId, bookEditionId)).characters, [])

    await service.advanceProgress(subjectId, bookEditionId, {
      progressFraction: 0.16,
      textOffset: null,
      chapterKey: 'chapter-2'
    })
    const manifest = await service.manifest(subjectId, bookEditionId)
    assert.equal(manifest.readerTextOffset, 160_000)
    assert.equal(manifest.readingFraction, 0.16)
    assert.equal(manifest.markup.textLength, 1_000_000)
    assert.equal(manifest.characters[0].bundle.assets.length, REQUIRED_CHARACTER_MEDIA.length)

    const media = await service.mediaDownload(
      subjectId,
      bookEditionId,
      manifest.characters[0].bundle.assets[0].assetId
    )
    const mediaResponse = await fetch(media.url)
    assert.equal(mediaResponse.status, 200)
    assert.ok((await mediaResponse.arrayBuffer()).byteLength > 0)

    await assert.rejects(
      service.sourceDownload(subjectId, bookEditionId),
      (error) => error.code === 'NOT_FOUND'
    )
  } finally {
    if (bookEditionId) {
      await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    }
    const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket })).catch(() => null)
    if (objects?.Contents?.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects.Contents.map(({ Key }) => ({ Key })) }
      })).catch(() => {})
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {})
    client.destroy()
    await pool.end()
  }
})
