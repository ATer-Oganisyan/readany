import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assembleBookMarkupV3 } from '../book-analysis-assembler.mjs'
import {
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION,
  normalizeBookAnalysisCharacterProfile
} from '../book-analysis-contracts.mjs'
import {
  createBookAnalysisExternalWorker,
  normalizeExternalBookObservations
} from '../book-analysis-external-worker.mjs'
import {
  BOOK_ANALYSIS_PIPELINE_EXTERNAL,
  BOOK_ANALYSIS_PIPELINE_NARRA,
  EXTERNAL_ADAPTER_CONTRACT_VERSION,
  bookAnalysisPipelineForRun,
  bookAnalysisPipelineCacheKey,
  bookAnalysisPipelineFromEnv,
  createExternalEvidenceOnlyCharacterProfile,
  getBookAnalysisPipeline
} from '../book-analysis-pipeline.mjs'
import { resolveBookAnalysisEntities } from '../book-analysis-resolver.mjs'
import { validateBookMarkupV3 } from '../book-analysis-validator.mjs'
import { compareBookAnalysisPipelines } from '../evaluation/compare-book-analysis-pipelines.mjs'
import { createExternalBookAdapterClient } from '../external-book-adapter-client.mjs'

const quietLogger = { info() {}, warn() {}, error() {} }

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function contentHash(value) {
  return hash(JSON.stringify(canonical(value)))
}

test('pipeline registry defaults to narra and rejects unknown selectors', () => {
  assert.equal(bookAnalysisPipelineFromEnv({}), BOOK_ANALYSIS_PIPELINE_NARRA)
  assert.equal(
    bookAnalysisPipelineFromEnv({ BOOK_ANALYSIS_PIPELINE: 'external' }),
    BOOK_ANALYSIS_PIPELINE_EXTERNAL
  )
  assert.throws(
    () => bookAnalysisPipelineFromEnv({ BOOK_ANALYSIS_PIPELINE: 'fallback' }),
    (error) => error.code === 'INVALID_ARGUMENT'
  )
})

test('both adapters implement one strategy contract without sharing scan topology', () => {
  const chunks = [
    { id: 'chunk-1', ordinal: 0 },
    { id: 'chunk-2', ordinal: 1 }
  ]
  const narra = getBookAnalysisPipeline('narra')
  const external = getBookAnalysisPipeline('external')
  for (const strategy of [narra, external]) {
    assert.equal(typeof strategy.createScanJobs, 'function')
    assert.equal(typeof strategy.reconcileIdentities, 'function')
    assert.equal(typeof strategy.synthesizeCharacter, 'function')
    assert.equal(strategy.outputSchemaVersion, 3)
    assert.equal(strategy.analysisVersion, 'book-markup-v3')
  }
  assert.equal(narra.createScanJobs(chunks).length, 2)
  assert.deepEqual(external.createScanJobs(chunks), [{
    shardKey: 'pipeline:external', chunkId: 'chunk-1', payload: { scope: 'book' }
  }])
})

test('worker strategy selection fails closed on changed durable versions', () => {
  assert.equal(bookAnalysisPipelineForRun({ pipelineId: 'narra' }).id, 'narra')
  assert.throws(
    () => bookAnalysisPipelineForRun({
      pipelineId: 'external',
      pipelineImplementationVersion: 'external-autiobook-v2.changed'
    }),
    (error) => error.code === 'PIPELINE_VERSION_UNSUPPORTED'
  )
})

test('narra and external cache identities are disjoint for the same content hash', () => {
  const contentHash = 'a'.repeat(64)
  const narra = bookAnalysisPipelineCacheKey({ pipelineId: 'narra', contentHash })
  const external = bookAnalysisPipelineCacheKey({ pipelineId: 'external', contentHash })
  assert.notEqual(narra, external)
  assert.match(narra, /narra:book-analysis-v50/)
  assert.match(external, /external:external-autiobook-v1\.d532bdd0/)
  assert.match(external, /normalized-text-v1:schema-3:book-markup-v3/)
})

test('external resolve and synthesis never call the narra generator', async () => {
  const external = getBookAnalysisPipeline('external')
  const entities = [{ entityKey: 'character:larisa' }]
  const reconciled = await external.reconcileIdentities({
    input: { observations: [] },
    entities,
    generator: {
      async reconcileBookCharacterIdentities() {
        assert.fail('external resolve must not call the narra identity LLM')
      }
    }
  })
  assert.deepEqual(reconciled.entities, entities)
  const profile = await external.synthesizeCharacter({
    input: {
      observations: [{
        id: 'evidence-1', type: 'character_dialogue', confidence: 0.99,
        evidence: { quote: 'Точная реплика.' }
      }]
    },
    generator: {
      async synthesizeCharacterProfile() {
        assert.fail('external synthesis must not call the narra profile LLM')
      }
    }
  })
  assert.equal(profile.profile.description, null)
  assert.equal(profile.profile.speechExamples[0].value, 'Точная реплика.')
})

test('external worker independently verifies evidence and has no narra fallback', async () => {
  const source = 'А😀 Лариса сказала: «Привет».'
  const quote = 'Привет'
  const sourceSha256 = hash(source)
  const strategy = getBookAnalysisPipeline('external')
  let completed
  let fallbackCalls = 0
  const job = {
    id: 'scan-1', runId: 'run-external', pipelineId: 'external',
    pipelineImplementationVersion: strategy.implementationVersion,
    sourceHash: 'b'.repeat(64), leaseToken: 'lease'
  }
  const repository = {
    async claimAnalysisJob(_workerId, options) {
      assert.deepEqual(options.pipelineIds, ['external'])
      return job
    },
    async getExternalScanInput() {
      return {
        runId: job.runId,
        pipelineId: 'external',
        pipelineImplementationVersion: strategy.implementationVersion,
        extractorVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
        normalizationVersion: 'normalized-text-v1',
        outputSchemaVersion: 3,
        normalizedTextObjectKey: 'normalized.txt',
        normalizedTextHash: sourceSha256,
        textLength: source.length
      }
    },
    async completeExternalScan(_job, value) {
      completed = value
      return { stage: 'resolve' }
    },
    async renewAnalysisJobLease() {},
    async failAnalysisJob() { assert.fail('valid external result must not fail') },
    async completeScan() { fallbackCalls += 1 }
  }
  const worker = createBookAnalysisExternalWorker({
    repository,
    storage: { async getBytes() { return { bytes: Buffer.from(source) } } },
    adapter: {
      async analyzeBook() {
        const startOffset = source.indexOf(quote)
        return {
          sourceSha256,
          extractorVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
          observations: [{
            observationKey: `obs:${'a'.repeat(48)}`,
            type: 'character_dialogue', entityKind: 'character',
            entityCandidate: 'Лариса', relatedEntityCandidates: [],
            fact: 'Реплика персонажа Лариса.',
            evidence: {
              quote, startOffset, endOffset: startOffset + quote.length,
              offsetEncoding: 'utf-16'
            },
            confidence: 0.99
          }, {
            observationKey: `obs:${'c'.repeat(48)}`,
            type: 'character_dialogue', entityKind: 'character',
            entityCandidate: 'Переписанный персонаж', relatedEntityCandidates: [],
            fact: 'Эта реплика не совпадает с источником.',
            evidence: {
              quote: 'Переписанный текст', startOffset: 0, endOffset: 4,
              offsetEncoding: 'utf-16'
            },
            confidence: 0.99
          }]
        }
      }
    },
    workerId: 'external-worker-1',
    leaseSeconds: 60,
    leaseRenewMs: 1_000,
    logger: quietLogger
  })
  assert.equal((await worker.runOnce()).status, 'completed')
  assert.equal(completed.observations.length, 1)
  assert.equal(completed.observations[0].evidence.quote, quote)
  assert.equal(fallbackCalls, 0)
})

test('external HTTP adapter client binds auth, source and pipeline cache identity', async () => {
  const source = 'Лариса: Привет.'
  const sourceSha256 = hash(source)
  let request
  const client = createExternalBookAdapterClient({
    baseUrl: 'http://127.0.0.1:8080',
    token: 'external-adapter-test-token-0000000001',
    production: false,
    async fetchImpl(_url, options) {
      request = options
      return new Response(JSON.stringify({
        contractVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
        provider: {
          name: 'autiobook',
          upstreamRevision: 'd532bdd0a15f2948fd0c99f5e11b92677cb5c3eb',
          model: 'test-model',
          castChunkWords: 1500,
          castOverlapWords: 400,
          revise: false
        },
        extractorVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
        sourceSha256,
        observations: [],
        diagnostics: {
          rawCharacters: 0,
          usedCharacters: 0,
          alignedSegments: 0,
          exactDialogueSegments: 0,
          droppedSegments: 0,
          unmappedSpeakers: 0,
          groundedAliases: 0
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  await client.analyzeBook({
    runId: 'run-external',
    text: source,
    sourceSha256,
    normalizationVersion: 'normalized-text-v1',
    outputSchemaVersion: 3
  })
  const body = JSON.parse(request.body)
  assert.match(request.headers.authorization, /^Bearer /)
  assert.match(body.idempotencyKey, /external:external-autiobook-v1\.d532bdd0/)
  assert.match(body.idempotencyKey, new RegExp(sourceSha256))
  assert.match(body.idempotencyKey, /normalized-text-v1:schema-3$/)
  assert.deepEqual(body.source, { text: source, sha256: sourceSha256 })
  assert.doesNotThrow(() => createExternalBookAdapterClient({
    baseUrl: 'http://autiobook-adapter.railway.internal:8080',
    token: 'external-adapter-test-token-0000000001',
    production: true,
    async fetchImpl() { assert.fail('constructor must not call the adapter') }
  }))
})

test('checked-in external OpenAPI freezes exact evidence and pinned upstream', async () => {
  const spec = await readFile(
    new URL('../../autiobook-adapter/openapi.yaml', import.meta.url),
    'utf8'
  )
  assert.match(spec, /version: autiobook-adapter-v1/)
  assert.match(spec, /\/internal\/v1\/analyze:/)
  assert.match(spec, /enum: \[character_dialogue, character_alias\]/)
  assert.match(spec, /const: utf-16/)
  assert.match(spec, /d532bdd0a15f2948fd0c99f5e11b92677cb5c3eb/)
})

test('external observations pass the common v3 schema and evidence validator', async () => {
  const normalizedText = 'Лариса: Привет.'
  const startOffset = normalizedText.indexOf('Привет.')
  const [normalized] = normalizeExternalBookObservations([{
    observationKey: `obs:${'b'.repeat(48)}`,
    type: 'character_dialogue', entityKind: 'character',
    entityCandidate: 'Лариса', relatedEntityCandidates: [],
    fact: 'Реплика персонажа Лариса.',
    evidence: {
      quote: 'Привет.', startOffset, endOffset: startOffset + 7,
      offsetEncoding: 'utf-16'
    },
    confidence: 0.99
  }], normalizedText)
  const observation = {
    id: '11111111-1111-4111-8111-111111111111',
    chunkId: 'chunk-1',
    sourceJobId: 'job-1',
    extractorVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
    ...normalized,
    evidence: { ...normalized.evidence, chapterKey: 'book' },
    data: {}
  }
  const entities = resolveBookAnalysisEntities({ observations: [observation] })
  assert.equal(entities.length, 1)
  const externalEntities = await getBookAnalysisPipeline('external').reconcileIdentities({
    input: { observations: [observation] },
    entities
  })
  const [resolvedEntity] = externalEntities.entities
  assert.equal(resolvedEntity.resolutionStatus, 'confirmed')
  const entity = { id: '22222222-2222-4222-8222-222222222222', ...resolvedEntity }
  const snapshotData = {
    schemaVersion: 1,
    observationSetHash: contentHash([observation]),
    entitySetHash: contentHash([resolvedEntity]),
    observationIds: [observation.id],
    entities: [entity]
  }
  const snapshot = {
    id: '33333333-3333-4333-8333-333333333333',
    contentHash: contentHash(snapshotData),
    evidenceCount: 1,
    data: snapshotData
  }
  const profile = normalizeBookAnalysisCharacterProfile(
    createExternalEvidenceOnlyCharacterProfile([observation]).profile,
    { entity, textLength: normalizedText.length }
  )
  const markup = assembleBookMarkupV3({
    snapshotId: snapshot.id,
    textLength: normalizedText.length,
    entities: [entity],
    observations: [observation],
    characterProfiles: [profile]
  })
  const report = validateBookMarkupV3({
    markup,
    snapshot,
    observations: [observation],
    normalizedText,
    normalizedTextHash: hash(normalizedText)
  })
  assert.equal(report.valid, true, JSON.stringify(report.errors))
  assert.equal(markup.schemaVersion, BOOK_ANALYSIS_SCHEMA_VERSION)
  assert.equal(markup.analysisVersion, BOOK_ANALYSIS_MARKUP_VERSION)
})

function comparisonMarkup(characterName) {
  return {
    schemaVersion: 3,
    analysisVersion: 'book-markup-v3',
    snapshotId: 'snapshot-1',
    textLength: 100,
    characters: [{
      characterKey: 'character:fixture',
      name: characterName,
      fullName: characterName,
      aliases: [],
      identityEvidenceIds: ['evidence-1'],
      firstAppearanceTextOffset: 10,
      warmupTextOffset: 0,
      role: null, age: null, gender: null, description: null,
      traits: [], appearance: [], speechStyle: null, speechExamples: [],
      creative: { greeting: '', appearancePrompt: '', voice: '' }
    }],
    locations: [], events: [], relationships: [], storyArcs: []
  }
}

test('side-by-side evaluation applies one golden scorer to two independent runs', () => {
  const sourceContentHash = 'c'.repeat(64)
  const fixture = {
    schemaVersion: 1,
    id: 'tiny-larisa-v1',
    characters: [{
      id: 'larisa', name: 'Лариса', aliases: [], mentionCount: 1, significant: true
    }],
    gates: { precision: 0, recall: 0, f1: 0, criticalMerges: 0, duplicateRate: 1 }
  }
  const results = ['narra', 'external'].map((pipelineId, index) => {
    const strategy = getBookAnalysisPipeline(pipelineId)
    const run = {
      id: `run-${pipelineId}`,
      pipelineId,
      pipelineImplementationVersion: strategy.implementationVersion,
      inputHash: sourceContentHash
    }
    return {
      run,
      publication: {
        id: `publication-${pipelineId}`,
        runId: run.id,
        data: {
          provenance: {
            pipelineId,
            pipelineImplementationVersion: strategy.implementationVersion,
            sourceContentHash
          },
          markup: comparisonMarkup(index === 0 ? 'Лариса' : 'Неизвестный')
        }
      }
    }
  })
  const comparison = compareBookAnalysisPipelines({ fixture, results })
  assert.equal(comparison.sourceContentHash, sourceContentHash)
  assert.equal(comparison.scores.narra.metrics.full.recall, 1)
  assert.equal(comparison.scores.external.metrics.full.recall, 0)
  assert.notEqual(comparison.scores.narra.runId, comparison.scores.external.runId)
})
