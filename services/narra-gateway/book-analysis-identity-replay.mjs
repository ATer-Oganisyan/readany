import { pathToFileURL } from 'node:url'
import {
  BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
  BOOK_ANALYSIS_PIPELINE_VERSION
} from './book-analysis-contracts.mjs'
import {
  buildBookIdentityReconciliationRequest,
  validateBookIdentityMerges
} from './book-analysis-identity-reconciliation.mjs'
import { resolveBookAnalysisEntities } from './book-analysis-resolver.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import { createPostgresPoolFromEnv } from './postgres-runtime.mjs'
import {
  loadIdentityFixture,
  scoreFrozenIdentity
} from './evaluation/score-frozen-identity.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const MAX_OBSERVATIONS = 100_000

export const BOOK_IDENTITY_REPLAY_USAGE = `Usage:
  node book-analysis-identity-replay.mjs \\
    --run-id <uuid> \\
    --expected-observation-set-hash <sha256> \\
    [--start-offset <integer> --end-offset <integer>] \\
    [--generate] [--fixture <path>] [--require-pass] [--pretty]

The command reads a successful frozen resolve snapshot in a read-only transaction.
Without --generate it only runs the deterministic resolver and builds the compact
identity-reconciliation request. --generate explicitly opts in to the configured
generation service. --fixture adds strict frozen scoring without exposing the gold
fixture to either the resolver or generation service.`

function replayError(code, message) {
  return Object.assign(new Error(message), { code })
}

function requiredUuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw replayError('INVALID_ARGUMENT', `${name} must be a UUID`)
  }
  return value.toLowerCase()
}

function requiredHash(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw replayError('INVALID_ARGUMENT', `${name} must be a lowercase SHA-256`)
  }
  return value
}

function optionalOffset(value, name) {
  if (value === undefined) return null
  if (!/^\d+$/u.test(value)) {
    throw replayError('INVALID_ARGUMENT', `${name} must be a non-negative integer`)
  }
  return Number(value)
}

export function parseBookIdentityReplayArgs(argv) {
  if (!Array.isArray(argv)) throw replayError('INVALID_ARGUMENT', 'argv must be an array')
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true }
  const values = {}
  let generate = false
  let requirePass = false
  let pretty = false
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (['--generate', '--require-pass', '--pretty'].includes(name)) {
      const key = name.slice(2)
      const current = { generate, requirePass, pretty }[key]
      if (current) throw replayError('INVALID_ARGUMENT', `${name} must be specified once`)
      if (name === '--generate') generate = true
      else if (name === '--require-pass') requirePass = true
      else pretty = true
      continue
    }
    if (![
      '--run-id', '--expected-observation-set-hash', '--fixture', '--start-offset', '--end-offset'
    ].includes(name)) {
      throw replayError('INVALID_ARGUMENT', `unsupported option: ${name || '(empty)'}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw replayError('INVALID_ARGUMENT', `${name} requires a value`)
    }
    if (Object.hasOwn(values, name)) {
      throw replayError('INVALID_ARGUMENT', `${name} must be specified once`)
    }
    values[name] = value
    index += 1
  }
  const startOffset = optionalOffset(values['--start-offset'], '--start-offset')
  const endOffset = optionalOffset(values['--end-offset'], '--end-offset')
  if ((startOffset === null) !== (endOffset === null) ||
      (startOffset !== null && endOffset <= startOffset)) {
    throw replayError(
      'INVALID_ARGUMENT',
      '--start-offset and --end-offset must be provided together with end greater than start'
    )
  }
  const result = {
    help: false,
    runId: requiredUuid(values['--run-id'], '--run-id'),
    expectedObservationSetHash: requiredHash(
      values['--expected-observation-set-hash'],
      '--expected-observation-set-hash'
    ),
    generate,
    fixturePath: values['--fixture'] || null,
    requirePass,
    pretty,
    scope: startOffset === null ? null : { startOffset, endOffset }
  }
  if (result.requirePass && !result.fixturePath) {
    throw replayError('INVALID_ARGUMENT', '--require-pass requires --fixture')
  }
  if (result.generate && result.scope) {
    throw replayError('INVALID_ARGUMENT', 'offset-scoped replay cannot use --generate')
  }
  return result
}

export function scopeFrozenIdentityInput(input, scope) {
  if (!scope) return input
  const observations = input.observations.filter(({ evidence }) =>
    evidence.startOffset >= scope.startOffset && evidence.endOffset <= scope.endOffset
  )
  if (!observations.length) {
    throw replayError('EVALUATION_SCOPE_EMPTY', 'offset scope contains no frozen observations')
  }
  return {
    ...input,
    observations,
    evaluationScope: {
      ...scope,
      sourceObservationCount: input.observations.length
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

/**
 * Loads only observation ids sealed into a successful resolve snapshot. The transaction is
 * explicitly read-only so this evaluation helper cannot mutate the source run by accident.
 */
export async function loadFrozenIdentityInput(pool, {
  runId,
  expectedObservationSetHash
}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  requiredUuid(runId, 'runId')
  requiredHash(expectedObservationSetHash, 'expectedObservationSetHash')
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const stored = await client.query(
      `SELECT run.id AS run_id, run.book_edition_id,
              run.pipeline_version AS source_pipeline_version,
              run.prompt_version, run.normalized_text_hash, run.text_length,
              edition.title, edition.author,
              snapshot.id AS snapshot_id, snapshot.snapshot_version,
              snapshot.data->>'observationSetHash' AS observation_set_hash,
              snapshot.data->'observationIds' AS observation_ids
       FROM book_analysis_runs AS run
       JOIN book_editions AS edition ON edition.id = run.book_edition_id
       JOIN LATERAL (
         SELECT frozen.* FROM book_analysis_snapshots AS frozen
         WHERE frozen.run_id = run.id
         ORDER BY frozen.snapshot_version DESC
         LIMIT 1
       ) AS snapshot ON true
       WHERE run.id = $1
         AND EXISTS (
           SELECT 1 FROM book_analysis_jobs AS job
           WHERE job.run_id = run.id AND job.stage = 'resolve' AND job.status = 'ready'
         )`,
      [runId]
    )
    const source = stored.rows[0]
    if (!source) {
      throw replayError(
        'FROZEN_RESOLVE_SNAPSHOT_NOT_FOUND',
        `successful resolve snapshot was not found for run ${runId}`
      )
    }
    if (source.run_id !== runId) {
      throw replayError('RUN_ID_MISMATCH', `expected run ${runId}, received ${source.run_id}`)
    }
    if (source.observation_set_hash !== expectedObservationSetHash) {
      throw replayError(
        'OBSERVATION_SET_HASH_MISMATCH',
        `expected observation set ${expectedObservationSetHash}, received ${source.observation_set_hash}`
      )
    }
    const observationIds = source.observation_ids
    if (!Array.isArray(observationIds) || !observationIds.length ||
        observationIds.length > MAX_OBSERVATIONS) {
      throw replayError('FROZEN_OBSERVATIONS_INVALID', 'snapshot observationIds are invalid')
    }
    const observationsResult = await client.query(
      `SELECT observation.*, chunk.chapter_key
       FROM book_analysis_observations AS observation
       JOIN book_analysis_chunks AS chunk
         ON chunk.run_id = observation.run_id AND chunk.id = observation.chunk_id
       WHERE observation.run_id = $1 AND observation.id = ANY($2::uuid[])
       ORDER BY observation.evidence_start_offset,
                observation.evidence_end_offset, observation.id`,
      [runId, observationIds]
    )
    if (observationsResult.rows.length !== observationIds.length) {
      throw replayError(
        'FROZEN_OBSERVATIONS_INCOMPLETE',
        `snapshot references ${observationIds.length} observations, loaded ${observationsResult.rows.length}`
      )
    }
    await client.query('COMMIT')
    return {
      runId: source.run_id,
      bookEditionId: source.book_edition_id,
      sourcePipelineVersion: source.source_pipeline_version,
      promptVersion: source.prompt_version,
      normalizedTextHash: source.normalized_text_hash,
      textLength: Number(source.text_length),
      title: source.title,
      author: source.author,
      snapshotId: source.snapshot_id,
      snapshotVersion: Number(source.snapshot_version),
      observationSetHash: source.observation_set_hash,
      observations: observationsResult.rows.map(observationRow)
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function compactEvidence(observation) {
  return {
    id: observation.id,
    type: observation.type,
    fact: String(observation.fact || '').trim().replace(/\s+/gu, ' ').slice(0, 160),
    quote: String(observation.evidence.quote || '').trim().replace(/\s+/gu, ' ').slice(0, 240),
    startOffset: observation.evidence.startOffset
  }
}

function compactRoster(entities, observations, requestRoster = []) {
  const observationsById = new Map(observations.map((item) => [item.id, item]))
  const requestByKey = new Map(requestRoster.map((item) => [item.entityKey, item]))
  return entities
    .filter(({ entityKind }) => entityKind === 'character')
    .map((entity) => {
      const requestEntity = requestByKey.get(entity.entityKey)
      const evidence = requestEntity?.evidence ?? entity.evidenceIds
        .map((id) => observationsById.get(id))
        .filter(Boolean)
        .sort((left, right) =>
          left.evidence.startOffset - right.evidence.startOffset || compareText(left.id, right.id)
        )
        .slice(0, 2)
        .map(compactEvidence)
      return {
        entityKey: entity.entityKey,
        canonicalName: entity.canonicalName,
        aliases: [...entity.aliases].sort(compareText),
        resolutionStatus: entity.resolutionStatus,
        observationCount: Number(entity.data.observationCount),
        evidence
      }
    })
    .sort((left, right) =>
      compareText(left.canonicalName.toLocaleLowerCase('ru-RU'),
        right.canonicalName.toLocaleLowerCase('ru-RU')) ||
      compareText(left.entityKey, right.entityKey)
    )
}

function pairEntity(entityKey, provisionalByKey) {
  const entity = provisionalByKey.get(entityKey)
  return {
    entityKey,
    canonicalName: entity?.canonicalName ?? ''
  }
}

export function summarizeAppliedIdentityMerges({ provisional, final, acceptedMerges }) {
  const finalEvidenceOwners = new Map()
  for (const entity of final) {
    for (const evidenceId of entity.evidenceIds) {
      const owners = finalEvidenceOwners.get(evidenceId) ?? new Set()
      owners.add(entity.entityKey)
      finalEvidenceOwners.set(evidenceId, owners)
    }
  }
  const finalOwner = new Map()
  for (const entity of provisional) {
    const ownerSets = entity.evidenceIds
      .map((id) => finalEvidenceOwners.get(id) ?? new Set())
      .filter((owners) => owners.size)
    const intersection = ownerSets.length
      ? [...ownerSets[0]].filter((key) => ownerSets.every((owners) => owners.has(key)))
      : []
    if (intersection.length === 1) finalOwner.set(entity.entityKey, intersection[0])
  }
  return acceptedMerges.map((merge) => ({
    ...merge,
    applied: finalOwner.has(merge.leftEntityKey) &&
      finalOwner.get(merge.leftEntityKey) === finalOwner.get(merge.rightEntityKey)
  }))
}

export async function replayBookIdentity({ input, generator = null }) {
  const provisional = resolveBookAnalysisEntities({ observations: input.observations })
  const request = buildBookIdentityReconciliationRequest({
    runId: input.runId,
    bookEditionId: input.bookEditionId,
    pipelineVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    reconciliationVersion: BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
    observationSetHash: input.observationSetHash,
    title: input.title,
    author: input.author,
    entities: provisional,
    observations: input.observations
  })
  let proposedMerges = []
  let acceptedMerges = []
  let final = provisional
  if (generator) {
    if (!request) {
      throw replayError(
        'IDENTITY_RECONCILIATION_REQUEST_UNAVAILABLE',
        'identity reconciliation request is unavailable for this frozen input'
      )
    }
    const proposed = await generator.reconcileBookCharacterIdentities(request)
    proposedMerges = Array.isArray(proposed?.merges) ? proposed.merges : []
    acceptedMerges = validateBookIdentityMerges({ request, proposedMerges })
    if (acceptedMerges.length) {
      final = resolveBookAnalysisEntities({
        observations: input.observations,
        identityMerges: acceptedMerges
      })
    }
  }
  const appliedMerges = summarizeAppliedIdentityMerges({
    provisional,
    final,
    acceptedMerges
  })
  const provisionalByKey = new Map(provisional.map((entity) => [entity.entityKey, entity]))
  const pairs = appliedMerges.map((merge) => ({
    left: pairEntity(merge.leftEntityKey, provisionalByKey),
    right: pairEntity(merge.rightEntityKey, provisionalByKey),
    basis: merge.basis,
    evidenceIds: merge.evidenceIds,
    status: merge.applied ? 'applied' : 'blocked'
  }))
  const provisionalCharacters = provisional.filter(({ entityKind }) => entityKind === 'character')
  const finalCharacters = final.filter(({ entityKind }) => entityKind === 'character')
  return {
    schemaVersion: 1,
    run: {
      id: input.runId,
      bookEditionId: input.bookEditionId,
      title: input.title,
      author: input.author,
      sourcePipelineVersion: input.sourcePipelineVersion,
      promptVersion: input.promptVersion
    },
    frozenInput: {
      snapshotId: input.snapshotId,
      snapshotVersion: input.snapshotVersion,
      observationSetHash: input.observationSetHash,
      observationCount: input.observations.length,
      ...(input.evaluationScope ? {
        sourceObservationCount: input.evaluationScope.sourceObservationCount,
        evaluationScope: {
          startOffset: input.evaluationScope.startOffset,
          endOffset: input.evaluationScope.endOffset
        }
      } : {})
    },
    engine: {
      pipelineVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
      reconciliationVersion: BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION
    },
    reconciliation: {
      generated: Boolean(generator),
      requestAvailable: Boolean(request),
      requestBytes: request ? Buffer.byteLength(JSON.stringify(request)) : 0,
      rosterCount: request?.roster.length ?? 0,
      candidatePairCount: request?.candidatePairs.length ?? 0,
      forbiddenPairCount: request?.forbiddenPairs.length ?? 0,
      proposedCount: proposedMerges.length,
      workerAcceptedCount: acceptedMerges.length,
      appliedCount: pairs.filter(({ status }) => status === 'applied').length,
      blockedCount: pairs.filter(({ status }) => status === 'blocked').length,
      pairs
    },
    provisional: {
      entityCount: provisional.length,
      characterCount: provisionalCharacters.length,
      roster: compactRoster(provisional, input.observations, request?.roster)
    },
    final: {
      entityCount: final.length,
      characterCount: finalCharacters.length,
      roster: compactRoster(final, input.observations)
    }
  }
}

export async function runBookIdentityReplayCli({ argv, env = process.env, stdout = process.stdout }) {
  const options = parseBookIdentityReplayArgs(argv)
  if (options.help) {
    stdout.write(`${BOOK_IDENTITY_REPLAY_USAGE}\n`)
    return null
  }
  const pool = await createPostgresPoolFromEnv(env)
  try {
    const frozenInput = await loadFrozenIdentityInput(pool, options)
    const input = scopeFrozenIdentityInput(frozenInput, options.scope)
    const generator = options.generate
      ? createGenerationServiceClient({
          baseUrl: env.GENERATOR_BASE_URL,
          token: env.GENERATOR_SERVICE_TOKEN,
          timeoutMs: Number(env.GENERATOR_TIMEOUT_MS || 300_000)
        })
      : null
    const result = await replayBookIdentity({ input, generator })
    if (options.fixturePath) {
      const fixture = await loadIdentityFixture(options.fixturePath)
      result.score = scoreFrozenIdentity({ fixture, input: result })
    }
    stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`)
    if (options.requirePass && !result.score.gate.passed) {
      throw replayError('IDENTITY_QUALITY_GATE_FAILED', 'frozen identity quality gate failed')
    }
    return result
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBookIdentityReplayCli({ argv: process.argv.slice(2) }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
      message: error?.message || 'identity replay failed'
    })}\n`)
    process.exitCode = 1
  })
}
