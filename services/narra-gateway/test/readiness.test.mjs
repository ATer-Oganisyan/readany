import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEnvBool, parseEnvUuidList } from '../env.mjs'
import { gatewayReadiness } from '../readiness.mjs'

const base = {
  llmReady: true,
  speechReady: true,
  imageReady: true,
  storageReady: true,
  videoConfigured: false,
  videoTransportAccepted: false,
  videoRequired: false,
  videoTransportSecure: false,
  llmTransportSecure: true,
  environment: 'production'
}

test('an optional unavailable video provider does not block the gateway', () => {
  const result = gatewayReadiness(base)
  assert.equal(result.ready, true)
  assert.deepEqual(result.degraded, [{ code: 'VIDEO_NOT_CONFIGURED', environment: 'production' }])
  assert.equal(result.checks.video, true)
})

test('a required unavailable video provider blocks readiness', () => {
  const result = gatewayReadiness({ ...base, videoRequired: true })
  assert.equal(result.ready, false)
  assert.equal(result.checks.video, false)
})

test('a required unavailable book backend blocks readiness', () => {
  const result = gatewayReadiness({
    ...base,
    bookBackendRequired: true,
    bookBackendReady: false
  })
  assert.equal(result.ready, false)
  assert.equal(result.checks.book_backend, false)
})

test('plaintext video is reported when explicitly configured', () => {
  const result = gatewayReadiness({
    ...base,
    videoConfigured: true,
    videoTransportAccepted: true
  })
  assert.equal(result.ready, true)
  assert.deepEqual(result.degraded, [{ code: 'VIDEO_PLAINTEXT_HTTP', environment: 'production' }])
})

test('explicit plaintext LLM transport remains visible in readiness', () => {
  const result = gatewayReadiness({ ...base, llmTransportSecure: false })
  assert.equal(result.ready, true)
  assert.deepEqual(result.degraded, [
    { code: 'VIDEO_NOT_CONFIGURED', environment: 'production' },
    { code: 'LLM_PLAINTEXT_HTTP', environment: 'production' }
  ])
})

test('boolean environment values are strict', () => {
  assert.equal(parseEnvBool({}, 'FLAG', true), true)
  assert.equal(parseEnvBool({ FLAG: 'false' }, 'FLAG', true), false)
  assert.throws(() => parseEnvBool({ FLAG: 'yes' }, 'FLAG'), /must be true or false/)
})

test('UUID list environment parser returns a deduplicated optional allowlist', () => {
  const first = '123e4567-e89b-42d3-a456-426614174000'
  const second = '123e4567-e89b-42d3-a456-426614174001'
  assert.equal(parseEnvUuidList({}, 'RUN_IDS'), undefined)
  assert.deepEqual(
    parseEnvUuidList({ RUN_IDS: `${first}, ${second},${first}` }, 'RUN_IDS'),
    [first, second]
  )
  assert.throws(
    () => parseEnvUuidList({ RUN_IDS: 'not-a-uuid' }, 'RUN_IDS'),
    /comma-separated list of UUIDs/
  )
})
