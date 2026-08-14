import { BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION } from './book-analysis-contracts.mjs'

const STAGES = Object.freeze(['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'])
const JOB_STATUSES = Object.freeze(['queued', 'running', 'ready', 'failed', 'cancelled'])

function number(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function jobCounts(rows, runId) {
  const result = {}
  for (const row of rows) {
    if (row.run_id !== runId) continue
    const stage = result[row.stage] ?? Object.fromEntries([
      ['total', 0],
      ...JOB_STATUSES.map((status) => [status, 0])
    ])
    const count = number(row.count)
    stage[row.status] = count
    stage.total += count
    result[row.stage] = stage
  }
  return result
}

function analysisPercent(run, jobs) {
  if (!run) return 0
  if (run.status === 'ready') return 100
  const stageIndex = Math.max(0, STAGES.indexOf(run.stage))
  const current = jobs[run.stage]
  const fraction = current?.total
    ? Math.min(1, current.ready / current.total)
    : run.status === 'running' ? 0.05 : 0
  return Math.max(0, Math.min(99, Math.round(((stageIndex + fraction) / STAGES.length) * 100)))
}

function iso(value) {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : String(value)
}

function runValue(row) {
  if (!row) return null
  return {
    id: row.id,
    bookEditionId: row.book_edition_id,
    pipelineVersion: row.pipeline_version,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    normalizedTextHash: row.normalized_text_hash ?? undefined,
    textLength: row.text_length == null ? undefined : number(row.text_length),
    stage: row.stage,
    status: row.status,
    lastErrorCode: row.last_error_code ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at)
  }
}

function bookValue(row) {
  return {
    id: row.id,
    scope: row.scope,
    catalogKey: row.catalog_key ?? undefined,
    title: row.title,
    author: row.author,
    format: row.format,
    status: row.status,
    contentSha256: row.content_sha256,
    source: {
      status: row.source_status ?? 'missing',
      byteSize: number(row.byte_size)
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}

function publicationValue(row, { includeData = true } = {}) {
  if (!row) return null
  return {
    id: row.id,
    runId: row.run_id,
    bookEditionId: row.book_edition_id,
    artifactId: row.artifact_id,
    channel: row.channel,
    analysisVersion: row.analysis_version,
    contentHash: row.content_hash,
    publishedAt: iso(row.published_at),
    ...(includeData ? { data: row.data } : {})
  }
}

function mediaCounts(row) {
  return {
    queued: number(row?.queued),
    running: number(row?.running),
    ready: number(row?.ready),
    failed: number(row?.failed),
    total: number(row?.total)
  }
}

function characterKey(value) {
  return String(value?.characterKey ?? value?.character_key ?? value?.entityKey ?? '')
}

function liveCharacters({ publication, entities, observations, media }) {
  const result = new Map()
  const published = Array.isArray(publication?.data?.markup?.characters)
    ? publication.data.markup.characters
    : []
  for (const value of published) {
    const key = characterKey(value)
    if (!key) continue
    result.set(key, {
      key,
      name: value.name || value.canonicalName || key,
      fullName: value.fullName || value.canonicalName || value.name || key,
      phase: 'published',
      firstAppearanceTextOffset: number(
        value.firstAppearanceTextOffset ?? value.first_appearance_text_offset
      ),
      warmupTextOffset: number(value.warmupTextOffset ?? value.warmup_text_offset),
      data: value
    })
  }
  for (const value of entities) {
    if (value.entity_kind !== 'character' || value.resolution_status === 'rejected') continue
    const key = value.entity_key
    if (!result.has(key)) {
      result.set(key, {
        key,
        name: value.canonical_name,
        fullName: value.canonical_name,
        phase: 'resolved',
        confidence: value.confidence,
        data: value.data
      })
    }
  }
  for (const value of observations) {
    const key = `observed:${String(value.entity_candidate).toLocaleLowerCase('ru')}`
    if (![...result.values()].some((item) => item.name === value.entity_candidate)) {
      result.set(key, {
        key,
        name: value.entity_candidate,
        fullName: value.entity_candidate,
        phase: 'observed',
        observationCount: number(value.observation_count),
        firstEvidenceOffset: number(value.first_evidence_offset)
      })
    }
  }
  const mediaByKey = new Map(media.map((item) => [item.character_key, item]))
  return [...result.values()].map((character) => {
    const bundle = mediaByKey.get(character.key)
    return {
      ...character,
      media: bundle
        ? {
            bundleVersion: bundle.bundle_version,
            status: bundle.bundle_status,
            generationStatus: bundle.generation_status ?? undefined,
            attempts: number(bundle.attempts),
            lastErrorCode: bundle.last_error_code ?? undefined,
            assets: bundle.assets ?? {}
          }
        : {
            bundleVersion: BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION,
            status: 'not_queued',
            assets: {}
          }
    }
  })
}

export function createPostgresBookOperatorRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }

  async function listBooks({ bookEditionId } = {}) {
    const editionFilter = bookEditionId ? 'WHERE edition.id = $1' : ''
    const runFilter = bookEditionId ? 'WHERE run.book_edition_id = $1' : ''
    const publicationFilter = bookEditionId
      ? "WHERE publication.channel = 'shadow' AND publication.book_edition_id = $1"
      : "WHERE publication.channel = 'shadow'"
    const editionParameters = bookEditionId ? [bookEditionId] : []
    const editionsPromise = pool.query(
      `/* operator:list-editions */
       SELECT edition.id, edition.scope, edition.catalog_key, edition.title,
              edition.author, edition.format, edition.status, edition.content_sha256,
              edition.created_at, edition.updated_at,
              file.status AS source_status, file.byte_size
       FROM book_editions AS edition
       LEFT JOIN book_files AS file ON file.book_edition_id = edition.id
       ${editionFilter}
       ORDER BY edition.updated_at DESC, edition.id`,
      editionParameters
    )
    const runsPromise = pool.query(
      `/* operator:latest-runs */
       SELECT DISTINCT ON (run.book_edition_id) run.*
       FROM book_analysis_runs AS run
       ${runFilter}
       ORDER BY run.book_edition_id, run.created_at DESC, run.id DESC`,
      editionParameters
    )
    const publicationsPromise = pool.query(
      `/* operator:latest-publications */
       SELECT DISTINCT ON (publication.book_edition_id)
              publication.id, publication.run_id, publication.book_edition_id,
              publication.analysis_version, publication.published_at,
              CASE
                WHEN jsonb_typeof(publication.data->'markup'->'characters') = 'array'
                  THEN jsonb_array_length(publication.data->'markup'->'characters')
                ELSE 0
              END AS character_count
       FROM book_analysis_publications AS publication
       ${publicationFilter}
       ORDER BY publication.book_edition_id, publication.published_at DESC, publication.id DESC`,
      editionParameters
    )
    const mediaPromise = pool.query(
      `/* operator:media-counts */
       SELECT job.book_edition_id,
              count(*) FILTER (WHERE job.status = 'queued')::integer AS queued,
              count(*) FILTER (WHERE job.status = 'running')::integer AS running,
              count(*) FILTER (WHERE job.status = 'ready')::integer AS ready,
              count(*) FILTER (WHERE job.status = 'failed')::integer AS failed,
              count(*)::integer AS total
       FROM generation_jobs AS job
       WHERE job.job_type = 'character_bundle' AND job.target_version = $1
         ${bookEditionId ? 'AND job.book_edition_id = $2' : ''}
       GROUP BY job.book_edition_id`,
      bookEditionId
        ? [BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION, bookEditionId]
        : [BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION]
    )
    const [editions, runs, publications, media] = await Promise.all([
      editionsPromise, runsPromise, publicationsPromise, mediaPromise
    ])
    const runIds = runs.rows.map((row) => row.id)
    const [jobs, findings] = runIds.length
      ? await Promise.all([
          pool.query(
            `/* operator:analysis-job-counts */
             SELECT job.run_id, job.stage, job.status, count(*)::integer AS count
             FROM book_analysis_jobs AS job
             WHERE job.run_id = ANY($1::uuid[])
             GROUP BY job.run_id, job.stage, job.status`,
            [runIds]
          ),
          pool.query(
            `/* operator:live-findings */
             SELECT run.id AS run_id,
                    (SELECT count(*)::integer FROM book_analysis_observations AS observation
                     WHERE observation.run_id = run.id) AS observation_count,
                    (SELECT count(*)::integer FROM book_analysis_entities AS entity
                     WHERE entity.run_id = run.id AND entity.entity_kind = 'character'
                       AND entity.resolution_status <> 'rejected') AS character_count
             FROM book_analysis_runs AS run
             WHERE run.id = ANY($1::uuid[])`,
            [runIds]
          )
        ])
      : [{ rows: [] }, { rows: [] }]

    const runByBook = new Map(runs.rows.map((row) => [row.book_edition_id, row]))
    const findingByRun = new Map(findings.rows.map((row) => [row.run_id, row]))
    const publicationByBook = new Map(publications.rows.map((row) => [row.book_edition_id, row]))
    const mediaByBook = new Map(media.rows.map((row) => [row.book_edition_id, row]))
    return editions.rows.map((edition) => {
      const run = runByBook.get(edition.id)
      const counts = jobCounts(jobs.rows, run?.id)
      const live = findingByRun.get(run?.id)
      const publication = publicationByBook.get(edition.id)
      return {
        ...bookValue(edition),
        analysis: run
          ? { ...runValue(run), runId: run.id, jobs: counts }
          : null,
        progress: {
          percent: analysisPercent(run, counts),
          stage: run?.stage ?? 'not_started',
          status: run?.status ?? 'not_started'
        },
        findings: {
          observations: number(live?.observation_count),
          characters: number(live?.character_count),
          publishedCharacters: number(publication?.character_count)
        },
        publication: publication
          ? {
              id: publication.id,
              runId: publication.run_id,
              analysisVersion: publication.analysis_version,
              publishedAt: iso(publication.published_at)
            }
          : null,
        media: mediaCounts(mediaByBook.get(edition.id))
      }
    })
  }

  async function getBookDetails(bookEditionId) {
    const summary = (await listBooks({ bookEditionId }))[0]
    if (!summary) return null
    const runId = summary.analysis?.runId
    const [publication, entities, observations, media, stages] = await Promise.all([
      pool.query(
        `/* operator:book-publication */
         SELECT * FROM book_analysis_publications
         WHERE book_edition_id = $1 AND channel = 'shadow'
         ORDER BY published_at DESC, id DESC LIMIT 1`,
        [bookEditionId]
      ),
      runId
        ? pool.query(
            `/* operator:book-entities */
             SELECT entity_key, entity_kind, canonical_name, aliases,
                    resolution_status, confidence, data, created_at, updated_at
             FROM book_analysis_entities WHERE run_id = $1
             ORDER BY entity_kind, canonical_name`,
            [runId]
          )
        : { rows: [] },
      runId
        ? pool.query(
            `/* operator:book-observations */
             SELECT entity_candidate, min(evidence_start_offset) AS first_evidence_offset,
                    count(*)::integer AS observation_count
             FROM book_analysis_observations
             WHERE run_id = $1 AND entity_kind = 'character'
             GROUP BY entity_candidate ORDER BY first_evidence_offset, entity_candidate`,
            [runId]
          )
        : { rows: [] },
      pool.query(
        `/* operator:book-media */
         SELECT bundle.character_key, bundle.bundle_version,
                bundle.status AS bundle_status, bundle.published_at,
                job.status AS generation_status, job.attempts, job.last_error_code,
                coalesce(
                  jsonb_object_agg(
                    link.asset_type,
                    jsonb_build_object(
                      'id', asset.id,
                      'status', asset.status,
                      'mimeType', asset.mime_type,
                      'byteSize', asset.byte_size
                    )
                  ) FILTER (WHERE asset.id IS NOT NULL),
                  '{}'::jsonb
                ) AS assets
         FROM character_media_bundles AS bundle
         LEFT JOIN generation_jobs AS job ON job.id = bundle.job_id
         LEFT JOIN character_bundle_assets AS link ON link.bundle_id = bundle.id
         LEFT JOIN media_assets AS asset ON asset.id = link.asset_id
         WHERE bundle.book_edition_id = $1 AND bundle.bundle_version = $2
         GROUP BY bundle.id, job.id
         ORDER BY bundle.created_at, bundle.character_key`,
        [bookEditionId, BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION]
      ),
      runId
        ? pool.query(
            `/* operator:book-stage-jobs */
             SELECT id, stage, shard_key, status, priority, attempts, max_attempts,
                    last_error_code, locked_by, available_at, created_at, updated_at
             FROM book_analysis_jobs WHERE run_id = $1
             ORDER BY created_at, stage, shard_key`,
            [runId]
          )
        : { rows: [] }
    ])
    const currentPublication = publicationValue(publication.rows[0])
    return {
      book: summary,
      run: summary.analysis,
      stages: stages.rows.map((row) => ({
        id: row.id,
        stage: row.stage,
        shardKey: row.shard_key,
        status: row.status,
        priority: row.priority,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        lastErrorCode: row.last_error_code ?? undefined,
        lockedBy: row.locked_by ?? undefined,
        availableAt: iso(row.available_at),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      })),
      characters: liveCharacters({
        publication: currentPublication,
        entities: entities.rows,
        observations: observations.rows,
        media: media.rows
      }),
      publication: currentPublication,
      refreshedAt: new Date().toISOString()
    }
  }

  async function getBookJson(bookEditionId) {
    const edition = await pool.query(
      `/* operator:json-edition */
       SELECT id, scope, catalog_key, title, author, format, status,
              content_sha256, created_at, updated_at
       FROM book_editions WHERE id = $1`,
      [bookEditionId]
    )
    if (!edition.rows[0]) return null
    const [publication, artifacts, markup] = await Promise.all([
      pool.query(
        `/* operator:json-publication */
         SELECT * FROM book_analysis_publications
         WHERE book_edition_id = $1 AND channel = 'shadow'
         ORDER BY published_at DESC, id DESC LIMIT 1`,
        [bookEditionId]
      ),
      pool.query(
        `/* operator:json-artifacts */
         SELECT artifact.id, artifact.run_id, artifact.snapshot_id,
                artifact.artifact_kind, artifact.artifact_key, artifact.schema_version,
                artifact.status, artifact.content_hash, artifact.data,
                artifact.created_at, artifact.published_at
         FROM book_analysis_artifacts AS artifact
         JOIN book_analysis_runs AS run ON run.id = artifact.run_id
         WHERE run.book_edition_id = $1
         ORDER BY artifact.created_at, artifact.artifact_kind, artifact.artifact_key`,
        [bookEditionId]
      ),
      pool.query(
        `/* operator:json-canonical-markup */
         SELECT markup.id, markup.analysis_version, markup.schema_version,
                markup.revision, markup.status, markup.input_hash,
                markup.created_at, markup.published_at,
                coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'characterKey', character.character_key,
                      'name', character.name,
                      'fullName', character.full_name,
                      'firstAppearanceTextOffset', character.first_appearance_text_offset,
                      'warmupTextOffset', character.warmup_text_offset,
                      'data', character.data
                    ) ORDER BY character.sort_order
                  ) FILTER (WHERE character.id IS NOT NULL),
                  '[]'::jsonb
                ) AS characters
         FROM book_markup_versions AS markup
         LEFT JOIN book_characters AS character ON character.markup_version_id = markup.id
         WHERE markup.book_edition_id = $1
         GROUP BY markup.id
         ORDER BY markup.revision DESC`,
        [bookEditionId]
      )
    ])
    const row = edition.rows[0]
    return {
      book: {
        id: row.id,
        scope: row.scope,
        catalogKey: row.catalog_key ?? undefined,
        title: row.title,
        author: row.author,
        format: row.format,
        status: row.status,
        contentSha256: row.content_sha256,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      },
      publication: publicationValue(publication.rows[0]),
      artifacts: artifacts.rows.map((artifact) => ({
        id: artifact.id,
        runId: artifact.run_id,
        snapshotId: artifact.snapshot_id,
        kind: artifact.artifact_kind,
        key: artifact.artifact_key,
        schemaVersion: artifact.schema_version,
        status: artifact.status,
        contentHash: artifact.content_hash,
        data: artifact.data,
        createdAt: iso(artifact.created_at),
        publishedAt: iso(artifact.published_at)
      })),
      canonicalMarkupVersions: markup.rows.map((item) => ({
        id: item.id,
        analysisVersion: item.analysis_version,
        schemaVersion: item.schema_version,
        revision: item.revision,
        status: item.status,
        inputHash: item.input_hash,
        characters: item.characters,
        createdAt: iso(item.created_at),
        publishedAt: iso(item.published_at)
      }))
    }
  }

  async function getBookOperations(bookEditionId) {
    const exists = await pool.query(
      '/* operator:operations-exists */ SELECT id FROM book_editions WHERE id = $1',
      [bookEditionId]
    )
    if (!exists.rows[0]) return null
    const [runs, analysisJobs, chunks, generationJobs, bundles] = await Promise.all([
      pool.query(
        `/* operator:operations-runs */
         SELECT * FROM book_analysis_runs WHERE book_edition_id = $1`,
        [bookEditionId]
      ),
      pool.query(
        `/* operator:operations-analysis-jobs */
         SELECT job.* FROM book_analysis_jobs AS job
         JOIN book_analysis_runs AS run ON run.id = job.run_id
         WHERE run.book_edition_id = $1`,
        [bookEditionId]
      ),
      pool.query(
        `/* operator:operations-chunks */
         SELECT chunk.* FROM book_analysis_chunks AS chunk
         JOIN book_analysis_runs AS run ON run.id = chunk.run_id
         WHERE run.book_edition_id = $1`,
        [bookEditionId]
      ),
      pool.query(
        `/* operator:operations-generation-jobs */
         SELECT * FROM generation_jobs WHERE book_edition_id = $1`,
        [bookEditionId]
      ),
      pool.query(
        `/* operator:operations-bundles */
         SELECT * FROM character_media_bundles WHERE book_edition_id = $1`,
        [bookEditionId]
      )
    ])
    const operations = [
      ...runs.rows.map((row) => ({
        at: iso(row.updated_at),
        createdAt: iso(row.created_at),
        kind: 'analysis_run',
        id: row.id,
        stage: row.stage,
        status: row.status,
        error: row.last_error_code ?? undefined,
        details: runValue(row)
      })),
      ...analysisJobs.rows.map((row) => ({
        at: iso(row.updated_at),
        createdAt: iso(row.created_at),
        kind: 'analysis_job',
        id: row.id,
        runId: row.run_id,
        stage: row.stage,
        shardKey: row.shard_key,
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        worker: row.locked_by ?? undefined,
        error: row.last_error_code ?? undefined,
        details: { payload: row.payload, result: row.result }
      })),
      ...chunks.rows.map((row) => ({
        at: iso(row.created_at),
        createdAt: iso(row.created_at),
        kind: 'analysis_chunk',
        id: row.id,
        runId: row.run_id,
        stage: 'scan',
        status: 'prepared',
        shardKey: String(row.ordinal),
        details: {
          chapterKey: row.chapter_key,
          coreStartOffset: number(row.core_start_offset),
          coreEndOffset: number(row.core_end_offset),
          contextStartOffset: number(row.context_start_offset),
          contextEndOffset: number(row.context_end_offset),
          metadata: row.metadata
        }
      })),
      ...generationJobs.rows.map((row) => ({
        at: iso(row.updated_at),
        createdAt: iso(row.created_at),
        kind: 'generation_job',
        id: row.id,
        stage: row.job_type,
        shardKey: row.character_key ?? row.target_version,
        status: row.status,
        attempts: row.attempts,
        worker: row.locked_by ?? undefined,
        error: row.last_error_code ?? undefined,
        details: {
          targetVersion: row.target_version,
          priority: row.priority,
          payload: row.payload,
          result: row.result
        }
      })),
      ...bundles.rows.map((row) => ({
        at: iso(row.updated_at),
        createdAt: iso(row.created_at),
        kind: 'media_bundle',
        id: row.id,
        stage: 'character_media',
        shardKey: row.character_key,
        status: row.status,
        details: {
          bundleVersion: row.bundle_version,
          jobId: row.job_id,
          publishedAt: iso(row.published_at)
        }
      }))
    ]
    operations.sort((left, right) => String(right.at).localeCompare(String(left.at)))
    return operations
  }

  return { listBooks, getBookDetails, getBookJson, getBookOperations }
}
