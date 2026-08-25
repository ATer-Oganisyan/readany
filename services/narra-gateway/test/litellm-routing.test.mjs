import assert from 'node:assert/strict'
import test from 'node:test'
import { llmRouteReadiness, requestChat, routeForPurpose } from '../providers.mjs'

const LITELLM_ENV = {
  LLM_ROUTE_STRUCTURED_TASK: 'litellm',
  LITELLM_BASE_URL: 'http://litellm.test:4000',
  LITELLM_API_KEY: 'proxy-key',
  LITELLM_MODEL_STRUCTURED_TASK: 'openrouter/openai/gpt-5.6-luna'
}

test('text fallback uses the LiteLLM provider and rejects a direct OpenRouter route', () => {
  assert.deepEqual(routeForPurpose('structured_task', {
    LLM_ROUTE_STRUCTURED_TASK: 'giga',
    LLM_FALLBACK_STRUCTURED_TASK: 'litellm'
  }), ['giga', 'litellm'])

  assert.throws(
    () => routeForPurpose('structured_task', { LLM_ROUTE_STRUCTURED_TASK: 'openrouter' }),
    /Unsupported provider route/
  )
})

test('an explicitly empty structured-task fallback never inherits GigaChat', () => {
  assert.deepEqual(routeForPurpose('structured_task', {
    LLM_ROUTE_STRUCTURED_TASK: 'litellm',
    LLM_FALLBACK_STRUCTURED_TASK: '',
    LLM_FALLBACK_DEFAULT: 'giga'
  }), ['litellm'])
})

test('LiteLLM text requests use their own endpoint, credential and model contract', async () => {
  let captured
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }],
    purpose: 'structured_task',
    stream: false,
    env: LITELLM_ENV,
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers, body: JSON.parse(init.body) }
      return new Response('{"choices":[{"message":{"content":"{}"}}]}', {
        status: 200,
        headers: { 'x-litellm-response-cost': '0.125' }
      })
    }
  })

  assert.equal(captured.url, 'http://litellm.test:4000/v1/chat/completions')
  assert.equal(captured.headers.Authorization, 'Bearer proxy-key')
  assert.equal(captured.body.model, 'openrouter/openai/gpt-5.6-luna')
  assert.equal(Object.hasOwn(captured.body, 'provider'), false)
  assert.equal(result.provider, 'litellm')
  assert.equal(result.responseCost, 0.125)
  await result.finalizeAttempt()
})

test('LiteLLM readiness is independent from direct OpenRouter image configuration', () => {
  const readiness = llmRouteReadiness({
    LLM_ROUTE_DEFAULT: 'litellm',
    LITELLM_BASE_URL: 'http://litellm.test:4000/v1',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_MODEL: 'openrouter/openai/gpt-5.6-luna',
    OPENROUTER_API_KEY: 'image-only-key'
  })

  assert.equal(readiness.ready, true)
  assert.deepEqual(readiness.purposes.structured_task.configured, ['litellm'])
})
