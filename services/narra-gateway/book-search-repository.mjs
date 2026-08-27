import { randomUUID } from 'node:crypto'

const JOB_TYPES = new Set(['lexical', 'embedding', 'graph', 'story_arc'])
const BOOK_SCOPES = new Set(['catalog', 'private'])

function repositoryError(code, message) {
  return Object.assign(new Error(message), { code })
}

function identifier(value, name, max = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${name} is required`)
  }
  return value.trim()
}

function positiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be between 1 and ${max}`)
  }
  return value
}

function jobType(value) {
  if (!JOB_TYPES.has(value)) throw new TypeError(`unsupported search job type: ${value}`)
  return value
}

function bookScope(value) {
  if (!BOOK_SCOPES.has(value)) throw new TypeError(`unsupported book scope: ${value}`)
  return value
}

function jobRow(row) {
  if (!row) return null
  return {
    id: row.id,
    indexId: row.index_id,
    analysisChunkId: row.analysis_chunk_id,
    type: row.job_type,
    status: row.status,
    priority: Number(row.priority),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    leaseToken: row.lease_token,
    payload: row.payload ?? {}
  }
}

function indexRow(row) {
  if (!row) return null
  return {
    id: row.id,
    bookEditionId: row.book_edition_id,
    runId: row.run_id,
    sourceContentHash: row.source_content_hash,
    indexVersion: row.index_version,
    embeddingModel: row.embedding_model,
    embeddingDimensions: Number(row.embedding_dimensions),
    state: row.state,
    active: row.is_active,
    chunkTotal: Number(row.chunk_total),
    lexicalChunkCount: Number(row.lexical_chunk_count),
    vectorChunkCount: Number(row.vector_chunk_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

async function transaction(pool, operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function requireLease(client, job) {
  const result = await client.query(
    `SELECT * FROM book_search_jobs
     WHERE id = $1 AND index_id = $2 AND status = 'running'
       AND lease_token = $3::uuid
     FOR UPDATE`,
    [job.id, job.indexId, job.leaseToken]
  )
  if (!result.rows[0]) throw repositoryError('LEASE_LOST', `search job lease lost: ${job.id}`)
  return result.rows[0]
}

async function refreshIndexState(client, indexId) {
  const result = await client.query(
    `SELECT index.id, index.book_edition_id, index.chunk_total,
            count(chunk.analysis_chunk_id)::integer AS lexical_count,
            count(chunk.embedding)::integer AS vector_count
     FROM book_search_indexes AS index
     LEFT JOIN book_search_chunks AS chunk ON chunk.index_id = index.id
     WHERE index.id = $1
     GROUP BY index.id`,
    [indexId]
  )
  const row = result.rows[0]
  if (!row) throw repositoryError('INDEX_NOT_FOUND', `search index not found: ${indexId}`)
  const total = Number(row.chunk_total)
  const lexical = Number(row.lexical_count)
  const vector = Number(row.vector_count)
  let state = 'prepared'
  if (lexical === total) {
    state = vector === total ? 'vector_ready' : (vector > 0 ? 'vector_partial' : 'lexical_ready')
  }
  if (lexical === total) {
    await client.query(
      `UPDATE book_search_indexes SET is_active = false, updated_at = now()
       WHERE book_edition_id = $1 AND id <> $2 AND is_active`,
      [row.book_edition_id, indexId]
    )
  }
  const updated = await client.query(
    `UPDATE book_search_indexes
     SET state = $2, lexical_chunk_count = $3, vector_chunk_count = $4,
         is_active = CASE WHEN $3 = chunk_total THEN true ELSE is_active END,
         completed_at = CASE WHEN $4 = chunk_total THEN now() ELSE NULL END,
         last_error_code = NULL, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [indexId, state, lexical, vector]
  )
  return indexRow(updated.rows[0])
}

export function createPostgresBookSearchRepository(pool, { idFactory = randomUUID } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  if (typeof idFactory !== 'function') throw new TypeError('idFactory is required')

  return {
    async enqueueBook({
      bookEditionId,
      indexVersion = 'book-search-v1',
      embeddingModel = 'text-embedding-3-large',
      embeddingDimensions = 1024,
      priority = 50
    }) {
      identifier(bookEditionId, 'bookEditionId')
      identifier(indexVersion, 'indexVersion', 128)
      identifier(embeddingModel, 'embeddingModel', 240)
      positiveInteger(embeddingDimensions, 'embeddingDimensions', 4096)
      if (!Number.isSafeInteger(priority) || priority < 0 || priority > 100) {
        throw new RangeError('priority must be between 0 and 100')
      }
      return transaction(pool, async (client) => {
        const prepared = await client.query(
          `SELECT run.id AS run_id, run.input_hash, count(chunk.id)::integer AS chunk_total
           FROM book_analysis_runs AS run
           JOIN book_analysis_chunks AS chunk ON chunk.run_id = run.id
           WHERE run.book_edition_id = $1
             AND run.normalized_text_object_key IS NOT NULL
             AND run.normalized_text_hash IS NOT NULL
           GROUP BY run.id
           ORDER BY run.run_sequence DESC, run.created_at DESC
           LIMIT 1`,
          [bookEditionId]
        )
        const source = prepared.rows[0]
        if (!source) {
          throw repositoryError('BOOK_NOT_PREPARED', 'book has no prepared analysis chunks')
        }
        const proposedId = idFactory()
        const inserted = await client.query(
          `INSERT INTO book_search_indexes (
             id, book_edition_id, run_id, source_content_hash, index_version,
             embedding_model, embedding_dimensions, chunk_total
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (
             book_edition_id, run_id, index_version, embedding_model, embedding_dimensions
           ) DO NOTHING
           RETURNING *`,
          [
            proposedId, bookEditionId, source.run_id, source.input_hash, indexVersion,
            embeddingModel, embeddingDimensions, Number(source.chunk_total)
          ]
        )
        const created = Boolean(inserted.rows[0])
        const current = created
          ? inserted
          : await client.query(
              `SELECT * FROM book_search_indexes
               WHERE book_edition_id = $1 AND run_id = $2 AND index_version = $3
                 AND embedding_model = $4 AND embedding_dimensions = $5`,
              [bookEditionId, source.run_id, indexVersion, embeddingModel, embeddingDimensions]
            )
        const index = current.rows[0]
        if (created) {
          await client.query(
            `INSERT INTO book_search_jobs (
               id, index_id, analysis_chunk_id, job_type, priority
             )
             SELECT gen_random_uuid(), $1, chunk.id, 'lexical', $2
             FROM book_analysis_chunks AS chunk
             WHERE chunk.run_id = $3
             ORDER BY chunk.ordinal`,
            [index.id, priority, source.run_id]
          )
        }
        return { created, index: indexRow(index) }
      })
    },

    async claimJob(workerId, {
      types = ['lexical', 'embedding'],
      scopes = ['catalog', 'private'],
      leaseSeconds = 300
    } = {}) {
      const worker = identifier(workerId, 'workerId')
      if (!Array.isArray(types) || !types.length) throw new TypeError('types must not be empty')
      const allowedTypes = [...new Set(types.map(jobType))]
      if (!Array.isArray(scopes) || !scopes.length) throw new TypeError('scopes must not be empty')
      const allowedScopes = [...new Set(scopes.map(bookScope))]
      positiveInteger(leaseSeconds, 'leaseSeconds', 3600)
      return transaction(pool, async (client) => {
        const exhausted = await client.query(
          `UPDATE book_search_jobs AS job
           SET status = 'failed', last_error_code = 'LEASE_EXPIRED',
               locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           FROM book_search_indexes AS index, book_editions AS edition
           WHERE job.index_id = index.id AND index.book_edition_id = edition.id
             AND job.job_type = ANY($1::text[]) AND edition.scope = ANY($2::text[])
             AND job.status = 'running' AND job.lease_expires_at <= now()
             AND job.attempts >= job.max_attempts
           RETURNING job.index_id`,
          [allowedTypes, allowedScopes]
        )
        if (exhausted.rows.length) {
          await client.query(
            `UPDATE book_search_indexes
             SET last_error_code = 'LEASE_EXPIRED', updated_at = now()
             WHERE id = ANY($1::uuid[])`,
            [[...new Set(exhausted.rows.map((row) => row.index_id))]]
          )
        }
        const leaseToken = idFactory()
        const claimed = await client.query(
          `WITH candidate AS (
             SELECT job.id FROM book_search_jobs AS job
             JOIN book_search_indexes AS index ON index.id = job.index_id
             JOIN book_editions AS edition ON edition.id = index.book_edition_id
             WHERE job.job_type = ANY($2::text[])
               AND edition.scope = ANY($3::text[])
               AND job.attempts < job.max_attempts
               AND (
                 (job.status = 'queued' AND job.available_at <= now()) OR
                 (job.status = 'running' AND job.lease_expires_at <= now())
               )
             ORDER BY job.priority DESC, job.available_at, job.created_at
             FOR UPDATE OF job SKIP LOCKED
             LIMIT 1
           )
           UPDATE book_search_jobs AS job
           SET status = 'running', attempts = attempts + 1, locked_at = now(),
               lease_expires_at = now() + make_interval(secs => $4),
               locked_by = $1, lease_token = $5::uuid, updated_at = now()
           FROM candidate WHERE job.id = candidate.id
           RETURNING job.*`,
          [worker, allowedTypes, allowedScopes, leaseSeconds, leaseToken]
        )
        return jobRow(claimed.rows[0])
      })
    },

    async renewJobLease(job, { leaseSeconds = 300 } = {}) {
      positiveInteger(leaseSeconds, 'leaseSeconds', 3600)
      const result = await pool.query(
        `UPDATE book_search_jobs
         SET locked_at = now(), lease_expires_at = now() + make_interval(secs => $3),
             updated_at = now()
         WHERE id = $1 AND status = 'running' AND lease_token = $2::uuid
         RETURNING id`,
        [job.id, job.leaseToken, leaseSeconds]
      )
      if (!result.rows[0]) throw repositoryError('LEASE_LOST', `search job lease lost: ${job.id}`)
      return { renewed: true }
    },

    async getJobInput(job) {
      const result = await pool.query(
        `SELECT job.id, job.index_id, job.job_type, job.lease_token,
                index.book_edition_id, index.run_id, index.embedding_model,
                index.embedding_dimensions, run.normalized_text_object_key,
                chunk.id AS analysis_chunk_id, chunk.ordinal, chunk.chapter_key,
                chunk.core_start_offset, chunk.core_end_offset,
                chunk.context_start_offset, chunk.context_end_offset,
                chunk.content_hash, chunk.metadata
         FROM book_search_jobs AS job
         JOIN book_search_indexes AS index ON index.id = job.index_id
         JOIN book_analysis_runs AS run ON run.id = index.run_id
         JOIN book_analysis_chunks AS chunk
           ON chunk.run_id = index.run_id AND chunk.id = job.analysis_chunk_id
         WHERE job.id = $1 AND job.index_id = $2 AND job.status = 'running'
           AND job.lease_token = $3::uuid`,
        [job.id, job.indexId, job.leaseToken]
      )
      const row = result.rows[0]
      if (!row) throw repositoryError('LEASE_LOST', `search job lease lost: ${job.id}`)
      return {
        indexId: row.index_id,
        bookEditionId: row.book_edition_id,
        runId: row.run_id,
        type: row.job_type,
        embeddingModel: row.embedding_model,
        embeddingDimensions: Number(row.embedding_dimensions),
        normalizedTextObjectKey: row.normalized_text_object_key,
        chunk: {
          id: row.analysis_chunk_id,
          ordinal: Number(row.ordinal),
          chapterKey: row.chapter_key,
          coreStartOffset: Number(row.core_start_offset),
          coreEndOffset: Number(row.core_end_offset),
          contextStartOffset: Number(row.context_start_offset),
          contextEndOffset: Number(row.context_end_offset),
          contentHash: row.content_hash,
          metadata: row.metadata ?? {}
        }
      }
    },

    async completeLexical(job, { coreText }) {
      if (typeof coreText !== 'string' || !coreText.length) {
        throw new TypeError('coreText is required')
      }
      return transaction(pool, async (client) => {
        const leased = await requireLease(client, job)
        if (leased.job_type !== 'lexical') throw repositoryError('JOB_TYPE', 'job is not lexical')
        await client.query(
          `INSERT INTO book_search_chunks (
             index_id, run_id, analysis_chunk_id, ordinal, chapter_key,
             core_start_offset, core_end_offset, context_start_offset,
             context_end_offset, content_hash, core_text
           )
           SELECT index.id, index.run_id, chunk.id, chunk.ordinal, chunk.chapter_key,
                  chunk.core_start_offset, chunk.core_end_offset,
                  chunk.context_start_offset, chunk.context_end_offset,
                  chunk.content_hash, $3
           FROM book_search_indexes AS index
           JOIN book_analysis_chunks AS chunk
             ON chunk.run_id = index.run_id AND chunk.id = $2
           WHERE index.id = $1
           ON CONFLICT (index_id, analysis_chunk_id) DO UPDATE
             SET core_text = EXCLUDED.core_text, lexical_indexed_at = now()`,
          [job.indexId, job.analysisChunkId, coreText]
        )
        await client.query(
          `UPDATE book_search_jobs
           SET status = 'ready', result = jsonb_build_object('characters', $3::integer),
               locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, coreText.length]
        )
        await client.query(
          `INSERT INTO book_search_jobs (
             id, index_id, analysis_chunk_id, job_type, priority
           ) VALUES ($1, $2, $3, 'embedding', $4)
           ON CONFLICT (index_id, job_type, analysis_chunk_id) DO NOTHING`,
          [idFactory(), job.indexId, job.analysisChunkId, job.priority]
        )
        return refreshIndexState(client, job.indexId)
      })
    },

    async completeEmbedding(job, {
      embedding,
      provider,
      model,
      inputUnits = 0,
      estimatedCostUsd = null
    }) {
      if (!Array.isArray(embedding) || !embedding.length || embedding.some((value) =>
        typeof value !== 'number' || !Number.isFinite(value)
      )) throw new TypeError('embedding must contain finite numbers')
      identifier(provider, 'provider', 120)
      identifier(model, 'model', 240)
      if (!Number.isSafeInteger(inputUnits) || inputUnits < 0) {
        throw new RangeError('inputUnits must be a non-negative integer')
      }
      return transaction(pool, async (client) => {
        const leased = await requireLease(client, job)
        if (leased.job_type !== 'embedding') throw repositoryError('JOB_TYPE', 'job is not embedding')
        const indexResult = await client.query(
          'SELECT * FROM book_search_indexes WHERE id = $1 FOR UPDATE',
          [job.indexId]
        )
        const index = indexResult.rows[0]
        if (!index) throw repositoryError('INDEX_NOT_FOUND', 'search index not found')
        if (embedding.length !== Number(index.embedding_dimensions) || model !== index.embedding_model) {
          throw repositoryError('EMBEDDING_CONTRACT', 'embedding does not match index contract')
        }
        const updated = await client.query(
          `UPDATE book_search_chunks
           SET embedding = $3::double precision[], embedding_model = $4,
               embedding_dimensions = $5, vector_indexed_at = now()
           WHERE index_id = $1 AND analysis_chunk_id = $2
           RETURNING analysis_chunk_id`,
          [job.indexId, job.analysisChunkId, embedding, model, embedding.length]
        )
        if (!updated.rows[0]) throw repositoryError('LEXICAL_REQUIRED', 'lexical chunk is missing')
        await client.query(
          `UPDATE book_search_jobs
           SET status = 'ready', result = jsonb_build_object(
                 'dimensions', $3::integer, 'input_units', $4::integer
               ), locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, embedding.length, inputUnits]
        )
        await client.query(
          `INSERT INTO book_ai_usage (
             id, book_edition_id, search_index_id, search_job_id, operation,
             provider, model, input_units, estimated_cost_usd
           ) VALUES ($1, $2, $3, $4, 'embedding_index', $5, $6, $7, $8)`,
          [
            idFactory(), index.book_edition_id, job.indexId, job.id,
            provider, model, inputUnits, estimatedCostUsd
          ]
        )
        return refreshIndexState(client, job.indexId)
      })
    },

    async failJob(job, errorCode, { retryable = true, retryDelaySeconds = 5 } = {}) {
      identifier(errorCode, 'errorCode', 64)
      positiveInteger(retryDelaySeconds, 'retryDelaySeconds', 3600)
      return transaction(pool, async (client) => {
        const leased = await requireLease(client, job)
        const retry = retryable && Number(leased.attempts) < Number(leased.max_attempts)
        const failed = await client.query(
          `UPDATE book_search_jobs
           SET status = $3, last_error_code = $4,
               available_at = CASE WHEN $3 = 'queued'
                 THEN now() + make_interval(secs => $5) ELSE available_at END,
               locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid
           RETURNING *`,
          [
            job.id, job.leaseToken, retry ? 'queued' : 'failed', errorCode,
            retryDelaySeconds
          ]
        )
        await client.query(
          `UPDATE book_search_indexes
           SET last_error_code = $2, updated_at = now() WHERE id = $1`,
          [job.indexId, errorCode]
        )
        return jobRow(failed.rows[0])
      })
    },

    async enqueueGraph({ bookEditionId, priority = 40 }) {
      identifier(bookEditionId, 'bookEditionId')
      if (!Number.isSafeInteger(priority) || priority < 0 || priority > 100) {
        throw new RangeError('priority must be between 0 and 100')
      }
      return transaction(pool, async (client) => {
        const selected = await client.query(
          `SELECT * FROM book_search_indexes
           WHERE book_edition_id = $1 AND is_active
             AND state IN ('vector_ready', 'graph_ready', 'story_arcs_ready')
           FOR UPDATE`,
          [bookEditionId]
        )
        const index = selected.rows[0]
        if (!index) {
          throw repositoryError('VECTOR_INDEX_NOT_READY', 'book vector index is not ready')
        }
        const proposedId = idFactory()
        const inserted = await client.query(
          `INSERT INTO book_search_jobs (
             id, index_id, analysis_chunk_id, job_type, priority
           ) VALUES ($1, $2, NULL, 'graph', $3)
           ON CONFLICT (index_id, job_type) WHERE analysis_chunk_id IS NULL
           DO NOTHING
           RETURNING *`,
          [proposedId, index.id, priority]
        )
        const current = inserted.rows[0]
          ? inserted.rows[0]
          : (await client.query(
              `SELECT * FROM book_search_jobs
               WHERE index_id = $1 AND job_type = 'graph'
                 AND analysis_chunk_id IS NULL`,
              [index.id]
            )).rows[0]
        return { created: Boolean(inserted.rows[0]), job: jobRow(current), index: indexRow(index) }
      })
    },

    async enqueueStoryArcs({ bookEditionId, priority = 30 }) {
      identifier(bookEditionId, 'bookEditionId')
      if (!Number.isSafeInteger(priority) || priority < 0 || priority > 100) {
        throw new RangeError('priority must be between 0 and 100')
      }
      return transaction(pool, async (client) => {
        const selected = await client.query(
          `SELECT * FROM book_search_indexes
           WHERE book_edition_id = $1 AND is_active
             AND state IN ('graph_ready', 'story_arcs_ready')
           FOR UPDATE`,
          [bookEditionId]
        )
        const index = selected.rows[0]
        if (!index) throw repositoryError('GRAPH_NOT_READY', 'book graph is not ready')
        const inserted = await client.query(
          `INSERT INTO book_search_jobs (
             id, index_id, analysis_chunk_id, job_type, priority
           ) VALUES ($1, $2, NULL, 'story_arc', $3)
           ON CONFLICT (index_id, job_type) WHERE analysis_chunk_id IS NULL
           DO NOTHING
           RETURNING *`,
          [idFactory(), index.id, priority]
        )
        const current = inserted.rows[0]
          ? inserted.rows[0]
          : (await client.query(
              `SELECT * FROM book_search_jobs
               WHERE index_id = $1 AND job_type = 'story_arc'
                 AND analysis_chunk_id IS NULL`,
              [index.id]
            )).rows[0]
        return { created: Boolean(inserted.rows[0]), job: jobRow(current), index: indexRow(index) }
      })
    },

    async getGraphInput(job) {
      const publication = await pool.query(
        `SELECT index.book_edition_id, index.run_id, publication.data->'markup' AS markup
         FROM book_search_jobs AS job
         JOIN book_search_indexes AS index ON index.id = job.index_id
         JOIN book_analysis_publications AS publication
           ON publication.run_id = index.run_id
         WHERE job.id = $1 AND job.index_id = $2
           AND job.job_type IN ('graph', 'story_arc')
           AND job.status = 'running' AND job.lease_token = $3::uuid
         ORDER BY publication.published_at DESC
         LIMIT 1`,
        [job.id, job.indexId, job.leaseToken]
      )
      const source = publication.rows[0]
      if (!source?.markup) {
        throw repositoryError('ANALYSIS_NOT_PUBLISHED', 'published analysis is required for graph')
      }
      const observations = await pool.query(
        `SELECT id, evidence_start_offset, evidence_end_offset, fact
         FROM book_analysis_observations WHERE run_id = $1`,
        [source.run_id]
      )
      return {
        indexId: job.indexId,
        bookEditionId: source.book_edition_id,
        runId: source.run_id,
        markup: source.markup,
        observations: observations.rows.map((row) => ({
          id: row.id,
          startOffset: Number(row.evidence_start_offset),
          endOffset: Number(row.evidence_end_offset),
          fact: row.fact
        }))
      }
    },

    async completeGraph(job, { nodes, edges }) {
      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        throw new TypeError('graph nodes and edges are required')
      }
      return transaction(pool, async (client) => {
        const leased = await requireLease(client, job)
        if (leased.job_type !== 'graph') throw repositoryError('JOB_TYPE', 'job is not graph')
        await client.query('DELETE FROM book_graph_edges WHERE index_id = $1', [job.indexId])
        await client.query('DELETE FROM book_graph_nodes WHERE index_id = $1', [job.indexId])
        if (nodes.length) {
          await client.query(
            `INSERT INTO book_graph_nodes (
               index_id, node_key, node_type, canonical_name,
               first_evidence_offset, last_evidence_offset, data
             )
             SELECT $1, node.node_key, node.node_type, node.canonical_name,
                    node.first_evidence_offset, node.last_evidence_offset, node.data
             FROM jsonb_to_recordset($2::jsonb) AS node(
               node_key text, node_type text, canonical_name text,
               first_evidence_offset bigint, last_evidence_offset bigint, data jsonb
             )`,
            [job.indexId, JSON.stringify(nodes.map((node) => ({
              node_key: node.key,
              node_type: node.type,
              canonical_name: node.name,
              first_evidence_offset: node.firstEvidenceOffset,
              last_evidence_offset: node.lastEvidenceOffset,
              data: node.data ?? {}
            })))]
          )
        }
        if (edges.length) {
          await client.query(
            `INSERT INTO book_graph_edges (
               index_id, edge_key, edge_type, source_node_key, target_node_key,
               label, evidence_start_offset, evidence_end_offset, evidence_ids, data
             )
             SELECT $1, edge.edge_key, edge.edge_type, edge.source_node_key,
                    edge.target_node_key, edge.label, edge.evidence_start_offset,
                    edge.evidence_end_offset, edge.evidence_ids, edge.data
             FROM jsonb_to_recordset($2::jsonb) AS edge(
               edge_key text, edge_type text, source_node_key text,
               target_node_key text, label text, evidence_start_offset bigint,
               evidence_end_offset bigint, evidence_ids jsonb, data jsonb
             )`,
            [job.indexId, JSON.stringify(edges.map((edge) => ({
              edge_key: edge.key,
              edge_type: edge.type,
              source_node_key: edge.sourceKey,
              target_node_key: edge.targetKey,
              label: edge.label,
              evidence_start_offset: edge.startOffset,
              evidence_end_offset: edge.endOffset,
              evidence_ids: edge.evidenceIds ?? [],
              data: edge.data ?? {}
            })))]
          )
        }
        await client.query(
          `UPDATE book_search_jobs
           SET status = 'ready', result = jsonb_build_object(
                 'nodes', $3::integer, 'edges', $4::integer
               ), locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, nodes.length, edges.length]
        )
        await client.query(
          `INSERT INTO book_search_jobs (
             id, index_id, analysis_chunk_id, job_type, priority
           ) VALUES ($1, $2, NULL, 'story_arc', $3)
           ON CONFLICT (index_id, job_type) WHERE analysis_chunk_id IS NULL
           DO NOTHING`,
          [idFactory(), job.indexId, Math.max(0, Number(leased.priority) - 10)]
        )
        const updated = await client.query(
          `UPDATE book_search_indexes
           SET state = 'graph_ready', last_error_code = NULL, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [job.indexId]
        )
        return indexRow(updated.rows[0])
      })
    },

    async completeStoryArcs(job, { storyArcs }) {
      if (!Array.isArray(storyArcs)) throw new TypeError('storyArcs are required')
      return transaction(pool, async (client) => {
        const leased = await requireLease(client, job)
        if (leased.job_type !== 'story_arc') {
          throw repositoryError('JOB_TYPE', 'job is not story_arc')
        }
        await client.query('DELETE FROM book_story_arcs WHERE index_id = $1', [job.indexId])
        if (storyArcs.length) {
          await client.query(
            `INSERT INTO book_story_arcs (
               index_id, arc_key, title, summary, event_keys,
               participant_character_keys, evidence_start_offset,
               evidence_end_offset, evidence_ids, data
             )
             SELECT $1, arc.arc_key, arc.title, arc.summary, arc.event_keys,
                    arc.participant_character_keys, arc.evidence_start_offset,
                    arc.evidence_end_offset, arc.evidence_ids, arc.data
             FROM jsonb_to_recordset($2::jsonb) AS arc(
               arc_key text, title text, summary text, event_keys jsonb,
               participant_character_keys jsonb, evidence_start_offset bigint,
               evidence_end_offset bigint, evidence_ids jsonb, data jsonb
             )`,
            [job.indexId, JSON.stringify(storyArcs.map((arc) => ({
              arc_key: arc.key,
              title: arc.title,
              summary: arc.summary,
              event_keys: arc.eventKeys,
              participant_character_keys: arc.participantCharacterKeys,
              evidence_start_offset: arc.startOffset,
              evidence_end_offset: arc.endOffset,
              evidence_ids: arc.evidenceIds,
              data: arc.data ?? {}
            })))]
          )
        }
        await client.query(
          `UPDATE book_search_jobs
           SET status = 'ready', result = jsonb_build_object('story_arcs', $3::integer),
               locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, storyArcs.length]
        )
        const updated = await client.query(
          `UPDATE book_search_indexes
           SET state = 'story_arcs_ready', last_error_code = NULL, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [job.indexId]
        )
        return indexRow(updated.rows[0])
      })
    },

    async graphSnapshot({ indexId, maxTextOffset, includeUnbounded = false }) {
      const nodes = await pool.query(
        `SELECT node_key, node_type, canonical_name, first_evidence_offset,
                last_evidence_offset, data
         FROM book_graph_nodes
         WHERE index_id = $1 AND (
           $3::boolean OR (
             last_evidence_offset IS NOT NULL AND last_evidence_offset <= $2
           )
         )
         ORDER BY first_evidence_offset NULLS LAST, node_key`,
        [indexId, maxTextOffset, includeUnbounded]
      )
      const visibleKeys = nodes.rows.map((row) => row.node_key)
      const edges = visibleKeys.length
        ? await pool.query(
            `SELECT edge_key, edge_type, source_node_key, target_node_key, label,
                    evidence_start_offset, evidence_end_offset, evidence_ids, data
             FROM book_graph_edges
             WHERE index_id = $1
               AND source_node_key = ANY($2::text[])
               AND target_node_key = ANY($2::text[])
               AND ($4::boolean OR (
                 evidence_end_offset IS NOT NULL AND evidence_end_offset <= $3
               ))
             ORDER BY evidence_start_offset NULLS LAST, edge_key`,
            [indexId, visibleKeys, maxTextOffset, includeUnbounded]
          )
        : { rows: [] }
      const storyArcs = await pool.query(
        `SELECT arc_key, title, summary, event_keys, participant_character_keys,
                evidence_start_offset, evidence_end_offset, evidence_ids, data
         FROM book_story_arcs
         WHERE index_id = $1 AND ($3::boolean OR evidence_end_offset <= $2)
         ORDER BY evidence_start_offset, arc_key`,
        [indexId, maxTextOffset, includeUnbounded]
      )
      return {
        nodes: nodes.rows.map((row) => ({
          key: row.node_key,
          type: row.node_type,
          name: row.canonical_name,
          firstEvidenceOffset: row.first_evidence_offset == null
            ? null
            : Number(row.first_evidence_offset),
          lastEvidenceOffset: row.last_evidence_offset == null
            ? null
            : Number(row.last_evidence_offset),
          data: row.data ?? {}
        })),
        edges: edges.rows.map((row) => ({
          key: row.edge_key,
          type: row.edge_type,
          sourceKey: row.source_node_key,
          targetKey: row.target_node_key,
          label: row.label,
          startOffset: row.evidence_start_offset == null
            ? null
            : Number(row.evidence_start_offset),
          endOffset: row.evidence_end_offset == null
            ? null
            : Number(row.evidence_end_offset),
          evidenceIds: row.evidence_ids ?? [],
          data: row.data ?? {}
        })),
        storyArcs: storyArcs.rows.map((row) => ({
          key: row.arc_key,
          title: row.title,
          summary: row.summary,
          eventKeys: row.event_keys ?? [],
          participantCharacterKeys: row.participant_character_keys ?? [],
          startOffset: Number(row.evidence_start_offset),
          endOffset: Number(row.evidence_end_offset),
          evidenceIds: row.evidence_ids ?? [],
          data: row.data ?? {}
        }))
      }
    },

    async graphEvidence({ indexId, evidenceIds, maxTextOffset, limit = 24 }) {
      if (!Array.isArray(evidenceIds)) throw new TypeError('evidenceIds must be an array')
      if (!evidenceIds.length) return []
      positiveInteger(limit, 'limit', 64)
      const result = await pool.query(
        `SELECT observation.id, observation.observation_type, observation.fact,
                observation.evidence_quote, observation.evidence_start_offset,
                observation.evidence_end_offset, chunk.analysis_chunk_id,
                chunk.chapter_key
         FROM book_search_indexes AS index
         JOIN book_analysis_observations AS observation
           ON observation.run_id = index.run_id
         LEFT JOIN book_search_chunks AS chunk
           ON chunk.index_id = index.id
          AND chunk.analysis_chunk_id = observation.chunk_id
         WHERE index.id = $1 AND observation.id = ANY($2::uuid[])
           AND observation.evidence_end_offset <= $3
         ORDER BY array_position($2::uuid[], observation.id),
                  observation.evidence_start_offset
         LIMIT $4`,
        [indexId, evidenceIds, maxTextOffset, limit]
      )
      return result.rows.map((row) => ({
        id: row.id,
        type: row.observation_type,
        fact: row.fact,
        quote: row.evidence_quote,
        startOffset: Number(row.evidence_start_offset),
        endOffset: Number(row.evidence_end_offset),
        chunkId: row.analysis_chunk_id,
        chapterKey: row.chapter_key
      }))
    },

    async getSearchContext({ subjectId, bookEditionId }) {
      const result = await pool.query(
        `SELECT edition.id AS book_edition_id, index.id AS index_id, index.state,
                index.embedding_model, index.embedding_dimensions,
                run.text_length,
                coalesce(position.text_offset, 0)::bigint AS reader_text_offset
         FROM book_editions AS edition
         LEFT JOIN book_search_indexes AS index
           ON index.book_edition_id = edition.id AND index.is_active
         LEFT JOIN book_analysis_runs AS run ON run.id = index.run_id
         LEFT JOIN reader_book_positions AS position
           ON position.book_edition_id = edition.id AND position.subject_id = $2::uuid
         WHERE edition.id = $1 AND (
           (edition.scope = 'catalog' AND edition.status IN ('base_ready', 'published')) OR
           (edition.scope = 'private' AND edition.owner_subject_id = $2::uuid)
         )`,
        [bookEditionId, subjectId]
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        bookEditionId: row.book_edition_id,
        indexId: row.index_id,
        state: row.state,
        embeddingModel: row.embedding_model,
        embeddingDimensions: row.embedding_dimensions == null
          ? null
          : Number(row.embedding_dimensions),
        textLength: row.text_length == null ? 0 : Number(row.text_length),
        readerTextOffset: Number(row.reader_text_offset)
      }
    },

    async lexicalSearch({ indexId, query, maxTextOffset, limit }) {
      const result = await pool.query(
        `WITH requested AS (
           SELECT websearch_to_tsquery('simple', $2) AS value
         )
         SELECT chunk.analysis_chunk_id, chunk.ordinal, chunk.chapter_key,
                chunk.core_start_offset, chunk.core_end_offset, chunk.core_text,
                ts_rank_cd(chunk.search_document, requested.value) AS score
         FROM book_search_chunks AS chunk, requested
         WHERE chunk.index_id = $1 AND chunk.core_end_offset <= $3
           AND chunk.search_document @@ requested.value
         ORDER BY score DESC, chunk.ordinal
         LIMIT $4`,
        [indexId, query, maxTextOffset, limit]
      )
      return result.rows.map((row) => ({
        chunkId: row.analysis_chunk_id,
        ordinal: Number(row.ordinal),
        chapterKey: row.chapter_key,
        startOffset: Number(row.core_start_offset),
        endOffset: Number(row.core_end_offset),
        text: row.core_text,
        score: Number(row.score)
      }))
    },

    async vectorCandidates({ indexId, maxTextOffset }) {
      const result = await pool.query(
        `SELECT analysis_chunk_id, ordinal, chapter_key, core_start_offset,
                core_end_offset, core_text, embedding
         FROM book_search_chunks
         WHERE index_id = $1 AND core_end_offset <= $2 AND embedding IS NOT NULL
         ORDER BY ordinal`,
        [indexId, maxTextOffset]
      )
      return result.rows.map((row) => ({
        chunkId: row.analysis_chunk_id,
        ordinal: Number(row.ordinal),
        chapterKey: row.chapter_key,
        startOffset: Number(row.core_start_offset),
        endOffset: Number(row.core_end_offset),
        text: row.core_text,
        embedding: row.embedding.map(Number)
      }))
    },

    async recordQueryUsage({
      bookEditionId,
      indexId,
      provider,
      model,
      inputUnits = 0,
      estimatedCostUsd = null
    }) {
      await pool.query(
        `INSERT INTO book_ai_usage (
           id, book_edition_id, search_index_id, operation, provider, model,
           input_units, estimated_cost_usd
         ) VALUES ($1, $2, $3, 'embedding_query', $4, $5, $6, $7)`,
        [
          idFactory(), bookEditionId, indexId, provider, model,
          inputUnits, estimatedCostUsd
        ]
      )
    }
  }
}
