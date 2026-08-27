import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import {
  createLocalEmbeddingServer,
  localHashEmbedding
} from '../local-book-embedding-server.mjs'

function cosine(left, right) {
  return left.reduce((sum, item, index) => sum + item * right[index], 0)
}

test('local hash embeddings are deterministic and preserve shared terms', () => {
  const first = localHashEmbedding('Анна приехала в Москву', 64)
  const repeated = localHashEmbedding('Анна приехала в Москву', 64)
  const related = localHashEmbedding('Анна живёт в Москве', 64)
  const unrelated = localHashEmbedding('Корабль пересёк океан', 64)

  assert.deepEqual(first, repeated)
  assert.equal(first.length, 64)
  assert.ok(cosine(first, related) > cosine(first, unrelated))
})

test('local embedding server implements the OpenAI-compatible endpoint', async (context) => {
  const server = createLocalEmbeddingServer({ model: 'local-hash-v1', dimensions: 32 })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => server.close())
  const address = server.address()

  const response = await fetch(`http://127.0.0.1:${address.port}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: 'локальная проверка поиска',
      model: 'local-hash-v1',
      dimensions: 32
    })
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.data[0].embedding.length, 32)
  assert.equal(payload.model, 'local-hash-v1')
  assert.equal(payload.usage.prompt_tokens, 3)
})
