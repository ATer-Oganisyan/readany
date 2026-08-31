import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookEmbeddingClient } from '../book-embedding-client.mjs'

test('embedding client uses OpenAI-compatible dimensions and exposes metering', async () => {
  let request
  const client = createBookEmbeddingClient({
    baseUrl: 'http://127.0.0.1:4000',
    apiKey: 'local-key',
    model: 'embedding-test',
    dimensions: 3,
    inputUsdPerMillion: 2,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options }
      return new Response(JSON.stringify({
        data: [{ embedding: [1, 0.5, -1] }],
        usage: { prompt_tokens: 25, total_tokens: 25 }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  const result = await client.embedText('текст книги')
  assert.equal(request.url, 'http://127.0.0.1:4000/v1/embeddings')
  assert.deepEqual(JSON.parse(request.options.body), {
    input: 'текст книги', model: 'embedding-test', dimensions: 3
  })
  assert.equal(request.options.headers.authorization, 'Bearer local-key')
  assert.deepEqual(result.embedding, [1, 0.5, -1])
  assert.equal(result.inputUnits, 25)
  assert.equal(result.estimatedCostUsd, 0.00005)
})

test('embedding client classifies retryable HTTP errors without leaking provider body', async () => {
  const client = createBookEmbeddingClient({
    baseUrl: 'http://localhost:4000/v1',
    model: 'embedding-test',
    dimensions: 2,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'secret provider detail' }), {
      status: 429
    })
  })
  await assert.rejects(client.embedText('query'), (error) => {
    assert.equal(error.code, 'EMBEDDING_HTTP_429')
    assert.equal(error.retryable, true)
    assert.doesNotMatch(error.message, /secret/)
    return true
  })
})
