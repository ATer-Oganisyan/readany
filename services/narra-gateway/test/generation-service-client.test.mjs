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
  assert.equal(body.idempotencyKey, 'book-1:anna:character-bundle-v1')
  assert.deepEqual(body.requiredMedia, [
    'primary_portrait',
    'greeting_audio',
    'idle_animation'
  ])
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
