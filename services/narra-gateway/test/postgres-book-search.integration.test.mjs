import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildNarrativeGraph } from '../book-narrative-graph.mjs'
import { createPostgresBookSearchRepository } from '../book-search-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('PostgreSQL search index is idempotent, gradual and searchable', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  const chunkId = randomUUID()
  const scanJobId = randomUUID()
  const observationId = randomUUID()
  const contentHash = 'a'.repeat(64)
  const normalizedHash = 'b'.repeat(64)
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Search Test', '', 'txt', 'base_ready')`,
      [bookEditionId, `search-${bookEditionId}`, contentHash]
    )
    await pool.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
         input_hash, normalized_text_object_key, normalized_text_hash,
         text_length, sections, stage, status
       ) VALUES (
         $1, $2, $3, 'book-analysis-test', 'scan-test', $4,
         $5, $6, 24, '[]'::jsonb, 'scan', 'running'
       )`,
      [
        runId, `search-test:${runId}`, bookEditionId, contentHash,
        `search-test/${runId}/normalized.txt`, normalizedHash
      ]
    )
    await pool.query(
      `INSERT INTO book_analysis_chunks (
         id, run_id, ordinal, chapter_key, core_start_offset, core_end_offset,
         context_start_offset, context_end_offset, content_hash, metadata
       ) VALUES ($1, $2, 0, 'chapter-1', 0, 24, 0, 24, $3, '{}'::jsonb)`,
      [chunkId, runId, contentHash]
    )
    await pool.query(
      `INSERT INTO book_analysis_jobs (
         id, run_id, stage, shard_key, chunk_id, status, locked_at,
         lease_expires_at, locked_by, lease_token
       ) VALUES (
         $1, $2, 'scan', 'chunk-0', $3, 'running', now(),
         now() + interval '1 minute', 'integration-test', $4
       )`,
      [scanJobId, runId, chunkId, randomUUID()]
    )
    await pool.query(
      `INSERT INTO book_analysis_observations (
         id, run_id, chunk_id, source_job_id, extractor_version,
         observation_key, observation_type, entity_kind, entity_candidate,
         related_entity_candidates, fact, evidence_quote,
         evidence_start_offset, evidence_end_offset, confidence
       ) VALUES (
         $1, $2, $3, $4, 'scan-test', 'friendship-observation',
         'relationship', 'relationship', 'Герой и Друг',
         '["Герой", "Друг"]'::jsonb, 'Герой и Друг являются друзьями.',
         'Герой', 0, 5, 0.95
       )`,
      [observationId, runId, chunkId, scanJobId]
    )

    const repository = createPostgresBookSearchRepository(pool)
    const first = await repository.enqueueBook({
      bookEditionId, embeddingModel: 'embedding-test', embeddingDimensions: 2
    })
    const second = await repository.enqueueBook({
      bookEditionId, embeddingModel: 'embedding-test', embeddingDimensions: 2
    })
    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(first.index.id, second.index.id)

    const privateOnly = await repository.claimJob('private-only-test', {
      types: ['lexical'], scopes: ['private'], leaseSeconds: 60
    })
    assert.equal(privateOnly, null)
    const lexical = await repository.claimJob('lexical-test', {
      types: ['lexical'], scopes: ['catalog'], leaseSeconds: 60
    })
    assert.equal(lexical.analysisChunkId, chunkId)
    const lexicalIndex = await repository.completeLexical(lexical, {
      coreText: 'Герой вернулся домой.'
    })
    assert.equal(lexicalIndex.state, 'lexical_ready')
    assert.equal(lexicalIndex.active, true)

    const hits = await repository.lexicalSearch({
      indexId: first.index.id,
      query: 'герой вернулся',
      maxTextOffset: 24,
      limit: 5
    })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].chunkId, chunkId)

    const embedding = await repository.claimJob('embedding-test', {
      types: ['embedding'], leaseSeconds: 60
    })
    const readyIndex = await repository.completeEmbedding(embedding, {
      embedding: [1, 0],
      provider: 'test',
      model: 'embedding-test',
      inputUnits: 7,
      estimatedCostUsd: 0.0001
    })
    assert.equal(readyIndex.state, 'vector_ready')
    assert.equal(readyIndex.vectorChunkCount, 1)

    const candidates = await repository.vectorCandidates({
      indexId: first.index.id,
      maxTextOffset: 24
    })
    assert.deepEqual(candidates[0].embedding, [1, 0])
    const usage = await pool.query(
      `SELECT operation, input_units, estimated_cost_usd::text AS cost
       FROM book_ai_usage WHERE book_edition_id = $1`,
      [bookEditionId]
    )
    assert.deepEqual(usage.rows, [{
      operation: 'embedding_index', input_units: 7, cost: '0.00010000'
    }])

    const snapshotId = randomUUID()
    const artifactId = randomUUID()
    const publicationHash = 'd'.repeat(64)
    const markup = {
      characters: [
        { characterKey: 'hero', name: 'Герой', fullName: 'Герой', firstAppearanceTextOffset: 1 },
        { characterKey: 'friend', name: 'Друг', fullName: 'Друг', firstAppearanceTextOffset: 5 }
      ],
      events: [],
      locations: [],
      relationships: [{
        relationshipKey: 'friendship', sourceCharacterKey: 'hero',
        targetCharacterKey: 'friend', description: 'друзья', evidenceIds: [observationId]
      }]
    }
    await pool.query(
      `INSERT INTO book_analysis_snapshots (
         id, run_id, snapshot_version, content_hash, evidence_count, data
       ) VALUES ($1, $2, 1, $3, 0, '{}'::jsonb)`,
      [snapshotId, runId, publicationHash]
    )
    await pool.query(
      `INSERT INTO book_analysis_artifacts (
         id, run_id, snapshot_id, artifact_kind, schema_version, status,
         content_hash, data, published_at
       ) VALUES (
         $1, $2, $3, 'book_markup', 3, 'published', $4, $5::jsonb, now()
       )`,
      [artifactId, runId, snapshotId, publicationHash, JSON.stringify(markup)]
    )
    await pool.query(
      `INSERT INTO book_analysis_publications (
         id, run_id, book_edition_id, artifact_id, analysis_version,
         content_hash, data
       ) VALUES ($1, $2, $3, $4, 'graph-test', $5, $6::jsonb)`,
      [
        randomUUID(), runId, bookEditionId, artifactId, publicationHash,
        JSON.stringify({ markup })
      ]
    )
    const graphRequest = await repository.enqueueGraph({ bookEditionId })
    assert.equal(graphRequest.created, true)
    const graphJob = await repository.claimJob('graph-test', {
      types: ['graph'], scopes: ['catalog'], leaseSeconds: 60
    })
    const graphInput = await repository.getGraphInput(graphJob)
    const graph = buildNarrativeGraph(graphInput)
    const graphIndex = await repository.completeGraph(graphJob, graph)
    assert.equal(graphIndex.state, 'graph_ready')
    const snapshot = await repository.graphSnapshot({
      indexId: first.index.id, maxTextOffset: 24, includeUnbounded: true
    })
    assert.equal(snapshot.nodes.length, 2)
    assert.equal(snapshot.edges.length, 1)
    assert.equal(snapshot.edges[0].label, 'друзья')
    const evidence = await repository.graphEvidence({
      indexId: first.index.id,
      evidenceIds: [observationId],
      maxTextOffset: 24
    })
    assert.deepEqual(evidence.map((item) => ({
      id: item.id, type: item.type, chunkId: item.chunkId
    })), [{ id: observationId, type: 'relationship', chunkId }])
    const storyRequest = await repository.enqueueStoryArcs({ bookEditionId })
    assert.equal(storyRequest.created, false)
    const storyJob = await repository.claimJob('story-test', {
      types: ['story_arc'], scopes: ['catalog'], leaseSeconds: 60
    })
    const storyIndex = await repository.completeStoryArcs(storyJob, {
      storyArcs: [{
        key: 'arc:friendship',
        title: 'Герой — Друг',
        summary: 'Герой и его друг проходят общую сюжетную линию.',
        eventKeys: ['meeting'],
        participantCharacterKeys: ['hero', 'friend'],
        startOffset: 1,
        endOffset: 20,
        evidenceIds: [],
        data: { source: 'test' }
      }]
    })
    assert.equal(storyIndex.state, 'story_arcs_ready')
    const withStory = await repository.graphSnapshot({
      indexId: first.index.id, maxTextOffset: 24, includeUnbounded: false
    })
    assert.equal(withStory.storyArcs.length, 1)
    assert.equal(withStory.storyArcs[0].key, 'arc:friendship')
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})

test('PostgreSQL search access never exposes another subject private book', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 1 })
  const bookEditionId = randomUUID()
  const ownerId = randomUUID()
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, owner_subject_id, content_sha256, title, author, format,
         status, source_storage, expires_at
       ) VALUES (
         $1, 'private', $2, $3, 'Private Search Test', '', 'txt',
         'base_ready', 'local_only', now() + interval '1 day'
       )`,
      [bookEditionId, ownerId, 'c'.repeat(64)]
    )
    const repository = createPostgresBookSearchRepository(pool)
    assert.equal(await repository.getSearchContext({
      subjectId: randomUUID(), bookEditionId
    }), null)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})
