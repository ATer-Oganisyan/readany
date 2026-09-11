import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completionText,
  settleProviderResponse,
  validateChatCompletionPayload
} from '../providers/provider-response.mjs'

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

test('a truncated or empty completion is a failure, not an empty answer', () => {
  // `content || ''` превращал две разные аварии в немую пустую строку, а та
  // доезжала до разбора JSON и падала на «LLM did not return a JSON object» —
  // сообщение, по которому причину не найти. Reasoning-модель, потратившая
  // весь `max_tokens` на рассуждение, приходит именно так: вызов «успешен»,
  // стоит денег и минуту времени, а текста нет.
  assert.equal(
    completionText({ choices: [{ message: { content: '{"ok": true}' }, finish_reason: 'stop' }] }),
    '{"ok": true}'
  )
  assert.throws(
    () => completionText({ choices: [{ message: { content: '{"partial"' }, finish_reason: 'length' }] }),
    (error) => error.code === 'LLM_OUTPUT_TRUNCATED'
  )
  assert.throws(
    () => completionText({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }),
    (error) => error.code === 'LLM_EMPTY_COMPLETION'
  )
  assert.throws(
    () => completionText({ choices: [{ message: { reasoning_content: 'долго думал' } }] }),
    (error) => error.code === 'LLM_EMPTY_COMPLETION'
  )
  assert.throws(() => completionText({}), (error) => error.code === 'LLM_EMPTY_COMPLETION')
})
