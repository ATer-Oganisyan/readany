import assert from 'node:assert/strict'
import test from 'node:test'
import { loadGatewayConfig } from '../platform/gateway-config.mjs'

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
  assert.equal(config.API_LIMIT, 600)
  assert.equal(config.SPEECH_CONCURRENCY, 5)
  assert.equal(config.INTERACTIVE_PORTRAIT_CASCADE_BUDGET_MS, 240_000)
  // Гейты конкурентности собираются здесь же, а не при первом запросе.
  assert.equal(typeof config.llmGate.status, 'function')
})

test('interactive portrait cascade budget is configurable in seconds', () => {
  assert.equal(load({
    INTERACTIVE_PORTRAIT_CASCADE_BUDGET_SECONDS: '300'
  }).INTERACTIVE_PORTRAIT_CASCADE_BUDGET_MS, 300_000)
  assert.throws(() => load({
    INTERACTIVE_PORTRAIT_CASCADE_BUDGET_SECONDS: '0'
  }), /INTERACTIVE_PORTRAIT_CASCADE_BUDGET_SECONDS/)
  assert.throws(() => load({
    INTERACTIVE_PORTRAIT_CASCADE_BUDGET_SECONDS: '481'
  }), /INTERACTIVE_PORTRAIT_CASCADE_BUDGET_SECONDS/)
})

test('portrait cascade is opt-in and reads an ordered, bounded model list', () => {
  const disabled = load({
    CHARACTER_PORTRAIT_FALLBACK_MODELS: 'model-one,model-two',
    COVER_IMAGE_TIMEOUT_MS: '60000'
  })
  assert.equal(disabled.CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED, false)
  assert.deepEqual(disabled.CHARACTER_PORTRAIT_FALLBACK_MODELS, [])

  const enabled = load({ CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED: 'true' })
  assert.deepEqual(enabled.CHARACTER_PORTRAIT_FALLBACK_MODELS, [
    enabled.coverProviderConfig.fallbackModel
  ])

  const configured = load({
    CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED: 'true',
    CHARACTER_PORTRAIT_FALLBACK_MODELS: 'model-one, openai/gpt-image-2, model-one, model-two',
    COVER_IMAGE_TIMEOUT_MS: '60000'
  })
  assert.deepEqual(configured.CHARACTER_PORTRAIT_FALLBACK_MODELS, ['model-one', 'model-two'])
  assert.ok(Object.isFrozen(configured.CHARACTER_PORTRAIT_FALLBACK_MODELS))
  assert.deepEqual(load({
    CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED: 'true',
    CHARACTER_PORTRAIT_FALLBACK_MODELS: ''
  }).CHARACTER_PORTRAIT_FALLBACK_MODELS, [])
  assert.throws(() => load({
    CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED: 'true',
    CHARACTER_PORTRAIT_FALLBACK_MODELS: Array.from({ length: 9 }, (_, index) => `m${index}`).join(',')
  }), /at most 8 models/)
})

test('cover cascade reuses the configured ordered image fallback list', () => {
  const inherited = load({
    CHARACTER_PORTRAIT_FALLBACK_MODELS: [
      'qwen/qwen-image-3',
      'black-forest-labs/flux.2-pro',
      'bytedance-seed/seedream-5-0-lite'
    ].join(','),
    COVER_IMAGE_TIMEOUT_MS: '60000'
  })
  assert.deepEqual(inherited.COVER_IMAGE_FALLBACK_MODELS, [
    'qwen/qwen-image-3',
    'black-forest-labs/flux.2-pro',
    'bytedance-seed/seedream-5-0-lite'
  ])
  assert.equal(inherited.coverProviderCallsPerAttempt, 4)
  assert.ok(Object.isFrozen(inherited.COVER_IMAGE_FALLBACK_MODELS))

  const overridden = load({
    CHARACTER_PORTRAIT_FALLBACK_MODELS: 'portrait-only',
    COVER_IMAGE_FALLBACK_MODELS: 'cover-one, cover-one, cover-two',
    COVER_IMAGE_TIMEOUT_MS: '60000'
  })
  assert.deepEqual(overridden.COVER_IMAGE_FALLBACK_MODELS, ['cover-one', 'cover-two'])

  assert.throws(() => load({
    COVER_IMAGE_FALLBACK_MODELS: Array.from({ length: 9 }, (_, index) => `m${index}`).join(',')
  }), /COVER_IMAGE_FALLBACK_MODELS supports at most 8 models/)
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

test('a cover attempt timeout too short for the configured model chain is rejected', () => {
  assert.throws(
    () => load({ COVER_JOB_ATTEMPT_TIMEOUT_SECONDS: '1' }),
    /COVER_JOB_ATTEMPT_TIMEOUT_SECONDS must reserve at least 30 seconds per cover image model/
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

test('the image provider is read from the given environment, not from process.env', () => {
  // Единственное место, где конфигурация читала чужое окружение: остальные
  // настройки брались из переданного env, а провайдер картинок — из
  // process.env. Из-за этого COVER_IMAGE_PROVIDER=litellm возвращал openrouter
  // вместе с его моделью и таймаутом, и по ним же считался бюджет времени.
  const config = load({
    COVER_IMAGE_PROVIDER: 'litellm',
    LITELLM_BASE_URL: 'https://litellm.example/v1',
    LITELLM_API_KEY: 'ключ',
    LITELLM_IMAGE_MODEL: 'своя-модель',
    LITELLM_IMAGE_FALLBACK_MODEL: 'своя-модель',
    COVER_IMAGE_TIMEOUT_MS: '60000'
  })

  assert.equal(config.coverProviderConfig.provider, 'litellm')
  assert.equal(config.coverProviderConfig.baseUrl, 'https://litellm.example/v1')
  assert.equal(config.coverProviderConfig.model, 'своя-модель')
  assert.equal(config.coverProviderConfig.timeoutMs, 60_000)
  // Производные величины считаются от той же конфигурации: запасная модель
  // совпадает с основной, значит вызов на попытку один, а не два. На каждую
  // модель остаётся хотя бы 30 секунд плюс 15 секунд на сохранение результата.
  assert.equal(config.coverProviderCallsPerAttempt, 1)
  assert.equal(config.minimumCoverAttemptTimeoutMs, 45_000)
})

test('without an image provider in the environment the default is still openrouter', () => {
  const config = load()
  assert.equal(config.coverProviderConfig.provider, 'openrouter')
  assert.equal(config.coverProviderCallsPerAttempt, 2)
})

test('an unsupported image provider fails loudly instead of falling back', () => {
  assert.throws(() => load({ COVER_IMAGE_PROVIDER: 'выдуманный' }), /Unsupported cover image provider/)
})

test('the character media backfill stays off until it is asked for by name', () => {
  // Подогрев медиа по старту стоит денег: каждый перезапуск шлюза заказывал
  // портреты персонажам, чей бандл однажды не собрался. Умолчание «выключено»
  // и есть предохранитель — включение должно быть видно в окружении.
  assert.equal(load().BOOK_CHARACTER_MEDIA_BACKFILL, false)
  assert.equal(load({ BOOK_CHARACTER_MEDIA_BACKFILL: 'true' }).BOOK_CHARACTER_MEDIA_BACKFILL, true)
  assert.equal(load({ BOOK_CHARACTER_MEDIA_BACKFILL: 'false' }).BOOK_CHARACTER_MEDIA_BACKFILL, false)
})
