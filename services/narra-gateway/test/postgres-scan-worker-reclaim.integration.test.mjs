import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { createPostgresBookAnalysisRepository } from '../book-analysis-repository.mjs'
import { createBookAnalysisScanWorker } from '../book-analysis-scan-worker.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const enabled = process.env.NARRA_QA_FRESH_RECLAIM_DATABASE === '1'
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('real PostgreSQL reclaim cancels the old scan owner and replacement completes once', {
  skip: !enabled, timeout: 30000
}, async t => {
  const { default: pg } = await import('pg')
  // Deliberately not BOOK_MARKUP_TEST_DATABASE_URL: never use an existing app/test DB.
  const admin = new pg.Pool({ host: '127.0.0.1', port: 55438, user: 'narra_audit',
    database: 'postgres', ssl: false, max: 1, connectionTimeoutMillis: 2000 })
  const database = `narra_qa_pipeline_20260906_reclaim_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  let pool, created = false, running
  const storageStarted = deferred(), storageDone = deferred(), leaseLost = deferred()
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0)
    await admin.query(`CREATE DATABASE "${database}"`)
    created = true
    pool = new pg.Pool({ host: '127.0.0.1', port: 55438, user: 'narra_audit',
      database, ssl: false, max: 4, connectionTimeoutMillis: 2000 })
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, database)
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    const repository = createPostgresBookAnalysisRepository(pool)
    const text = 'Анна вошла в комнату.'
    const hash = createHash('sha256').update(text).digest('hex')
    const edition = randomUUID(), chunkId = randomUUID()
    await pool.query(`INSERT INTO book_editions
      (id,scope,catalog_key,content_sha256,title,author,format,status)
      VALUES ($1,'catalog',$2,$3,'Own reclaim fixture','','txt','marking_up')`, [edition, edition, hash])
    await pool.query(`INSERT INTO book_files
      (book_edition_id,object_key,mime_type,byte_size,content_hash,status)
      VALUES ($1,'own-reclaim/source.txt','text/plain',$2,$3,'ready')`, [edition, Buffer.byteLength(text), hash])
    const ensured = await repository.ensureAnalysisRun({ bookEditionId: edition, inputHash: hash })
    const runId = ensured.run.id
    const prepare = await repository.claimAnalysisJob('own-prepare', { stages: ['prepare'], runIds: [runId] })
    await repository.completePrepare(prepare, {
      normalizedTextObjectKey: 'own-reclaim/text.txt', normalizedTextHash: hash,
      textLength: text.length, sections: [{ key: 'own-section', title: 'Own chapter', startOffset: 0, endOffset: text.length }],
      contentNavigation: { version: 'book-navigation-v1', source: 'document', items: [], segments: [] },
      chunks: [{ id: chunkId, ordinal: 0, coreStartOffset: 0, coreEndOffset: text.length,
        contextStartOffset: 0, contextEndOffset: text.length, contentHash: hash,
        metadata: { contextByteStart: 0, contextByteEnd: Buffer.byteLength(text), sectionTitles: [] } }]
    })
    let oldJob, staleModels = 0, staleCommits = 0, staleFailures = 0
    t.mock.timers.enable({ apis: ['setInterval'] })
    const old = createBookAnalysisScanWorker({
      workerId: 'own-old', runIds: [runId], extractorVersion: ensured.run.promptVersion,
      leaseSeconds: 30, leaseRenewMs: 1000, logger: { info() {}, error() {}, warn() {} },
      repository: {
        ...repository,
        async claimAnalysisJob(...args) { oldJob = await repository.claimAnalysisJob(...args); return oldJob },
        async renewAnalysisJobLease(...args) {
          try { return await repository.renewAnalysisJobLease(...args) }
          catch (error) { leaseLost.resolve(error); throw error }
        },
        async completeScan(...args) { staleCommits++; return repository.completeScan(...args) },
        async failAnalysisJob(...args) { staleFailures++; return repository.failAnalysisJob(...args) }
      },
      storage: { async getBytesRange() { storageStarted.resolve(); await storageDone.promise; return { bytes: Buffer.from(text) } } },
      generator: { async scanBookChunk() { staleModels++; return { observations: [] } } }
    })
    running = old.runOnce()
    await storageStarted.promise
    await pool.query("UPDATE book_analysis_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [oldJob.id])
    const replacement = await repository.claimAnalysisJob('own-new', { stages: ['scan'], runIds: [runId], leaseSeconds: 30 })
    assert.equal(replacement.id, oldJob.id)
    assert.notEqual(replacement.leaseToken, oldJob.leaseToken)
    assert.equal(replacement.attempts, 2)
    t.mock.timers.tick(1000)
    assert.equal((await leaseLost.promise).code, 'LEASE_LOST')
    for (let i = 0; i < 8; i++) await Promise.resolve()
    storageDone.resolve()
    const outcome = await running
    assert.equal(outcome.errorCode, 'LEASE_LOST')
    assert.deepEqual([staleModels, staleCommits, staleFailures], [0, 0, 0])
    const before = await pool.query('SELECT status,lease_token FROM book_analysis_jobs WHERE id=$1', [replacement.id])
    assert.equal(before.rows[0].status, 'running')
    assert.equal(before.rows[0].lease_token, replacement.leaseToken)
    // Check fencing while the run is still in scan: a later RUN_STATE_CHANGED
    // alone would not prove that the old lease token is rejected.
    await assert.rejects(repository.completeScan(oldJob, {
      extractorVersion: ensured.run.promptVersion, observations: []
    }), error => error.code === 'LEASE_LOST')
    await repository.completeScan(replacement, { extractorVersion: ensured.run.promptVersion, observations: [{
      observationKey: 'own-action', type: 'character_action', entityKind: 'character',
      entityCandidate: 'Анна', relatedEntityCandidates: [], fact: text,
      evidence: { quote: text, startOffset: 0, endOffset: text.length }, confidence: 1
    }] })
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM book_analysis_observations WHERE run_id=$1', [runId])).rows[0].count, 1)
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM book_analysis_jobs WHERE run_id=$1 AND stage='resolve'", [runId])).rows[0].count, 1)
    assert.equal((await pool.query('SELECT stage FROM book_analysis_runs WHERE id=$1', [runId])).rows[0].stage, 'resolve')
    await assert.rejects(repository.completeScan(oldJob, { extractorVersion: ensured.run.promptVersion, observations: [] }),
      error => ['LEASE_LOST', 'RUN_STATE_CHANGED'].includes(error.code))
  } finally {
    storageDone.resolve()
    await running?.catch(() => {})
    t.mock.timers.reset()
    await pool?.end()
    if (created) {
      await admin.query(`DROP DATABASE "${database}"`)
      assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
        'own temporary database must be removed')
    }
    await admin.end()
  }
})
