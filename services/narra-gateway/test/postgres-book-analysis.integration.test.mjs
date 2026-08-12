import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { assembleBookMarkupV3 } from '../book-analysis-assembler.mjs'
import { createPostgresBookAnalysisRepository } from '../book-analysis-repository.mjs'
import { resolveBookAnalysisEntities } from '../book-analysis-resolver.mjs'
import { validateBookMarkupV3 } from '../book-analysis-validator.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

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
       ) VALUES ($1, $2, $3, 'book-analysis-v3', 'scan-v1', $4)`,
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

test('PostgreSQL analysis workers claim different scan shards and reclaim an expired lease', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 4 })
  const bookEditionId = randomUUID()
  const hash = 'e'.repeat(64)
  const normalizedText = `${' '.repeat(10)}test${' '.repeat(46)}test${' '.repeat(36)}`
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
      const startOffset = firstChunk ? 10 : 60
      return {
        observationKey: `obs:${firstChunk ? 'first' : 'second'}`,
        type: 'character_action',
        entityKind: 'character',
        entityCandidate: firstChunk ? 'Анна' : 'Борис',
        relatedEntityCandidates: [],
        fact: 'Подтверждённое действие',
        evidence: {
          quote: 'test',
          startOffset,
          endOffset: startOffset + 4,
          chapterKey: firstChunk ? 'chapter-1' : 'chapter-2'
        },
        confidence: 0.9
      }
    }

    const completionResults = await Promise.all([
      repository.completeScan(second, {
        extractorVersion: 'book-scan-v2',
        observations: [scanObservation(second)]
      }),
      repository.completeScan(reclaimed, {
        extractorVersion: 'book-scan-v2',
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
        extractorVersion: 'book-scan-v2',
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
        synthesisVersion: 'character-profile-v1',
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
      `SELECT run.stage, run.status,
              (SELECT count(*)::integer FROM book_analysis_publications
               WHERE run_id = run.id AND channel = 'shadow') AS shadow_publications,
              (SELECT count(*)::integer FROM book_markup_versions
               WHERE book_edition_id = run.book_edition_id) AS visible_v2_markups
       FROM book_analysis_runs AS run WHERE run.id = $1`,
      [runId]
    )
    assert.deepEqual(finalState.rows[0], {
      stage: 'publish',
      status: 'ready',
      shadow_publications: 1,
      visible_v2_markups: 0
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
           $1, $2, $3, $4, 'book-scan-v2', 'obs:late',
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
