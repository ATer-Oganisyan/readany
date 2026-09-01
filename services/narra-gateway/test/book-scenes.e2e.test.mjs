import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3'
import { createBookCatalogService } from '../book-catalog-service.mjs'
import { createBookObjectStorage } from '../book-object-storage.mjs'
import { createGenerationWorker } from '../generation-worker.mjs'
import { createInternalGenerationService } from '../internal-generation-service.mjs'
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

test('private v3 book generates only the explicitly requested scene by reader offset', {
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
  const bucket = `readany-scenes-e2e-${randomUUID()}`
  const subjectId = randomUUID()
  const bookEditionId = randomUUID()
  const markupVersionId = randomUUID()
  const runId = randomUUID()
  const snapshotId = randomUUID()
  const artifactId = randomUUID()
  const publicationId = randomUUID()
  const normalizedText = `Анна открыла дверь и вошла в зал. ${'Действие продолжалось в старом доме. '.repeat(2_900)}`
  const normalizedBytes = Buffer.from(normalizedText)
  const normalizedTextHash = sha256(normalizedBytes)
  const contentHash = sha256('canonical-scene-markup')
  let storage
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    storage = createBookObjectStorage({
      client,
      bucket,
      uploadExpiresSeconds: 60,
      downloadExpiresSeconds: 60
    })
    const normalizedTextObjectKey = `analysis/${runId}/normalized-text-v1.txt`
    await storage.putBytes({
      objectKey: normalizedTextObjectKey,
      bytes: normalizedBytes,
      mimeType: 'text/plain'
    })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, owner_subject_id, content_sha256, title, author, format,
         status, source_storage, expires_at
       ) VALUES (
         $1, 'private', $2, $3, 'Scene E2E Book', 'ReadAny', 'txt',
         'base_ready', 'temporary', now() + interval '7 days'
       )`,
      [bookEditionId, subjectId, sha256('scene-e2e-source')]
    )
    await pool.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
         input_hash, normalized_text_object_key, normalized_text_hash, text_length,
         sections, stage, status, completed_at
       ) VALUES (
         $1, $2, $3, 'book-analysis-v51', 'book-scan-v17', $4, $5, $6, $7,
         '[]'::jsonb, 'publish', 'ready', now()
       )`,
      [
        runId, `scene-e2e:${runId}`, bookEditionId, sha256('scene-e2e-source'),
        normalizedTextObjectKey, normalizedTextHash, normalizedText.length
      ]
    )
    await pool.query(
      `INSERT INTO book_analysis_snapshots (
         id, run_id, snapshot_version, content_hash, evidence_count, data
       ) VALUES ($1, $2, 1, $3, 0, '{}'::jsonb)`,
      [snapshotId, runId, sha256('scene-e2e-snapshot')]
    )
    const markup = {
      schemaVersion: 3,
      analysisVersion: 'book-markup-v3',
      snapshotId,
      textLength: normalizedText.length,
      characters: [], locations: [], events: [], relationships: [], storyArcs: []
    }
    await pool.query(
      `INSERT INTO book_analysis_artifacts (
         id, run_id, snapshot_id, artifact_kind, artifact_key, schema_version,
         status, content_hash, data, published_at
       ) VALUES ($1, $2, $3, 'book_markup', 'primary', 3, 'published', $4, $5::jsonb, now())`,
      [artifactId, runId, snapshotId, contentHash, JSON.stringify(markup)]
    )
    await pool.query(
      `INSERT INTO book_analysis_publications (
         id, run_id, book_edition_id, artifact_id, channel,
         analysis_version, content_hash, data
       ) VALUES ($1, $2, $3, $4, 'shadow', 'book-markup-v3', $5, $6::jsonb)`,
      [publicationId, runId, bookEditionId, artifactId, contentHash, JSON.stringify({ markup })]
    )
    await pool.query(
      `INSERT INTO book_markup_versions (
         id, book_edition_id, schema_version, analysis_version, revision,
         status, input_hash, text_length, published_at, expires_at
       ) VALUES ($1, $2, 3, 'book-markup-v3', 1, 'published', $3, $4, now(), now() + interval '7 days')`,
      [markupVersionId, bookEditionId, contentHash, normalizedText.length]
    )

    const repository = createPostgresBookMarkupRepository(pool)
    const service = createBookCatalogService({ repository, storage })
    await service.manifest(subjectId, bookEditionId)
    const initialJobs = await pool.query(
      `SELECT count(*)::integer AS count FROM generation_jobs
       WHERE book_edition_id = $1 AND job_type = 'scene_image'`,
      [bookEditionId]
    )
    assert.equal(Number(initialJobs.rows[0].count), 0)

    const pending = await service.sceneAt(subjectId, bookEditionId, {
      readerTextOffset: 1_000,
      progressFraction: null
    })
    assert.equal(pending.status, 'queued')
    assert.equal(pending.sceneKey, 'text-interval-v1:0')

    let generatedPrompt = ''
    const internal = createInternalGenerationService({
      storage,
      logger: { info() {}, error() {} },
      async completeChat() { throw new Error('unused') },
      async generatePortrait() { throw new Error('portrait must not run') },
      async generateScene(prompt) {
        generatedPrompt = prompt
        return { bytes: Buffer.from('scene-image'), mimeType: 'image/png', provider: 'e2e' }
      },
      async synthesizeSpeech() { throw new Error('unused') },
      async generateIdleAnimation() { throw new Error('unused') }
    })
    const worker = createGenerationWorker({
      repository: {
        ...repository,
        claimGenerationJob(workerId) {
          return repository.claimGenerationJob(workerId, { jobTypes: ['scene_image'] })
        }
      },
      generator: {
        generateBookScene(input) {
          return internal.generateBookScene({
            idempotencyKey: [
              input.bookEditionId, 'scene', input.sceneKey, input.targetVersion
            ].join(':'),
            ...input
          })
        }
      },
      workerId: 'scene-e2e-worker',
      logger: { info() {}, warn() {}, error() {} }
    })
    assert.equal((await worker.runOnce()).status, 'completed')
    assert.match(generatedPrompt, /Анна открыла дверь/)

    const ready = await service.sceneAt(subjectId, bookEditionId, {
      readerTextOffset: 1_000,
      progressFraction: null
    })
    assert.equal(ready.status, 'ready')
    assert.equal(ready.sceneKey, 'text-interval-v1:0')
    assert.match(ready.imageUrl, /^http/)

    const advanced = await service.advanceProgress(subjectId, bookEditionId, {
      progressFraction: 0.36,
      textOffset: null,
      chapterKey: 'chapter-4',
      sectionIndex: null,
      sectionFraction: null
    })
    assert.equal(advanced.sceneWarmup.requested, 0)
    const advancedJobs = await pool.query(
      `SELECT count(*)::integer AS count FROM generation_jobs
       WHERE book_edition_id = $1 AND job_type = 'scene_image'`,
      [bookEditionId]
    )
    assert.equal(Number(advancedJobs.rows[0].count), 1)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    if (storage) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket })).catch(() => null)
      if (listed?.Contents?.length) {
        await client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: listed.Contents.map(({ Key }) => ({ Key })) }
        })).catch(() => {})
      }
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {})
    await pool.end()
  }
})
