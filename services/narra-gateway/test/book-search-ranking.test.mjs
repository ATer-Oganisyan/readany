import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cosineSimilarity,
  reciprocalRankFusion,
  searchSnippet
} from '../book-search-ranking.mjs'

test('cosine similarity validates dimensions and ranks aligned vectors first', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0)
  assert.throws(() => cosineSimilarity([1], [1, 2]), /equal dimensions/)
})

test('RRF combines lexical and semantic ranks without duplicate chunks', () => {
  const result = reciprocalRankFusion([
    { source: 'lexical', items: [{ chunkId: 'a', ordinal: 0 }, { chunkId: 'b', ordinal: 1 }] },
    { source: 'semantic', items: [{ chunkId: 'b', ordinal: 1 }, { chunkId: 'c', ordinal: 2 }] }
  ], { limit: 3 })
  assert.deepEqual(result.map(({ chunkId }) => chunkId), ['b', 'a', 'c'])
  assert.deepEqual(result[0].matchedBy, ['lexical', 'semantic'])
})

test('snippet returns stable local offsets around a query match', () => {
  const text = `${'Начало '.repeat(50)}тайное озеро ${'Конец '.repeat(50)}`
  const result = searchSnippet(text, 'тайное озеро', { maxCharacters: 120 })
  assert.match(result.text, /тайное озеро/)
  assert.equal(text.slice(result.localStartOffset, result.localEndOffset).trim(), result.text)
})
