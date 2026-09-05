import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { BOOK_ANALYSIS_PIPELINE_VERSION, BOOK_ANALYSIS_PROMPT_VERSION } from '../book-analysis-contracts.mjs'
import { createPostgresBookAnalysisRepository } from '../book-analysis-repository.mjs'
import { createInstallationRegistry } from '../installation-registry.mjs'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

async function seedSceneBook(pool, subjectId, ids, { queuedAnalysis = false } = {}) {
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  const snapshotId = randomUUID()
  const artifactId = randomUUID()
  const hash = createHash('sha256').update(bookEditionId).digest('hex')
  ids.push(bookEditionId)
  await pool.query(`INSERT INTO book_editions (
    id, scope, owner_subject_id, content_sha256, title, author, format, status, source_storage, expires_at
  ) VALUES ($1, 'private', $2, $3, 'Isolated release concurrency fixture', 'Narra test', 'txt', 'base_ready', 'temporary', now() + interval '1 day')`,
  [bookEditionId, subjectId, hash])
  await pool.query(`INSERT INTO book_analysis_runs (
    id, idempotency_key, book_edition_id, pipeline_version, prompt_version, input_hash,
    normalized_text_object_key, normalized_text_hash, text_length, sections, stage, status, completed_at
  ) VALUES ($1, $1::uuid::text, $2, $4, $5, $3,
    'release-concurrency/' || $1::uuid::text || '/normalized.txt', $3, 10000, '[]', $6, $7,
    CASE WHEN $8::boolean THEN NULL ELSE now() END)`,
  [runId, bookEditionId, hash, BOOK_ANALYSIS_PIPELINE_VERSION, BOOK_ANALYSIS_PROMPT_VERSION,
    queuedAnalysis ? 'synthesize' : 'publish', queuedAnalysis ? 'queued' : 'ready', queuedAnalysis])
  if (queuedAnalysis) return { subjectId, bookEditionId, runId }
  await pool.query(`INSERT INTO book_analysis_snapshots (id, run_id, snapshot_version, content_hash, evidence_count, data)
    VALUES ($1, $2, 1, $3, 0, '{}')`, [snapshotId, runId, hash])
  await pool.query(`INSERT INTO book_analysis_artifacts (
    id, run_id, snapshot_id, artifact_kind, artifact_key, schema_version, status, content_hash, data, published_at
  ) VALUES ($1, $2, $3, 'book_markup', 'primary', 3, 'published', $4, '{}', now())`, [artifactId, runId, snapshotId, hash])
  await pool.query(`INSERT INTO book_analysis_publications (
    id, run_id, book_edition_id, artifact_id, channel, analysis_version, content_hash, data
  ) VALUES ($1, $2, $3, $4, 'shadow', 'book-markup-v3', $5, '{}')`, [randomUUID(), runId, bookEditionId, artifactId, hash])
  await pool.query(`INSERT INTO book_markup_versions (
    id, book_edition_id, schema_version, analysis_version, revision, status, input_hash, text_length, published_at
  ) VALUES ($1, $2, 3, 'book-markup-v3', 1, 'published', $3, 10000, now())`, [randomUUID(), bookEditionId, hash])
  return { subjectId, bookEditionId, progressFraction: 0.4 }
}

test('local PostgreSQL stress: repeated scene slot is unique and quota is reserved once per explicit attempt', {
  skip: !connectionString, timeout: 30_000
}, async (t) => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 16 })
  const ids = []
  let reservations = 0
  const started = performance.now()
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    const repository = createPostgresBookMarkupRepository(pool, {
      beforeCreateReaderScene: async () => { reservations += 1 }
    })
    const input = await seedSceneBook(pool, randomUUID(), ids)
    const firstWave = await Promise.all(Array.from({ length: 64 }, () => repository.ensureReaderBookScene(input)))
    assert.equal(new Set(firstWave.map((scene) => scene.jobId)).size, 1)
    assert.equal(reservations, 1)
    const jobId = firstWave[0].jobId
    await pool.query("UPDATE generation_jobs SET status = 'failed', attempts = 3, last_error_code = 'TEST_FAILURE' WHERE id = $1", [jobId])
    const polling = await Promise.all(Array.from({ length: 64 }, () => repository.ensureReaderBookScene(input)))
    assert.ok(polling.every((scene) => scene.status === 'failed' && scene.jobId === jobId))
    assert.equal(reservations, 1)
    const retries = await Promise.all(Array.from({ length: 64 }, () => repository.ensureReaderBookScene({ ...input, retryFailed: true })))
    assert.ok(retries.every((scene) => scene.jobId === jobId && scene.status === 'queued'))
    assert.equal(reservations, 2)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM generation_jobs WHERE book_edition_id = $1', [input.bookEditionId])).rows[0].count, 1)
    assert.equal(await repository.ensureReaderBookScene({ ...input, subjectId: randomUUID() }), null)
    assert.equal(reservations, 2)
    t.diagnostic(JSON.stringify({ sceneRequests: 192, uniqueJobs: 1, quotaReservations: reservations, elapsedMs: Math.round(performance.now() - started) }))
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = ANY($1::uuid[])', [ids])
    await pool.end()
  }
})

test('local PostgreSQL analysis fairness: another book runs before a second equal-priority shard', {
  skip: !connectionString, timeout: 30_000
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const ids = []
  const runIds = []
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    for (let bookIndex = 0; bookIndex < 2; bookIndex += 1) {
      // Create a queued lineage directly; never try to rewind an immutable
      // ready publication just to manufacture scheduler work.
      const book = await seedSceneBook(pool, randomUUID(), ids, { queuedAnalysis: true })
      const runId = book.runId
      runIds.push(runId)
      for (let shard = 0; shard < (bookIndex === 0 ? 3 : 1); shard += 1) {
        await pool.query(`INSERT INTO book_analysis_jobs (
          id, run_id, stage, shard_key, priority, available_at, pipeline_id, pipeline_implementation_version
        ) SELECT $1, id, 'synthesize', $3, 50, now() - make_interval(mins => $4), pipeline_id, pipeline_implementation_version
          FROM book_analysis_runs WHERE id = $2`,
        [randomUUID(), runId, `character:release-${shard}`, 2 - bookIndex])
      }
    }
    const repository = createPostgresBookAnalysisRepository(pool)
    const options = { stages: ['synthesize'], runIds, leaseSeconds: 60 }
    const first = await repository.claimAnalysisJob('release-fairness-first', options)
    const second = await repository.claimAnalysisJob('release-fairness-second', options)
    assert.equal(first.runId, runIds[0], 'the earlier book starts first')
    assert.equal(second.runId, runIds[1], 'another untouched book gets a turn before the first book monopolizes shards')
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = ANY($1::uuid[])', [ids])
    await pool.end()
  }
})

test('local PostgreSQL stress: independent owners respect one-gateway budgets and concurrent workers cannot duplicate claims', {
  skip: !connectionString, timeout: 30_000
}, async (t) => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 16 })
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'narra-release-quota-'))
  const registry = createInstallationRegistry({ dataDir, environment: 'test' })
  const ids = []
  const reservations = new Map()
  const started = performance.now()
  try {
    await registry.start()
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    const owners = Array.from({ length: 8 }, () => randomUUID())
    const repository = createPostgresBookMarkupRepository(pool, {
      beforeCreateReaderScene: async (installationId) => {
        const reservation = await registry.reserve({
          installationId, metric: 'release_scene', perInstallationLimit: 3, globalLimit: 12
        })
        if (!reservation.ok) throw Object.assign(new Error('Test quota exhausted'), { code: 'RATE' })
        reservations.set(installationId, (reservations.get(installationId) || 0) + 1)
      }
    })
    const inputs = await Promise.all(Array.from({ length: 32 }, (_, index) => seedSceneBook(pool, owners[index % owners.length], ids)))
    const outcomes = await Promise.allSettled(inputs.map((input) => repository.ensureReaderBookScene(input)))
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 12)
    assert.equal(outcomes.filter((result) => result.status === 'rejected' && result.reason.code === 'RATE').length, 20)
    assert.ok([...reservations.values()].every((count) => count <= 3))
    assert.equal([...reservations.values()].reduce((sum, count) => sum + count, 0), 12)
    const jobs = (await pool.query('SELECT id FROM generation_jobs WHERE book_edition_id = ANY($1::uuid[])', [ids])).rows
    assert.equal(jobs.length, 12, 'quota-rejected inserts must roll back')
    const claims = (await Promise.all(Array.from({ length: 64 }, (_, index) =>
      repository.claimGenerationJob(`release-worker-${index}`, { jobTypes: ['scene_image'], bookEditionIds: ids })
    ))).filter(Boolean)
    assert.equal(claims.length, 12)
    assert.equal(new Set(claims.map((job) => job.id)).size, 12)
    assert.ok(claims.every((job) => job.attempts === 1))
    // A replacement lease fences off late results from a dead worker.
    const old = claims[0]
    await pool.query("UPDATE generation_jobs SET locked_at = now() - interval '10 minutes' WHERE id = $1", [old.id])
    const reclaimed = await repository.claimGenerationJob('release-replacement', { jobTypes: ['scene_image'], bookEditionIds: ids })
    assert.equal(reclaimed.id, old.id)
    assert.notEqual(reclaimed.leaseToken, old.leaseToken)
    await assert.rejects(repository.failGenerationJob(old, 'TEST_STALE'), (error) => error.code === 'LEASE_LOST')
    await repository.failGenerationJob(reclaimed, 'TEST_FINISHED', { maxAttempts: 1 })
    t.diagnostic(JSON.stringify({ owners: 8, independentRequests: 32, accepted: 12, quotaRejected: 20, workerClaimAttempts: 64, uniqueClaims: 12, staleLeaseRejected: true, elapsedMs: Math.round(performance.now() - started) }))
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = ANY($1::uuid[])', [ids])
    await pool.end()
    await registry.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
})
