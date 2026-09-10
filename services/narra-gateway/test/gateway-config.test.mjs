import assert from 'node:assert/strict'
import test from 'node:test'
import { loadGatewayConfig } from '../gateway-config.mjs'

// Минимальное окружение, при котором конфигурация вообще собирается.
const BASE = Object.freeze({
  NODE_ENV: 'test',
  LLM_BASE_URL: 'https://llm.example/v1'
})

function load(overrides = {}) {
  return loadGatewayConfig({ ...BASE, ...overrides })
}

test('the whole environment is parsed once and handed back frozen', () => {
  const config = load()
  assert.ok(Object.isFrozen(config))
  assert.equal(config.PRODUCTION, false)
  assert.equal(config.ANALYTICS_ENV, 'development')
  assert.equal(config.API_LIMIT, 120)
  assert.equal(config.SPEECH_CONCURRENCY, 5)
  // Гейты конкурентности собираются здесь же, а не при первом запросе.
  assert.equal(typeof config.llmGate.status, 'function')
})

test('production refuses the insecure transport escape hatches', () => {
  assert.throws(
    () => load({ NODE_ENV: 'production', ALLOW_INSECURE_TLS: 'true' }),
    /ALLOW_INSECURE_TLS is forbidden in production/
  )
  assert.throws(
    () => load({ ANALYTICS_ENV: 'production', ALLOW_INSECURE_VIDEO_HTTP: 'true' }),
    /ALLOW_INSECURE_VIDEO_HTTP is forbidden/
  )
})

test('production refuses short operator and ingest secrets', () => {
  const production = {
    NODE_ENV: 'production',
    ANALYTICS_ENV: 'production',
    DATABASE_SSL_MODE: 'require',
    INSTALLATION_OPERATOR_TOKEN: 'x'.repeat(32),
    CATALOG_INGEST_TOKEN: 'y'.repeat(32),
    BOOK_OPERATOR_PASSWORD: 'z'.repeat(20)
  }
  assert.doesNotThrow(() => load(production))
  assert.throws(
    () => load({ ...production, INSTALLATION_OPERATOR_TOKEN: 'short' }),
    /INSTALLATION_OPERATOR_TOKEN must contain at least 32 characters/
  )
  assert.throws(
    () => load({ ...production, CATALOG_INGEST_TOKEN: 'short' }),
    /CATALOG_INGEST_TOKEN must contain at least 32 characters/
  )
  assert.throws(
    () => load({ ...production, BOOK_OPERATOR_PASSWORD: 'short' }),
    /BOOK_OPERATOR_PASSWORD are required in production/
  )
})

test('traction ingest needs its URL and token together or not at all', () => {
  assert.throws(
    () => load({ TRACTION_INGEST_URL: 'https://ingest.example' }),
    /must be configured together/
  )
  assert.throws(
    () => load({ TRACTION_INGEST_TOKEN: 't'.repeat(32) }),
    /must be configured together/
  )
  assert.doesNotThrow(() => load({
    TRACTION_INGEST_URL: 'https://ingest.example',
    TRACTION_INGEST_TOKEN: 't'.repeat(32)
  }))
})

test('a cover attempt timeout shorter than the provider timeouts is rejected', () => {
  assert.throws(
    () => load({ COVER_JOB_ATTEMPT_TIMEOUT_SECONDS: '1' }),
    /COVER_JOB_ATTEMPT_TIMEOUT_SECONDS must cover every configured cover image model timeout/
  )
})

test('an out-of-range numeric knob fails at startup, not at the first request', () => {
  assert.throws(() => load({ API_LIMIT_PER_MINUTE: '0' }), /API_LIMIT_PER_MINUTE/)
  assert.throws(() => load({ SPEECH_CONCURRENCY: '10' }), /between 1 and 5/)
  assert.throws(
    () => load({ INSTALLATION_TOKEN_TTL_SECONDS: '60' }),
    /INSTALLATION_TOKEN_TTL_SECONDS must be at least 300 seconds/
  )
})

test('loading twice with the same environment yields the same values', () => {
  const first = load()
  const second = load()
  for (const key of ['PORT', 'API_LIMIT', 'LLM_MODEL', 'ANALYTICS_ENV', 'BUILD_VERSION']) {
    assert.deepEqual(first[key], second[key])
  }
})
