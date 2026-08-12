import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createBookAnalysisPublishWorker } from '../book-analysis-publish-worker.mjs'
import { createBookAnalysisSynthesizeWorker } from '../book-analysis-synthesize-worker.mjs'
import { createBookAnalysisValidateWorker } from '../book-analysis-validate-worker.mjs'

const leaseToken = '11111111-1111-4111-8111-111111111111'
const job = {
  id: 'job-1', runId: 'run-1', stage: 'synthesize', shardKey: 'character:anna', leaseToken
}
const quietLogger = { info() {}, error() {} }

test('synthesize workers isolate one character and send only selected evidence to the model', async () => {
  const observations = Array.from({ length: 300 }, (_, index) => ({
    id: `observation-${index}`,
    type: 'character_action',
    fact: `Факт ${index}`,
    evidence: { quote: `цитата ${index}`, startOffset: index * 20, endOffset: index * 20 + 8 },
    confidence: 0.9
  }))
  let modelInput
  let completion
  const repository = {
    async claimAnalysisJob() { return job },
    async getSynthesizeInput() {
      return {
        mode: 'character_profile', runId: 'run-1', title: 'Книга', author: 'Автор',
        textLength: 10_000,
        snapshot: { id: 'snapshot-1' },
        entity: {
          id: 'database-only-id',
          entityKey: 'character:anna', entityKind: 'character', canonicalName: 'Анна',
          aliases: [], resolutionStatus: 'confirmed', confidence: 0.9,
          evidenceIds: observations.map(({ id }) => id),
          data: { firstEvidenceStartOffset: 0 }
        },
        observations
      }
    },
    async completeCharacterSynthesis(_job, value) {
      completion = value
      return { artifactId: 'artifact-1', stage: 'synthesize' }
    },
    async renewAnalysisJobLease() {},
    async failAnalysisJob() { throw new Error('unexpected failure') }
  }
  const worker = createBookAnalysisSynthesizeWorker({
    repository,
    generator: {
      async synthesizeCharacterProfile(input) {
        modelInput = input
        return { profile: { creative: {} } }
      }
    },
    workerId: 'synthesis-worker-1',
    leaseSeconds: 60,
    leaseRenewMs: 1_000,
    logger: quietLogger
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.ok(modelInput.evidence.length <= 240)
  assert.deepEqual(modelInput.entity.evidenceIds, modelInput.evidence.map(({ id }) => id))
  assert.equal(Object.hasOwn(modelInput.entity, 'id'), false)
  assert.deepEqual(completion.selectedEvidenceIds, modelInput.entity.evidenceIds)
})

test('validate and publish workers keep publication behind an independent valid report', async () => {
  const text = 'Анна'
  const observationId = '22222222-2222-4222-8222-222222222222'
  const snapshotData = {
    schemaVersion: 1,
    observationSetHash: '',
    entitySetHash: '',
    observationIds: [observationId],
    entities: [{
      entityKey: 'character:anna', entityKind: 'character', canonicalName: 'Анна', aliases: [],
      resolutionStatus: 'confirmed', evidenceIds: [observationId]
    }]
  }
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const validationObservations = [{
    id: observationId, type: 'character_mention',
    evidence: { quote: text, startOffset: 0, endOffset: text.length }
  }]
  snapshotData.observationSetHash = hash(JSON.stringify(canonical(validationObservations)))
  snapshotData.entitySetHash = hash(JSON.stringify(canonical(snapshotData.entities)))
  const snapshot = {
    id: 'snapshot-1', evidenceCount: 1, data: snapshotData,
    contentHash: hash(JSON.stringify(canonical(snapshotData)))
  }
  const markup = {
    schemaVersion: 3, analysisVersion: 'book-markup-v3', snapshotId: 'snapshot-1',
    textLength: text.length,
    characters: [{
      characterKey: 'character:anna', name: 'Анна', fullName: 'Анна', aliases: [],
      identityEvidenceIds: [observationId], firstAppearanceTextOffset: 0, warmupTextOffset: 0,
      role: null, age: null, gender: null, description: null, traits: [], appearance: [],
      speechStyle: null, speechExamples: [], creative: { greeting: '', appearancePrompt: '', voice: '' }
    }],
    locations: [], events: [], relationships: [], storyArcs: []
  }
  const markupContentHash = hash(JSON.stringify(canonical(markup)))
  let report
  const validateRepository = {
    async claimAnalysisJob() {
      return { ...job, id: 'validate-1', stage: 'validate', shardKey: 'book' }
    },
    async getValidationInput() {
      return {
        normalizedTextObjectKey: 'normalized.txt', normalizedTextHash: hash(text),
        snapshot, artifact: { id: 'artifact-1', contentHash: markupContentHash, data: markup },
        observations: validationObservations
      }
    },
    async completeValidation(_job, value) {
      report = value.report
      return { reportId: 'report-1', stage: 'publish' }
    },
    async renewAnalysisJobLease() {},
    async failAnalysisJob() { throw new Error('unexpected failure') }
  }
  const validateWorker = createBookAnalysisValidateWorker({
    repository: validateRepository,
    storage: { async getBytes() { return { bytes: Buffer.from(text) } } },
    workerId: 'validate-worker-1', leaseSeconds: 60, leaseRenewMs: 1_000,
    logger: quietLogger
  })
  assert.equal((await validateWorker.runOnce()).status, 'completed')
  assert.equal(report.valid, true)
  assert.deepEqual(report.bindings, {
    snapshotId: 'snapshot-1',
    snapshotContentHash: snapshot.contentHash,
    normalizedTextHash: hash(text),
    markupArtifactId: 'artifact-1',
    markupContentHash
  })

  let publishedArtifactId
  const publishWorker = createBookAnalysisPublishWorker({
    repository: {
      async claimAnalysisJob() {
        return { ...job, id: 'publish-1', stage: 'publish', shardKey: 'shadow' }
      },
      async getPublishInput() {
        return { channel: 'shadow', artifact: { id: 'artifact-1' }, validationReport: report }
      },
      async completeShadowPublish(_job, { artifactId }) {
        publishedArtifactId = artifactId
        return { publicationId: 'publication-1', channel: 'shadow', status: 'ready' }
      },
      async renewAnalysisJobLease() {},
      async failAnalysisJob() { throw new Error('unexpected failure') }
    },
    workerId: 'publish-worker-1', leaseSeconds: 60, leaseRenewMs: 1_000,
    logger: quietLogger
  })
  assert.equal((await publishWorker.runOnce()).status, 'completed')
  assert.equal(publishedArtifactId, 'artifact-1')
})
