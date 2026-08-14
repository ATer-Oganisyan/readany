import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bookAnalysisRunIdempotencyKey,
  createPostgresBookAnalysisRepository
} from '../book-analysis-repository.mjs'

function scriptedPool(scripts) {
  const queries = []
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params })
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
      const script = scripts.shift()
      if (!script) throw new Error(`unexpected query: ${sql}`)
      return script(sql, params)
    },
    release() {}
  }
  return {
    queries,
    async connect() { return client },
    async query(sql, params = []) { return client.query(sql, params) }
  }
}

test('analysis run key binds source and both pipeline versions', () => {
  assert.equal(bookAnalysisRunIdempotencyKey({
    bookEditionId: 'book-1',
    inputHash: 'a'.repeat(64),
    pipelineVersion: 'book-analysis-v8',
    promptVersion: 'scan-v1'
  }), `book-analysis:book-1:${'a'.repeat(64)}:book-analysis-v8:scan-v1`)
})

test('restart creates the next isolated run and leaves the previous publication untouched', async () => {
  const ids = [
    '123e4567-e89b-42d3-a456-426614174010',
    '123e4567-e89b-42d3-a456-426614174011'
  ]
  const pool = scriptedPool([
    () => ({ rows: [{
      id: '123e4567-e89b-42d3-a456-426614174001',
      content_sha256: 'a'.repeat(64)
    }] }),
    () => ({ rows: [{
      id: '123e4567-e89b-42d3-a456-426614174002',
      book_edition_id: '123e4567-e89b-42d3-a456-426614174001',
      input_hash: 'a'.repeat(64), pipeline_version: 'book-analysis-v8',
      prompt_version: 'book-scan-v4', run_sequence: 1,
      stage: 'publish', status: 'ready'
    }] }),
    (_sql, params) => ({ rows: [{
      id: params[0], idempotency_key: params[1],
      book_edition_id: params[2], input_hash: params[3],
      pipeline_version: params[4], prompt_version: params[5],
      run_sequence: params[6], stage: 'prepare', status: 'queued'
    }] }),
    (_sql, params) => ({ rows: [{
      id: params[0], run_id: params[1], stage: 'prepare', shard_key: 'book',
      status: 'queued', priority: params[2], attempts: 0, max_attempts: 5,
      payload: {}
    }] })
  ])
  const repository = createPostgresBookAnalysisRepository(pool, {
    idFactory: () => ids.shift()
  })

  const restarted = await repository.restartAnalysisRun({
    bookEditionId: '123e4567-e89b-42d3-a456-426614174001',
    priority: 100
  })

  assert.equal(restarted.created, true)
  assert.equal(restarted.run.runSequence, 2)
  assert.equal(restarted.prepareJob.priority, 100)
  assert.ok(pool.queries.some(({ sql }) => /INSERT INTO book_analysis_runs/.test(sql)))
  assert.ok(pool.queries.every(({ sql }) => !/(UPDATE|DELETE FROM) book_analysis_publications/.test(sql)))
})

test('analysis jobs are claimed with stage isolation, skip locked and expiring leases', async () => {
  const pool = scriptedPool([
    () => ({ rows: [] }),
    () => ({ rows: [{
      id: 'job-1', run_id: 'run-1', stage: 'scan', shard_key: 'chunk:0',
      chunk_id: 'chunk-1', status: 'running', priority: 50, attempts: 1,
      max_attempts: 5, lease_token: '123e4567-e89b-42d3-a456-426614174001', payload: {}
    }] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookAnalysisRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174001'
  })
  const job = await repository.claimAnalysisJob('scan-worker-1', {
    stages: ['scan'],
    leaseSeconds: 120
  })
  assert.equal(job.id, 'job-1')
  assert.equal(job.stage, 'scan')
  const claim = pool.queries.find(({ sql }) => /WITH candidate AS/.test(sql))
  assert.match(claim.sql, /run\.stage = job\.stage/)
  assert.match(claim.sql, /FOR UPDATE OF job SKIP LOCKED/)
  assert.match(claim.sql, /lease_expires_at = now\(\) \+ make_interval/)
  assert.deepEqual(claim.params[1], ['scan'])
})

test('analysis jobs are claimed fairly across books before another chunk from the same run', async () => {
  const pool = scriptedPool([
    () => ({ rows: [] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookAnalysisRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174001'
  })

  await repository.claimAnalysisJob('scan-worker-1', { stages: ['scan'] })

  const claim = pool.queries.find(({ sql }) => /WITH candidate AS/.test(sql))
  assert.match(claim.sql, /MAX\(sibling\.updated_at\)/)
  assert.match(claim.sql, /sibling\.attempts > 0/)
  assert.match(claim.sql, /NULLS FIRST/)
})

test('prepare completion writes chunks and scan jobs before advancing the barrier', async () => {
  const pool = scriptedPool([
    () => ({ rows: [{ id: 'prepare-1', max_attempts: 5, attempts: 1 }] }),
    () => ({ rows: [{ id: 'run-1' }] }),
    () => ({ rows: [] }),
    () => ({ rows: [] }),
    () => ({ rows: [] }),
    () => ({ rows: [{
      chunk_count: 1, first_ordinal: 0, last_ordinal: 0,
      first_offset: '0', last_offset: '100', covered_chars: '100',
      discontinuity_count: 0
    }] }),
    () => ({ rows: [] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookAnalysisRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174002'
  })
  const result = await repository.completePrepare({
    id: 'prepare-1', runId: 'run-1', leaseToken: '123e4567-e89b-42d3-a456-426614174003'
  }, {
    normalizedTextObjectKey: 'analysis/run-1/normalized-text-v1.txt',
    normalizedTextHash: 'b'.repeat(64),
    textLength: 100,
    sections: [{ key: 'document', startOffset: 0, endOffset: 100 }],
    chunks: [{
      id: '123e4567-e89b-42d3-a456-426614174004',
      ordinal: 0,
      chapterKey: 'document',
      coreStartOffset: 0,
      coreEndOffset: 100,
      contextStartOffset: 0,
      contextEndOffset: 100,
      contentHash: 'c'.repeat(64),
      metadata: {}
    }]
  })
  assert.deepEqual(result, { textLength: 100, chunkCount: 1, stage: 'scan' })
  const sql = pool.queries.map(({ sql }) => sql)
  const insertChunk = sql.findIndex((value) => /INSERT INTO book_analysis_chunks/.test(value))
  const insertJob = sql.findIndex((value) => /INSERT INTO book_analysis_jobs/.test(value))
  const readyPrepare = sql.findIndex((value) => /UPDATE book_analysis_jobs[\s\S]*status = 'ready'/.test(value))
  const advance = sql.findIndex((value) => /UPDATE book_analysis_runs SET stage = 'scan'/.test(value))
  assert.ok(insertChunk > 0 && insertChunk < insertJob)
  assert.ok(insertJob < readyPrepare && readyPrepare < advance)
  assert.ok(sql.some((value) => /chunk_ordinal', \$6::integer/.test(value)))
  assert.ok(sql.some((value) => /lag\(core_end_offset\)/.test(value)))
})

test('resolve completion freezes evidence before advancing to synthesize', async () => {
  const observation = {
    id: '11111111-1111-4111-8111-111111111111',
    chunk_id: '21111111-1111-4111-8111-111111111111',
    source_job_id: '31111111-1111-4111-8111-111111111111',
    extractor_version: 'book-scan-v1',
    observation_key: 'obs:anna',
    observation_type: 'character_mention',
    entity_kind: 'character',
    entity_candidate: 'Анна',
    related_entity_candidates: [],
    fact: 'Анна появилась',
    evidence_quote: 'Анна',
    evidence_start_offset: '10',
    evidence_end_offset: '14',
    confidence: 0.9,
    data: {},
    chapter_key: 'chapter-1'
  }
  const pool = scriptedPool([
    () => ({ rows: [{ id: 'resolve-1', max_attempts: 5, attempts: 1 }] }),
    () => ({ rows: [{ id: 'run-1' }] }),
    () => ({ rows: [observation] }),
    () => ({ rows: [] }),
    () => ({ rows: [] }),
    () => ({ rows: [] }),
    () => ({ rows: [] }),
    () => ({ rows: [] }),
    () => ({ rows: [] }),
    () => ({ rows: [] })
  ])
  const ids = [
    '41111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    '81111111-1111-4111-8111-111111111111'
  ]
  const repository = createPostgresBookAnalysisRepository(pool, {
    idFactory: () => ids.shift()
  })
  const input = await (async () => {
    const readPool = scriptedPool([
      () => ({ rows: [{
        run_id: 'run-1', book_edition_id: 'book-1', prompt_version: 'book-scan-v1',
        normalized_text_hash: 'a'.repeat(64), text_length: '100', title: 'Книга', author: ''
      }] }),
      () => ({ rows: [observation] })
    ])
    const readRepository = createPostgresBookAnalysisRepository(readPool)
    return readRepository.getResolveInput({
      id: 'resolve-1', runId: 'run-1', leaseToken: '71111111-1111-4111-8111-111111111111'
    })
  })()
  const result = await repository.completeResolve({
    id: 'resolve-1', runId: 'run-1', leaseToken: '71111111-1111-4111-8111-111111111111'
  }, {
    observationSetHash: input.observationSetHash,
    observationCount: 1,
    entities: [{
      entityKey: 'character:anna',
      entityKind: 'character',
      canonicalName: 'Анна',
      aliases: [],
      resolutionStatus: 'confirmed',
      confidence: 0.9,
      evidenceIds: [observation.id],
      data: { observationCount: 1 }
    }]
  })
  assert.equal(result.stage, 'synthesize')
  assert.equal(result.entityCount, 1)
  assert.equal(result.characterJobCount, 1)
  const sql = pool.queries.map(({ sql }) => sql)
  const insertEntity = sql.findIndex((value) => /INSERT INTO book_analysis_entities/.test(value))
  const linkEvidence = sql.findIndex((value) => /INSERT INTO book_analysis_entity_evidence/.test(value))
  const insertSnapshot = sql.findIndex((value) => /INSERT INTO book_analysis_snapshots/.test(value))
  const completeJob = sql.findIndex((value) => /UPDATE book_analysis_jobs[\s\S]*status = 'ready'/.test(value))
  const insertCharacterSynthesize = sql.findIndex((value) => /'synthesize', \$3/.test(value))
  const insertSynthesize = sql.findIndex((value) => /'synthesize', 'book'/.test(value))
  const advance = sql.findIndex((value) => /SET stage = 'synthesize'/.test(value))
  assert.ok(insertEntity < linkEvidence && linkEvidence < insertSnapshot)
  assert.ok(insertSnapshot < completeJob && completeJob < insertCharacterSynthesize)
  assert.ok(insertCharacterSynthesize < insertSynthesize && insertSynthesize < advance)
})
