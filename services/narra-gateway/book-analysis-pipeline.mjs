import {
  BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_PIPELINE_VERSION,
  BOOK_ANALYSIS_PROMPT_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION,
  BOOK_ANALYSIS_SYNTHESIS_VERSION
} from './book-analysis-contracts.mjs'
import {
  buildBookIdentityReconciliationRequest,
  validateBookIdentityMerges
} from './book-analysis-identity-reconciliation.mjs'
import { selectCharacterSynthesisEvidence } from './book-analysis-synthesis.mjs'

export const BOOK_ANALYSIS_PIPELINE_NARRA = 'narra'
export const BOOK_ANALYSIS_PIPELINE_EXTERNAL = 'external'
export const BOOK_ANALYSIS_PIPELINE_IDS = Object.freeze([
  BOOK_ANALYSIS_PIPELINE_NARRA,
  BOOK_ANALYSIS_PIPELINE_EXTERNAL
])

export const BOOK_ANALYSIS_NORMALIZATION_VERSION = 'normalized-text-v1'
export const EXTERNAL_ADAPTER_CONTRACT_VERSION = 'autiobook-adapter-v1'
export const EXTERNAL_UPSTREAM_REVISION = 'd532bdd0a15f2948fd0c99f5e11b92677cb5c3eb'
export const EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION =
  'external-autiobook-v1.d532bdd0'
export const EXTERNAL_EVIDENCE_PROFILE_VERSION = 'external-evidence-profile-v1'

const PIPELINE_IDS = new Set(BOOK_ANALYSIS_PIPELINE_IDS)

function pipelineInputError(message) {
  return Object.assign(new TypeError(message), { code: 'INVALID_ARGUMENT' })
}

export function normalizeBookAnalysisPipelineId(value, name = 'pipeline') {
  const normalized = String(value || '').trim().toLowerCase()
  if (!PIPELINE_IDS.has(normalized)) {
    throw pipelineInputError(`${name} must be one of: ${BOOK_ANALYSIS_PIPELINE_IDS.join(', ')}`)
  }
  return normalized
}

export function bookAnalysisPipelineFromEnv(env = process.env) {
  return normalizeBookAnalysisPipelineId(
    env.BOOK_ANALYSIS_PIPELINE || BOOK_ANALYSIS_PIPELINE_NARRA,
    'BOOK_ANALYSIS_PIPELINE'
  )
}

function narraScanJobs(chunks) {
  return chunks.map((chunk) => ({
    shardKey: `chunk:${chunk.ordinal}`,
    chunkId: chunk.id,
    payload: { chunkOrdinal: chunk.ordinal }
  }))
}

function externalScanJobs(chunks) {
  return [{
    shardKey: 'pipeline:external',
    chunkId: chunks[0].id,
    payload: { scope: 'book' }
  }]
}

async function reconcileNarraIdentities({
  input,
  entities,
  generator,
  reconciliationVersion,
  resolveEntities,
  log
}) {
  if (!generator) return { entities, acceptedIdentityMerges: [] }
  const request = buildBookIdentityReconciliationRequest({
    ...input,
    entities,
    pipelineVersion: input.pipelineVersion,
    reconciliationVersion
  })
  if (!request) {
    log?.warn('resolve.identity_skipped', 'Глобальная сверка имён пропущена из-за лимитов', {
      run: input.runId,
      pipeline_id: input.pipelineId,
      character_count: entities.filter(({ entityKind }) => entityKind === 'character').length
    })
    return { entities, acceptedIdentityMerges: [] }
  }
  const proposed = await generator.reconcileBookCharacterIdentities(request)
  const acceptedIdentityMerges = validateBookIdentityMerges({
    request,
    proposedMerges: proposed.merges
  })
  const reconciled = acceptedIdentityMerges.length
    ? await resolveEntities({
        observations: input.observations,
        identityMerges: acceptedIdentityMerges
      })
    : entities
  log?.info('resolve.identity_reconciled', 'Имена персонажей сверены по всей книге', {
    run: input.runId,
    pipeline_id: input.pipelineId,
    proposed_merge_count: proposed.merges.length,
    accepted_merge_count: acceptedIdentityMerges.length
  })
  return { entities: reconciled, acceptedIdentityMerges }
}

async function reconcileExternalIdentities({ input, entities }) {
  const dialogueEvidenceIds = new Set((input?.observations ?? [])
    .filter(({ type }) => type === 'character_dialogue')
    .map(({ id }) => id))
  return {
    entities: entities.map((entity) =>
      entity.entityKind === 'character' &&
      entity.resolutionStatus !== 'rejected' &&
      entity.evidenceIds.some((id) => dialogueEvidenceIds.has(id))
        ? { ...entity, resolutionStatus: 'confirmed' }
        : entity
    ),
    acceptedIdentityMerges: []
  }
}

function narraProfileRequest(input) {
  const selectedEvidence = selectCharacterSynthesisEvidence(input.observations).map((observation) => ({
    id: observation.id,
    type: observation.type,
    fact: observation.fact,
    quote: observation.evidence.quote,
    startOffset: observation.evidence.startOffset,
    endOffset: observation.evidence.endOffset,
    confidence: observation.confidence
  }))
  return {
    selectedEvidence,
    entity: {
      entityKey: input.entity.entityKey,
      entityKind: input.entity.entityKind,
      canonicalName: input.entity.canonicalName,
      aliases: input.entity.aliases.slice(0, 16),
      resolutionStatus: input.entity.resolutionStatus,
      confidence: input.entity.confidence,
      evidenceIds: selectedEvidence.map(({ id }) => id),
      data: {
        observationCount: input.entity.data.observationCount,
        firstEvidenceStartOffset: input.entity.data.firstEvidenceStartOffset,
        lastEvidenceEndOffset: input.entity.data.lastEvidenceEndOffset
      }
    }
  }
}

async function synthesizeNarraCharacter({ input, generator, synthesisVersion }) {
  const request = narraProfileRequest(input)
  const generated = await generator.synthesizeCharacterProfile({
    runId: input.runId,
    snapshotId: input.snapshot.id,
    synthesisVersion,
    bookTitle: input.title,
    bookAuthor: input.author,
    textLength: input.textLength,
    entity: request.entity,
    evidence: request.selectedEvidence
  })
  return {
    synthesisVersion,
    selectedEvidenceIds: request.selectedEvidence.map(({ id }) => id),
    profile: generated.profile
  }
}

export function createExternalEvidenceOnlyCharacterProfile(observations) {
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array')
  const dialogue = observations
    .filter((observation) =>
      observation?.type === 'character_dialogue' &&
      typeof observation?.evidence?.quote === 'string' &&
      observation.evidence.quote.length <= 4_000
    )
    .slice(0, 3)
  if (!dialogue.length) {
    throw Object.assign(new Error('external character has no exact dialogue evidence'), {
      code: 'SYNTHESIS_EVIDENCE_MISSING'
    })
  }
  return {
    synthesisVersion: EXTERNAL_EVIDENCE_PROFILE_VERSION,
    selectedEvidenceIds: dialogue.map(({ id }) => id),
    profile: {
      role: null,
      age: null,
      gender: null,
      description: null,
      traits: [],
      appearance: [],
      speechStyle: null,
      speechExamples: dialogue.map((observation) => ({
        value: observation.evidence.quote,
        evidenceIds: [observation.id],
        confidence: observation.confidence
      })),
      creative: { greeting: '', appearancePrompt: '', voice: '' }
    }
  }
}

async function synthesizeExternalCharacter({ input }) {
  return createExternalEvidenceOnlyCharacterProfile(input.observations)
}

const STRATEGIES = new Map([
  [BOOK_ANALYSIS_PIPELINE_NARRA, Object.freeze({
    id: BOOK_ANALYSIS_PIPELINE_NARRA,
    implementationVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    orchestrationVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    extractorVersion: BOOK_ANALYSIS_PROMPT_VERSION,
    synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION,
    reconciliationVersion: BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
    normalizationVersion: BOOK_ANALYSIS_NORMALIZATION_VERSION,
    outputSchemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    scanScope: 'chunk',
    createScanJobs: narraScanJobs,
    reconcileIdentities: reconcileNarraIdentities,
    synthesizeCharacter: synthesizeNarraCharacter,
    quality: Object.freeze({ requireTextCoverage: true })
  })],
  [BOOK_ANALYSIS_PIPELINE_EXTERNAL, Object.freeze({
    id: BOOK_ANALYSIS_PIPELINE_EXTERNAL,
    implementationVersion: EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION,
    orchestrationVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    extractorVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
    synthesisVersion: EXTERNAL_EVIDENCE_PROFILE_VERSION,
    reconciliationVersion: 'none',
    normalizationVersion: BOOK_ANALYSIS_NORMALIZATION_VERSION,
    outputSchemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    scanScope: 'book',
    createScanJobs: externalScanJobs,
    reconcileIdentities: reconcileExternalIdentities,
    synthesizeCharacter: synthesizeExternalCharacter,
    quality: Object.freeze({ requireTextCoverage: false })
  })]
])

export function getBookAnalysisPipeline(value) {
  return STRATEGIES.get(normalizeBookAnalysisPipelineId(value))
}

export function bookAnalysisPipelineForRun(run) {
  const strategy = getBookAnalysisPipeline(run?.pipelineId ?? BOOK_ANALYSIS_PIPELINE_NARRA)
  const mismatches = [
    ['implementation', run?.pipelineImplementationVersion, strategy.implementationVersion],
    ['normalization', run?.normalizationVersion, strategy.normalizationVersion],
    ['schema', run?.outputSchemaVersion, strategy.outputSchemaVersion]
  ].filter(([, actual, expected]) => actual != null && actual !== expected)
  if (mismatches.length) {
    const error = new Error(
      `analysis run requires unsupported ${mismatches.map(([name]) => name).join(', ')} version`
    )
    error.code = 'PIPELINE_VERSION_UNSUPPORTED'
    throw error
  }
  return strategy
}

export function bookAnalysisPipelineCacheKey({
  pipelineId,
  contentHash,
  orchestrationVersion,
  extractorVersion,
  implementationVersion,
  normalizationVersion = BOOK_ANALYSIS_NORMALIZATION_VERSION,
  outputSchemaVersion = BOOK_ANALYSIS_SCHEMA_VERSION
}) {
  const strategy = getBookAnalysisPipeline(pipelineId)
  return [
    'book-analysis-cache',
    strategy.id,
    implementationVersion ?? strategy.implementationVersion,
    contentHash,
    orchestrationVersion ?? strategy.orchestrationVersion,
    extractorVersion ?? strategy.extractorVersion,
    normalizationVersion,
    `schema-${outputSchemaVersion}`,
    BOOK_ANALYSIS_MARKUP_VERSION
  ].join(':')
}

export function bookAnalysisPublicationProvenance(run) {
  const strategy = getBookAnalysisPipeline(run.pipelineId)
  return {
    pipelineId: strategy.id,
    pipelineImplementationVersion: run.pipelineImplementationVersion,
    orchestrationVersion: run.pipelineVersion,
    extractorVersion: run.promptVersion,
    normalizationVersion: run.normalizationVersion,
    schemaVersion: run.outputSchemaVersion,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    sourceContentHash: run.inputHash,
    normalizedTextHash: run.normalizedTextHash
  }
}
