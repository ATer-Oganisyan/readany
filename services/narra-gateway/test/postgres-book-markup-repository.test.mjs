import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'

function scriptedPool(scripts) {
  const queries = []
  const client = {
    async query(sql, params) {
      queries.push({ sql, params, transaction: true })
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
      return scripts.shift()?.(sql, params) ?? { rows: [] }
    },
    release() {}
  }
  return {
    queries,
    async connect() { return client },
    async query(sql, params) {
      queries.push({ sql, params, transaction: false })
      return scripts.shift()?.(sql, params) ?? { rows: [] }
    }
  }
}

test('durable character ensure returns an existing idempotent job', async () => {
  const row = {
    id: 'job-existing',
    job_type: 'character_bundle',
    book_edition_id: 'book-42',
    character_key: 'anna',
    target_version: 'character-bundle-v1',
    status: 'running',
    attempts: 1,
    payload: {}
  }
  const pool = scriptedPool([
    () => ({ rows: [] }),
    () => ({ rows: [row] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174000'
  })
  const result = await repository.ensureCharacterBundle({
    bookEditionId: 'book-42',
    characterKey: 'anna'
  })
  assert.equal(result.created, false)
  assert.equal(result.id, 'job-existing')
  assert.equal(result.status, 'running')
  assert.equal(result.idempotencyKey, 'book-42:anna:character-bundle-v1')
  assert.match(pool.queries[1].sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/)
})

test('claim query uses skip locked and assigns a unique lease token', async () => {
  const pool = scriptedPool([
    (sql, params) => ({ rows: [{
      id: 'job-1', job_type: 'book_markup', book_edition_id: 'book-1',
      character_key: null, target_version: 'book-markup-v1', status: 'running',
      attempts: 1, lease_token: params[2], payload: {}
    }] })
  ])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174001'
  })
  const job = await repository.claimGenerationJob('worker-1')
  assert.equal(job.leaseToken, '123e4567-e89b-42d3-a456-426614174001')
  assert.match(pool.queries[0].sql, /FOR UPDATE SKIP LOCKED/)
  assert.match(pool.queries[0].sql, /lease_token = \$3::uuid/)
})

test('failed generation retry preserves the idempotent job and resets its bundle', async () => {
  const row = {
    id: 'job-failed', job_type: 'character_bundle', book_edition_id: 'book-1',
    character_key: 'hero', target_version: 'character-bundle-v1', status: 'queued',
    attempts: 0, payload: {}
  }
  const pool = scriptedPool([
    (sql) => {
      assert.match(sql, /FOR UPDATE SKIP LOCKED/)
      assert.match(sql, /attempts = 0/)
      return { rows: [row] }
    },
    (sql) => {
      assert.match(sql, /UPDATE character_media_bundles/)
      return { rows: [] }
    }
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  const jobs = await repository.retryFailedGenerationJobs({ limit: 10 })
  assert.equal(jobs[0].id, 'job-failed')
  assert.equal(jobs[0].status, 'queued')
})

test('migration enforces durable idempotency and bundle uniqueness', async () => {
  const migration = await readFile(
    new URL('../migrations/001_book_markup.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/)
  assert.match(migration, /UNIQUE \(book_edition_id, character_key, bundle_version\)/)
  assert.match(migration, /warmup_text_offset <= first_appearance_text_offset/)
  assert.match(migration, /lease_token UUID/)
})

test('canonical progress migration is additive for existing markup rows', async () => {
  const migration = await readFile(
    new URL('../migrations/002_canonical_reader_progress.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN IF NOT EXISTS text_length BIGINT/)
  assert.match(migration, /text_length IS NULL OR text_length > 0/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reading_fraction DOUBLE PRECISION/)
  assert.match(migration, /reading_fraction >= 0 AND reading_fraction <= 1/)
})

test('local-only migration removes private source metadata and adds expiring object cleanup', async () => {
  const migration = await readFile(
    new URL('../migrations/003_local_books_and_retention.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /DELETE FROM book_files[\s\S]*edition\.scope = 'private'/)
  assert.match(migration, /scope = 'private' AND source_storage = 'local_only'/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS book_object_deletions/)
  assert.match(migration, /expires_at TIMESTAMPTZ/)
})
