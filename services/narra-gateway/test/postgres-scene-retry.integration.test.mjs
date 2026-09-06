import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('scene polling preserves terminal failure; only an explicit action retries the same job', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 4 })
  const bookEditionId = randomUUID()
  const subjectId = randomUUID()
  const runId = randomUUID()
  const snapshotId = randomUUID()
  const artifactId = randomUUID()
  const hash = 'a'.repeat(64)
  let reservations = 0
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(`INSERT INTO book_editions (
      id, scope, owner_subject_id, content_sha256, title, author, format, status, source_storage, expires_at
    ) VALUES ($1, 'private', $2, $3, 'Scene retry test', 'Author', 'txt', 'base_ready', 'temporary', now() + interval '1 day')`,
    [bookEditionId, subjectId, hash])
    await pool.query(`INSERT INTO book_analysis_runs (
      id, idempotency_key, book_edition_id, pipeline_version, prompt_version, input_hash,
      normalized_text_object_key, normalized_text_hash, text_length, sections, stage, status, completed_at
    ) VALUES ($1, $1::uuid::text, $2, 'book-analysis-v51', 'book-scan-v17', $3,
      'scene-retry-test.txt', $3, 10000, '[]', 'publish', 'ready', now())`, [runId, bookEditionId, hash])
    await pool.query(`INSERT INTO book_analysis_snapshots (
      id, run_id, snapshot_version, content_hash, evidence_count, data
    ) VALUES ($1, $2, 1, $3, 0, '{}')`, [snapshotId, runId, hash])
    await pool.query(`INSERT INTO book_analysis_artifacts (
      id, run_id, snapshot_id, artifact_kind, artifact_key, schema_version, status, content_hash, data, published_at
    ) VALUES ($1, $2, $3, 'book_markup', 'primary', 3, 'published', $4, '{}', now())`, [artifactId, runId, snapshotId, hash])
    await pool.query(`INSERT INTO book_analysis_publications (
      id, run_id, book_edition_id, artifact_id, channel, analysis_version, content_hash, data
    ) VALUES ($1, $2, $3, $4, 'shadow', 'book-markup-v3', $5, '{}')`, [randomUUID(), runId, bookEditionId, artifactId, hash])
    await pool.query(`INSERT INTO book_markup_versions (
      id, book_edition_id, schema_version, analysis_version, revision, status, input_hash, text_length, published_at
    ) VALUES ($1, $2, 3, 'book-markup-v3', 1, 'published', $3, 10000, now())`, [randomUUID(), bookEditionId, hash])
    const repository = createPostgresBookMarkupRepository(pool, {
      beforeCreateReaderScene: async () => { reservations += 1 }
    })
    const input = { subjectId, bookEditionId, progressFraction: 0.4 }
    const first = await repository.ensureReaderBookScene(input)
    assert.equal(first.status, 'queued')
    await pool.query("UPDATE generation_jobs SET status = 'failed', attempts = 3, last_error_code = 'IMAGE_FAILED' WHERE id = $1", [first.jobId])
    for (let index = 0; index < 3; index += 1) {
      const polled = await repository.ensureReaderBookScene(input)
      assert.equal(polled.status, 'failed')
      assert.equal(polled.jobId, first.jobId)
    }
    assert.equal(reservations, 1)
    const row = (await pool.query('SELECT attempts, last_error_code FROM generation_jobs WHERE id = $1', [first.jobId])).rows[0]
    assert.equal(row.attempts, 3)
    assert.equal(row.last_error_code, 'IMAGE_FAILED')
    const retried = await repository.ensureReaderBookScene({ ...input, retryFailed: true })
    assert.equal(retried.status, 'queued')
    assert.equal(retried.jobId, first.jobId)
    assert.equal(reservations, 2)
    const duplicate = await repository.ensureReaderBookScene({ ...input, retryFailed: true })
    assert.equal(duplicate.jobId, first.jobId)
    assert.equal(reservations, 2)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM generation_jobs WHERE book_edition_id = $1', [bookEditionId])).rows[0].count, 1)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId])
    await pool.end()
  }
})
