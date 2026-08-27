import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  createBookSearchWorker,
  parseBookSearchBookScopes,
  parseBookSearchJobTypes,
  readSearchChunk
} from '../book-search-worker.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function inputFor(text = 'контекст ОСНОВА хвост') {
  return {
    normalizedTextObjectKey: 'book/normalized.txt',
    chunk: {
      id: 'chunk-1', ordinal: 0, chapterKey: 'chapter-1',
      contextStartOffset: 0, contextEndOffset: text.length,
      coreStartOffset: 9, coreEndOffset: 15,
      contentHash: sha256(text),
      metadata: { contextByteStart: 0, contextByteEnd: Buffer.byteLength(text) }
    }
  }
}

function storageFor(text) {
  return {
    async getBytesRange(request) {
      assert.deepEqual(request, {
        objectKey: 'book/normalized.txt',
        startByte: 0,
        endByteExclusive: Buffer.byteLength(text),
        maxBytes: 256 * 1024
      })
      return { bytes: Buffer.from(text) }
    }
  }
}

test('search chunks reuse context byte ranges and extract non-overlapping core text', async () => {
  const text = 'контекст ОСНОВА хвост'
  const result = await readSearchChunk(inputFor(text), storageFor(text))
  assert.equal(result.contextText, text)
  assert.equal(result.coreText, 'ОСНОВА')
})

test('lexical job completes independently and does not call embedding API', async () => {
  const text = 'контекст ОСНОВА хвост'
  const job = {
    id: 'job-1', indexId: 'index-1', analysisChunkId: 'chunk-1',
    type: 'lexical', attempts: 1, priority: 50, leaseToken: 'lease-1'
  }
  let completed
  const repository = {
    async claimJob() { return job },
    async getJobInput() { return inputFor(text) },
    async completeLexical(_job, value) {
      completed = value
      return { state: 'lexical_ready' }
    },
    async renewJobLease() {},
    async failJob() { assert.fail('lexical job must not fail') }
  }
  const worker = createBookSearchWorker({
    repository,
    storage: storageFor(text),
    embeddingClient: { async embedText() { assert.fail('embedding must not run') } },
    workerId: 'test-worker',
    leaseSeconds: 30,
    leaseRenewMs: 1000
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.equal(result.jobType, 'lexical')
  assert.deepEqual(completed, { coreText: 'ОСНОВА' })
})

test('deterministic chunk integrity failure is not retried', async () => {
  const text = 'контекст ОСНОВА хвост'
  const job = {
    id: 'job-1', indexId: 'index-1', analysisChunkId: 'chunk-1',
    type: 'lexical', attempts: 1, priority: 50, leaseToken: 'lease-1'
  }
  let failure
  const repository = {
    async claimJob() { return job },
    async getJobInput() {
      const input = inputFor('контекст ОСНОВА хвост')
      input.chunk.contentHash = 'f'.repeat(64)
      return input
    },
    async renewJobLease() {},
    async failJob(_job, code, options) { failure = { code, options } }
  }
  const worker = createBookSearchWorker({
    repository,
    storage: storageFor(text),
    embeddingClient: { async embedText() {} },
    workerId: 'test-worker',
    leaseSeconds: 30,
    leaseRenewMs: 1000
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'CHUNK_INTEGRITY')
  assert.equal(failure.code, 'CHUNK_INTEGRITY')
  assert.equal(failure.options.retryable, false)
})

test('narrative worker is isolated from storage and embedding dependencies', async () => {
  let claimOptions
  const repository = {
    async claimJob(_workerId, options) {
      claimOptions = options
      return {
        id: 'job-graph', indexId: 'index-1', type: 'graph', attempts: 1,
        priority: 40, leaseToken: 'lease-graph'
      }
    },
    async getGraphInput() {
      return { markup: { characters: [], events: [], locations: [], relationships: [] } }
    },
    async completeGraph(_job, graph) {
      assert.deepEqual(graph, { nodes: [], edges: [] })
      return { state: 'graph_ready' }
    },
    async renewJobLease() {},
    async failJob() { assert.fail('graph job must not fail') }
  }
  const worker = createBookSearchWorker({
    repository,
    workerId: 'private-narrative',
    jobTypes: ['graph', 'story_arc'],
    bookScopes: ['private'],
    leaseSeconds: 30,
    leaseRenewMs: 1000
  })
  const result = await worker.runOnce()
  assert.equal(result.status, 'completed')
  assert.deepEqual(claimOptions, {
    types: ['graph', 'story_arc'], scopes: ['private'], leaseSeconds: 30
  })
})

test('worker scope and job type environment selections are strict', () => {
  assert.deepEqual(parseBookSearchJobTypes('graph,story_arc,graph'), ['graph', 'story_arc'])
  assert.deepEqual(parseBookSearchBookScopes('catalog'), ['catalog'])
  assert.throws(() => parseBookSearchJobTypes('graph,cover'), /unsupported/)
  assert.throws(() => parseBookSearchBookScopes('all'), /unsupported/)
})
