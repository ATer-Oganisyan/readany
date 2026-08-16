import assert from 'node:assert/strict'
import test from 'node:test'
import {
  imageEmptyResultError,
  imageUpstreamError,
  simplifiedPortraitPrompt,
  shouldFallbackAfterImageError
} from '../image-policy.mjs'
import {
  shouldRetryKandinsky,
  shouldRetryKandinskyStatus,
  videoRetryDelay
} from '../retry-policy.mjs'

test('Kandinsky retries provider rate limits and transient 5xx network failures', () => {
  assert.equal(shouldRetryKandinsky({ code: 'RATE' }), true)
  assert.equal(shouldRetryKandinsky({ code: 'NETWORK' }), true)
  assert.equal(shouldRetryKandinsky({ code: 'CENSOR' }), false)
  assert.equal(shouldRetryKandinsky({ code: 'AUTH' }), false)
  assert.equal(shouldRetryKandinsky({ code: 'TIMEOUT' }), false)
})

test('Kandinsky status polling keeps the same task after transient transport failures', () => {
  assert.equal(shouldRetryKandinskyStatus({ code: 'TIMEOUT' }), true)
  assert.equal(shouldRetryKandinskyStatus({ code: 'NETWORK' }), true)
  assert.equal(shouldRetryKandinskyStatus({ code: 'CENSOR' }), false)
  assert.equal(shouldRetryKandinskyStatus({ code: 'AUTH' }), false)
})

test('provider fallback never bypasses an image censorship decision', () => {
  assert.equal(shouldFallbackAfterImageError({ code: 'CENSOR' }), false)
  assert.equal(shouldFallbackAfterImageError({ code: 'VALIDATION' }), false)
  assert.equal(shouldFallbackAfterImageError({ code: 'UNKNOWN' }), false)
  assert.equal(shouldFallbackAfterImageError({ code: 'RATE' }), true)
  assert.equal(shouldFallbackAfterImageError({ code: 'NETWORK' }), true)
})

test('image moderation is terminal at Kandinsky create, status and result phases', () => {
  assert.equal(imageUpstreamError({
    provider: 'Kandinsky', phase: 'create', status: 422, detail: '{"bad_text_lemmas":[]}'
  }).code, 'CENSOR')
  assert.equal(imageUpstreamError({
    provider: 'Kandinsky', phase: 'status', detail: 'failed: blocked by censor'
  }).code, 'CENSOR')
  assert.equal(imageUpstreamError({
    provider: 'Kandinsky', phase: 'result', status: 422
  }).code, 'CENSOR')
})

test('Giga moderation and shared-request 4xx never qualify for provider fallback', () => {
  const moderated = imageUpstreamError({
    provider: 'GigaChat Image', phase: 'create', status: 400, detail: 'safety policy violation'
  })
  const invalid = imageUpstreamError({
    provider: 'GigaChat Image', phase: 'create', status: 400, detail: 'invalid request'
  })
  assert.equal(moderated.code, 'CENSOR')
  assert.equal(invalid.code, 'VALIDATION')
  assert.equal(shouldFallbackAfterImageError(moderated), false)
  assert.equal(shouldFallbackAfterImageError(invalid), false)
})

test('an empty successful image response falls back unless it carries moderation evidence', () => {
  const empty = imageEmptyResultError({
    provider: 'GigaChat Image', detail: JSON.stringify({ data: [] })
  })
  const moderated = imageEmptyResultError({
    provider: 'GigaChat Image', detail: JSON.stringify({ error: 'blocked by safety policy' })
  })
  assert.equal(empty.code, 'NETWORK')
  assert.equal(shouldFallbackAfterImageError(empty), true)
  assert.equal(moderated.code, 'CENSOR')
  assert.equal(shouldFallbackAfterImageError(moderated), false)
})

test('portrait retry keeps a bounded appearance but drops book metadata', () => {
  const retry = simplifiedPortraitPrompt(
    `${'A detailed fictional appearance. '.repeat(30)} Character from the book “Book” by Author.`
  )
  assert.ok(retry.length <= 900)
  assert.match(retry, /fictional appearance/i)
  assert.doesNotMatch(retry, /Character from the book|Author/)
  assert.match(retry, /no typography/i)
})

test('video retries only explicit rate-limit conditions', () => {
  assert.equal(videoRetryDelay({ code: 'RATE', message: 'concurrent slots' }), 45_000)
  assert.equal(videoRetryDelay({ message: '429' }), 10_000)
  assert.equal(videoRetryDelay({ code: 'CENSOR' }), 0)
})
