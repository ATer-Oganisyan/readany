import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createBookAnalysisPrepareWorker } from '../book-analysis-prepare-worker.mjs'

const bytes = Buffer.from('source book')
const hash = createHash('sha256').update(bytes).digest('hex')

test('prepare worker stores normalized text and atomically creates scan input', async () => {
  let completed
  let uploaded
  const repository = {
    async claimAnalysisJob() {
      return {
        id: 'job-1', runId: 'run-1', stage: 'prepare', leaseToken: 'lease-1'
      }
    },
    async getPrepareInput() {
      return {
        runId: 'run-1', inputHash: hash, title: 'Книга', format: 'txt',
        mimeType: 'text/plain', byteSize: bytes.byteLength, objectKey: 'books/source'
      }
    },
    async renewAnalysisJobLease() {},
    async completePrepare(job, input) { completed = { job, input }; return { stage: 'scan' } },
    async failAnalysisJob() { assert.fail('prepare must not fail') }
  }
  const storage = {
    async getBytes() { return { bytes, mimeType: 'text/plain' } },
    async putBytes(input) {
      uploaded = input
      const contentHash = createHash('sha256').update(input.bytes).digest('hex')
      return { ...input, contentHash, byteSize: input.bytes.byteLength }
    }
  }
  const text = Array.from({ length: 100 }, (_, index) =>
    `Абзац ${index}. Это содержимое книги для подготовки.`
  ).join('\n\n')
  const worker = createBookAnalysisPrepareWorker({
    repository,
    storage,
    workerId: 'prepare-1',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    chunkOptions: { targetChars: 800, minChars: 500, maxChars: 1_000, overlapChars: 100 },
    async extractStructuredText() {
      return {
        text,
        textLength: text.length,
        sections: [{ key: 'document', title: '', startOffset: 0, endOffset: text.length }],
        navigation: {
          version: 'book-navigation-v1', source: 'document', items: [], segments: []
        }
      }
    },
    logger: { info() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.equal(uploaded.objectKey, 'analysis/run-1/normalized-text-v1.txt')
  assert.equal(uploaded.bytes.toString('utf8'), text)
  assert.equal(completed.input.textLength, text.length)
  assert.equal(completed.input.contentNavigation.version, 'book-navigation-v1')
  assert.ok(completed.input.chunks.length > 1)
  assert.equal(completed.input.chunks[0].coreStartOffset, 0)
  assert.equal(completed.input.chunks.at(-1).coreEndOffset, text.length)
})

test('prepare worker retries only its leased job after an integrity failure', async () => {
  let failed
  const repository = {
    async claimAnalysisJob() {
      return { id: 'job-2', runId: 'run-2', stage: 'prepare', leaseToken: 'lease-2' }
    },
    async getPrepareInput() {
      return {
        runId: 'run-2', inputHash: 'a'.repeat(64), title: 'Книга', format: 'txt',
        mimeType: 'text/plain', byteSize: bytes.byteLength, objectKey: 'books/source'
      }
    },
    async renewAnalysisJobLease() {},
    async completePrepare() { assert.fail('prepare must not complete') },
    async failAnalysisJob(job, code) { failed = { job, code }; return { status: 'queued' } }
  }
  const worker = createBookAnalysisPrepareWorker({
    repository,
    storage: { async getBytes() { return { bytes } } },
    workerId: 'prepare-2',
    leaseSeconds: 60,
    leaseRenewMs: 10_000,
    logger: { info() {}, error() {} }
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'BOOK_INTEGRITY')
  assert.equal(failed.job.id, 'job-2')
  assert.equal(failed.code, 'BOOK_INTEGRITY')
})
