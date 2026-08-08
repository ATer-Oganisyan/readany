import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coverRouteReadiness,
  llmRouteReadiness,
  maxTokensFor,
  omitsTemperature,
  requestChat,
  requestCoverImage,
  routeForPurpose
} from '../providers.mjs'

test('provider route is selected only from server environment', () => {
  const route = routeForPurpose('summary', {
    LLM_ROUTE_SUMMARY: 'openrouter',
    LLM_FALLBACK_SUMMARY: 'giga'
  })
  assert.deepEqual(route, ['openrouter', 'giga'])
})

test('readiness requires a complete configured route for every purpose', () => {
  const broken = llmRouteReadiness({ OPENROUTER_API_KEY: 'key', LLM_ROUTE_DEFAULT: 'openrouter' })
  assert.equal(broken.ready, false)
  assert.equal(broken.purposes.summary.ready, false)
  const ready = llmRouteReadiness({
    LLM_ROUTE_DEFAULT: 'giga', LLM_BASE_URL: 'https://giga.test',
    LLM_API_KEY: 'key', LLM_MODEL: 'model'
  })
  assert.equal(ready.ready, true)
})

test('llm max_tokens has safe defaults and env overrides with bounds', async () => {
  assert.equal(maxTokensFor('structured_task', true, {}), 4096)
  assert.equal(maxTokensFor('structured_task', false, {}), 8000)
  assert.equal(maxTokensFor('summary', true, { LLM_MAX_TOKENS_STREAM: '2048' }), 2048)
  assert.equal(maxTokensFor('summary', false, { LLM_MAX_TOKENS_COMPLETE: '12000' }), 12000)
  assert.equal(
    maxTokensFor('structured_task', true, {
      LLM_MAX_TOKENS_STREAM: '2048',
      LLM_MAX_TOKENS_STRUCTURED_TASK: '9000'
    }),
    9000
  )
  assert.equal(maxTokensFor('summary', true, { LLM_MAX_TOKENS_STREAM: '10' }), 4096)
  assert.equal(maxTokensFor('summary', false, { LLM_MAX_TOKENS_COMPLETE: 'мусор' }), 8000)
  assert.equal(maxTokensFor('summary', false, { LLM_MAX_TOKENS_COMPLETE: '900000' }), 32000)

  const bodies = []
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2,
    purpose: 'structured_task',
    stream: false,
    fetchImpl,
    env: {
      LLM_ROUTE_STRUCTURED_TASK: 'giga',
      LLM_BASE_URL: 'https://giga.test',
      LLM_API_KEY: 'key',
      LLM_MODEL: 'model'
    }
  })
  await result.finalizeAttempt()
  assert.equal(bodies[0].max_tokens, 8000)
})

test('temperature is dropped only for providers that reject it', async () => {
  assert.equal(omitsTemperature('giga', {}), false)
  assert.equal(omitsTemperature('giga', { LLM_OMIT_TEMPERATURE: 'true' }), true)
  assert.equal(omitsTemperature('giga', { LLM_OMIT_TEMPERATURE: 'TRUE' }), true)
  assert.equal(omitsTemperature('giga', { LLM_OMIT_TEMPERATURE: 'yes' }), false)
  assert.equal(omitsTemperature('openrouter', { LLM_OMIT_TEMPERATURE: 'true' }), false)
  assert.equal(omitsTemperature('openrouter', { OPENROUTER_OMIT_TEMPERATURE: 'true' }), true)

  const bodies = []
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const baseEnv = {
    LLM_ROUTE_SUMMARY: 'giga',
    LLM_BASE_URL: 'https://giga.test',
    LLM_API_KEY: 'key',
    LLM_MODEL: 'model'
  }
  const call = async (env) => {
    const result = await requestChat({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.25,
      purpose: 'summary',
      stream: false,
      fetchImpl,
      env
    })
    await result.finalizeAttempt()
  }
  await call(baseEnv)
  assert.equal(bodies[0].temperature, 0.25)
  await call({ ...baseEnv, LLM_OMIT_TEMPERATURE: 'true' })
  assert.ok(!('temperature' in bodies[1]), 'temperature must be absent, not null')
})

test('retryable primary failure falls back and keeps one request identity', async () => {
  const calls = []
  const events = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    if (calls.length === 1) return new Response('busy', { status: 429 })
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.2,
    purpose: 'summary',
    stream: false,
    requestId: 'request-1',
    fetchImpl,
    onAttempt: async (attempt) => events.push(attempt),
    env: {
      LLM_ROUTE_SUMMARY: 'openrouter',
      LLM_FALLBACK_SUMMARY: 'giga',
      OPENROUTER_BASE_URL: 'https://openrouter.test/v1',
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_MODEL: 'or-model',
      LLM_BASE_URL: 'https://giga.test',
      LLM_API_KEY: 'giga-key',
      LLM_MODEL: 'giga-model'
    }
  })
  assert.equal(result.requestId, 'request-1')
  assert.equal(result.provider, 'giga')
  assert.equal(result.attempts.length, 1)
  await result.finalizeAttempt()
  assert.equal(result.attempts.length, 2)
  assert.deepEqual(events.map((attempt) => `${attempt.provider}:${attempt.status}`), [
    'openrouter:started',
    'openrouter:failed',
    'giga:started',
    'giga:completed'
  ])
  assert.equal(new Set(events.map((attempt) => attempt.event_id)).size, events.length)
  assert.equal(events[0].attempt_id, events[1].attempt_id)
  assert.equal(events[2].attempt_id, events[3].attempt_id)
  assert.deepEqual(calls.map((call) => call.url), [
    'https://openrouter.test/v1/chat/completions',
    'https://giga.test/v1/chat/completions'
  ])
  assert.deepEqual(calls[0].body.provider, { zdr: true, data_collection: 'deny' })
  assert.equal(calls[1].body.provider, undefined)
})

test('provider-local auth failure falls back to the configured secondary', async () => {
  let calls = 0
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }], purpose: 'summary', stream: false,
    fetchImpl: async () => {
      calls += 1
      return calls === 1
        ? new Response('expired key', { status: 401 })
        : new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 })
    },
    env: {
      LLM_ROUTE_SUMMARY: 'openrouter', LLM_FALLBACK_SUMMARY: 'giga',
      OPENROUTER_API_KEY: 'expired', OPENROUTER_MODEL: 'or-model',
      LLM_BASE_URL: 'https://giga.test', LLM_API_KEY: 'giga-key', LLM_MODEL: 'giga-model'
    }
  })
  assert.equal(result.provider, 'giga')
  assert.equal(calls, 2)
  await result.finalizeAttempt()
  assert.deepEqual(result.attempts.map((attempt) => attempt.retry_index), [0, 1])
})

test('Giga streaming requests usage and accepts an exact LiteLLM cost header', async () => {
  let body
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }],
    purpose: 'summary',
    stream: true,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'x-litellm-response-cost': '0.0125' }
      })
    },
    env: {
      LLM_ROUTE_SUMMARY: 'giga',
      LLM_BASE_URL: 'https://giga.test',
      LLM_API_KEY: 'giga-key',
      LLM_MODEL: 'giga-model'
    }
  })
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(result.responseCost, 0.0125)
  assert.equal(result.attempts.length, 0)
  await result.finalizeAttempt()
  await result.finalizeAttempt({ status: 'failed', error_code: 'NETWORK' })
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ['completed'])
})

for (const [name, response, expected] of [
  ['shared validation failure', new Response('invalid messages', { status: 400 }), 'VALIDATION'],
  ['moderation failure', new Response('content_filter blocked', { status: 422 }), 'CENSOR']
]) {
  test(`${name} is terminal and classified without fallback`, async () => {
    const events = []
    let calls = 0
    await assert.rejects(requestChat({
      messages: [{ role: 'user', content: 'hello' }],
      purpose: 'summary',
      stream: false,
      fetchImpl: async () => {
        calls += 1
        return response.clone()
      },
      onAttempt: async (attempt) => events.push(attempt),
      env: {
        LLM_ROUTE_SUMMARY: 'giga',
        LLM_FALLBACK_SUMMARY: 'openrouter',
        LLM_BASE_URL: 'https://giga.test',
        LLM_API_KEY: 'giga-key',
        LLM_MODEL: 'giga-model',
        OPENROUTER_API_KEY: 'or-key',
        OPENROUTER_MODEL: 'or-model'
      }
    }), (error) => error?.code === expected)
    assert.equal(calls, 1)
    assert.equal(events.at(-1).error_code, expected)
  })
}

test('cover route readiness and model come only from server environment', () => {
  assert.equal(coverRouteReadiness({}).ready, false)
  const configured = coverRouteReadiness({ OPENROUTER_API_KEY: 'or-key' })
  assert.equal(configured.ready, true)
  assert.equal(configured.model, 'openai/gpt-image-2')
  assert.equal(
    coverRouteReadiness({ OPENROUTER_API_KEY: 'or-key', OPENROUTER_IMAGE_MODEL: 'other/image' }).model,
    'other/image'
  )
})

test('cover request sends the server-side image contract to OpenRouter', async () => {
  const calls = []
  const result = await requestCoverImage({
    prompt: 'front cover artwork',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) })
      return new Response(
        JSON.stringify({ data: [{ b64_json: 'aGVsbG8=', media_type: 'image/jpeg' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    },
    env: {
      OPENROUTER_BASE_URL: 'https://openrouter.test/v1',
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_APP_NAME: 'Narra'
    }
  })
  assert.deepEqual(result, { image: 'aGVsbG8=', mimeType: 'image/jpeg', model: 'openai/gpt-image-2' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://openrouter.test/v1/images')
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer or-key')
  assert.equal(new Headers(calls[0].init.headers).get('x-title'), 'Narra')
  assert.deepEqual(calls[0].body, {
    model: 'openai/gpt-image-2',
    prompt: 'front cover artwork',
    aspect_ratio: '2:3',
    quality: 'high',
    output_format: 'jpeg',
    output_compression: 90,
    n: 1
  })
})

test('unconfigured cover route fails with NO_KEY before any network call', async () => {
  await assert.rejects(
    requestCoverImage({
      prompt: 'cover',
      env: {},
      fetchImpl: async () => { throw new Error('no calls expected') }
    }),
    (error) => error?.code === 'NO_KEY'
  )
})

for (const [name, response, expected] of [
  ['rate limit', () => new Response('rate limited', { status: 429 }), 'RATE'],
  ['moderation', () => new Response('content moderation blocked', { status: 422 }), 'CENSOR'],
  ['upstream outage', () => new Response('bad gateway', { status: 502 }), 'NETWORK'],
  ['empty result', () => new Response(JSON.stringify({ data: [] }), { status: 200 }), 'UNKNOWN']
]) {
  test(`cover ${name} is classified for the shared image fallback policy`, async () => {
    await assert.rejects(
      requestCoverImage({
        prompt: 'cover',
        fetchImpl: async () => response(),
        env: { OPENROUTER_API_KEY: 'or-key' }
      }),
      (error) => error?.code === expected
    )
  })
}
