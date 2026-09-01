import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { assembleBookMarkupV3 } from '../book-analysis-assembler.mjs'
import { createPostgresBookAnalysisRepository } from '../book-analysis-repository.mjs'
import { resolveBookAnalysisEntities } from '../book-analysis-resolver.mjs'
import { validateBookMarkupV3 } from '../book-analysis-validator.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('PostgreSQL persists two immutable pipeline lineages for one content hash', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const bookEditionId = randomUUID()
  const inputHash = createHash('sha256').update(`pipelines-${bookEditionId}`).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Pipeline Test', '', 'epub', 'marking_up')`,
      [bookEditionId, `pipelines-${bookEditionId}`, inputHash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 10, $3, 'ready')`,
      [bookEditionId, `pipelines/${bookEditionId}/source`, inputHash]
    )
    const repository = createPostgresBookAnalysisRepository(pool)
    const narra = await repository.ensureAnalysisRun({ bookEditionId, inputHash })
    const external = await repository.ensureAnalysisRun({
      bookEditionId,
      inputHash,
      pipelineId: 'external'
    })
    assert.equal(narra.run.pipelineId, 'narra')
    assert.equal(external.run.pipelineId, 'external')
    assert.notEqual(narra.run.id, external.run.id)
    assert.notEqual(narra.run.idempotencyKey, external.run.idempotencyKey)
    const rows = await pool.query(
      `SELECT run.pipeline_id, run.pipeline_implementation_version,
              job.pipeline_id AS job_pipeline_id,
              job.pipeline_implementation_version AS job_pipeline_version
       FROM book_analysis_runs AS run
       JOIN book_analysis_jobs AS job ON job.run_id = run.id
       WHERE run.book_edition_id = $1 AND job.stage = 'prepare'
       ORDER BY run.pipeline_id`,
      [bookEditionId]
    )
    assert.equal(rows.rows.length, 2)
    assert.ok(rows.rows.every((row) =>
      row.pipeline_id === row.job_pipeline_id &&
      row.pipeline_implementation_version === row.job_pipeline_version
    ))
    await assert.rejects(
      pool.query(
        `UPDATE book_analysis_runs SET pipeline_id = 'external' WHERE id = $1`,
        [narra.run.id]
      ),
      /run lineage is immutable/
    )
    await assert.rejects(
      pool.query(
        `UPDATE book_analysis_runs SET prompt_version = 'changed-after-retry' WHERE id = $1`,
        [narra.run.id]
      ),
      /run lineage is immutable/
    )

    const prepareNarra = await repository.claimAnalysisJob('prepare-narra', {
      stages: ['prepare'], pipelineIds: ['narra'], leaseSeconds: 60
    })
    const prepareExternal = await repository.claimAnalysisJob('prepare-external', {
      stages: ['prepare'], pipelineIds: ['external'], leaseSeconds: 60
    })
    assert.equal(prepareNarra.runId, narra.run.id)
    assert.equal(prepareExternal.runId, external.run.id)
    for (const [prepared, pipelineId, ordinal] of [
      [prepareNarra, 'narra', 1],
      [prepareExternal, 'external', 2]
    ]) {
      await repository.completePrepare(prepared, {
        normalizedTextObjectKey: `pipelines/${prepared.runId}/normalized.txt`,
        normalizedTextHash: String(ordinal).repeat(64),
        textLength: 10,
        sections: [{ key: 'book', startOffset: 0, endOffset: 10 }],
        contentNavigation: {
          version: 'book-navigation-v1', source: 'document', items: [], segments: []
        },
        chunks: [{
          id: randomUUID(), ordinal: 0, chapterKey: 'book',
          coreStartOffset: 0, coreEndOffset: 10,
          contextStartOffset: 0, contextEndOffset: 10,
          contentHash: String(ordinal + 2).repeat(64), metadata: {}
        }]
      })
      const scan = await repository.claimAnalysisJob(`scan-${pipelineId}`, {
        stages: ['scan'], pipelineIds: [pipelineId], leaseSeconds: 60
      })
      assert.equal(scan.runId, prepared.runId)
      assert.equal(scan.pipelineId, pipelineId)
      assert.equal(
        scan.shardKey,
        pipelineId === 'narra' ? 'chunk:0' : 'pipeline:external'
      )
    }
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})

test('PostgreSQL creates one isolated rerun and deduplicates concurrent restart requests', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 4 })
  const bookEditionId = randomUUID()
  const hash = createHash('sha256').update(`rerun-${bookEditionId}`).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Rerun Test', '', 'epub', 'marking_up')`,
      [bookEditionId, `rerun-${bookEditionId}`, hash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 10, $3, 'ready')`,
      [bookEditionId, `rerun/${bookEditionId}/source`, hash]
    )
    const repository = createPostgresBookAnalysisRepository(pool)
    const first = await repository.ensureAnalysisRun({ bookEditionId, inputHash: hash })
    const active = await repository.restartAnalysisRun({ bookEditionId })
    assert.equal(active.created, false)
    assert.equal(active.run.id, first.run.id)

    await pool.query(
      `UPDATE book_analysis_jobs SET status = 'cancelled'
       WHERE run_id = $1 AND status = 'queued'`,
      [first.run.id]
    )
    await pool.query(
      `UPDATE book_analysis_runs SET status = 'cancelled' WHERE id = $1`,
      [first.run.id]
    )

    const restarted = await Promise.all([
      repository.restartAnalysisRun({ bookEditionId }),
      repository.restartAnalysisRun({ bookEditionId })
    ])
    assert.equal(restarted.filter((value) => value.created).length, 1)
    assert.equal(new Set(restarted.map((value) => value.run.id)).size, 1)
    assert.equal(restarted[0].run.runSequence, 2)
    assert.equal(restarted[0].run.restartedFromRunId, first.run.id)

    const original = await repository.ensureAnalysisRun({ bookEditionId, inputHash: hash })
    assert.equal(original.run.id, first.run.id)
    assert.equal(original.run.runSequence, 1)
    const count = await pool.query(
      `SELECT count(*)::integer AS count
       FROM book_analysis_runs WHERE book_edition_id = $1`,
      [bookEditionId]
    )
    assert.equal(count.rows[0].count, 2)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})

test('PostgreSQL private retry is owner-scoped, concurrent, idempotent and source-aware', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 6 })
  const bookEditionId = randomUUID()
  const ownerSubjectId = randomUUID()
  const foreignSubjectId = randomUUID()
  const hash = createHash('sha256').update(`private-retry-${bookEditionId}`).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, owner_subject_id, content_sha256, title, author, format,
         status, source_storage, expires_at
       ) VALUES (
         $1, 'private', $2, $3, 'Private Retry', '', 'epub',
         'marking_up', 'temporary', now() + interval '1 day'
       )`,
      [bookEditionId, ownerSubjectId, hash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 10, $3, 'ready')`,
      [bookEditionId, `private-retry/${bookEditionId}/source`, hash]
    )
    const repository = createPostgresBookAnalysisRepository(pool)
    const first = await repository.ensureAnalysisRun({ bookEditionId, inputHash: hash })
    await pool.query(
      `UPDATE book_analysis_jobs SET status = 'cancelled'
       WHERE run_id = $1 AND status = 'queued'`,
      [first.run.id]
    )
    await pool.query(
      `UPDATE book_analysis_runs
       SET status = 'cancelled', last_error_code = 'OPERATOR_CANCELLED' WHERE id = $1`,
      [first.run.id]
    )

    const requestIds = [randomUUID(), randomUUID()]
    const concurrent = await Promise.all(requestIds.map((requestId) =>
      repository.retryPrivateAnalysisRun({
        subjectId: ownerSubjectId,
        bookEditionId,
        requestId
      })
    ))
    assert.equal(concurrent.filter((value) => value.outcome === 'created').length, 1)
    assert.equal(concurrent.filter((value) => value.outcome === 'active').length, 1)
    assert.equal(new Set(concurrent.map((value) => value.run.id)).size, 1)
    assert.equal(concurrent[0].run.runSequence, 2)
    assert.equal(concurrent[0].run.restartedFromRunId, first.run.id)

    const repeated = await repository.retryPrivateAnalysisRun({
      subjectId: ownerSubjectId,
      bookEditionId,
      requestId: requestIds[0]
    })
    assert.equal(repeated.idempotent, true)
    assert.equal(repeated.run.id, concurrent[0].run.id)
    await assert.rejects(
      repository.retryPrivateAnalysisRun({
        subjectId: foreignSubjectId,
        bookEditionId,
        requestId: randomUUID()
      }),
      (error) => error.code === 'NOT_FOUND' && error.status === 404
    )

    await pool.query(
      `UPDATE book_analysis_jobs SET status = 'cancelled'
       WHERE run_id = $1 AND status = 'queued'`,
      [concurrent[0].run.id]
    )
    await pool.query(
      `UPDATE book_analysis_runs SET status = 'cancelled' WHERE id = $1`,
      [concurrent[0].run.id]
    )
    await pool.query(
      `UPDATE book_editions SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [bookEditionId]
    )
    await assert.rejects(
      repository.retryPrivateAnalysisRun({
        subjectId: ownerSubjectId,
        bookEditionId,
        requestId: randomUUID()
      }),
      (error) => error.code === 'SOURCE_UNAVAILABLE' && error.status === 409
    )
    const runCount = await pool.query(
      'SELECT count(*)::integer AS count FROM book_analysis_runs WHERE book_edition_id = $1',
      [bookEditionId]
    )
    assert.equal(runCount.rows[0].count, 2)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})

test('PostgreSQL analysis barriers reject incomplete or skipped stages', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  const prepareJobId = randomUUID()
  const hash = 'd'.repeat(64)
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Analysis Test', '', 'epub', 'marking_up')`,
      [bookEditionId, `analysis-${bookEditionId}`, hash]
    )
    await pool.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version, input_hash
       ) VALUES ($1, $2, $3, 'book-analysis-v8', 'scan-v1', $4)`,
      [runId, `analysis:${bookEditionId}:v3`, bookEditionId, hash]
    )
    await pool.query(
      `INSERT INTO book_analysis_jobs (
         id, run_id, stage, shard_key, status
       ) VALUES ($1, $2, 'prepare', 'book', 'queued')`,
      [prepareJobId, runId]
    )
    await pool.query(
      `UPDATE book_analysis_runs SET status = 'running' WHERE id = $1`,
      [runId]
    )
    await assert.rejects(
      pool.query(`UPDATE book_analysis_runs SET stage = 'scan' WHERE id = $1`, [runId]),
      /incomplete/
    )
    await pool.query(
      `UPDATE book_analysis_jobs SET status = 'ready', result = '{}'::jsonb WHERE id = $1`,
      [prepareJobId]
    )
    await pool.query(`UPDATE book_analysis_runs SET stage = 'scan' WHERE id = $1`, [runId])
    const state = await pool.query(
      `SELECT stage, status FROM book_analysis_runs WHERE id = $1`,
      [runId]
    )
    assert.deepEqual(state.rows[0], { stage: 'scan', status: 'running' })
    await assert.rejects(
      pool.query(
        `UPDATE book_analysis_runs SET stage = 'publish', status = 'ready' WHERE id = $1`,
        [runId]
      ),
      /stage changes require|exactly one step|publish stage is incomplete/
    )
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})

test('PostgreSQL stops a deterministic analysis failure without retrying identical input', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  const jobId = randomUUID()
  const hash = createHash('sha256').update(`deterministic-${bookEditionId}`).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Deterministic Failure', '', 'epub', 'marking_up')`,
      [bookEditionId, `deterministic-${bookEditionId}`, hash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 10, $3, 'ready')`,
      [bookEditionId, `deterministic/${bookEditionId}/source`, hash]
    )
    await pool.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
         input_hash, stage, status
       ) VALUES ($1, $2, $3, 'book-analysis-test', 'book-scan-test', $4, 'resolve', 'running')`,
      [runId, `deterministic:${bookEditionId}`, bookEditionId, hash]
    )
    await pool.query(
      `INSERT INTO book_analysis_jobs (
         id, run_id, stage, shard_key, status, max_attempts
       ) VALUES ($1, $2, 'resolve', 'book', 'queued', 5)`,
      [jobId, runId]
    )
    const repository = createPostgresBookAnalysisRepository(pool)
    const job = await repository.claimAnalysisJob('resolve-worker', {
      stages: ['resolve'], leaseSeconds: 60
    })
    const failed = await repository.failAnalysisJob(
      job,
      'ANALYSIS_TEXT_COVERAGE_INCOMPLETE',
      { retryable: false }
    )
    assert.deepEqual(failed, { status: 'failed', retrySeconds: undefined })
    const state = await pool.query(
      `SELECT run.status AS run_status, run.last_error_code,
              job.status AS job_status, job.attempts
       FROM book_analysis_runs AS run
       JOIN book_analysis_jobs AS job ON job.run_id = run.id
       WHERE run.id = $1`,
      [runId]
    )
    assert.deepEqual(state.rows[0], {
      run_status: 'failed',
      last_error_code: 'ANALYSIS_TEXT_COVERAGE_INCOMPLETE',
      job_status: 'failed',
      attempts: 1
    })
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})

test('PostgreSQL analysis workers claim different scan shards and reclaim an expired lease', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 4 })
  const bookEditionId = randomUUID()
  const hash = 'e'.repeat(64)
  const normalizedText = `${' '.repeat(10)}Анна${' '.repeat(36)}Борис${' '.repeat(45)}`
  const normalizedTextHash = createHash('sha256').update(normalizedText).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Parallel Test', '', 'epub', 'marking_up')`,
      [bookEditionId, `parallel-${bookEditionId}`, hash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 100, $3, 'ready')`,
      [bookEditionId, `parallel/${bookEditionId}/source`, hash]
    )
    const repository = createPostgresBookAnalysisRepository(pool)
    const source = await repository.getReadyAnalysisSource(bookEditionId)
    assert.equal(source.id, bookEditionId)
    assert.equal(source.contentSha256, hash)
    assert.equal(source.source.contentHash, hash)
    const ensured = await repository.ensureAnalysisRun({ bookEditionId, inputHash: hash })
    assert.equal(ensured.created, true)
    const runId = ensured.run.id
    const chunkIds = [randomUUID(), randomUUID()]
    const prepare = await repository.claimAnalysisJob('prepare-worker', {
      stages: ['prepare'],
      leaseSeconds: 60
    })
    assert.equal(prepare.id, ensured.prepareJob.id)
    assert.deepEqual(await repository.completePrepare(prepare, {
      normalizedTextObjectKey: `analysis/${runId}/normalized-text-v1.txt`,
      normalizedTextHash,
      textLength: 100,
      sections: [
        { key: 'chapter-1', title: 'One', startOffset: 0, endOffset: 50 },
        { key: 'chapter-2', title: 'Two', startOffset: 50, endOffset: 100 }
      ],
      contentNavigation: {
        version: 'book-navigation-v1', source: 'document', items: [], segments: []
      },
      chunks: [
        {
          id: chunkIds[0], ordinal: 0, chapterKey: 'chapter-1',
          coreStartOffset: 0, coreEndOffset: 50,
          contextStartOffset: 0, contextEndOffset: 60,
          contentHash: '1'.repeat(64), metadata: { sectionKeys: ['chapter-1'] }
        },
        {
          id: chunkIds[1], ordinal: 1, chapterKey: 'chapter-2',
          coreStartOffset: 50, coreEndOffset: 100,
          contextStartOffset: 40, contextEndOffset: 100,
          contentHash: '2'.repeat(64), metadata: { sectionKeys: ['chapter-2'] }
        }
      ]
    }), { textLength: 100, chunkCount: 2, stage: 'scan' })

    const [first, second] = await Promise.all([
      repository.claimAnalysisJob('scan-worker-1', { stages: ['scan'], leaseSeconds: 60 }),
      repository.claimAnalysisJob('scan-worker-2', { stages: ['scan'], leaseSeconds: 60 })
    ])
    assert.ok(first)
    assert.ok(second)
    assert.notEqual(first.id, second.id)
    assert.notEqual(first.chunkId, second.chunkId)

    await pool.query(
      `UPDATE book_analysis_jobs
       SET lease_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [first.id]
    )
    const reclaimed = await repository.claimAnalysisJob('scan-worker-3', {
      stages: ['scan'],
      leaseSeconds: 60
    })
    assert.equal(reclaimed.id, first.id)
    assert.equal(reclaimed.attempts, 2)
    assert.notEqual(reclaimed.leaseToken, first.leaseToken)

    function scanObservation(scanJob) {
      const firstChunk = scanJob.chunkId === chunkIds[0]
      const startOffset = firstChunk ? 10 : 50
      const quote = firstChunk ? 'Анна' : 'Борис'
      return {
        observationKey: `obs:${firstChunk ? 'first' : 'second'}`,
        type: 'character_action',
        entityKind: 'character',
        entityCandidate: firstChunk ? 'Анна' : 'Борис',
        relatedEntityCandidates: [],
        fact: 'Подтверждённое действие',
        evidence: {
          quote,
          startOffset,
          endOffset: startOffset + quote.length,
          chapterKey: firstChunk ? 'chapter-1' : 'chapter-2'
        },
        confidence: 0.99
      }
    }

    const completionResults = await Promise.all([
      repository.completeScan(second, {
        extractorVersion: ensured.run.promptVersion,
        observations: [scanObservation(second)]
      }),
      repository.completeScan(reclaimed, {
        extractorVersion: ensured.run.promptVersion,
        observations: [scanObservation(reclaimed)]
      })
    ])
    assert.deepEqual(
      completionResults.map(({ stage }) => stage).sort(),
      ['resolve', 'scan']
    )
    const barrierState = await pool.query(
      `SELECT run.stage,
              count(job.*) FILTER (WHERE job.stage = 'resolve')::integer AS resolve_jobs,
              count(job.*) FILTER (
                WHERE job.stage = 'scan' AND job.status = 'ready'
              )::integer AS ready_scan_jobs
       FROM book_analysis_runs AS run
       LEFT JOIN book_analysis_jobs AS job ON job.run_id = run.id
       WHERE run.id = $1
       GROUP BY run.stage`,
      [runId]
    )
    assert.deepEqual(barrierState.rows[0], {
      stage: 'resolve',
      resolve_jobs: 1,
      ready_scan_jobs: 2
    })
    const storedObservations = await pool.query(
      `SELECT count(*)::integer AS count
       FROM book_analysis_observations WHERE run_id = $1`,
      [runId]
    )
    assert.equal(storedObservations.rows[0].count, 2)
    await assert.rejects(
      repository.completeScan(first, {
        extractorVersion: ensured.run.promptVersion,
        observations: [scanObservation(first)]
      }),
      (error) => ['LEASE_LOST', 'RUN_STATE_CHANGED'].includes(error.code)
    )

    const resolve = await repository.claimAnalysisJob('resolve-worker-1', {
      stages: ['resolve'],
      leaseSeconds: 60
    })
    assert.ok(resolve)
    const resolveInput = await repository.getResolveInput(resolve)
    assert.equal(resolveInput.observations.length, 2)
    assert.match(resolveInput.observationSetHash, /^[0-9a-f]{64}$/)
    const entities = resolveBookAnalysisEntities({
      observations: resolveInput.observations
    })
    await assert.rejects(
      repository.completeResolve(resolve, {
        observationSetHash: 'b'.repeat(64),
        observationCount: resolveInput.observations.length,
        entities
      }),
      (error) => error.code === 'RESOLUTION_INPUT_CHANGED'
    )
    await assert.rejects(
      repository.completeResolve(resolve, {
        observationSetHash: resolveInput.observationSetHash,
        observationCount: resolveInput.observations.length,
        entities: entities.slice(0, 1)
      }),
      (error) => error.code === 'RESOLUTION_OUTPUT_INCOMPLETE'
    )
    await assert.rejects(
      repository.completeResolve(resolve, {
        observationSetHash: resolveInput.observationSetHash,
        observationCount: resolveInput.observations.length,
        entities: entities.map((entity) => entity.entityKind === 'character'
          ? { ...entity, resolutionStatus: 'rejected' }
          : entity)
      }),
      (error) => error.code === 'ANALYSIS_CHARACTERS_MISSING'
    )
    const rolledBack = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM book_analysis_entities WHERE run_id = $1) AS entities,
         (SELECT count(*)::integer FROM book_analysis_snapshots WHERE run_id = $1) AS snapshots,
         (SELECT stage FROM book_analysis_runs WHERE id = $1) AS stage`,
      [runId]
    )
    assert.deepEqual(rolledBack.rows[0], { entities: 0, snapshots: 0, stage: 'resolve' })
    const resolved = await repository.completeResolve(resolve, {
      observationSetHash: resolveInput.observationSetHash,
      observationCount: resolveInput.observations.length,
      entities
    })
    assert.equal(resolved.stage, 'synthesize')
    assert.equal(resolved.entityCount, 2)
    assert.match(resolved.snapshotId, /^[0-9a-f-]{36}$/)
    const resolvedState = await pool.query(
      `SELECT run.stage,
              count(DISTINCT entity.id)::integer AS entities,
              count(DISTINCT evidence.observation_id)::integer AS linked_observations,
              count(DISTINCT snapshot.id)::integer AS snapshots,
              count(DISTINCT synthesize.id)::integer AS synthesize_jobs
       FROM book_analysis_runs AS run
       LEFT JOIN book_analysis_entities AS entity ON entity.run_id = run.id
       LEFT JOIN book_analysis_entity_evidence AS evidence ON evidence.run_id = run.id
       LEFT JOIN book_analysis_snapshots AS snapshot ON snapshot.run_id = run.id
       LEFT JOIN book_analysis_jobs AS synthesize
         ON synthesize.run_id = run.id AND synthesize.stage = 'synthesize'
       WHERE run.id = $1
       GROUP BY run.stage`,
      [runId]
    )
    assert.deepEqual(resolvedState.rows[0], {
      stage: 'synthesize',
      entities: 2,
      linked_observations: 2,
      snapshots: 1,
      synthesize_jobs: 3
    })
    const snapshot = await pool.query(
      `SELECT evidence_count, data FROM book_analysis_snapshots WHERE id = $1`,
      [resolved.snapshotId]
    )
    assert.equal(snapshot.rows[0].evidence_count, 2)
    assert.equal(snapshot.rows[0].data.observationIds.length, 2)
    assert.equal(snapshot.rows[0].data.entities.length, 2)

    const firstCharacter = await repository.claimAnalysisJob('synthesis-worker-1', {
      stages: ['synthesize'], leaseSeconds: 60
    })
    const secondCharacter = await repository.claimAnalysisJob('synthesis-worker-2', {
      stages: ['synthesize'], leaseSeconds: 60
    })
    assert.equal(firstCharacter.payload.mode, 'character_profile')
    assert.equal(secondCharacter.payload.mode, 'character_profile')
    assert.notEqual(firstCharacter.id, secondCharacter.id)
    assert.equal(await repository.claimAnalysisJob('synthesis-worker-3', {
      stages: ['synthesize'], leaseSeconds: 60
    }), null)
    for (const characterJob of [firstCharacter, secondCharacter]) {
      const input = await repository.getSynthesizeInput(characterJob)
      assert.equal(input.observations.length, 1)
      await repository.completeCharacterSynthesis(characterJob, {
        snapshotId: input.snapshot.id,
        synthesisVersion: 'character-profile-v3',
        selectedEvidenceIds: input.observations.map(({ id }) => id),
        profile: {
          role: null,
          age: null,
          gender: null,
          description: null,
          traits: [],
          appearance: [],
          speechStyle: null,
          speechExamples: [],
          creative: { greeting: '', appearancePrompt: '', voice: '' }
        }
      })
    }
    const assembleJob = await repository.claimAnalysisJob('assembly-worker-1', {
      stages: ['synthesize'], leaseSeconds: 60
    })
    assert.equal(assembleJob.shardKey, 'book')
    const assemblyInput = await repository.getSynthesizeInput(assembleJob)
    assert.equal(assemblyInput.characterProfiles.length, 2)
    const markup = assembleBookMarkupV3({
      snapshotId: assemblyInput.snapshot.id,
      textLength: assemblyInput.textLength,
      entities: assemblyInput.snapshot.data.entities,
      observations: assemblyInput.observations,
      characterProfiles: assemblyInput.characterProfiles
    })
    assert.equal(markup.characters.length, 2)
    const synthesisResult = await repository.completeBookSynthesis(assembleJob, {
      snapshotId: assemblyInput.snapshot.id,
      markup
    })
    assert.equal(synthesisResult.stage, 'validate')

    const validateJob = await repository.claimAnalysisJob('validate-worker-1', {
      stages: ['validate'], leaseSeconds: 60
    })
    const validationInput = await repository.getValidationInput(validateJob)
    const validation = validateBookMarkupV3({
      markup: validationInput.artifact.data,
      snapshot: validationInput.snapshot,
      observations: validationInput.observations,
      normalizedText,
      normalizedTextHash: validationInput.normalizedTextHash
    })
    assert.equal(validation.valid, true)
    const validationResult = await repository.completeValidation(validateJob, {
      report: {
        ...validation,
        bindings: {
          snapshotId: validationInput.snapshot.id,
          snapshotContentHash: validationInput.snapshot.contentHash,
          normalizedTextHash: validationInput.normalizedTextHash,
          markupArtifactId: validationInput.artifact.id,
          markupContentHash: validationInput.artifact.contentHash
        }
      }
    })
    assert.equal(validationResult.stage, 'publish')

    const publishJob = await repository.claimAnalysisJob('publish-worker-1', {
      stages: ['publish'], leaseSeconds: 60
    })
    const publishInput = await repository.getPublishInput(publishJob)
    assert.equal(publishInput.channel, 'shadow')
    assert.equal(publishInput.validationReport.valid, true)
    const publication = await repository.completeShadowPublish(publishJob, {
      artifactId: publishInput.artifact.id
    })
    assert.equal(publication.status, 'ready')
    const finalState = await pool.query(
      `SELECT run.stage, run.status, edition.status AS edition_status,
              (SELECT count(*)::integer FROM book_analysis_publications
               WHERE run_id = run.id AND channel = 'shadow') AS shadow_publications,
              (SELECT count(*)::integer FROM book_markup_versions
               WHERE book_edition_id = run.book_edition_id
                 AND status = 'published' AND analysis_version = 'book-markup-v3') AS media_projections,
              (SELECT count(*)::integer FROM generation_jobs
               WHERE book_edition_id = run.book_edition_id
                 AND job_type IN ('character_portrait', 'character_audio', 'character_animation')
                 AND target_version = 'character-bundle-v3:r1') AS media_jobs,
              (SELECT count(*)::integer
               FROM book_markup_versions AS media_markup
               JOIN book_characters AS media_character
                 ON media_character.markup_version_id = media_markup.id
               WHERE media_markup.book_edition_id = run.book_edition_id
                 AND media_markup.status = 'published'
                 AND media_character.data->>'analysisSource' = 'book-markup-v3') AS media_characters
       FROM book_analysis_runs AS run
       JOIN book_editions AS edition ON edition.id = run.book_edition_id
       WHERE run.id = $1`,
      [runId]
    )
    assert.deepEqual(finalState.rows[0], {
      stage: 'publish',
      status: 'ready',
      edition_status: 'base_ready',
      shadow_publications: 1,
      media_projections: 1,
      media_jobs: 6,
      media_characters: 2
    })
    const repeatedProjection = await repository.ensureLatestMediaProjection(bookEditionId)
    assert.equal(repeatedProjection.created, false)
    assert.equal(repeatedProjection.queuedCharacters, 2)
    const failedMediaJob = await pool.query(
      `UPDATE generation_jobs
       SET status = 'failed', attempts = 3, last_error_code = 'GENERATOR_HTTP_502'
       WHERE id = (
         SELECT id FROM generation_jobs
         WHERE book_edition_id = $1 AND target_version = 'character-bundle-v3:r1'
           AND job_type = 'character_portrait'
         ORDER BY character_key LIMIT 1
       )
       RETURNING id`,
      [bookEditionId]
    )
    await pool.query(
      `UPDATE character_media_bundles SET status = 'failed'
       WHERE job_id = $1`,
      [failedMediaJob.rows[0].id]
    )
    await repository.ensureLatestMediaProjection(bookEditionId)
    assert.equal((await pool.query(
      'SELECT status FROM generation_jobs WHERE id = $1',
      [failedMediaJob.rows[0].id]
    )).rows[0].status, 'failed')
    await repository.ensureLatestMediaProjection(bookEditionId, { retryFailedBundles: true })
    const retriedMedia = await pool.query(
      `SELECT job.status, job.attempts, job.last_error_code, bundle.status AS bundle_status
       FROM generation_jobs AS job
       JOIN character_media_bundles AS bundle ON bundle.job_id = job.id
       WHERE job.id = $1`,
      [failedMediaJob.rows[0].id]
    )
    assert.deepEqual(retriedMedia.rows[0], {
      status: 'queued', attempts: 0, last_error_code: null, bundle_status: 'queued'
    })
    const details = await repository.getAnalysisRunDetails(runId)
    assert.equal(details.run.status, 'ready')
    assert.equal(details.book.id, bookEditionId)
    assert.equal(details.jobs.scan.ready, 2)
    assert.equal(details.jobs.synthesize.ready, 3)
    assert.equal(details.publication.channel, 'shadow')
    assert.equal('data' in details.publication, false)
    const shadowResult = await repository.getShadowAnalysisPublication(runId)
    assert.equal(shadowResult.runId, runId)
    assert.equal(shadowResult.channel, 'shadow')
    assert.deepEqual(shadowResult.data.markup, markup)
    const existingObservation = resolveInput.observations[0]
    await assert.rejects(
      pool.query(
        `INSERT INTO book_analysis_observations (
           id, run_id, chunk_id, source_job_id, extractor_version,
           observation_key, observation_type, entity_kind, entity_candidate,
           related_entity_candidates, fact, evidence_quote,
           evidence_start_offset, evidence_end_offset, confidence
         ) VALUES (
           $1, $2, $3, $4, 'book-scan-v4', 'obs:late',
           'character_mention', 'character', 'Поздний герой',
           '[]'::jsonb, 'Поздний факт', 'late', 11, 15, 0.9
         )`,
        [randomUUID(), runId, existingObservation.chunkId, existingObservation.sourceJobId]
      ),
      /observations may be inserted only by a running scan job/
    )
    await assert.rejects(
      repository.completeResolve(resolve, {
        observationSetHash: resolveInput.observationSetHash,
        observationCount: resolveInput.observations.length,
        entities
      }),
      (error) => error.code === 'LEASE_LOST'
    )
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})
