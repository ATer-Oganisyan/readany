import { createHash, randomUUID } from 'node:crypto'
import {
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION,
  BOOK_ANALYSIS_PIPELINE_VERSION,
  BOOK_ANALYSIS_PROMPT_VERSION,
  normalizeBookAnalysisCharacterProfile,
  normalizeBookMarkupV3,
  normalizeBookAnalysisResolvedEntity
} from './book-analysis-contracts.mjs'
import { isSupportedVoice } from './voices.mjs'

const SHA256 = /^[0-9a-f]{64}$/
const STAGES = new Set(['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'])

function repositoryError(code, message) {
  return Object.assign(new Error(message), { code })
}

function validateIdentifier(value, name, maxLength = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${name} must be non-empty text up to ${maxLength} characters`)
  }
  return value.trim()
}

function validateHash(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256`)
  }
  return value
}

function validateStage(value) {
  if (!STAGES.has(value)) throw new TypeError(`unsupported analysis stage: ${value}`)
  return value
}

function validateLeaseSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 30 || value > 3_600) {
    throw new RangeError('leaseSeconds must be between 30 and 3600')
  }
  return value
}

function runRow(row) {
  if (!row) return null
  return {
    id: row.id,
    bookEditionId: row.book_edition_id,
    idempotencyKey: row.idempotency_key,
    pipelineVersion: row.pipeline_version,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    stage: row.stage,
    status: row.status,
    normalizedTextObjectKey: row.normalized_text_object_key ?? undefined,
    normalizedTextHash: row.normalized_text_hash ?? undefined,
    textLength: row.text_length == null ? undefined : Number(row.text_length),
    sections: row.sections ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at ?? undefined,
    completedAt: row.completed_at instanceof Date
      ? row.completed_at.toISOString()
      : row.completed_at ?? undefined
  }
}

function analysisSourceRow(row) {
  if (!row) return null
  return {
    id: row.id,
    scope: row.scope,
    catalogKey: row.catalog_key ?? undefined,
    contentSha256: row.content_sha256,
    title: row.title,
    author: row.author,
    format: row.format,
    status: row.status,
    source: {
      objectKey: row.object_key,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      contentHash: row.content_hash
    }
  }
}

function publicationRow(row, { includeData = true } = {}) {
  if (!row) return null
  return {
    id: row.id,
    runId: row.run_id,
    bookEditionId: row.book_edition_id,
    artifactId: row.artifact_id,
    channel: row.channel,
    analysisVersion: row.analysis_version,
    contentHash: row.content_hash,
    publishedAt: row.published_at instanceof Date
      ? row.published_at.toISOString()
      : row.published_at,
    ...(includeData ? { data: row.data } : {})
  }
}

function jobRow(row) {
  if (!row) return null
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    shardKey: row.shard_key,
    chunkId: row.chunk_id ?? undefined,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token ?? undefined,
    payload: row.payload ?? {},
    result: row.result ?? undefined
  }
}

function scanInputRow(row) {
  if (!row) return null
  return {
    runId: row.run_id,
    bookEditionId: row.book_edition_id,
    title: row.title,
    author: row.author,
    extractorVersion: row.prompt_version,
    normalizedTextObjectKey: row.normalized_text_object_key,
    normalizedTextHash: row.normalized_text_hash,
    textLength: Number(row.text_length),
    chunk: {
      id: row.chunk_id,
      ordinal: row.ordinal,
      chapterKey: row.chapter_key ?? '',
      coreStartOffset: Number(row.core_start_offset),
      coreEndOffset: Number(row.core_end_offset),
      contextStartOffset: Number(row.context_start_offset),
      contextEndOffset: Number(row.context_end_offset),
      contentHash: row.content_hash,
      metadata: row.chunk_metadata ?? {}
    }
  }
}

function observationRow(row) {
  return {
    id: row.id,
    chunkId: row.chunk_id,
    sourceJobId: row.source_job_id,
    extractorVersion: row.extractor_version,
    observationKey: row.observation_key,
    type: row.observation_type,
    entityKind: row.entity_kind,
    entityCandidate: row.entity_candidate,
    relatedEntityCandidates: row.related_entity_candidates ?? [],
    fact: row.fact,
    evidence: {
      quote: row.evidence_quote,
      startOffset: Number(row.evidence_start_offset),
      endOffset: Number(row.evidence_end_offset),
      chapterKey: row.chapter_key ?? ''
    },
    confidence: Number(row.confidence),
    data: row.data ?? {}
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function artifactRow(row) {
  if (!row) return null
  return {
    id: row.id,
    runId: row.run_id,
    snapshotId: row.snapshot_id,
    kind: row.artifact_kind,
    key: row.artifact_key,
    schemaVersion: Number(row.schema_version),
    status: row.status,
    contentHash: row.content_hash,
    data: row.data,
    publishedAt: row.published_at ?? undefined
  }
}

function hashObservationSet(observations) {
  return contentHash(observations)
}

function snapshotRow(row) {
  if (!row) return null
  return {
    id: row.id,
    runId: row.run_id,
    version: Number(row.snapshot_version),
    contentHash: row.content_hash,
    evidenceCount: Number(row.evidence_count),
    data: row.data
  }
}

async function loadOrderedObservations(client, runId) {
  const stored = await client.query(
    `SELECT observation.*, chunk.chapter_key
     FROM book_analysis_observations AS observation
     JOIN book_analysis_chunks AS chunk
       ON chunk.run_id = observation.run_id AND chunk.id = observation.chunk_id
     WHERE observation.run_id = $1
     ORDER BY observation.evidence_start_offset,
              observation.evidence_end_offset, observation.id`,
    [runId]
  )
  return stored.rows.map(observationRow)
}

async function loadOrderedObservationsByIds(client, runId, observationIds) {
  if (!Array.isArray(observationIds) || !observationIds.length) return []
  const stored = await client.query(
    `SELECT observation.*, chunk.chapter_key
     FROM book_analysis_observations AS observation
     JOIN book_analysis_chunks AS chunk
       ON chunk.run_id = observation.run_id AND chunk.id = observation.chunk_id
     WHERE observation.run_id = $1 AND observation.id = ANY($2::uuid[])
     ORDER BY observation.evidence_start_offset,
              observation.evidence_end_offset, observation.id`,
    [runId, observationIds]
  )
  return stored.rows.map(observationRow)
}

async function requireStageInput(pool, job, stage) {
  const result = await pool.query(
    `SELECT run.id AS run_id, run.book_edition_id, run.normalized_text_object_key,
            run.normalized_text_hash, run.text_length, edition.title, edition.author,
            job.payload, job.shard_key, snapshot.*
     FROM book_analysis_jobs AS job
     JOIN book_analysis_runs AS run ON run.id = job.run_id
     JOIN book_editions AS edition ON edition.id = run.book_edition_id
     JOIN book_analysis_snapshots AS snapshot
       ON snapshot.run_id = run.id AND snapshot.id = (job.payload->>'snapshotId')::uuid
     WHERE job.id = $1 AND job.run_id = $2 AND job.stage = $4
       AND job.status = 'running' AND job.lease_token = $3::uuid
       AND run.stage = $4 AND run.status = 'running'`,
    [job.id, job.runId, job.leaseToken, stage]
  )
  if (!result.rows[0]) throw repositoryError('LEASE_LOST', `analysis job lease lost: ${job.id}`)
  return result.rows[0]
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

async function requireLeasedJob(client, job, expectedStage) {
  const result = await client.query(
    `SELECT * FROM book_analysis_jobs
     WHERE id = $1 AND run_id = $2 AND stage = $3
       AND status = 'running' AND lease_token = $4::uuid
     FOR UPDATE`,
    [job.id, job.runId, expectedStage, job.leaseToken]
  )
  if (!result.rows[0]) throw repositoryError('LEASE_LOST', `analysis job lease lost: ${job.id}`)
  return result.rows[0]
}

export function bookAnalysisRunIdempotencyKey({
  bookEditionId,
  inputHash,
  pipelineVersion = BOOK_ANALYSIS_PIPELINE_VERSION,
  promptVersion = BOOK_ANALYSIS_PROMPT_VERSION
}) {
  return [
    'book-analysis',
    validateIdentifier(bookEditionId, 'bookEditionId'),
    validateHash(inputHash, 'inputHash'),
    validateIdentifier(pipelineVersion, 'pipelineVersion'),
    validateIdentifier(promptVersion, 'promptVersion')
  ].join(':')
}

export function createPostgresBookAnalysisRepository(pool, { idFactory = randomUUID } = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }

  return {
    async getReadyAnalysisSource(bookEditionId) {
      const result = await pool.query(
        `SELECT edition.id, edition.scope, edition.catalog_key,
                edition.content_sha256, edition.title, edition.author,
                edition.format, edition.status, file.object_key, file.mime_type,
                file.byte_size, file.content_hash
         FROM book_editions AS edition
         JOIN book_files AS file
           ON file.book_edition_id = edition.id
          AND file.status = 'ready'
          AND file.content_hash = edition.content_sha256
         WHERE edition.id = $1`,
        [validateIdentifier(bookEditionId, 'bookEditionId')]
      )
      return analysisSourceRow(result.rows[0])
    },

    async ensureAnalysisRun({
      bookEditionId,
      inputHash,
      pipelineVersion = BOOK_ANALYSIS_PIPELINE_VERSION,
      promptVersion = BOOK_ANALYSIS_PROMPT_VERSION,
      priority = 50
    }) {
      const idempotencyKey = bookAnalysisRunIdempotencyKey({
        bookEditionId,
        inputHash,
        pipelineVersion,
        promptVersion
      })
      if (!Number.isSafeInteger(priority) || priority < -1_000 || priority > 1_000) {
        throw new RangeError('priority must be between -1000 and 1000')
      }
      return transaction(pool, async (client) => {
        const inserted = await client.query(
          `INSERT INTO book_analysis_runs (
             id, idempotency_key, book_edition_id, pipeline_version, prompt_version, input_hash
           )
           SELECT $1, $2, edition.id, $4, $5, $3
           FROM book_editions AS edition
           JOIN book_files AS file
             ON file.book_edition_id = edition.id
            AND file.status = 'ready'
            AND file.content_hash = edition.content_sha256
           WHERE edition.id = $6 AND edition.content_sha256 = $3
           ON CONFLICT (book_edition_id, input_hash, pipeline_version, prompt_version)
           DO NOTHING
           RETURNING *`,
          [idFactory(), idempotencyKey, inputHash, pipelineVersion, promptVersion, bookEditionId]
        )
        const selected = inserted.rows[0]
          ? inserted
          : await client.query(
              `SELECT * FROM book_analysis_runs
               WHERE book_edition_id = $1 AND input_hash = $2
                 AND pipeline_version = $3 AND prompt_version = $4
               FOR UPDATE`,
              [bookEditionId, inputHash, pipelineVersion, promptVersion]
            )
        const row = selected.rows[0]
        if (!row) {
          throw repositoryError(
            'BOOK_ANALYSIS_SOURCE_UNAVAILABLE',
            'book edition or verified stored source is unavailable'
          )
        }
        const job = await client.query(
          `INSERT INTO book_analysis_jobs (
             id, run_id, stage, shard_key, required, priority
           ) VALUES ($1, $2, 'prepare', 'book', true, $3)
           ON CONFLICT (run_id, stage, shard_key) DO NOTHING
           RETURNING *`,
          [idFactory(), row.id, priority]
        )
        const selectedJob = job.rows[0]
          ? job
          : await client.query(
              `SELECT * FROM book_analysis_jobs
               WHERE run_id = $1 AND stage = 'prepare' AND shard_key = 'book'`,
              [row.id]
            )
        return {
          run: runRow(row),
          prepareJob: jobRow(selectedJob.rows[0]),
          created: Boolean(inserted.rows[0])
        }
      })
    },

    async getAnalysisRun(runId) {
      const result = await pool.query(
        'SELECT * FROM book_analysis_runs WHERE id = $1',
        [runId]
      )
      return runRow(result.rows[0])
    },

    async getAnalysisRunDetails(runId) {
      const safeRunId = validateIdentifier(runId, 'runId')
      const run = await pool.query(
        `SELECT analysis.*, edition.title, edition.author, edition.scope,
                edition.catalog_key
         FROM book_analysis_runs AS analysis
         JOIN book_editions AS edition ON edition.id = analysis.book_edition_id
         WHERE analysis.id = $1`,
        [safeRunId]
      )
      if (!run.rows[0]) return null
      const [jobs, publication] = await Promise.all([
        pool.query(
          `SELECT stage, status, count(*)::integer AS count
           FROM book_analysis_jobs
           WHERE run_id = $1
           GROUP BY stage, status
           ORDER BY stage, status`,
          [safeRunId]
        ),
        pool.query(
          `SELECT * FROM book_analysis_publications
           WHERE run_id = $1 AND channel = 'shadow'`,
          [safeRunId]
        )
      ])
      const jobCounts = {}
      for (const row of jobs.rows) {
        const stage = jobCounts[row.stage] ?? {
          total: 0,
          queued: 0,
          running: 0,
          ready: 0,
          failed: 0,
          cancelled: 0
        }
        stage[row.status] = Number(row.count)
        stage.total += Number(row.count)
        jobCounts[row.stage] = stage
      }
      return {
        run: runRow(run.rows[0]),
        book: {
          id: run.rows[0].book_edition_id,
          scope: run.rows[0].scope,
          catalogKey: run.rows[0].catalog_key ?? undefined,
          title: run.rows[0].title,
          author: run.rows[0].author
        },
        jobs: jobCounts,
        publication: publicationRow(publication.rows[0], { includeData: false })
      }
    },

    async getShadowAnalysisPublication(runId) {
      const result = await pool.query(
        `SELECT publication.*
         FROM book_analysis_publications AS publication
         WHERE publication.run_id = $1 AND publication.channel = 'shadow'`,
        [validateIdentifier(runId, 'runId')]
      )
      return publicationRow(result.rows[0])
    },

    async getLatestShadowAnalysisPublication(bookEditionId) {
      const result = await pool.query(
        `SELECT publication.*
         FROM book_analysis_publications AS publication
         WHERE publication.book_edition_id = $1 AND publication.channel = 'shadow'
         ORDER BY publication.published_at DESC, publication.id DESC
         LIMIT 1`,
        [validateIdentifier(bookEditionId, 'bookEditionId')]
      )
      return publicationRow(result.rows[0])
    },

    async claimAnalysisJob(workerId, {
      stages = ['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'],
      leaseSeconds = 300
    } = {}) {
      const worker = validateIdentifier(workerId, 'workerId', 240)
      if (!Array.isArray(stages) || !stages.length) throw new TypeError('stages must not be empty')
      const allowedStages = [...new Set(stages.map(validateStage))]
      validateLeaseSeconds(leaseSeconds)
      return transaction(pool, async (client) => {
        const exhausted = await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'failed', last_error_code = 'LEASE_EXPIRED',
               locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           WHERE stage = ANY($1::text[]) AND status = 'running'
             AND lease_expires_at <= now() AND attempts >= max_attempts
           RETURNING run_id`,
          [allowedStages]
        )
        if (exhausted.rows.length) {
          await client.query(
            `UPDATE book_analysis_runs
             SET status = 'failed', last_error_code = 'LEASE_EXPIRED'
             WHERE id = ANY($1::uuid[]) AND status = 'running'`,
            [[...new Set(exhausted.rows.map(({ run_id }) => run_id))]]
          )
        }
        const leaseToken = idFactory()
        const result = await client.query(
          `WITH candidate AS (
             SELECT job.id
             FROM book_analysis_jobs AS job
             JOIN book_analysis_runs AS run ON run.id = job.run_id
             WHERE job.stage = ANY($2::text[]) AND run.stage = job.stage
               AND run.status IN ('queued', 'running')
               AND job.attempts < job.max_attempts
               AND (
                 (job.status = 'queued' AND job.available_at <= now()) OR
               (job.status = 'running' AND job.lease_expires_at <= now())
               )
               AND (
                 job.stage <> 'synthesize' OR job.shard_key <> 'book' OR
                 NOT EXISTS (
                   SELECT 1 FROM book_analysis_jobs AS dependency
                   WHERE dependency.run_id = job.run_id
                     AND dependency.stage = 'synthesize'
                     AND dependency.required AND dependency.shard_key <> 'book'
                     AND dependency.status <> 'ready'
                 )
               )
             ORDER BY job.priority DESC,
               (
                 SELECT MAX(sibling.updated_at)
                 FROM book_analysis_jobs AS sibling
                 WHERE sibling.run_id = job.run_id
                   AND sibling.stage = job.stage
                   AND sibling.attempts > 0
               ) ASC NULLS FIRST,
               job.available_at, job.created_at
             FOR UPDATE OF job SKIP LOCKED
             LIMIT 1
           )
           UPDATE book_analysis_jobs AS job
           SET status = 'running', attempts = attempts + 1,
               locked_at = now(), lease_expires_at = now() + make_interval(secs => $3),
               locked_by = $1, lease_token = $4::uuid, updated_at = now()
           FROM candidate
           WHERE job.id = candidate.id
           RETURNING job.*`,
          [worker, allowedStages, leaseSeconds, leaseToken]
        )
        const job = jobRow(result.rows[0])
        if (job) {
          await client.query(
            `UPDATE book_analysis_runs
             SET status = 'running', started_at = COALESCE(started_at, now())
             WHERE id = $1 AND status = 'queued'`,
            [job.runId]
          )
        }
        return job
      })
    },

    async renewAnalysisJobLease(job, { leaseSeconds = 300 } = {}) {
      validateLeaseSeconds(leaseSeconds)
      const result = await pool.query(
        `UPDATE book_analysis_jobs
         SET locked_at = now(), lease_expires_at = now() + make_interval(secs => $3),
             updated_at = now()
         WHERE id = $1 AND status = 'running' AND lease_token = $2::uuid
         RETURNING id`,
        [job.id, job.leaseToken, leaseSeconds]
      )
      if (!result.rows[0]) throw repositoryError('LEASE_LOST', `analysis job lease lost: ${job.id}`)
      return { renewed: true }
    },

    async getPrepareInput(job) {
      const result = await pool.query(
        `SELECT run.id AS run_id, run.input_hash, run.pipeline_version, run.prompt_version,
                edition.scope, edition.title, edition.author, edition.format,
                file.object_key, file.mime_type, file.byte_size, file.content_hash
         FROM book_analysis_jobs AS job
         JOIN book_analysis_runs AS run ON run.id = job.run_id
         JOIN book_editions AS edition ON edition.id = run.book_edition_id
         JOIN book_files AS file
           ON file.book_edition_id = edition.id AND file.status = 'ready'
         WHERE job.id = $1 AND job.run_id = $2 AND job.stage = 'prepare'
           AND job.status = 'running' AND job.lease_token = $3::uuid`,
        [job.id, job.runId, job.leaseToken]
      )
      const row = result.rows[0]
      if (!row) throw repositoryError('LEASE_LOST', `analysis job lease lost: ${job.id}`)
      return {
        runId: row.run_id,
        inputHash: row.input_hash,
        pipelineVersion: row.pipeline_version,
        promptVersion: row.prompt_version,
        scope: row.scope,
        title: row.title,
        author: row.author,
        format: row.format,
        objectKey: row.object_key,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        contentHash: row.content_hash
      }
    },

    async completePrepare(job, {
      normalizedTextObjectKey,
      normalizedTextHash,
      textLength,
      sections,
      chunks,
      scanPriority = 50
    }) {
      validateIdentifier(normalizedTextObjectKey, 'normalizedTextObjectKey', 900)
      validateHash(normalizedTextHash, 'normalizedTextHash')
      if (!Number.isSafeInteger(textLength) || textLength < 1) {
        throw new TypeError('textLength must be a positive safe integer')
      }
      if (!Array.isArray(sections) || !sections.length) throw new TypeError('sections must not be empty')
      if (!Array.isArray(chunks) || !chunks.length) throw new TypeError('chunks must not be empty')
      return transaction(pool, async (client) => {
        await requireLeasedJob(client, job, 'prepare')
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND stage = 'prepare' AND status = 'running'
           FOR UPDATE`,
          [job.runId]
        )
        if (!run.rows[0]) throw repositoryError('RUN_STATE_CHANGED', 'analysis run is not preparing')
        await client.query(
          `UPDATE book_analysis_runs
           SET normalized_text_object_key = $2, normalized_text_hash = $3,
               text_length = $4, sections = $5::jsonb
           WHERE id = $1`,
          [job.runId, normalizedTextObjectKey, normalizedTextHash, textLength, JSON.stringify(sections)]
        )
        for (const chunk of chunks) {
          await client.query(
            `INSERT INTO book_analysis_chunks (
               id, run_id, ordinal, chapter_key,
               core_start_offset, core_end_offset,
               context_start_offset, context_end_offset,
               content_hash, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
             `,
            [
              chunk.id, job.runId, chunk.ordinal, chunk.chapterKey,
              chunk.coreStartOffset, chunk.coreEndOffset,
              chunk.contextStartOffset, chunk.contextEndOffset,
              chunk.contentHash, JSON.stringify(chunk.metadata ?? {})
            ]
          )
          await client.query(
            `INSERT INTO book_analysis_jobs (
               id, run_id, stage, shard_key, chunk_id, required, priority,
               payload
             ) VALUES (
               $1, $2, 'scan', $3, $4, true, $5,
               jsonb_build_object('chunk_ordinal', $6::integer)
             )`,
            [idFactory(), job.runId, `chunk:${chunk.ordinal}`, chunk.id, scanPriority, chunk.ordinal]
          )
        }
        const coverage = await client.query(
          `WITH ordered AS (
             SELECT ordinal, core_start_offset, core_end_offset,
                    lag(core_end_offset) OVER (ORDER BY ordinal) AS previous_end_offset
             FROM book_analysis_chunks WHERE run_id = $1
           )
           SELECT count(*)::integer AS chunk_count,
                  min(ordinal)::integer AS first_ordinal,
                  max(ordinal)::integer AS last_ordinal,
                  min(core_start_offset)::bigint AS first_offset,
                  max(core_end_offset)::bigint AS last_offset,
                  coalesce(sum(core_end_offset - core_start_offset), 0)::bigint AS covered_chars,
                  count(*) FILTER (
                    WHERE ordinal > 0 AND previous_end_offset <> core_start_offset
                  )::integer AS discontinuity_count
           FROM ordered`,
          [job.runId]
        )
        const summary = coverage.rows[0]
        if (
          Number(summary.chunk_count) !== chunks.length ||
          Number(summary.first_ordinal) !== 0 ||
          Number(summary.last_ordinal) !== chunks.length - 1 ||
          Number(summary.first_offset) !== 0 ||
          Number(summary.last_offset) !== textLength ||
          Number(summary.covered_chars) !== textLength ||
          Number(summary.discontinuity_count) !== 0
        ) {
          throw repositoryError('CHUNK_COVERAGE_INVALID', 'prepared chunks do not cover the book')
        }
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'ready', result = $3::jsonb,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, JSON.stringify({ textLength, chunkCount: chunks.length })]
        )
        await client.query(
          `UPDATE book_analysis_runs SET stage = 'scan' WHERE id = $1`,
          [job.runId]
        )
        return { textLength, chunkCount: chunks.length, stage: 'scan' }
      })
    },

    async getScanInput(job) {
      const result = await pool.query(
        `SELECT run.id AS run_id, run.book_edition_id, run.prompt_version,
                run.normalized_text_object_key, run.normalized_text_hash,
                run.text_length, edition.title, edition.author,
                chunk.id AS chunk_id, chunk.ordinal, chunk.chapter_key,
                chunk.core_start_offset, chunk.core_end_offset,
                chunk.context_start_offset, chunk.context_end_offset,
                chunk.content_hash, chunk.metadata AS chunk_metadata
         FROM book_analysis_jobs AS job
         JOIN book_analysis_runs AS run ON run.id = job.run_id
         JOIN book_editions AS edition ON edition.id = run.book_edition_id
         JOIN book_analysis_chunks AS chunk
           ON chunk.run_id = job.run_id AND chunk.id = job.chunk_id
         WHERE job.id = $1 AND job.run_id = $2 AND job.stage = 'scan'
           AND job.status = 'running' AND job.lease_token = $3::uuid
           AND run.stage = 'scan' AND run.status = 'running'`,
        [job.id, job.runId, job.leaseToken]
      )
      const input = scanInputRow(result.rows[0])
      if (!input) throw repositoryError('LEASE_LOST', `analysis job lease lost: ${job.id}`)
      return input
    },

    async completeScan(job, { extractorVersion, observations, resolvePriority = 50 }) {
      validateIdentifier(extractorVersion, 'extractorVersion', 128)
      if (!Array.isArray(observations)) throw new TypeError('observations must be an array')
      if (observations.length > 160) throw new RangeError('observations exceed 160 items')
      return transaction(pool, async (client) => {
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND stage = 'scan' AND status = 'running'
           FOR UPDATE`,
          [job.runId]
        )
        if (!run.rows[0]) throw repositoryError('RUN_STATE_CHANGED', 'analysis run is not scanning')
        const leased = await requireLeasedJob(client, job, 'scan')
        if (run.rows[0].prompt_version !== extractorVersion) {
          throw repositoryError(
            'EXTRACTOR_VERSION_MISMATCH',
            'scan result extractor version does not match the analysis run'
          )
        }
        for (const observation of observations) {
          const inserted = await client.query(
            `INSERT INTO book_analysis_observations (
               id, run_id, chunk_id, source_job_id, extractor_version,
               observation_key, observation_type, entity_kind, entity_candidate,
               related_entity_candidates, fact, evidence_quote,
               evidence_start_offset, evidence_end_offset, confidence, data
             )
             SELECT
               $1, $2, chunk.id, $3, $4,
               $5, $6, $7, $8,
               $9::jsonb, $10, $11,
               $12, $13, $14, $15::jsonb
             FROM book_analysis_chunks AS chunk
             WHERE chunk.run_id = $2 AND chunk.id = $16
               AND $12 >= chunk.core_start_offset
               AND $12 < chunk.core_end_offset
               AND $13 > $12
               AND $13 <= chunk.context_end_offset
             ON CONFLICT (run_id, chunk_id, extractor_version, observation_key)
             DO NOTHING
             RETURNING id`,
            [
              idFactory(), job.runId, job.id, extractorVersion,
              observation.observationKey, observation.type, observation.entityKind,
              observation.entityCandidate,
              JSON.stringify(observation.relatedEntityCandidates),
              observation.fact, observation.evidence.quote,
              observation.evidence.startOffset, observation.evidence.endOffset,
              observation.confidence, JSON.stringify(observation.data ?? {}),
              leased.chunk_id
            ]
          )
          if (!inserted.rows[0]) {
            const existing = await client.query(
              `SELECT id FROM book_analysis_observations
               WHERE run_id = $1 AND chunk_id = $2 AND extractor_version = $3
                 AND observation_key = $4`,
              [job.runId, leased.chunk_id, extractorVersion, observation.observationKey]
            )
            if (!existing.rows[0]) {
              throw repositoryError(
                'OBSERVATION_OUTSIDE_CORE',
                `observation is outside its owned core: ${observation.observationKey}`
              )
            }
          }
        }
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'ready', result = $3::jsonb,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, JSON.stringify({ observationCount: observations.length })]
        )
        const barrier = await client.query(
          `SELECT count(*)::integer AS required_count,
                  count(*) FILTER (WHERE status <> 'ready')::integer AS incomplete_count
           FROM book_analysis_jobs
           WHERE run_id = $1 AND stage = 'scan' AND required`,
          [job.runId]
        )
        const requiredCount = Number(barrier.rows[0].required_count)
        const incompleteCount = Number(barrier.rows[0].incomplete_count)
        let stage = 'scan'
        if (requiredCount > 0 && incompleteCount === 0) {
          await client.query(
            `INSERT INTO book_analysis_jobs (
               id, run_id, stage, shard_key, required, priority
             ) VALUES ($1, $2, 'resolve', 'book', true, $3)
             ON CONFLICT (run_id, stage, shard_key) DO NOTHING`,
            [idFactory(), job.runId, resolvePriority]
          )
          await client.query(
            `UPDATE book_analysis_runs SET stage = 'resolve' WHERE id = $1`,
            [job.runId]
          )
          stage = 'resolve'
        }
        return { observationCount: observations.length, stage }
      })
    },

    async getResolveInput(job) {
      const run = await pool.query(
        `SELECT run.id AS run_id, run.book_edition_id, run.prompt_version,
                run.normalized_text_hash, run.text_length, edition.title, edition.author
         FROM book_analysis_jobs AS job
         JOIN book_analysis_runs AS run ON run.id = job.run_id
         JOIN book_editions AS edition ON edition.id = run.book_edition_id
         WHERE job.id = $1 AND job.run_id = $2 AND job.stage = 'resolve'
           AND job.status = 'running' AND job.lease_token = $3::uuid
           AND run.stage = 'resolve' AND run.status = 'running'
           AND NOT EXISTS (
             SELECT 1 FROM book_analysis_jobs AS scan
             WHERE scan.run_id = run.id AND scan.stage = 'scan'
               AND scan.required AND scan.status <> 'ready'
           )`,
        [job.id, job.runId, job.leaseToken]
      )
      if (!run.rows[0]) throw repositoryError('LEASE_LOST', `analysis job lease lost: ${job.id}`)
      const stored = await pool.query(
        `SELECT observation.*, chunk.chapter_key
         FROM book_analysis_observations AS observation
         JOIN book_analysis_chunks AS chunk
           ON chunk.run_id = observation.run_id AND chunk.id = observation.chunk_id
         WHERE observation.run_id = $1
         ORDER BY observation.evidence_start_offset,
                  observation.evidence_end_offset, observation.id
         LIMIT 100001`,
        [job.runId]
      )
      if (stored.rows.length > 100_000) {
        throw repositoryError('RESOLUTION_INPUT_TOO_LARGE', 'resolve input exceeds 100000 observations')
      }
      const observations = stored.rows.map(observationRow)
      return {
        runId: run.rows[0].run_id,
        bookEditionId: run.rows[0].book_edition_id,
        title: run.rows[0].title,
        author: run.rows[0].author,
        extractorVersion: run.rows[0].prompt_version,
        normalizedTextHash: run.rows[0].normalized_text_hash,
        textLength: Number(run.rows[0].text_length),
        observationSetHash: hashObservationSet(observations),
        observations
      }
    },

    async completeResolve(job, {
      observationSetHash,
      observationCount,
      entities,
      synthesizePriority = 50
    }) {
      validateHash(observationSetHash, 'observationSetHash')
      if (!Number.isSafeInteger(observationCount) || observationCount < 0 || observationCount > 100_000) {
        throw new RangeError('observationCount must be between 0 and 100000')
      }
      if (!Array.isArray(entities) || entities.length > 100_000) {
        throw new RangeError('entities must be an array with at most 100000 items')
      }
      const normalizedEntities = entities.map(normalizeBookAnalysisResolvedEntity)
      return transaction(pool, async (client) => {
        await requireLeasedJob(client, job, 'resolve')
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND stage = 'resolve' AND status = 'running'
           FOR UPDATE`,
          [job.runId]
        )
        if (!run.rows[0]) throw repositoryError('RUN_STATE_CHANGED', 'analysis run is not resolving')
        const stored = await client.query(
          `SELECT observation.*, chunk.chapter_key
           FROM book_analysis_observations AS observation
           JOIN book_analysis_chunks AS chunk
             ON chunk.run_id = observation.run_id AND chunk.id = observation.chunk_id
           WHERE observation.run_id = $1
           ORDER BY observation.evidence_start_offset,
                    observation.evidence_end_offset, observation.id`,
          [job.runId]
        )
        const observations = stored.rows.map(observationRow)
        if (
          observations.length !== observationCount ||
          hashObservationSet(observations) !== observationSetHash
        ) {
          throw repositoryError(
            'RESOLUTION_INPUT_CHANGED',
            'observation set changed while the resolve job was running'
          )
        }
        const knownEvidenceIds = new Set(observations.map(({ id }) => id))
        const observationsById = new Map(observations.map((observation) => [
          observation.id,
          observation
        ]))
        const assignedEvidenceIds = new Set()
        const entityKeys = new Set()
        for (const entity of normalizedEntities) {
          if (entityKeys.has(entity.entityKey)) {
            throw repositoryError('RESOLUTION_OUTPUT_INVALID', `duplicate entity key: ${entity.entityKey}`)
          }
          entityKeys.add(entity.entityKey)
          for (const evidenceId of entity.evidenceIds) {
            if (!knownEvidenceIds.has(evidenceId)) {
              throw repositoryError('RESOLUTION_OUTPUT_INVALID', `unknown evidence: ${evidenceId}`)
            }
            if (observationsById.get(evidenceId).entityKind !== entity.entityKind) {
              throw repositoryError(
                'RESOLUTION_OUTPUT_INVALID',
                `evidence kind does not match entity kind: ${evidenceId}`
              )
            }
            if (assignedEvidenceIds.has(evidenceId)) {
              throw repositoryError('RESOLUTION_OUTPUT_INVALID', `evidence assigned twice: ${evidenceId}`)
            }
            assignedEvidenceIds.add(evidenceId)
          }
        }
        if (assignedEvidenceIds.size !== knownEvidenceIds.size) {
          throw repositoryError(
            'RESOLUTION_OUTPUT_INCOMPLETE',
            'every observation must be assigned to exactly one resolved entity'
          )
        }
        const entityRecords = normalizedEntities.map((entity) => ({
          id: idFactory(),
          ...entity
        }))
        if (entityRecords.length) {
          await client.query(
            `INSERT INTO book_analysis_entities (
               id, run_id, entity_key, entity_kind, canonical_name,
               aliases, resolution_status, confidence, data
             )
             SELECT item.id, $1, item.entity_key, item.entity_kind,
                    item.canonical_name, item.aliases, item.resolution_status,
                    item.confidence, item.data
             FROM jsonb_to_recordset($2::jsonb) AS item(
               id uuid, entity_key text, entity_kind text, canonical_name text,
               aliases jsonb, resolution_status text,
               confidence double precision, data jsonb
             )`,
            [job.runId, JSON.stringify(entityRecords.map((entity) => ({
              id: entity.id,
              entity_key: entity.entityKey,
              entity_kind: entity.entityKind,
              canonical_name: entity.canonicalName,
              aliases: entity.aliases,
              resolution_status: entity.resolutionStatus,
              confidence: entity.confidence,
              data: entity.data
            })))]
          )
          const evidenceLinks = entityRecords.flatMap((entity) =>
            entity.evidenceIds.map((observationId) => ({
              entity_id: entity.id,
              observation_id: observationId
            }))
          )
          await client.query(
            `INSERT INTO book_analysis_entity_evidence (
               run_id, entity_id, observation_id
             )
             SELECT $1, item.entity_id, item.observation_id
             FROM jsonb_to_recordset($2::jsonb) AS item(
               entity_id uuid, observation_id uuid
             )`,
            [job.runId, JSON.stringify(evidenceLinks)]
          )
        }
        const entitySetHash = contentHash(normalizedEntities)
        const snapshotId = idFactory()
        const snapshotData = {
          schemaVersion: 1,
          observationSetHash,
          entitySetHash,
          observationIds: observations.map(({ id }) => id),
          entities: entityRecords
        }
        const snapshotContentHash = contentHash(snapshotData)
        await client.query(
          `INSERT INTO book_analysis_snapshots (
             id, run_id, snapshot_version, content_hash, evidence_count, data
           ) VALUES ($1, $2, 1, $3, $4, $5::jsonb)`,
          [
            snapshotId, job.runId, snapshotContentHash,
            observations.length, JSON.stringify(snapshotData)
          ]
        )
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'ready', result = $3::jsonb,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [
            job.id,
            job.leaseToken,
            JSON.stringify({
              observationCount: observations.length,
              entityCount: normalizedEntities.length,
              snapshotId
            })
          ]
        )
        const characterEntities = entityRecords.filter((entity) =>
          entity.entityKind === 'character' && entity.resolutionStatus === 'confirmed'
        ).slice(0, 128)
        for (const entity of characterEntities) {
          await client.query(
            `INSERT INTO book_analysis_jobs (
               id, run_id, stage, shard_key, required, priority, payload
             ) VALUES ($1, $2, 'synthesize', $3, true, $4, $5::jsonb)
             ON CONFLICT (run_id, stage, shard_key) DO NOTHING`,
            [
              idFactory(), job.runId, `character:${entity.entityKey}`,
              synthesizePriority,
              JSON.stringify({ mode: 'character_profile', snapshotId, entityId: entity.id })
            ]
          )
        }
        await client.query(
          `INSERT INTO book_analysis_jobs (
             id, run_id, stage, shard_key, required, priority, payload
           ) VALUES ($1, $2, 'synthesize', 'book', true, $3, $4::jsonb)
           ON CONFLICT (run_id, stage, shard_key) DO NOTHING`,
          [
            idFactory(), job.runId, synthesizePriority,
            JSON.stringify({ mode: 'assemble_book', snapshotId })
          ]
        )
        await client.query(
          `UPDATE book_analysis_runs SET stage = 'synthesize' WHERE id = $1`,
          [job.runId]
        )
        return {
          observationCount: observations.length,
          entityCount: normalizedEntities.length,
          characterJobCount: characterEntities.length,
          snapshotId,
          stage: 'synthesize'
        }
      })
    },

    async getSynthesizeInput(job) {
      const row = await requireStageInput(pool, job, 'synthesize')
      const snapshot = snapshotRow(row)
      const mode = row.payload?.mode
      if (mode === 'character_profile') {
        const entity = snapshot.data.entities.find(({ id }) => id === row.payload.entityId)
        if (!entity || entity.entityKind !== 'character') {
          throw repositoryError('SYNTHESIS_INPUT_INVALID', 'character entity is absent from snapshot')
        }
        return {
          mode,
          runId: row.run_id,
          title: row.title,
          author: row.author,
          textLength: Number(row.text_length),
          snapshot,
          entity,
          observations: await loadOrderedObservationsByIds(pool, job.runId, entity.evidenceIds)
        }
      }
      if (mode === 'assemble_book') {
        const observations = await loadOrderedObservations(pool, job.runId)
        const artifacts = await pool.query(
          `SELECT * FROM book_analysis_artifacts
           WHERE run_id = $1 AND snapshot_id = $2
             AND artifact_kind = 'character_profile' AND status = 'valid'
           ORDER BY artifact_key`,
          [job.runId, snapshot.id]
        )
        return {
          mode,
          runId: row.run_id,
          title: row.title,
          author: row.author,
          textLength: Number(row.text_length),
          snapshot,
          observations,
          characterProfiles: artifacts.rows.map(({ data }) => data.profile)
        }
      }
      throw repositoryError('SYNTHESIS_INPUT_INVALID', 'unsupported synthesize payload mode')
    },

    async completeCharacterSynthesis(job, {
      snapshotId,
      synthesisVersion,
      selectedEvidenceIds,
      profile
    }) {
      validateIdentifier(snapshotId, 'snapshotId')
      validateIdentifier(synthesisVersion, 'synthesisVersion', 128)
      if (
        !Array.isArray(selectedEvidenceIds) || !selectedEvidenceIds.length ||
        selectedEvidenceIds.length > 240 ||
        new Set(selectedEvidenceIds).size !== selectedEvidenceIds.length
      ) {
        throw new TypeError('selectedEvidenceIds must contain 1 to 240 unique items')
      }
      return transaction(pool, async (client) => {
        const leased = await requireLeasedJob(client, job, 'synthesize')
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND stage = 'synthesize' AND status = 'running'
           FOR UPDATE`,
          [job.runId]
        )
        if (!run.rows[0]) throw repositoryError('RUN_STATE_CHANGED', 'analysis run is not synthesizing')
        if (leased.payload?.mode !== 'character_profile' || leased.payload?.snapshotId !== snapshotId) {
          throw repositoryError('SYNTHESIS_INPUT_CHANGED', 'character job payload changed')
        }
        const snapshot = await client.query(
          `SELECT * FROM book_analysis_snapshots WHERE id = $1 AND run_id = $2`,
          [snapshotId, job.runId]
        )
        const entity = snapshot.rows[0]?.data?.entities?.find(({ id }) =>
          id === leased.payload.entityId
        )
        if (!entity) throw repositoryError('SYNTHESIS_INPUT_CHANGED', 'entity is absent from snapshot')
        const allowedEvidenceIds = new Set(entity.evidenceIds)
        if (selectedEvidenceIds.some((id) => !allowedEvidenceIds.has(id))) {
          throw repositoryError('SYNTHESIS_OUTPUT_INVALID', 'profile used evidence from another entity')
        }
        const normalizedProfile = normalizeBookAnalysisCharacterProfile(profile, {
          entity,
          textLength: Number(run.rows[0].text_length)
        })
        if (normalizedProfile.creative.voice && !isSupportedVoice(normalizedProfile.creative.voice)) {
          throw repositoryError('SYNTHESIS_OUTPUT_INVALID', 'profile creative voice is unsupported')
        }
        const usedEvidenceIds = new Set()
        const claims = [
          normalizedProfile.role, normalizedProfile.age, normalizedProfile.gender,
          normalizedProfile.description, ...normalizedProfile.traits,
          ...normalizedProfile.appearance, normalizedProfile.speechStyle,
          ...normalizedProfile.speechExamples
        ].filter(Boolean)
        for (const claim of claims) {
          for (const evidenceId of claim.evidenceIds) {
            if (!selectedEvidenceIds.includes(evidenceId)) {
              throw repositoryError('SYNTHESIS_OUTPUT_INVALID', `unknown selected evidence: ${evidenceId}`)
            }
            usedEvidenceIds.add(evidenceId)
          }
        }
        const artifactData = {
          synthesisVersion,
          selectedEvidenceIds,
          usedEvidenceIds: [...usedEvidenceIds].sort(),
          profile: normalizedProfile
        }
        const artifactHash = contentHash(artifactData)
        const artifactId = idFactory()
        await client.query(
          `INSERT INTO book_analysis_artifacts (
             id, run_id, snapshot_id, artifact_kind, artifact_key,
             schema_version, status, content_hash, data
           ) VALUES ($1, $2, $3, 'character_profile', $4, 1, 'valid', $5, $6::jsonb)`,
          [
            artifactId, job.runId, snapshotId, entity.entityKey,
            artifactHash, JSON.stringify(artifactData)
          ]
        )
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'ready', result = $3::jsonb,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [
            job.id, job.leaseToken,
            JSON.stringify({ artifactId, usedEvidenceCount: usedEvidenceIds.size })
          ]
        )
        return { artifactId, stage: 'synthesize' }
      })
    },

    async completeBookSynthesis(job, { snapshotId, markup, validatePriority = 50 }) {
      validateIdentifier(snapshotId, 'snapshotId')
      const normalizedMarkup = normalizeBookMarkupV3(markup)
      if (normalizedMarkup.snapshotId !== snapshotId) {
        throw repositoryError('SYNTHESIS_OUTPUT_INVALID', 'markup references another snapshot')
      }
      return transaction(pool, async (client) => {
        const leased = await requireLeasedJob(client, job, 'synthesize')
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND stage = 'synthesize' AND status = 'running'
           FOR UPDATE`,
          [job.runId]
        )
        if (!run.rows[0]) throw repositoryError('RUN_STATE_CHANGED', 'analysis run is not synthesizing')
        if (leased.shard_key !== 'book' || leased.payload?.snapshotId !== snapshotId) {
          throw repositoryError('SYNTHESIS_INPUT_CHANGED', 'book synthesis payload changed')
        }
        const incomplete = await client.query(
          `SELECT count(*)::integer AS count FROM book_analysis_jobs
           WHERE run_id = $1 AND stage = 'synthesize' AND required
             AND shard_key <> 'book' AND status <> 'ready'`,
          [job.runId]
        )
        if (Number(incomplete.rows[0].count) > 0) {
          throw repositoryError('SYNTHESIS_BARRIER_INCOMPLETE', 'character profiles are incomplete')
        }
        const artifactId = idFactory()
        const artifactHash = contentHash(normalizedMarkup)
        await client.query(
          `INSERT INTO book_analysis_artifacts (
             id, run_id, snapshot_id, artifact_kind, artifact_key,
             schema_version, status, content_hash, data
           ) VALUES ($1, $2, $3, 'book_markup', 'primary', $4, 'draft', $5, $6::jsonb)`,
          [
            artifactId, job.runId, snapshotId, BOOK_ANALYSIS_SCHEMA_VERSION,
            artifactHash, JSON.stringify(normalizedMarkup)
          ]
        )
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'ready', result = $3::jsonb,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, JSON.stringify({ artifactId })]
        )
        await client.query(
          `INSERT INTO book_analysis_jobs (
             id, run_id, stage, shard_key, required, priority, payload
           ) VALUES ($1, $2, 'validate', 'book', true, $3, $4::jsonb)
           ON CONFLICT (run_id, stage, shard_key) DO NOTHING`,
          [
            idFactory(), job.runId, validatePriority,
            JSON.stringify({ snapshotId, artifactId })
          ]
        )
        await client.query(`UPDATE book_analysis_runs SET stage = 'validate' WHERE id = $1`, [job.runId])
        return { artifactId, stage: 'validate' }
      })
    },

    async getValidationInput(job) {
      const row = await requireStageInput(pool, job, 'validate')
      const artifact = await pool.query(
        `SELECT * FROM book_analysis_artifacts
         WHERE id = $1 AND run_id = $2 AND snapshot_id = $3
           AND artifact_kind = 'book_markup' AND status = 'draft'`,
        [row.payload.artifactId, job.runId, row.id]
      )
      if (!artifact.rows[0]) throw repositoryError('VALIDATION_INPUT_INVALID', 'draft markup is unavailable')
      return {
        runId: row.run_id,
        snapshot: snapshotRow(row),
        artifact: artifactRow(artifact.rows[0]),
        normalizedTextObjectKey: row.normalized_text_object_key,
        normalizedTextHash: row.normalized_text_hash,
        textLength: Number(row.text_length),
        observations: await loadOrderedObservations(pool, job.runId)
      }
    },

    async completeValidation(job, { report, publishPriority = 50 }) {
      if (
        !report || typeof report !== 'object' || Array.isArray(report) ||
        typeof report.valid !== 'boolean' || !Array.isArray(report.errors) ||
        report.errors.length > 1_000 ||
        !report.checks || typeof report.checks !== 'object' || Array.isArray(report.checks) ||
        !['schema', 'sourceHash', 'evidence', 'references'].every((key) =>
          typeof report.checks[key] === 'boolean'
        )
      ) {
        throw new TypeError('report must be a normalized validation report')
      }
      if (
        report.valid !== (report.errors.length === 0) ||
        (report.valid && Object.values(report.checks).some((value) => value !== true))
      ) {
        throw new TypeError('report validity does not match its errors and checks')
      }
      return transaction(pool, async (client) => {
        const leased = await requireLeasedJob(client, job, 'validate')
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND stage = 'validate' AND status = 'running'
           FOR UPDATE`,
          [job.runId]
        )
        if (!run.rows[0]) throw repositoryError('RUN_STATE_CHANGED', 'analysis run is not validating')
        const markup = await client.query(
          `SELECT * FROM book_analysis_artifacts
           WHERE id = $1 AND run_id = $2 AND artifact_kind = 'book_markup'
           FOR UPDATE`,
          [leased.payload.artifactId, job.runId]
        )
        if (!markup.rows[0] || markup.rows[0].status !== 'draft') {
          throw repositoryError('VALIDATION_INPUT_CHANGED', 'draft markup is unavailable')
        }
        const snapshot = await client.query(
          `SELECT * FROM book_analysis_snapshots
           WHERE id = $1 AND run_id = $2`,
          [markup.rows[0].snapshot_id, job.runId]
        )
        const expectedBindings = {
          snapshotId: markup.rows[0].snapshot_id,
          snapshotContentHash: snapshot.rows[0]?.content_hash,
          normalizedTextHash: run.rows[0].normalized_text_hash,
          markupArtifactId: markup.rows[0].id,
          markupContentHash: markup.rows[0].content_hash
        }
        if (
          !snapshot.rows[0] || !report.bindings ||
          Object.entries(expectedBindings).some(([key, value]) => report.bindings[key] !== value)
        ) {
          throw repositoryError('VALIDATION_OUTPUT_INVALID', 'validation report bindings do not match inputs')
        }
        const reportId = idFactory()
        const reportHash = contentHash(report)
        await client.query(
          `INSERT INTO book_analysis_artifacts (
             id, run_id, snapshot_id, artifact_kind, artifact_key,
             schema_version, status, content_hash, data
           ) VALUES ($1, $2, $3, 'validation_report', 'primary', 1, $4, $5, $6::jsonb)`,
          [
            reportId, job.runId, markup.rows[0].snapshot_id,
            report.valid ? 'valid' : 'invalid', reportHash, JSON.stringify(report)
          ]
        )
        await client.query(
          `UPDATE book_analysis_artifacts SET status = $2 WHERE id = $1`,
          [markup.rows[0].id, report.valid ? 'valid' : 'invalid']
        )
        if (!report.valid) {
          await client.query(
            `UPDATE book_analysis_jobs
             SET status = 'failed', result = $3::jsonb,
                 last_error_code = 'MARKUP_VALIDATION_FAILED',
                 locked_at = NULL, lease_expires_at = NULL,
                 locked_by = NULL, lease_token = NULL, updated_at = now()
             WHERE id = $1 AND lease_token = $2::uuid`,
            [job.id, job.leaseToken, JSON.stringify({ reportId })]
          )
          await client.query(
            `UPDATE book_analysis_runs
             SET status = 'failed', last_error_code = 'MARKUP_VALIDATION_FAILED'
             WHERE id = $1`,
            [job.runId]
          )
          return { reportId, stage: 'validate', status: 'failed' }
        }
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'ready', result = $3::jsonb,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, JSON.stringify({ reportId })]
        )
        await client.query(
          `INSERT INTO book_analysis_jobs (
             id, run_id, stage, shard_key, required, priority, payload
           ) VALUES ($1, $2, 'publish', 'shadow', true, $3, $4::jsonb)
           ON CONFLICT (run_id, stage, shard_key) DO NOTHING`,
          [
            idFactory(), job.runId, publishPriority,
            JSON.stringify({
              snapshotId: markup.rows[0].snapshot_id,
              artifactId: markup.rows[0].id,
              reportId,
              channel: 'shadow'
            })
          ]
        )
        await client.query(`UPDATE book_analysis_runs SET stage = 'publish' WHERE id = $1`, [job.runId])
        return { reportId, stage: 'publish' }
      })
    },

    async getPublishInput(job) {
      const result = await pool.query(
        `SELECT run.id AS run_id, run.book_edition_id, job.payload,
                markup.*, report.status AS report_status, report.data AS report_data
         FROM book_analysis_jobs AS job
         JOIN book_analysis_runs AS run ON run.id = job.run_id
         JOIN book_analysis_artifacts AS markup
           ON markup.id = (job.payload->>'artifactId')::uuid AND markup.run_id = run.id
         JOIN book_analysis_artifacts AS report
           ON report.id = (job.payload->>'reportId')::uuid AND report.run_id = run.id
         WHERE job.id = $1 AND job.run_id = $2 AND job.stage = 'publish'
           AND job.status = 'running' AND job.lease_token = $3::uuid
           AND run.stage = 'publish' AND run.status = 'running'
           AND job.payload->>'channel' = 'shadow'
           AND markup.artifact_kind = 'book_markup' AND markup.status = 'valid'
           AND report.artifact_kind = 'validation_report' AND report.status = 'valid'`,
        [job.id, job.runId, job.leaseToken]
      )
      if (!result.rows[0]) throw repositoryError('LEASE_LOST', `analysis job lease lost: ${job.id}`)
      return {
        runId: result.rows[0].run_id,
        bookEditionId: result.rows[0].book_edition_id,
        channel: 'shadow',
        artifact: artifactRow(result.rows[0]),
        validationReport: result.rows[0].report_data
      }
    },

    async completeShadowPublish(job, { artifactId }) {
      validateIdentifier(artifactId, 'artifactId')
      return transaction(pool, async (client) => {
        const leased = await requireLeasedJob(client, job, 'publish')
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND stage = 'publish' AND status = 'running'
           FOR UPDATE`,
          [job.runId]
        )
        if (!run.rows[0]) throw repositoryError('RUN_STATE_CHANGED', 'analysis run is not publishing')
        if (leased.payload?.channel !== 'shadow' || leased.payload?.artifactId !== artifactId) {
          throw repositoryError('PUBLISH_INPUT_CHANGED', 'publish payload changed')
        }
        const artifact = await client.query(
          `SELECT * FROM book_analysis_artifacts
           WHERE id = $1 AND run_id = $2 AND artifact_kind = 'book_markup'
             AND status = 'valid' FOR UPDATE`,
          [artifactId, job.runId]
        )
        if (!artifact.rows[0]) throw repositoryError('PUBLISH_INPUT_INVALID', 'valid markup is unavailable')
        const validation = await client.query(
          `SELECT * FROM book_analysis_artifacts
           WHERE id = $1 AND run_id = $2 AND artifact_kind = 'validation_report'
             AND status = 'valid' FOR KEY SHARE`,
          [leased.payload.reportId, job.runId]
        )
        const bindings = validation.rows[0]?.data?.bindings
        const snapshot = await client.query(
          `SELECT content_hash FROM book_analysis_snapshots
           WHERE id = $1 AND run_id = $2`,
          [artifact.rows[0].snapshot_id, job.runId]
        )
        if (
          !validation.rows[0] || validation.rows[0].data?.valid !== true ||
          bindings?.snapshotId !== artifact.rows[0].snapshot_id ||
          bindings?.snapshotContentHash !== snapshot.rows[0]?.content_hash ||
          bindings?.normalizedTextHash !== run.rows[0].normalized_text_hash ||
          bindings?.markupArtifactId !== artifact.rows[0].id ||
          bindings?.markupContentHash !== artifact.rows[0].content_hash
        ) {
          throw repositoryError('PUBLISH_INPUT_INVALID', 'validation report is not bound to this markup')
        }
        const publicationId = idFactory()
        const publicationData = {
          schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
          analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
          artifactId,
          snapshotId: artifact.rows[0].snapshot_id,
          markup: artifact.rows[0].data
        }
        await client.query(
          `INSERT INTO book_analysis_publications (
             id, run_id, book_edition_id, artifact_id, channel,
             analysis_version, content_hash, data
           ) VALUES ($1, $2, $3, $4, 'shadow', $5, $6, $7::jsonb)`,
          [
            publicationId, job.runId, run.rows[0].book_edition_id, artifactId,
            BOOK_ANALYSIS_MARKUP_VERSION, artifact.rows[0].content_hash,
            JSON.stringify(publicationData)
          ]
        )
        await client.query(
          `UPDATE book_analysis_artifacts
           SET status = 'published', published_at = now() WHERE id = $1`,
          [artifactId]
        )
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = 'ready', result = $3::jsonb,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, JSON.stringify({ publicationId, channel: 'shadow' })]
        )
        await client.query(
          `UPDATE book_analysis_runs SET status = 'ready' WHERE id = $1`,
          [job.runId]
        )
        await client.query(
          `UPDATE book_editions SET status = 'base_ready', updated_at = now()
           WHERE id = $1 AND scope = 'catalog' AND status IN ('marking_up', 'failed')`,
          [run.rows[0].book_edition_id]
        )
        return { publicationId, channel: 'shadow', status: 'ready' }
      })
    },

    async failAnalysisJob(job, errorCode) {
      const safeCode = typeof errorCode === 'string' && /^[A-Z][A-Z0-9_]{1,48}$/.test(errorCode)
        ? errorCode
        : 'UNKNOWN'
      return transaction(pool, async (client) => {
        const row = await requireLeasedJob(client, job, job.stage)
        const exhausted = Number(row.attempts) >= Number(row.max_attempts)
        const status = exhausted ? 'failed' : 'queued'
        const retrySeconds = Math.min(300, 2 ** Math.min(Number(row.attempts), 8))
        await client.query(
          `UPDATE book_analysis_jobs
           SET status = $3, last_error_code = $4,
               available_at = CASE WHEN $3 = 'queued'
                 THEN now() + make_interval(secs => $5) ELSE available_at END,
               locked_at = NULL, lease_expires_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.id, job.leaseToken, status, safeCode, retrySeconds]
        )
        if (exhausted) {
          await client.query(
            `UPDATE book_analysis_runs
             SET status = 'failed', last_error_code = $2
             WHERE id = $1 AND status = 'running'`,
            [job.runId, safeCode]
          )
        }
        return { status, retrySeconds: exhausted ? undefined : retrySeconds }
      })
    }
  }
}
