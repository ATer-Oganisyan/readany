import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createBookAnalysisPublishWorker } from '../analysis/book-analysis-publish-worker.mjs'
import { createBookAnalysisSynthesizeWorker } from '../analysis/book-analysis-synthesize-worker.mjs'
import { createBookAnalysisValidateWorker } from '../analysis/book-analysis-validate-worker.mjs'
import { EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION } from '../analysis/book-analysis-pipeline.mjs'

const leaseToken = '11111111-1111-4111-8111-111111111111'
const job = {
  id: 'job-1', runId: 'run-1', stage: 'synthesize', shardKey: 'character:anna', leaseToken
}
const quietLogger = { info() {}, error() {} }

test('synthesize worker builds the profile from exact evidence without calling the model', async () => {
  // Отбор улик моделью был стадией снятого конвейера. У оставшегося external
  // профиль собирается из точных реплик, и обращения к модели здесь быть не
  // должно вовсе — иначе за неё платили бы там, где ответ уже известен.
  let completion
  const observations = [{
    id: 'observation-1',
    type: 'character_dialogue',
    fact: 'Анна ответила',
    evidence: { quote: 'Точная реплика.', startOffset: 0, endOffset: 15 },
    confidence: 0.99
  }]
  const repository = {
    async claimAnalysisJob() { return job },
    async getSynthesizeInput() {
      return {
        mode: 'character_profile', runId: 'run-1', pipelineId: 'external',
        pipelineImplementationVersion: EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION,
        title: 'Книга', author: 'Автор', textLength: 10_000,
        snapshot: { id: 'snapshot-1' },
        entity: {
          entityKey: 'character:anna', entityKind: 'character', canonicalName: 'Анна',
          aliases: [], resolutionStatus: 'confirmed', confidence: 0.9,
          evidenceIds: ['observation-1'],
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
      async synthesizeCharacterProfile() {
        assert.fail('external synthesis must not call the model')
      }
    },
    workerId: 'synthesis-worker-1',
    leaseSeconds: 60,
    leaseRenewMs: 1_000,
    logger: quietLogger
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.deepEqual(completion.selectedEvidenceIds, ['observation-1'])
  assert.equal(completion.profile.speechExamples[0].value, 'Точная реплика.')
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
