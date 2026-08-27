import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('PostgreSQL cleanup leaves only 20 canonical characters and stops omitted media jobs', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  const snapshotId = randomUUID()
  const artifactId = randomUUID()
  const publicationId = randomUUID()
  const markupVersionId = randomUUID()
  const omittedJobId = randomUUID()
  const sourceHash = hash(`source:${bookEditionId}`)
  const markupHash = hash(`markup:${bookEditionId}`)
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Top 20 Migration', '', 'epub', 'base_ready')`,
      [bookEditionId, `top20-${bookEditionId}`, sourceHash]
    )
    await pool.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
         input_hash, normalized_text_object_key, normalized_text_hash, text_length,
         sections, stage, status, completed_at
       ) VALUES (
         $1, $2, $3, 'book-analysis-v49', 'book-scan-v17', $4, $5, $6, 100000,
         '[]'::jsonb, 'publish', 'ready', now()
       )`,
      [
        runId, `top20:${runId}`, bookEditionId, sourceHash,
        `analysis/${runId}/normalized.txt`, hash(`normalized:${runId}`)
      ]
    )
    await pool.query(
      `INSERT INTO book_analysis_snapshots (
         id, run_id, snapshot_version, content_hash, evidence_count, data
       ) VALUES ($1, $2, 1, $3, 0, '{}'::jsonb)`,
      [snapshotId, runId, hash(`snapshot:${runId}`)]
    )
    const markup = {
      schemaVersion: 3,
      analysisVersion: 'book-markup-v3',
      snapshotId,
      textLength: 100_000,
      characters: [], locations: [], events: [], relationships: [], storyArcs: []
    }
    await pool.query(
      `INSERT INTO book_analysis_artifacts (
         id, run_id, snapshot_id, artifact_kind, artifact_key, schema_version,
         status, content_hash, data, published_at
       ) VALUES ($1, $2, $3, 'book_markup', 'primary', 3, 'published', $4, $5::jsonb, now())`,
      [artifactId, runId, snapshotId, markupHash, JSON.stringify(markup)]
    )
    await pool.query(
      `INSERT INTO book_analysis_publications (
         id, run_id, book_edition_id, artifact_id, channel,
         analysis_version, content_hash, data
       ) VALUES ($1, $2, $3, $4, 'shadow', 'book-markup-v3', $5, $6::jsonb)`,
      [publicationId, runId, bookEditionId, artifactId, markupHash, JSON.stringify({ markup })]
    )
    await pool.query(
      `INSERT INTO book_markup_versions (
         id, book_edition_id, schema_version, analysis_version, revision,
         status, input_hash, text_length, published_at
       ) VALUES ($1, $2, 3, 'book-markup-v3', 1, 'published', $3, 100000, now())`,
      [markupVersionId, bookEditionId, markupHash]
    )
    await pool.query(
      `INSERT INTO book_characters (
         id, markup_version_id, character_key, sort_order, name, full_name,
         first_appearance_text_offset, warmup_text_offset, data
       )
       SELECT gen_random_uuid(), $1, 'character:' || lpad(value::text, 2, '0'),
              value - 1, 'Character ' || value, 'Character ' || value,
              value * 1000, value * 1000 - 100, '{}'::jsonb
       FROM generate_series(1, 22) AS value`,
      [markupVersionId]
    )
    await pool.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, character_key,
         target_version, status, priority
       ) VALUES ($1, $2, 'character_portrait', $3, 'character:22',
                 'character-bundle-v3:r1', 'queued', 50)`,
      [omittedJobId, `top20-job:${omittedJobId}`, bookEditionId]
    )

    const migration = await readFile(
      new URL('../migrations/020_limit_published_characters.sql', import.meta.url),
      'utf8'
    )
    await pool.query('BEGIN')
    try {
      await pool.query(migration)
      await pool.query('COMMIT')
    } catch (error) {
      await pool.query('ROLLBACK')
      throw error
    }

    const characters = await pool.query(
      `SELECT character_key, sort_order
       FROM book_characters WHERE markup_version_id = $1
       ORDER BY sort_order`,
      [markupVersionId]
    )
    assert.equal(characters.rows.length, 20)
    assert.deepEqual(
      characters.rows.map(({ character_key: key }) => key),
      Array.from({ length: 20 }, (_, index) => `character:${String(index + 1).padStart(2, '0')}`)
    )
    const job = await pool.query(
      'SELECT status, last_error_code FROM generation_jobs WHERE id = $1',
      [omittedJobId]
    )
    assert.deepEqual(job.rows[0], {
      status: 'failed',
      last_error_code: 'CHARACTER_NOT_SELECTED'
    })
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})
