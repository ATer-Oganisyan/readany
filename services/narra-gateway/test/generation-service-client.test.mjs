import assert from 'node:assert/strict'
import test from 'node:test'
import { createGenerationServiceClient } from '../generation-service-client.mjs'

const TOKEN = 'generator-service-token-that-is-long-enough'

test('generator client sends a stable markup idempotency key and service auth', async () => {
  let request
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl(url, options) {
      request = { url: String(url), options }
      return new Response(JSON.stringify({ result: { characters: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  const result = await client.generateBookMarkup({
    bookEditionId: 'book-1',
    analysisVersion: 'book-markup-v1',
    objectKey: 'books/book-1/source.epub'
  })
  assert.deepEqual(result, { characters: [] })
  assert.equal(request.url, 'http://localhost:8790/internal/v1/book-markup')
  assert.equal(request.options.headers.authorization, `Bearer ${TOKEN}`)
  assert.deepEqual(JSON.parse(request.options.body), {
    idempotencyKey: 'book-1:book-markup:book-markup-v1',
    bookEditionId: 'book-1',
    analysisVersion: 'book-markup-v1',
    objectKey: 'books/book-1/source.epub'
  })
})

test('generator client sends one idempotent request for an atomic character bundle', async () => {
  let body
  const client = createGenerationServiceClient({
    baseUrl: 'https://generator.example.com',
    token: TOKEN,
    production: true,
    async fetchImpl(_url, options) {
      body = JSON.parse(options.body)
      return new Response(JSON.stringify({ assets: [] }), { status: 200 })
    }
  })
  await client.generateCharacterBundle({
    bookEditionId: 'book-1',
    characterKey: 'anna',
    bundleVersion: 'character-bundle-v1'
  }, ['primary_portrait', 'greeting_audio', 'idle_animation'])
  assert.equal(
    body.idempotencyKey,
    'book-1:anna:character-bundle-v1:primary_portrait+greeting_audio+idle_animation'
  )
  assert.deepEqual(body.requiredMedia, [
    'primary_portrait',
    'greeting_audio',
    'idle_animation'
  ])
})

test('generator client keeps catalog cover routing and credentials inside the service boundary', async () => {
  let request
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl(url, options) {
      request = { url: String(url), body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ asset: { objectKey: 'cover.png' } }), { status: 200 })
    }
  })
  await client.generateCatalogCover({
    bookEditionId: 'book-1', targetVersion: 'catalog-cover-v2-aaaa',
    scope: 'catalog', title: 'Книга', author: '', context: ''
  })
  assert.equal(request.url, 'http://localhost:8790/internal/v1/catalog-covers')
  assert.equal(request.body.idempotencyKey, 'book-1:catalog-cover:catalog-cover-v2-aaaa')
  assert.equal(Object.hasOwn(request.body, 'provider'), false)
  assert.equal(Object.hasOwn(request.body, 'apiKey'), false)
})

test('generator client sends book identity jobs to their dedicated endpoint', async () => {
  let request
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl(url, options) {
      request = { url: String(url), body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ result: { title: 'Книга', source: 'llm' } }), {
        status: 200
      })
    }
  })
  await client.generateBookIdentity({
    bookEditionId: 'book-1', targetVersion: 'book-identity-v1-aaaa', title: 'Книга'
  })
  assert.equal(request.url, 'http://localhost:8790/internal/v1/book-identities')
  assert.equal(
    request.body.idempotencyKey,
    'book-1:book-identity:book-identity-v1-aaaa'
  )
})

test('generator client sends one bounded scan chunk with a stable idempotency key', async () => {
  let request
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl(url, options) {
      request = { url: String(url), body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ result: { observations: [] } }), { status: 200 })
    }
  })
  const contextText = ' Анна вошла в комнату. '
  assert.deepEqual(await client.scanBookChunk({
    runId: 'run-1',
    chunkId: 'chunk-2',
    extractorVersion: 'book-scan-v1',
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    contextText,
    coreLocalStartOffset: 1,
    coreLocalEndOffset: contextText.length - 1
  }), { observations: [] })
  assert.equal(request.url, 'http://localhost:8790/internal/v1/book-analysis/scan-chunk')
  assert.deepEqual(request.body, {
    idempotencyKey: 'run-1:scan:chunk-2:book-scan-v1',
    runId: 'run-1',
    chunkId: 'chunk-2',
    extractorVersion: 'book-scan-v1',
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    contextText,
    coreLocalStartOffset: 1,
    coreLocalEndOffset: contextText.length - 1
  })
})

test('generator client sends one idempotent character profile request', async () => {
  let request
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl(url, options) {
      request = { url: String(url), body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ result: { profile: { characterKey: 'character:anna' } } }), {
        status: 200
      })
    }
  })
  const input = {
    runId: 'run-1', snapshotId: 'snapshot-1', synthesisVersion: 'character-profile-v3',
    bookTitle: 'Книга', bookAuthor: 'Автор', textLength: 100,
    entity: { entityKey: 'character:anna' }, evidence: [{ id: 'evidence-1' }]
  }
  assert.deepEqual(await client.synthesizeCharacterProfile(input), {
    profile: { characterKey: 'character:anna' }
  })
  assert.equal(request.url, 'http://localhost:8790/internal/v1/book-analysis/synthesize-character')
  assert.equal(
    request.body.idempotencyKey,
    'run-1:synthesize:snapshot-1:character:anna:character-profile-v3'
  )
  assert.deepEqual({ ...request.body, idempotencyKey: undefined }, {
    ...input,
    idempotencyKey: undefined
  })
})

test('generator client sends one idempotent whole-book identity request', async () => {
  let request
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl(url, options) {
      request = { url: String(url), body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ result: { merges: [] } }), { status: 200 })
    }
  })
  const input = {
    runId: 'run-1',
    bookEditionId: 'book-1',
    pipelineVersion: 'book-analysis-v25',
    reconciliationVersion: 'character-identity-v6',
    observationSetHash: 'a'.repeat(64),
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    roster: [],
    forbiddenPairs: []
  }
  assert.deepEqual(await client.reconcileBookCharacterIdentities(input), { merges: [] })
  assert.equal(
    request.url,
    'http://localhost:8790/internal/v1/book-analysis/reconcile-character-identities'
  )
  assert.equal(
    request.body.idempotencyKey,
    `run-1:identity:book-analysis-v25:character-identity-v6:${'a'.repeat(64)}`
  )
})

test('generator client rejects weak auth and unsafe production URLs', () => {
  assert.throws(() => createGenerationServiceClient({
    baseUrl: 'https://generator.example.com', token: 'short', production: true
  }), /at least 32 characters/)
  assert.throws(() => createGenerationServiceClient({
    baseUrl: 'http://generator.example.com', token: TOKEN, production: true
  }), /must use HTTPS/)
})

test('generator client maps non-success responses to a safe worker error code', async () => {
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl() {
      return new Response(JSON.stringify({ error: 'provider details stay internal' }), { status: 503 })
    }
  })
  await assert.rejects(
    () => client.generateBookMarkup({ bookEditionId: 'book-1', analysisVersion: 'v1' }),
    (error) => error.code === 'GENERATOR_HTTP_503'
  )
})

test('generator client preserves a bounded provider error code for media retries', async () => {
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl() {
      return new Response(JSON.stringify({
        error: 'provider details stay internal',
        code: 'VIDEO_FAILED'
      }), { status: 502 })
    }
  })
  await assert.rejects(
    () => client.generateCharacterBundle({
      bookEditionId: 'book-1', characterKey: 'anna', bundleVersion: 'v1'
    }, ['idle_animation']),
    (error) => error.code === 'VIDEO_FAILED'
  )
})

test('generator client preserves a grounded evidence mismatch for scan retry policy', async () => {
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl() {
      return new Response(JSON.stringify({
        error: 'internal details stay inside the generation service',
        code: 'EVIDENCE_MISMATCH'
      }), { status: 400 })
    }
  })
  await assert.rejects(
    () => client.scanBookChunk({
      runId: 'run-1',
      chunkId: 'chunk-1',
      extractorVersion: 'book-scan-v4'
    }),
    (error) => error.code === 'EVIDENCE_MISMATCH'
  )
})

test('generator client preserves safe scan validation codes instead of hiding them as HTTP 400', async () => {
  const client = createGenerationServiceClient({
    baseUrl: 'http://localhost:8790',
    token: TOKEN,
    production: false,
    async fetchImpl() {
      return new Response(JSON.stringify({
        error: 'internal details stay inside the generation service',
        code: 'SCAN_RELATION_PARTICIPANT_MISSING'
      }), { status: 400 })
    }
  })
  await assert.rejects(
    () => client.scanBookChunk({
      runId: 'run-1',
      chunkId: 'chunk-1',
      extractorVersion: 'book-scan-v10'
    }),
    (error) => error.code === 'SCAN_RELATION_PARTICIPANT_MISSING'
  )
})
