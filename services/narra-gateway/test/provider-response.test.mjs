import assert from 'node:assert/strict'
import test from 'node:test'
import { requestChat } from '../providers.mjs'
import {
  settleProviderResponse,
  validateChatCompletionPayload
} from '../provider-response.mjs'

test('provider completion is emitted only after response consumption', async () => {
  const events = []
  const value = await settleProviderResponse({
    consume: async () => ({ ok: true }),
    finalizeAttempt: async (event) => events.push(event)
  })
  assert.deepEqual(value, { ok: true })
  assert.deepEqual(events, [{ status: 'completed' }])
})

for (const [name, failure, expected] of [
  ['broken SSE body', Object.assign(new Error('socket reset'), { code: 'NETWORK' }), 'NETWORK'],
  ['malformed JSON body', Object.assign(new SyntaxError('bad json'), { code: 'PARSE' }), 'PARSE'],
  ['oversized body', Object.assign(new Error('body too large'), { code: 'NETWORK' }), 'NETWORK']
]) {
  test(`${name} emits a failed attempt and never a completed attempt`, async () => {
    const events = []
    await assert.rejects(settleProviderResponse({
      consume: async () => { throw failure },
      finalizeAttempt: async (event) => events.push(event)
    }))
    assert.deepEqual(events, [{ status: 'failed', error_code: expected }])
  })
}

test('non-stream completion rejects in-band error and content-filter finish', () => {
  assert.throws(
    () => validateChatCompletionPayload({ error: { code: 'upstream_failure' } }),
    (error) => error?.code === 'NETWORK'
  )
  assert.throws(
    () => validateChatCompletionPayload({
      choices: [{ finish_reason: 'content_filter' }]
    }),
    (error) => error?.code === 'CENSOR'
  )
})

test('explicit length completion fails consumption with PARSE rather than completing a partial answer', async () => {
  const events = []
  await assert.rejects(settleProviderResponse({
    consume: async () => validateChatCompletionPayload({
      choices: [{ message: { content: 'An incomplete answer that' }, finish_reason: 'length' }]
    }),
    finalizeAttempt: async event => events.push(event)
  }), { code: 'PARSE', status: 502 })
  assert.deepEqual(events, [{ status: 'failed', error_code: 'PARSE' }])
})

test('length rejection after a real provider response never retries or invokes configured fallback', async () => {
  let calls = 0
  const events = []
  const result = await requestChat({
    messages: [{ role: 'user', content: 'Own fixture question' }],
    purpose: 'character_chat', stream: false,
    env: {
      LLM_ROUTE_CHARACTER_CHAT: 'litellm', LLM_FALLBACK_CHARACTER_CHAT: 'giga',
      LITELLM_BASE_URL: 'https://unused.example', LITELLM_API_KEY: 'fixture-only', LITELLM_MODEL: 'fixture',
      LLM_BASE_URL: 'https://fallback.example', LLM_API_KEY: 'fixture-only', LLM_MODEL: 'fixture'
    },
    onAttempt: async event => events.push(event),
    fetchImpl: async () => {
      calls++
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'Partial' } }] }))
    }
  })
  await assert.rejects(settleProviderResponse({
    consume: async () => validateChatCompletionPayload(await result.response.json()),
    finalizeAttempt: result.finalizeAttempt
  }), { code: 'PARSE', status: 502 })
  assert.equal(calls, 1)
  assert.deepEqual(events.map(event => event.status), ['started', 'failed'])
  assert.equal(result.attempts.length, 1)
  assert.equal(result.attempts[0].error_code, 'PARSE')
})

for (const finishReason of [undefined, 'stop', 'tool_calls']) {
  test(`preserves compatible completion with finish_reason ${String(finishReason)}`, () => {
    const payload = { choices: [{
      ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
      message: finishReason === 'tool_calls'
        ? { content: null, tool_calls: [{ id: 'call_own', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }
        : { content: 'A full answer.' }
    }] }
    assert.equal(validateChatCompletionPayload(payload), payload)
  })
}
