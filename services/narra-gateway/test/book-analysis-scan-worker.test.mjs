import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  createBookAnalysisScanWorker,
  normalizeScanObservations
} from '../book-analysis-scan-worker.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function scanInput(text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL') {
  return {
    runId: 'run-1',
    title: 'Книга',
    author: 'Автор',
    extractorVersion: 'book-scan-v8',
    normalizedTextObjectKey: 'analysis/run-1/normalized-text-v1.txt',
    chunk: {
      id: 'chunk-1',
      ordinal: 1,
      chapterKey: 'chapter-2',
      coreStartOffset: 8,
      coreEndOffset: 50,
      contextStartOffset: 0,
      contextEndOffset: text.length,
      contentHash: sha256(text),
      metadata: {
        contextByteStart: 0,
        contextByteEnd: Buffer.byteLength(text)
      }
    }
  }
}

function observation(text, quote, overrides = {}) {
  const startOffset = text.indexOf(quote)
  return {
    type: 'character_action',
    entityKind: 'character',
    entityCandidate: 'Анна',
    relatedEntityCandidates: [],
    fact: 'Анна вошла в комнату',
    evidence: {
      quote,
      startOffset,
      endOffset: startOffset + quote.length
    },
    confidence: 0.95,
    ...overrides
  }
}

test('scan normalization verifies quotes, converts offsets and discards overlap ownership', () => {
  const text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  const accepted = observation(text, 'Анна вошла в комнату.')
  const overlap = observation(text, 'OVERLAP', {
    entityCandidate: 'Пролог',
    fact: 'Слово находится только в левом overlap'
  })
  const result = normalizeScanObservations({ observations: [accepted, accepted, overlap] }, input, text)
  assert.equal(result.length, 1)
  assert.equal(result[0].evidence.startOffset, text.indexOf('Анна'))
  assert.equal(result[0].evidence.endOffset, text.indexOf('Анна') + accepted.evidence.quote.length)
  assert.equal(result[0].evidence.chapterKey, 'chapter-2')
  assert.match(result[0].observationKey, /^obs:[0-9a-f]{48}$/)
})

test('scan normalization preserves verbatim evidence whitespace', () => {
  const text = 'OVERLAP  Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  const result = normalizeScanObservations({
    observations: [observation(text, ' Анна вошла в комнату. ')]
  }, input, text)
  assert.equal(result.length, 1)
  assert.equal(result[0].evidence.quote, ' Анна вошла в комнату. ')
  assert.equal(
    text.slice(result[0].evidence.startOffset, result[0].evidence.endOffset),
    result[0].evidence.quote
  )
})

test('scan normalization rejects invented quotes and invalid offsets', () => {
  const text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  const invented = observation(text, 'Анна вошла в комнату.')
  invented.evidence.quote = 'Анна убежала из комнаты.'
  assert.throws(
    () => normalizeScanObservations({ observations: [invented] }, input, text),
    (error) => error.code === 'EVIDENCE_MISMATCH'
  )
  const invalid = observation(text, 'Анна вошла в комнату.')
  invalid.evidence.endOffset = text.length + 1
  assert.throws(
    () => normalizeScanObservations({ observations: [invalid] }, input, text),
    (error) => error.code === 'GENERATION_RESULT_INVALID'
  )
})

test('scan worker reads and sends only its bounded chunk', async () => {
  const text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  let rangeRequest
  let generatorRequest
  let completed
  const job = { id: 'job-1', runId: 'run-1', stage: 'scan', leaseToken: 'lease-1' }
  const repository = {
    async claimAnalysisJob() { return job },
    async getScanInput() { return input },
    async renewAnalysisJobLease() {},
    async completeScan(candidate, value) {
      completed = { candidate, value }
      return { observationCount: value.observations.length, stage: 'scan' }
    },
    async failAnalysisJob() { assert.fail('scan must not fail') }
  }
  const worker = createBookAnalysisScanWorker({
    repository,
    storage: {
      async getBytesRange(request) {
        rangeRequest = request
        return { bytes: Buffer.from(text) }
      }
    },
    generator: {
      async scanBookChunk(request) {
        generatorRequest = request
        return { observations: [observation(text, 'Анна вошла в комнату.')] }
      }
    },
    workerId: 'scan-worker-1',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.deepEqual(rangeRequest, {
    objectKey: input.normalizedTextObjectKey,
    startByte: 0,
    endByteExclusive: Buffer.byteLength(text),
    maxBytes: 128 * 1024
  })
  assert.equal(generatorRequest.contextText, text)
  assert.equal(generatorRequest.coreLocalStartOffset, 8)
  assert.equal(generatorRequest.coreLocalEndOffset, 50)
  assert.equal('normalizedTextObjectKey' in generatorRequest, false)
  assert.equal(completed.value.observations.length, 1)
})

test('scan worker retries its job when the stored chunk hash is wrong', async () => {
  const text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  input.chunk.contentHash = 'a'.repeat(64)
  let failed
  const repository = {
    async claimAnalysisJob() {
      return { id: 'job-2', runId: 'run-1', stage: 'scan', leaseToken: 'lease-2' }
    },
    async getScanInput() { return input },
    async renewAnalysisJobLease() {},
    async completeScan() { assert.fail('scan must not complete') },
    async failAnalysisJob(job, code) { failed = { job, code }; return { status: 'queued' } }
  }
  const worker = createBookAnalysisScanWorker({
    repository,
    storage: { async getBytesRange() { return { bytes: Buffer.from(text) } } },
    generator: { async scanBookChunk() { assert.fail('LLM must not be called') } },
    workerId: 'scan-worker-2',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.errorCode, 'CHUNK_INTEGRITY')
  assert.equal(failed.code, 'CHUNK_INTEGRITY')
})

test('scan worker refuses a job created for another extractor version', async () => {
  const text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  input.extractorVersion = 'book-scan-v1'
  let failedCode
  const worker = createBookAnalysisScanWorker({
    repository: {
      async claimAnalysisJob() {
        return { id: 'job-3', runId: 'run-1', stage: 'scan', leaseToken: 'lease-3' }
      },
      async getScanInput() { return input },
      async renewAnalysisJobLease() {},
      async completeScan() { assert.fail('scan must not complete') },
      async failAnalysisJob(_job, code) { failedCode = code; return { status: 'queued' } }
    },
    storage: { async getBytesRange() { assert.fail('storage must not be read') } },
    generator: { async scanBookChunk() { assert.fail('LLM must not be called') } },
    workerId: 'scan-worker-3',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.errorCode, 'EXTRACTOR_VERSION_MISMATCH')
  assert.equal(failedCode, 'EXTRACTOR_VERSION_MISMATCH')
})

test('scan worker completes the final evidence mismatch attempt with an empty grounded result', async () => {
  const text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  const job = {
    id: 'job-4',
    runId: 'run-1',
    stage: 'scan',
    leaseToken: 'lease-4',
    attempts: 5,
    maxAttempts: 5
  }
  let completed
  const worker = createBookAnalysisScanWorker({
    repository: {
      async claimAnalysisJob() { return job },
      async getScanInput() { return input },
      async renewAnalysisJobLease() {},
      async completeScan(candidate, value) {
        completed = { candidate, value }
        return { observationCount: 0, stage: 'resolve' }
      },
      async failAnalysisJob() { assert.fail('final evidence mismatch must not fail the run') }
    },
    storage: { async getBytesRange() { return { bytes: Buffer.from(text) } } },
    generator: {
      async scanBookChunk() {
        throw Object.assign(new Error('no grounded observations'), { code: 'EVIDENCE_MISMATCH' })
      }
    },
    workerId: 'scan-worker-4',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, warn() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.equal(result.result.stage, 'resolve')
  assert.equal(completed.candidate, job)
  assert.deepEqual(completed.value, {
    extractorVersion: 'book-scan-v8',
    observations: []
  })
})

test('scan worker still retries an evidence mismatch before the final attempt', async () => {
  const text = 'OVERLAP Анна вошла в комнату. Борис ответил ей. TAIL'
  const input = scanInput(text)
  const job = {
    id: 'job-5',
    runId: 'run-1',
    stage: 'scan',
    leaseToken: 'lease-5',
    attempts: 4,
    maxAttempts: 5
  }
  let failedCode
  const worker = createBookAnalysisScanWorker({
    repository: {
      async claimAnalysisJob() { return job },
      async getScanInput() { return input },
      async renewAnalysisJobLease() {},
      async completeScan() { assert.fail('non-final evidence mismatch must retry') },
      async failAnalysisJob(_candidate, code) {
        failedCode = code
        return { status: 'queued' }
      }
    },
    storage: { async getBytesRange() { return { bytes: Buffer.from(text) } } },
    generator: {
      async scanBookChunk() {
        throw Object.assign(new Error('no grounded observations'), { code: 'EVIDENCE_MISMATCH' })
      }
    },
    workerId: 'scan-worker-5',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, warn() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'EVIDENCE_MISMATCH')
  assert.equal(failedCode, 'EVIDENCE_MISMATCH')
})
