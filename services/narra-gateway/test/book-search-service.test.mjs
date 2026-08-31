import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookSearchService } from '../book-search-service.mjs'

const SUBJECT_ID = '123e4567-e89b-42d3-a456-426614174000'
const BOOK_ID = '123e4567-e89b-42d3-a456-426614174001'

function context(overrides = {}) {
  return {
    bookEditionId: BOOK_ID,
    indexId: 'index-1',
    state: 'vector_ready',
    embeddingModel: 'embedding-test',
    embeddingDimensions: 2,
    textLength: 1000,
    readerTextOffset: 400,
    ...overrides
  }
}

test('hybrid search fuses results and applies server-owned reader spoiler boundary', async () => {
  const calls = []
  const repository = {
    async getSearchContext() { return context() },
    async lexicalSearch(input) {
      calls.push(['lexical', input])
      return [{
        chunkId: 'a', ordinal: 0, chapterKey: 'one', startOffset: 0,
        endOffset: 300, text: 'герой вернулся домой', score: 1
      }]
    },
    async vectorCandidates(input) {
      calls.push(['vector', input])
      return [{
        chunkId: 'a', ordinal: 0, chapterKey: 'one', startOffset: 0,
        endOffset: 300, text: 'герой вернулся домой', embedding: [1, 0]
      }]
    },
    async recordQueryUsage(input) { calls.push(['usage', input]) }
  }
  const service = createBookSearchService({
    repository,
    embeddingClient: {
      model: 'embedding-test', dimensions: 2,
      async embedText() {
        return {
          embedding: [1, 0], provider: 'test', model: 'embedding-test',
          inputUnits: 2, estimatedCostUsd: 0.01
        }
      }
    }
  })
  const result = await service.search(SUBJECT_ID, BOOK_ID, {
    query: 'вернулся', mode: 'hybrid', spoilerMode: 'reader', limit: 5
  })
  assert.equal(result.effectiveMode, 'hybrid')
  assert.equal(result.maxTextOffset, 400)
  assert.deepEqual(result.results[0].matchedBy, ['lexical', 'semantic'])
  assert.ok(calls.filter(([type]) => type === 'lexical' || type === 'vector')
    .every(([, input]) => input.maxTextOffset === 400))
  assert.equal(calls.filter(([type]) => type === 'usage').length, 1)
})

test('hybrid mode falls back to lexical without an embedding client', async () => {
  const repository = {
    async getSearchContext() { return context() },
    async lexicalSearch() { return [] }
  }
  const service = createBookSearchService({ repository })
  const result = await service.search(SUBJECT_ID, BOOK_ID, {
    query: 'герой', mode: 'hybrid', spoilerMode: 'full', limit: 5
  })
  assert.equal(result.effectiveMode, 'lexical')
  assert.equal(result.maxTextOffset, 1000)
})

test('semantic-only mode reports a partial index instead of silently changing semantics', async () => {
  const repository = {
    async getSearchContext() { return context({ state: 'lexical_ready' }) }
  }
  const service = createBookSearchService({ repository })
  await assert.rejects(
    service.search(SUBJECT_ID, BOOK_ID, {
      query: 'герой', mode: 'semantic', spoilerMode: 'reader', limit: 5
    }),
    (error) => error.code === 'SEMANTIC_SEARCH_NOT_READY' && error.status === 409
  )
})

test('graph applies the same server-owned spoiler boundary as text search', async () => {
  let snapshotInput
  const repository = {
    async getSearchContext() { return context({ state: 'graph_ready' }) },
    async graphSnapshot(input) {
      snapshotInput = input
      return { nodes: [], edges: [] }
    }
  }
  const service = createBookSearchService({ repository })
  const result = await service.graph(SUBJECT_ID, BOOK_ID, { spoilerMode: 'reader' })
  assert.equal(result.maxTextOffset, 400)
  assert.deepEqual(snapshotInput, {
    indexId: 'index-1', maxTextOffset: 400, includeUnbounded: false
  })
})

test('graph search anchors bounded traversal in hybrid text results and returns evidence', async () => {
  let evidenceInput
  const evidenceId = '123e4567-e89b-42d3-a456-426614174010'
  const repository = {
    async getSearchContext() { return context({ state: 'graph_ready' }) },
    async lexicalSearch() {
      return [{
        chunkId: 'chunk-1', ordinal: 0, chapterKey: 'one', startOffset: 80,
        endOffset: 180, text: 'Прометей вступил в конфликт с Зевсом.', score: 1
      }]
    },
    async graphSnapshot() {
      return {
        nodes: [
          { key: 'prometheus', type: 'character', name: 'Прометей', data: {} },
          { key: 'zeus', type: 'character', name: 'Зевс', data: {} }
        ],
        edges: [{
          key: 'conflict', type: 'relationship', sourceKey: 'prometheus', targetKey: 'zeus',
          label: 'конфликтует', startOffset: 100, endOffset: 150,
          evidenceIds: [evidenceId], data: {}
        }],
        storyArcs: []
      }
    },
    async graphEvidence(input) {
      evidenceInput = input
      return [{
        id: evidenceId, type: 'relationship', fact: 'Прометей конфликтует с Зевсом.',
        quote: 'конфликт', startOffset: 100, endOffset: 150,
        chunkId: 'chunk-1', chapterKey: 'one'
      }]
    }
  }
  const service = createBookSearchService({ repository })
  const result = await service.graphSearch(SUBJECT_ID, BOOK_ID, {
    query: 'Почему Прометей конфликтует с Зевсом?',
    mode: 'hybrid', spoilerMode: 'reader', limit: 5, maxHops: 2
  })
  assert.equal(result.effectiveMode, 'lexical')
  assert.equal(result.edges[0].key, 'conflict')
  assert.equal(result.evidence[0].id, evidenceId)
  assert.equal(evidenceInput.maxTextOffset, 400)
  assert.deepEqual(evidenceInput.evidenceIds, [evidenceId])
})
