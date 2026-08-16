import assert from 'node:assert/strict'
import test from 'node:test'
import { requestChat } from '../providers.mjs'

async function captureRequestBody({ provider = 'giga', model, purpose, temperature }) {
  let body
  const isLiteLlm = provider === 'litellm'
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }],
    temperature,
    purpose,
    stream: false,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 })
    },
    env: isLiteLlm
      ? {
          LLM_ROUTE_CHARACTER_CHAT: 'litellm',
          LITELLM_BASE_URL: 'https://litellm.test/v1',
          LITELLM_API_KEY: 'proxy-key',
          LITELLM_MODEL_CHARACTER_CHAT: model
        }
      : {
          LLM_ROUTE_CHARACTER_CHAT: 'giga',
          LLM_BASE_URL: 'https://giga.test',
          LLM_API_KEY: 'giga-key',
          LLM_MODEL_CHARACTER_CHAT: model
        }
  })
  await result.finalizeAttempt()
  return body
}

test('gateway owns sampling policy for supported character-chat models', async () => {
  for (const [provider, model] of [
    ['giga', 'gpt-5.6-luna'],
    ['litellm', 'openrouter/openai/gpt-5.6-luna']
  ]) {
    const body = await captureRequestBody({
      provider,
      model,
      purpose: 'character_chat',
      temperature: 0.1
    })
    assert.equal(body.temperature, 0.85)
    assert.equal(body.reasoning_effort, 'none')
  }
})

test('gateway omits optional sampling for an unverified model', async () => {
  const body = await captureRequestBody({
    model: 'future-model',
    purpose: 'character_chat',
    temperature: 0.1
  })
  assert.equal(Object.hasOwn(body, 'temperature'), false)
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
})
