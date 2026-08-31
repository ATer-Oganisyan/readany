import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookOperatorRepository } from '../book-operator-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('PostgreSQL operator read model exposes a live run through every dashboard view', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 4 })
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  const hash = createHash('sha256').update(bookEditionId).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Operator Integration', 'Narra', 'epub', 'marking_up')`,
      [bookEditionId, `operator-${bookEditionId}`, hash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 128, $3, 'staging')`,
      [bookEditionId, `operator/${bookEditionId}/source`, hash]
    )
    await pool.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version, input_hash
       ) VALUES ($1, $2, $3, 'book-analysis-v8', 'book-scan-v4', $4)`,
      [runId, `operator:${bookEditionId}`, bookEditionId, hash]
    )
    await pool.query(
      `INSERT INTO book_analysis_jobs (id, run_id, stage, shard_key, status)
       VALUES ($1, $2, 'prepare', 'book', 'cancelled')`,
      [randomUUID(), runId]
    )

    const repository = createPostgresBookOperatorRepository(pool)
    const books = await repository.listBooks()
    const summary = books.find(({ id }) => id === bookEditionId)
    assert.equal(summary.analysis.runId, runId)
    assert.equal(summary.progress.stage, 'prepare')
    assert.equal(summary.analysis.jobs.prepare.cancelled, 1)

    const detail = await repository.getBookDetails(bookEditionId)
    assert.equal(detail.book.title, 'Operator Integration')
    assert.equal(detail.stages.length, 1)
    assert.deepEqual(detail.characters, [])

    const json = await repository.getBookJson(bookEditionId)
    assert.equal(json.book.contentSha256, hash)
    assert.equal(json.publication, null)

    const operations = await repository.getBookOperations(bookEditionId)
    assert.equal(operations.some(({ kind }) => kind === 'analysis_run'), true)
    assert.equal(operations.some(({ kind }) => kind === 'analysis_job'), true)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})
