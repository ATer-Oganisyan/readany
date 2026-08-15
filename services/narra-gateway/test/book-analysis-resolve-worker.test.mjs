import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookAnalysisResolveWorker } from '../book-analysis-resolve-worker.mjs'

const input = {
  runId: 'run-1',
  textLength: 100,
  observationSetHash: 'a'.repeat(64),
  observations: [{
    id: '11111111-1111-4111-8111-111111111111',
    observationKey: 'obs:anna',
    type: 'character_action',
    entityKind: 'character',
    entityCandidate: 'Анна',
    relatedEntityCandidates: [],
    fact: 'Анна появилась',
    evidence: {
      quote: 'Анна появилась',
      startOffset: 10,
      endOffset: 26,
      chapterKey: 'chapter-1'
    },
    confidence: 0.9
  }]
}

test('resolve worker consumes a whole-run observation set and advances to synthesize', async () => {
  let completed
  const job = { id: 'job-1', runId: 'run-1', stage: 'resolve', leaseToken: 'lease-1' }
  const worker = createBookAnalysisResolveWorker({
    repository: {
      async claimAnalysisJob() { return job },
      async getResolveInput() { return input },
      async renewAnalysisJobLease() {},
      async completeResolve(candidate, value) {
        completed = { candidate, value }
        return { stage: 'synthesize', entityCount: value.entities.length }
      },
      async failAnalysisJob() { assert.fail('resolve must not fail') }
    },
    workerId: 'resolve-worker-1',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.equal(result.result.stage, 'synthesize')
  assert.equal(completed.value.observationSetHash, input.observationSetHash)
  assert.equal(completed.value.observationCount, 1)
  assert.equal(completed.value.entities[0].canonicalName, 'Анна')
  assert.deepEqual(completed.value.entities[0].evidenceIds, [input.observations[0].id])
})

test('resolve worker retries its lease after invalid resolution input', async () => {
  let failure
  const worker = createBookAnalysisResolveWorker({
    repository: {
      async claimAnalysisJob() {
        return { id: 'job-2', runId: 'run-2', stage: 'resolve', leaseToken: 'lease-2' }
      },
      async getResolveInput() {
        return { ...input, observations: [{ ...input.observations[0], id: '' }] }
      },
      async renewAnalysisJobLease() {},
      async completeResolve() { assert.fail('resolve must not complete') },
      async failAnalysisJob(job, errorCode) {
        failure = { job, errorCode }
        return { status: 'queued' }
      }
    },
    workerId: 'resolve-worker-2',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'RESOLUTION_INPUT_INVALID')
  assert.equal(failure.job.id, 'job-2')
})

test('resolve worker rejects grounded facts that cover only the beginning of a book', async () => {
  let failure
  const observations = [
    { offset: 178, type: 'location', entityKind: 'location', candidate: 'Петербург' },
    { offset: 214, type: 'event', entityKind: 'event', candidate: 'Происшествие' },
    { offset: 273, type: 'event', entityKind: 'event', candidate: 'Наводнение' }
  ].map(({ offset, type, entityKind, candidate }, index) => ({
    id: `11111111-1111-4111-8111-11111111111${index}`,
    observationKey: `obs:${index}`,
    type,
    entityKind,
    entityCandidate: candidate,
    relatedEntityCandidates: [],
    fact: `${candidate}: подтверждённый факт`,
    evidence: {
      quote: 'подтверждение',
      startOffset: offset,
      endOffset: offset + 13,
      chapterKey: 'book'
    },
    confidence: 0.99
  }))
  const worker = createBookAnalysisResolveWorker({
    repository: {
      async claimAnalysisJob() {
        return { id: 'job-3', runId: 'run-3', stage: 'resolve', leaseToken: 'lease-3' }
      },
      async getResolveInput() {
        return {
          ...input,
          runId: 'run-3',
          textLength: 15_805,
          observations
        }
      },
      async renewAnalysisJobLease() {},
      async completeResolve() { assert.fail('incomplete analysis must not advance') },
      async failAnalysisJob(job, errorCode, options) {
        failure = { job, errorCode, options }
        return { status: 'failed' }
      }
    },
    workerId: 'resolve-worker-3',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, warn() {}, error() {} }
  })

  const result = await worker.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'ANALYSIS_TEXT_COVERAGE_INCOMPLETE')
  assert.equal(failure.errorCode, 'ANALYSIS_TEXT_COVERAGE_INCOMPLETE')
  assert.deepEqual(failure.options, { retryable: false })
})
