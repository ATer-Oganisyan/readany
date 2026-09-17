import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../books/postgres-book-markup-repository.mjs'
import { createIsolatedPostgres } from './support/isolated-postgres.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('CENSOR retries generation jobs until their type-specific attempt limit', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const bookEditionId = randomUUID()
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Retry test', 'Test', 'epub', 'base_ready')`,
      [bookEditionId, `retry-${bookEditionId}`, 'a'.repeat(64)]
    )

    const repository = createPostgresBookMarkupRepository(pool)
    for (const { type, attempts, expectedStatus } of [
      { type: 'character_portrait', attempts: 1, expectedStatus: 'queued' },
      { type: 'character_portrait', attempts: 6, expectedStatus: 'failed' },
      { type: 'book_markup', attempts: 1, expectedStatus: 'queued' },
      { type: 'book_markup', attempts: 3, expectedStatus: 'failed' }
    ]) {
      const jobId = randomUUID()
      const leaseToken = randomUUID()
      const characterKey = type === 'character_portrait' ? 'hero' : null
      await pool.query(
        `INSERT INTO generation_jobs (
           id, idempotency_key, job_type, book_edition_id, character_key,
           target_version, status, attempts, locked_at, locked_by, lease_token
         ) VALUES ($1, $2, $3, $4, $5, 'v1', 'running', $6, now(), 'test-worker', $7)`,
        [jobId, `retry-${jobId}`, type, bookEditionId, characterKey, attempts, leaseToken]
      )

      const result = await repository.failGenerationJob({
        id: jobId,
        type,
        leaseToken,
        payload: {}
      }, 'CENSOR')
      const { rows: [stored] } = await pool.query(
        `SELECT status, last_error_code, locked_at, locked_by, lease_token
         FROM generation_jobs WHERE id = $1`,
        [jobId]
      )
      assert.equal(result.status, expectedStatus, `${type} at attempt ${attempts}`)
      assert.equal(stored.status, expectedStatus, `${type} at attempt ${attempts}`)
      assert.equal(stored.last_error_code, 'CENSOR')
      assert.equal(stored.locked_at, null)
      assert.equal(stored.locked_by, null)
      assert.equal(stored.lease_token, null)
    }
  } finally {
    await isolated.release()
  }
})
