/**
 * Снимок прогресса против настоящего PostgreSQL.
 *
 * Тест на моках проверяет форму ответа, но не сам SQL: `DISTINCT ON`,
 * `make_interval` и массивы идентификаторов либо выполняются базой, либо нет.
 * Дашборд опрашивается раз в пять секунд, и сломанный запрос выглядел бы как
 * «всё встало», а не как ошибка.
 */

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookAnalysisRepository } from '../analysis/book-analysis-repository.mjs'
import { createBookProgressRepository } from '../books/book-progress-repository.mjs'
import { runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('PostgreSQL reports workers, leases and per-book progress in one snapshot', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const bookEditionId = randomUUID()
  const workerId = `progress-${bookEditionId}`
  const inputHash = createHash('sha256').update(`progress-${bookEditionId}`).digest('hex')
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Прогресс', 'Автор', 'epub', 'marking_up')`,
      [bookEditionId, `progress-${bookEditionId}`, inputHash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 10, $3, 'ready')`,
      [bookEditionId, `books/${bookEditionId}.epub`, inputHash]
    )
    const analysis = createPostgresBookAnalysisRepository(pool)
    const started = await analysis.ensureAnalysisRun({
      bookEditionId,
      inputHash,
      pipelineId: 'cards'
    })
    const runId = started.run.id

    await pool.query(
      `INSERT INTO worker_heartbeats (worker_id, worker_type, build_version, state)
       VALUES ($1, 'book-card', 'test-build', 'ready')`,
      [workerId]
    )
    await pool.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, target_version,
         status, priority, payload, analysis_run_id, card_window_index
       ) VALUES ($1, $2, 'roster_confirm', $3, 'roster-confirm-v1', 'ready', 65, '{}'::jsonb, $4, 0)`,
      [randomUUID(), `progress-${runId}-roster`, bookEditionId, runId]
    )
    await pool.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, target_version,
         status, priority, payload, locked_at, locked_by
       ) VALUES ($1, $2, 'catalog_cover', $3, 'cover-v1', 'running', 50, '{}'::jsonb, now(), $4)`,
      [randomUUID(), `progress-${runId}-cover`, bookEditionId, 'cover-worker-1']
    )
    await pool.query(
      `INSERT INTO book_character_roster (
         run_id, character_key, canonical_name, names, candidate_keys,
         mention_count, first_mention_text_offset, tier, window_index
       ) VALUES ($1, 'char:oblomov', 'Обломов', ARRAY['Обломов'], ARRAY['name:oblomov'],
                 12, 100, 'significant', 0)`,
      [runId]
    )
    await pool.query(
      `INSERT INTO book_character_cards (
         id, run_id, book_edition_id, character_key, card_revision, window_index,
         first_mention_text_offset, window_start_offset, window_end_offset,
         document, document_hash, fragment_set_hash, normalized_text_hash, prompt_version
       ) VALUES ($1, $2, $3, 'char:oblomov', 1, 0, 100, 0, 5000,
                 '{"bio": {"value": "тест"}}'::jsonb, $4, $5, $6, 'character-card-v1')`,
      [randomUUID(), runId, bookEditionId, hash('document'), hash('fragments'), hash('text')]
    )

    const snapshot = await createBookProgressRepository(pool).snapshot()
    assert.match(snapshot.generatedAt, /^\d{4}-\d{2}-\d{2}T/)

    const worker = snapshot.workers.find((entry) => entry.buildVersion === 'test-build')
    assert.equal(worker.workerType, 'book-card')
    assert.equal(worker.alive, 1)

    const lease = snapshot.running.find((entry) => entry.workerId === 'cover-worker-1')
    assert.equal(lease.kind, 'generation')
    assert.equal(lease.label, 'catalog_cover')
    assert.equal(lease.bookTitle, 'Прогресс')
    assert.ok(lease.leaseAgeMs >= 0)

    const book = snapshot.books.find((entry) => entry.bookEditionId === bookEditionId)
    assert.equal(book.title, 'Прогресс')
    assert.equal(book.pipelineId, 'cards')
    assert.equal(book.stage, 'prepare')
    assert.deepEqual(book.stages, [{ name: 'prepare', status: 'queued', count: 1 }])
    assert.deepEqual(book.runJobs, [{ name: 'roster_confirm', status: 'ready', count: 1 }])
    assert.deepEqual(book.editionJobs, [{ name: 'catalog_cover', status: 'running', count: 1 }])
    assert.deepEqual(book.roster, [{ tier: 'significant', count: 1 }])
    assert.deepEqual(book.cards, { published: 1, lastWindowIndex: 0 })
  } finally {
    await pool.query('DELETE FROM worker_heartbeats WHERE worker_id = $1', [workerId]).catch(() => {})
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})
