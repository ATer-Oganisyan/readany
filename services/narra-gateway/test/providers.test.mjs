import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coverImageConfig,
  coverRouteReadiness,
  llmRouteReadiness,
  maxTokensFor,
  timeoutMsFor,
  mediaImageQualityForDimensions,
  normalizeImageTransportError,
  omitsJsonResponseFormat,
  omitsTemperature,
  requestChat,
  requestCoverImage,
  requestCoverImageWithFallback,
  routeForPurpose
} from '../providers/providers.mjs'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('provider route is selected only from server environment', () => {
  const route = routeForPurpose('summary', {
    LLM_ROUTE_SUMMARY: 'litellm',
    LLM_FALLBACK_SUMMARY: 'giga'
  })
  assert.deepEqual(route, ['litellm', 'giga'])
})

test('assistant defaults to the configured LiteLLM proxy while explicit routes still win', () => {
  const env = {
    LITELLM_BASE_URL: 'https://litellm.test/v1',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_MODEL: 'gpt-5.6-luna'
  }
  assert.deepEqual(routeForPurpose('assistant', env), ['litellm'])
  assert.deepEqual(routeForPurpose('assistant', {
    ...env,
    LLM_ROUTE_DEFAULT: 'giga'
  }), ['litellm'])
  assert.deepEqual(routeForPurpose('summary', env), ['giga'])
  assert.deepEqual(routeForPurpose('assistant', {
    ...env,
    LLM_ROUTE_ASSISTANT: 'giga'
  }), ['giga'])
})

test('provider request omits temperature when the caller leaves it unset', async () => {
  let body
  let headers
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }],
    purpose: 'structured_task',
    stream: false,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      headers = new Headers(init.headers)
      return new Response('{"choices":[{"message":{"content":"{}"}}]}', { status: 200 })
    },
    env: {
      LLM_ROUTE_STRUCTURED_TASK: 'giga',
      LLM_BASE_URL: 'https://giga.test',
      LLM_API_KEY: 'giga-key',
      LLM_MODEL_STRUCTURED_TASK: 'gpt-5.6-luna'
    }
  })
  assert.equal(Object.hasOwn(body, 'temperature'), false)
  assert.match(headers.get('x-request-id'), /^[0-9a-f-]{36}$/)
  assert.equal(result.responseCost, undefined)
  await result.finalizeAttempt()
})

test('assistant route forwards validated OpenAI tools through the server-owned model route', async () => {
  let body
  const tools = [{
    type: 'function',
    function: {
      name: 'list_books',
      description: 'List local books',
      parameters: { type: 'object', properties: {} }
    }
  }]
  const result = await requestChat({
    messages: [{ role: 'user', content: 'Что я читаю?' }],
    tools,
    toolChoice: 'auto',
    parallelToolCalls: false,
    purpose: 'assistant',
    stream: true,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('data: [DONE]\n\n', { status: 200 })
    },
    env: {
      LLM_ROUTE_ASSISTANT: 'litellm',
      LITELLM_BASE_URL: 'https://litellm.test/v1',
      LITELLM_API_KEY: 'proxy-key',
      LITELLM_MODEL_ASSISTANT: 'openrouter/openai/gpt-5.6-luna'
    }
  })

  assert.deepEqual(body.tools, tools)
  assert.equal(body.tool_choice, 'auto')
  assert.equal(body.parallel_tool_calls, false)
  assert.equal(body.model, 'openrouter/openai/gpt-5.6-luna')
  await result.finalizeAttempt()
})

test('character chat uses model-aware server sampling and ignores caller temperature', async () => {
  for (const provider of ['giga', 'litellm']) {
    let body
    const isLiteLlm = provider === 'litellm'
    const result = await requestChat({
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.1,
      purpose: 'character_chat',
      stream: false,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body)
        return new Response('{"choices":[{"message":{"content":"hello"}}]}', { status: 200 })
      },
      env: isLiteLlm
        ? {
            LLM_ROUTE_CHARACTER_CHAT: 'litellm',
            LITELLM_BASE_URL: 'https://litellm.test/v1',
            LITELLM_API_KEY: 'proxy-key',
            LITELLM_MODEL_CHARACTER_CHAT: 'openrouter/openai/gpt-5.6-luna'
          }
        : {
            LLM_ROUTE_CHARACTER_CHAT: 'giga',
            LLM_BASE_URL: 'https://giga.test',
            LLM_API_KEY: 'giga-key',
            LLM_MODEL_CHARACTER_CHAT: 'gpt-5.6-luna'
          }
    })
    assert.equal(body.temperature, 0.85)
    assert.equal(body.reasoning_effort, 'none')
    await result.finalizeAttempt()
  }
})

test('unknown models receive no optional sampling parameters', async () => {
  let body
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.1,
    purpose: 'character_chat',
    stream: false,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('{"choices":[{"message":{"content":"hello"}}]}', { status: 200 })
    },
    env: {
      LLM_ROUTE_CHARACTER_CHAT: 'giga',
      LLM_BASE_URL: 'https://giga.test',
      LLM_API_KEY: 'giga-key',
      LLM_MODEL_CHARACTER_CHAT: 'future-model'
    }
  })
  assert.equal(Object.hasOwn(body, 'temperature'), false)
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
  await result.finalizeAttempt()
})

test('readiness requires a complete configured route for every purpose', () => {
  const broken = llmRouteReadiness({ LITELLM_API_KEY: 'key', LLM_ROUTE_DEFAULT: 'litellm' })
  assert.equal(broken.ready, false)
  assert.equal(broken.purposes.summary.ready, false)
  const ready = llmRouteReadiness({
    LLM_ROUTE_DEFAULT: 'giga', LLM_BASE_URL: 'https://giga.test',
    LLM_API_KEY: 'key', LLM_MODEL: 'model'
  })
  assert.equal(ready.ready, true)
})

test('сколько ждать модель — настройка, а не константа в коде', () => {
  // Потолок был зашит: 120 секунд на любой нестримовый вызов. Подтверждение
  // состава большой книги в них не укладывалось и уходило в повтор, чтобы
  // упереться снова — менять было нечего.
  assert.equal(timeoutMsFor('roster_confirm', false, {}), 120_000)
  assert.equal(timeoutMsFor('summary', true, {}), 180_000)
  assert.equal(
    timeoutMsFor('roster_confirm', false, { LLM_TIMEOUT_MS_ROSTER_CONFIRM: '240000' }),
    240_000
  )
  // Точечная настройка сильнее режимной, как и у потолка токенов.
  assert.equal(
    timeoutMsFor('roster_confirm', false, {
      LLM_TIMEOUT_MS_COMPLETE: '90000',
      LLM_TIMEOUT_MS_ROSTER_CONFIRM: '240000'
    }),
    240_000
  )
  assert.equal(timeoutMsFor('summary', false, { LLM_TIMEOUT_MS_COMPLETE: '90000' }), 90_000)
  // Пять минут — потолок: дальше истекает запрос самого генератора.
  assert.equal(timeoutMsFor('summary', false, { LLM_TIMEOUT_MS_COMPLETE: '900000' }), 300_000)
  assert.equal(timeoutMsFor('summary', false, { LLM_TIMEOUT_MS_COMPLETE: '10' }), 120_000)
  assert.equal(timeoutMsFor('summary', false, { LLM_TIMEOUT_MS_COMPLETE: 'мусор' }), 120_000)
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
  const fetchImpl = async (_url, init) => {
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

test('legacy provider omit flags stay scoped while request sampling remains server-owned', async () => {
  assert.equal(omitsTemperature('giga', {}), false)
  assert.equal(omitsTemperature('giga', { LLM_OMIT_TEMPERATURE: 'true' }), true)
  assert.equal(omitsTemperature('giga', { LLM_OMIT_TEMPERATURE: 'TRUE' }), true)
  assert.equal(omitsTemperature('giga', { LLM_OMIT_TEMPERATURE: 'yes' }), false)
  assert.equal(omitsTemperature('litellm', { LLM_OMIT_TEMPERATURE: 'true' }), false)
  assert.equal(omitsTemperature('litellm', { LITELLM_OMIT_TEMPERATURE: 'true' }), true)

  const bodies = []
  const fetchImpl = async (_url, init) => {
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
  assert.ok(!('temperature' in bodies[0]), 'an unknown model must not inherit caller sampling')
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
      LLM_ROUTE_SUMMARY: 'litellm',
      LLM_FALLBACK_SUMMARY: 'giga',
      LITELLM_BASE_URL: 'https://litellm.test/v1',
      LITELLM_API_KEY: 'proxy-key',
      LITELLM_MODEL: 'openrouter/model',
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
    'litellm:started',
    'litellm:failed',
    'giga:started',
    'giga:completed'
  ])
  assert.equal(new Set(events.map((attempt) => attempt.event_id)).size, events.length)
  assert.equal(events[0].attempt_id, events[1].attempt_id)
  assert.equal(events[2].attempt_id, events[3].attempt_id)
  assert.deepEqual(calls.map((call) => call.url), [
    'https://litellm.test/v1/chat/completions',
    'https://giga.test/v1/chat/completions'
  ])
  assert.equal(calls[0].body.provider, undefined)
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
      LLM_ROUTE_SUMMARY: 'litellm', LLM_FALLBACK_SUMMARY: 'giga',
      LITELLM_BASE_URL: 'https://litellm.test/v1',
      LITELLM_API_KEY: 'expired', LITELLM_MODEL: 'openrouter/model',
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
        LLM_FALLBACK_SUMMARY: 'litellm',
        LLM_BASE_URL: 'https://giga.test',
        LLM_API_KEY: 'giga-key',
        LLM_MODEL: 'giga-model',
        LITELLM_BASE_URL: 'https://litellm.test/v1',
        LITELLM_API_KEY: 'proxy-key',
        LITELLM_MODEL: 'openrouter/model'
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
  assert.equal(configured.fallbackModel, 'google/gemini-3.1-flash-image')
  assert.equal(
    coverRouteReadiness({ OPENROUTER_API_KEY: 'or-key', OPENROUTER_IMAGE_MODEL: 'other/image' }).model,
    'other/image'
  )
})

test('cover image route can explicitly use LiteLLM without direct OpenRouter credentials', () => {
  const env = {
    COVER_IMAGE_PROVIDER: 'litellm',
    LITELLM_BASE_URL: 'https://litellm.test',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_IMAGE_MODEL: 'gpt-image-2'
  }

  assert.deepEqual(coverRouteReadiness(env), {
    ready: true,
    provider: 'litellm',
    model: 'gpt-image-2',
    fallbackModel: 'openrouter/google/gemini-3.1-flash-image'
  })
  assert.equal(coverImageConfig(env).baseUrl, 'https://litellm.test/v1')
})

test('LiteLLM cover request uses the standard images generations contract', async () => {
  let captured
  const result = await requestCoverImage({
    prompt: 'front cover artwork',
    aspectRatio: '2:3',
    requestId: 'cover-request-1',
    fetchImpl: async (url, init) => {
      captured = {
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(init.body)
      }
      return new Response(JSON.stringify({
        created: 123,
        data: [{ b64_json: PNG_BASE64, media_type: 'image/jpeg' }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    },
    env: {
      COVER_IMAGE_PROVIDER: 'litellm',
      LITELLM_BASE_URL: 'https://litellm.test',
      LITELLM_API_KEY: 'proxy-key',
      LITELLM_IMAGE_MODEL: 'gpt-image-2'
    }
  })

  assert.equal(result.image, PNG_BASE64)
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.model, 'gpt-image-2')
  assert.equal(result.provider, 'litellm')
  assert.equal(result.requestId, 'cover-request-1')
  assert.equal(result.responseCost, undefined)
  assert.deepEqual(result.attempts.map(({ status, retry_index: retryIndex }) => ({ status, retryIndex })), [
    { status: 'completed', retryIndex: 0 }
  ])
  assert.equal(captured.url, 'https://litellm.test/v1/images/generations')
  assert.equal(captured.headers.get('authorization'), 'Bearer proxy-key')
  assert.equal(captured.headers.get('x-request-id'), 'cover-request-1')
  assert.deepEqual(captured.body, {
    model: 'gpt-image-2',
    prompt: 'front cover artwork',
    n: 1,
    size: '1024x1536',
    quality: 'high',
    output_format: 'png'
  })
})

test('LiteLLM cover route falls back from GPT Image 2 to Nano Banana 2', async () => {
  const models = []
  const bodies = []
  const result = await requestCoverImageWithFallback({
    prompt: 'front cover artwork',
    quality: 'low',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      models.push(body.model)
      bodies.push(body)
      if (models.length === 1) return new Response('upstream unavailable', { status: 502 })
      return new Response(JSON.stringify({ data: [{ b64_json: 'bmFuby1iYW5hbmE=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    },
    env: {
      COVER_IMAGE_PROVIDER: 'litellm',
      LITELLM_BASE_URL: 'https://litellm.test',
      LITELLM_API_KEY: 'proxy-key',
      LITELLM_IMAGE_MODEL: 'gpt-image-2'
    }
  })

  assert.deepEqual(models, [
    'gpt-image-2',
    'openrouter/google/gemini-3.1-flash-image'
  ])
  assert.equal(result.model, 'openrouter/google/gemini-3.1-flash-image')
  assert.deepEqual(result.attempts.map(({ status, retry_index: retryIndex }) => ({ status, retryIndex })), [
    { status: 'failed', retryIndex: 0 },
    { status: 'completed', retryIndex: 1 }
  ])
  assert.equal(bodies[0].quality, 'low')
  assert.equal(Object.hasOwn(bodies[0], 'resolution'), false)
  assert.equal(bodies[1].aspect_ratio, '2:3')
  assert.equal(bodies[1].resolution, '1K')
  assert.equal(Object.hasOwn(bodies[1], 'quality'), false)
})

test('LiteLLM cover route requires an explicit staging plaintext allowlist', () => {
  const base = {
    COVER_IMAGE_PROVIDER: 'litellm',
    LITELLM_BASE_URL: 'http://192.0.2.10:4000',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_IMAGE_MODEL: 'gpt-image-2',
    NODE_ENV: 'production',
    ANALYTICS_ENV: 'staging'
  }

  assert.throws(() => coverImageConfig(base), /LITELLM_BASE_URL must use HTTPS/)
  assert.equal(coverImageConfig({
    ...base,
    ALLOW_INSECURE_LLM_HTTP: 'true',
    LLM_INSECURE_HTTP_HOSTS: '192.0.2.10'
  }).baseUrl, 'http://192.0.2.10:4000/v1')
  assert.throws(() => coverImageConfig({
    ...base,
    ANALYTICS_ENV: 'production',
    ALLOW_INSECURE_LLM_HTTP: 'true',
    LLM_INSECURE_HTTP_HOSTS: '192.0.2.10'
  }), /plaintext HTTP is forbidden in production/)
})

test('LiteLLM cover route normalizes standard JSON image errors', async () => {
  await assert.rejects(
    requestCoverImage({
      prompt: 'cover',
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: 'invalid image size', type: 'invalid_request_error' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }),
      env: {
        COVER_IMAGE_PROVIDER: 'litellm',
        LITELLM_BASE_URL: 'https://litellm.test/v1',
        LITELLM_API_KEY: 'proxy-key',
        LITELLM_IMAGE_MODEL: 'gpt-image-2'
      }
    }),
    (error) => error?.code === 'VALIDATION' && /LiteLLM/.test(error.message)
  )
})

test('temporary primary image failure falls back to Nano Banana', async () => {
  const models = []
  const result = await requestCoverImageWithFallback({
    prompt: 'character portrait',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      models.push(body.model)
      if (models.length === 1) return new Response('rate limited', { status: 429 })
      return new Response(
        JSON.stringify({ data: [{ b64_json: 'bmFuby1iYW5hbmE=', media_type: 'image/png' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    },
    env: { OPENROUTER_API_KEY: 'or-key' }
  })

  assert.deepEqual(models, ['openai/gpt-image-2', 'google/gemini-3.1-flash-image'])
  assert.equal(result.model, 'google/gemini-3.1-flash-image')
})

test('Nano Banana fallback can be overridden by the server environment', async () => {
  const models = []
  await requestCoverImageWithFallback({
    prompt: 'cover',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      models.push(body.model)
      if (models.length === 1) return new Response('bad gateway', { status: 502 })
      return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    },
    env: {
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_IMAGE_FALLBACK_MODEL: 'google/custom-nano-banana'
    }
  })

  assert.deepEqual(models, ['openai/gpt-image-2', 'google/custom-nano-banana'])
})

test('moderation rejection does not fall back to Nano Banana', async () => {
  let calls = 0
  await assert.rejects(
    requestCoverImageWithFallback({
      prompt: 'cover',
      fetchImpl: async () => {
        calls += 1
        return new Response('content moderation blocked', { status: 422 })
      },
      env: { OPENROUTER_API_KEY: 'or-key' }
    }),
    (error) => error?.code === 'CENSOR'
  )
  assert.equal(calls, 1)
})

test('character portrait can fall back after a moderation rejection', async () => {
  const models = []
  const result = await requestCoverImageWithFallback({
    prompt: 'fictional character portrait',
    allowCensorFallback: true,
    fetchImpl: async (_url, init) => {
      const model = JSON.parse(init.body).model
      models.push(model)
      if (models.length === 1) {
        return new Response('content moderation blocked', { status: 400 })
      }
      return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    },
    env: {
      COVER_IMAGE_PROVIDER: 'litellm',
      LITELLM_BASE_URL: 'https://litellm.test',
      LITELLM_API_KEY: 'proxy-key',
      LITELLM_IMAGE_MODEL: 'gpt-image-2'
    }
  })

  assert.deepEqual(models, ['gpt-image-2', 'openrouter/google/gemini-3.1-flash-image'])
  assert.equal(result.model, 'openrouter/google/gemini-3.1-flash-image')
  assert.deepEqual(result.attempts.map(({ error_code }) => error_code), ['CENSOR', undefined])
})

test('character portrait preserves both moderation refusals and stops after the fallback', async () => {
  const requestId = 'portrait-refused-twice'
  const calls = []
  await assert.rejects(
    requestCoverImageWithFallback({
      prompt: 'fictional character portrait',
      requestId,
      allowCensorFallback: true,
      fetchImpl: async (_url, init) => {
        calls.push({
          model: JSON.parse(init.body).model,
          requestId: new Headers(init.headers).get('x-request-id')
        })
        return new Response(
          calls.length === 1 ? 'primary moderation blocked' : 'fallback moderation blocked',
          { status: 400 }
        )
      },
      env: {
        COVER_IMAGE_PROVIDER: 'litellm',
        LITELLM_BASE_URL: 'https://litellm.test',
        LITELLM_API_KEY: 'proxy-key',
        LITELLM_IMAGE_MODEL: 'gpt-image-2'
      }
    }),
    (error) => {
      assert.equal(error.code, 'CENSOR')
      assert.equal(error.status, 400)
      assert.equal(error.providerDetail, 'fallback moderation blocked')
      assert.equal(error.requestId, requestId)
      assert.deepEqual(error.attempts.map((attempt) => ({
        model: attempt.model,
        status: attempt.status,
        httpStatus: attempt.http_status,
        errorCode: attempt.error_code,
        retryIndex: attempt.retry_index
      })), [
        {
          model: 'gpt-image-2', status: 'failed', httpStatus: 400,
          errorCode: 'CENSOR', retryIndex: 0
        },
        {
          model: 'openrouter/google/gemini-3.1-flash-image', status: 'failed',
          httpStatus: 400, errorCode: 'CENSOR', retryIndex: 1
        }
      ])
      assert.notEqual(error.attempts[0].attempt_id, error.attempts[1].attempt_id)
      return true
    }
  )
  assert.deepEqual(calls, [
    { model: 'gpt-image-2', requestId },
    { model: 'openrouter/google/gemini-3.1-flash-image', requestId }
  ])
})

const portraitCascadeEnv = {
  COVER_IMAGE_PROVIDER: 'litellm',
  LITELLM_BASE_URL: 'https://litellm.test',
  LITELLM_API_KEY: 'proxy-key',
  LITELLM_IMAGE_MODEL: 'gpt-image-2'
}

test('enabled portrait cascade follows every HTTP 400 until a model succeeds', async () => {
  const requestId = 'portrait-cascade'
  const calls = []
  const result = await requestCoverImageWithFallback({
    prompt: 'fictional character portrait',
    requestId,
    cascadeOnHttp400: true,
    fallbackModels: ['fallback-one', 'fallback-two'],
    env: portraitCascadeEnv,
    fetchImpl: async (_url, init) => {
      calls.push({
        model: JSON.parse(init.body).model,
        requestId: new Headers(init.headers).get('x-request-id')
      })
      return calls.length < 3
        ? new Response('invalid for this model', { status: 400 })
        : new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    }
  })

  assert.deepEqual(calls, [
    { model: 'gpt-image-2', requestId },
    { model: 'fallback-one', requestId },
    { model: 'fallback-two', requestId }
  ])
  assert.equal(result.model, 'fallback-two')
  assert.deepEqual(result.attempts.map(({ http_status, retry_index }) => [http_status, retry_index]), [
    [400, 0], [400, 1], [200, 2]
  ])
})

test('enabled portrait cascade sends a 5xx to the delayed job retry without switching models', async () => {
  const calls = []
  await assert.rejects(
    requestCoverImageWithFallback({
      prompt: 'fictional character portrait',
      cascadeOnHttp400: true,
      fallbackModels: ['fallback-one', 'fallback-two'],
      env: portraitCascadeEnv,
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(init.body).model)
        return new Response('upstream unavailable', { status: 503 })
      }
    }),
    (error) => {
      assert.equal(error.status, 503)
      assert.equal(error.code, 'NETWORK')
      assert.deepEqual(error.attempts.map(({ http_status }) => http_status), [503])
      return true
    }
  )
  assert.deepEqual(calls, ['gpt-image-2'])
})

test('enabled portrait cascade limits a slow model to its share of the total budget', async () => {
  const calls = []
  await assert.rejects(
    requestCoverImageWithFallback({
      prompt: 'fictional character portrait',
      cascadeOnHttp400: true,
      cascadeBudgetMs: 180,
      fallbackModels: ['fallback-one', 'fallback-two'],
      env: portraitCascadeEnv,
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(init.body).model)
        if (calls.length === 1) return new Response('invalid', { status: 400 })
        return new Promise((_resolve, reject) => {
          const guard = setTimeout(() => reject(new Error('model exceeded its cascade budget')), 2_000)
          init.signal.addEventListener('abort', () => {
            clearTimeout(guard)
            reject(init.signal.reason)
          }, { once: true })
        })
      }
    }),
    (error) => {
      assert.equal(error.status, 504)
      assert.equal(error.code, 'TIMEOUT')
      assert.deepEqual(error.attempts.map(({ error_code, retry_index }) => [error_code, retry_index]), [
        ['VALIDATION', 0], ['TIMEOUT', 1]
      ])
      return true
    }
  )
  assert.deepEqual(calls, ['gpt-image-2', 'fallback-one'])
})

test('enabled portrait cascade switches models only for HTTP 400', async () => {
  for (const [status, expectedCode] of [[422, 'CENSOR'], [429, 'RATE']]) {
    const calls = []
    await assert.rejects(
      requestCoverImageWithFallback({
        prompt: 'fictional character portrait',
        cascadeOnHttp400: true,
        fallbackModels: ['fallback-one'],
        env: portraitCascadeEnv,
        fetchImpl: async (_url, init) => {
          calls.push(JSON.parse(init.body).model)
          return new Response('upstream refused', { status })
        }
      }),
      (error) => error.status === status && error.code === expectedCode
    )
    assert.deepEqual(calls, ['gpt-image-2'])
  }
})

test('enabled portrait cascade stops on a fallback 5xx and retries the whole job later', async () => {
  const calls = []
  await assert.rejects(
    requestCoverImageWithFallback({
      prompt: 'fictional character portrait',
      cascadeOnHttp400: true,
      fallbackModels: ['fallback-one', 'fallback-two'],
      env: portraitCascadeEnv,
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(init.body).model)
        return new Response(calls.length === 1 ? 'invalid' : 'upstream unavailable', {
          status: calls.length === 1 ? 400 : 502
        })
      }
    }),
    (error) => {
      assert.equal(error.status, 502)
      assert.equal(error.code, 'NETWORK')
      assert.deepEqual(error.attempts.map(({ http_status }) => http_status), [400, 502])
      return true
    }
  )
  assert.deepEqual(calls, ['gpt-image-2', 'fallback-one'])
})

test('enabled portrait cascade ends after every model returns HTTP 400', async () => {
  const calls = []
  await assert.rejects(
    requestCoverImageWithFallback({
      prompt: 'fictional character portrait',
      cascadeOnHttp400: true,
      fallbackModels: ['fallback-one', 'fallback-two'],
      env: portraitCascadeEnv,
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(init.body).model)
        return new Response('content moderation blocked', { status: 400 })
      }
    }),
    (error) => {
      assert.equal(error.status, 400)
      assert.equal(error.code, 'PORTRAIT_CASCADE_EXHAUSTED')
      assert.deepEqual(error.attempts.map(({ error_code, retry_index }) => [error_code, retry_index]), [
        ['CENSOR', 0], ['CENSOR', 1], ['CENSOR', 2]
      ])
      return true
    }
  )
  assert.deepEqual(calls, ['gpt-image-2', 'fallback-one', 'fallback-two'])
})

test('disabled portrait cascade keeps the original single-fallback rule', async () => {
  const calls = []
  await assert.rejects(
    requestCoverImageWithFallback({
      prompt: 'fictional character portrait',
      cascadeOnHttp400: false,
      fallbackModels: ['fallback-one', 'fallback-two'],
      env: portraitCascadeEnv,
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(init.body).model)
        return new Response('invalid request', { status: 400 })
      }
    }),
    (error) => error.code === 'VALIDATION'
  )
  assert.deepEqual(calls, ['gpt-image-2'])
})

test('raw AbortSignal timeout is normalized and falls back to Nano Banana', async () => {
  const models = []
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  assert.equal(typeof timeout.code, 'number')
  const result = await requestCoverImageWithFallback({
    prompt: 'cover',
    fetchImpl: async (_url, init) => {
      const model = JSON.parse(init.body).model
      models.push(model)
      if (models.length === 1) throw timeout
      return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    },
    env: { OPENROUTER_API_KEY: 'or-key' }
  })
  assert.deepEqual(models, ['openai/gpt-image-2', 'google/gemini-3.1-flash-image'])
  assert.equal(result.model, 'google/gemini-3.1-flash-image')
})

test('native transport codes are normalized to the closed image error vocabulary', () => {
  const network = normalizeImageTransportError(
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
  )
  assert.equal(network.code, 'NETWORK')
  assert.equal(network.status, 502)

  const timeout = normalizeImageTransportError(
    Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
  )
  assert.equal(timeout.code, 'TIMEOUT')
  assert.equal(timeout.status, 504)
})

test('cover request sends the server-side image contract to OpenRouter', async () => {
  const calls = []
  const result = await requestCoverImage({
    prompt: 'front cover artwork',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) })
      return new Response(
        JSON.stringify({ data: [{ b64_json: PNG_BASE64, media_type: 'image/jpeg' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    },
    env: {
      OPENROUTER_BASE_URL: 'https://openrouter.test/v1',
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_APP_NAME: 'Narra'
    }
  })
  assert.equal(result.image, PNG_BASE64)
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.model, 'openai/gpt-image-2')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://openrouter.test/v1/images')
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer or-key')
  assert.equal(new Headers(calls[0].init.headers).get('x-title'), 'Narra')
  assert.deepEqual(calls[0].body, {
    model: 'openai/gpt-image-2',
    prompt: 'front cover artwork',
    aspect_ratio: '2:3',
    quality: 'high',
    output_format: 'png',
    n: 1
  })
})

test('image response exposes exact cost and usage without treating a missing header as zero', async () => {
  const env = {
    COVER_IMAGE_PROVIDER: 'litellm',
    LITELLM_BASE_URL: 'https://litellm.test',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_IMAGE_MODEL: 'gpt-image-2'
  }
  const priced = await requestCoverImage({
    prompt: 'cover',
    env,
    fetchImpl: async () => new Response(JSON.stringify({
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, cost: 0.25 },
      data: [{ b64_json: PNG_BASE64 }]
    }), {
      status: 200,
      headers: { 'x-litellm-response-cost': '0.25' }
    })
  })
  assert.deepEqual(priced.usage, {
    input_tokens: 10, output_tokens: 20, total_tokens: 30, cost: 0.25
  })
  assert.equal(priced.responseCost, 0.25)

  const unpriced = await requestCoverImage({
    prompt: 'cover',
    env,
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
      status: 200
    })
  })
  assert.equal(unpriced.responseCost, undefined)
  assert.equal(unpriced.usage, null)
})

test('OpenRouter image request accepts a server-selected portrait aspect ratio', async () => {
  const calls = []
  await requestCoverImage({
    prompt: 'character portrait',
    aspectRatio: '3:4',
    quality: 'low',
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body))
      return new Response(
        JSON.stringify({ data: [{ b64_json: 'aGVsbG8=', media_type: 'image/jpeg' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    },
    env: { OPENROUTER_API_KEY: 'or-key' }
  })
  assert.equal(calls[0].aspect_ratio, '3:4')
  assert.equal(calls[0].quality, 'low')
})

test('legacy media dimensions select portrait and scene quality independently', () => {
  const qualities = {
    portraitQuality: 'medium',
    sceneQuality: 'low'
  }
  assert.equal(mediaImageQualityForDimensions({ width: 768, height: 1024, ...qualities }), 'medium')
  assert.equal(mediaImageQualityForDimensions({ width: 1024, height: 1024, ...qualities }), 'low')
  assert.equal(mediaImageQualityForDimensions({ width: 1536, height: 1024, ...qualities }), 'low')
  assert.equal(mediaImageQualityForDimensions({ width: 1024, height: 1536 }), 'high')
})

test('image request rejects an unsupported server-selected quality', async () => {
  await assert.rejects(
    requestCoverImage({
      prompt: 'cover',
      quality: 'ultra',
      env: { OPENROUTER_API_KEY: 'or-key' },
      fetchImpl: async () => { throw new Error('no calls expected') }
    }),
    /Unsupported image quality: ultra/
  )
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

test('a structured task asks the model for a JSON object, and other purposes do not', async () => {
  // Разбор ответа структурной задачи — `JSON.parse`, поэтому формат тут часть
  // контракта. Без него reasoning-модель тратит весь `max_tokens` на
  // рассуждение и отдаёт пустой content: замер на deepseek-v4-flash дал 6367
  // reasoning-токенов и 58 секунд против нуля и двух секунд с форматом.
  const bodies = {}
  const env = {
    LLM_ROUTE_STRUCTURED_TASK: 'litellm',
    LLM_ROUTE_CHARACTER_CHAT: 'litellm',
    LITELLM_BASE_URL: 'https://litellm.test/v1',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_MODEL: 'deepseek/deepseek-v4-flash'
  }
  const call = async (purpose, extraEnv = {}) => {
    const result = await requestChat({
      messages: [{ role: 'user', content: 'hello' }],
      purpose,
      stream: false,
      fetchImpl: async (_url, init) => {
        bodies[purpose] = JSON.parse(init.body)
        return new Response('{"choices":[{"message":{"content":"{}"}}]}', { status: 200 })
      },
      env: { ...env, ...extraEnv }
    })
    await result.finalizeAttempt()
    return bodies[purpose]
  }

  assert.deepEqual((await call('structured_task')).response_format, { type: 'json_object' })
  assert.equal(Object.hasOwn(await call('character_chat'), 'response_format'), false)
  // Назначение, унаследовавшее модель структурных задач, наследует и форму
  // запроса. Пока проверка шла напрямую, `roster_confirm` уходил на ту же
  // модель без формата, и рассуждающая модель тратила на рассуждение весь
  // потолок токенов, не закрыв JSON.
  assert.deepEqual((await call('roster_confirm')).response_format, { type: 'json_object' })

  // Провайдер, который формат не принимает, отключается настройкой, а не
  // молчаливым отказом от формата.
  const opted = await call('structured_task', { LITELLM_OMIT_JSON_RESPONSE_FORMAT: 'true' })
  assert.equal(Object.hasOwn(opted, 'response_format'), false)
})

test('the JSON response format opt-out is per provider, like the temperature one', () => {
  assert.equal(omitsJsonResponseFormat('giga', {}), false)
  assert.equal(omitsJsonResponseFormat('giga', { LLM_OMIT_JSON_RESPONSE_FORMAT: 'true' }), true)
  assert.equal(omitsJsonResponseFormat('giga', { LLM_OMIT_JSON_RESPONSE_FORMAT: 'yes' }), false)
  assert.equal(omitsJsonResponseFormat('litellm', { LLM_OMIT_JSON_RESPONSE_FORMAT: 'true' }), false)
  assert.equal(omitsJsonResponseFormat('litellm', { LITELLM_OMIT_JSON_RESPONSE_FORMAT: 'TRUE' }), true)
})

test('roster confirmation can get its own model and inherits the structured one until it does', () => {
  // Это единственная стадия, где решение — суждение, а не извлечение: слитые
  // люди не разделяются обратно. Замер на «Обломове» и «Герое» со снятым
  // запретом по со-упоминанию: deepseek-v4-flash и v4-pro при JSON-формате
  // теряют рассуждение и штампуют все пары подряд (99 из 99, 56 кандидатов в
  // одного человека), gemma скачет от прогона к прогону, а gpt-5.6-sol дважды
  // подряд не сделал ни одного ложного слияния.
  //
  // Наследование обязательно: без него добавление назначения увело бы стадию
  // на маршрут по умолчанию — молча и у всех сразу.
  const structured = {
    LLM_ROUTE_STRUCTURED_TASK: 'litellm',
    LITELLM_BASE_URL: 'https://litellm.test/v1',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_MODEL: 'gpt-5.6-luna',
    LITELLM_MODEL_STRUCTURED_TASK: 'deepseek/deepseek-v4-flash',
    LLM_MAX_TOKENS_STRUCTURED_TASK: '8000'
  }
  assert.deepEqual(routeForPurpose('roster_confirm', structured), ['litellm'])
  assert.equal(maxTokensFor('roster_confirm', false, structured), 8000)

  const own = {
    ...structured,
    LITELLM_MODEL_ROSTER_CONFIRM: 'gpt-5.6-sol',
    LLM_MAX_TOKENS_ROSTER_CONFIRM: '16000'
  }
  assert.equal(maxTokensFor('roster_confirm', false, own), 16000)
  assert.equal(maxTokensFor('structured_task', false, own), 8000)
  assert.deepEqual(llmRouteReadiness(own).purposes.roster_confirm.configured, ['litellm'])
})

test('a stage model reaches the provider request, and the general one still serves the rest', async () => {
  const models = {}
  const env = {
    LLM_ROUTE_STRUCTURED_TASK: 'litellm',
    LITELLM_BASE_URL: 'https://litellm.test/v1',
    LITELLM_API_KEY: 'proxy-key',
    LITELLM_MODEL_STRUCTURED_TASK: 'deepseek/deepseek-v4-flash',
    LITELLM_MODEL_ROSTER_CONFIRM: 'gpt-5.6-sol'
  }
  for (const purpose of ['structured_task', 'roster_confirm']) {
    const result = await requestChat({
      messages: [{ role: 'user', content: 'hello' }],
      purpose,
      stream: false,
      fetchImpl: async (_url, init) => {
        models[purpose] = JSON.parse(init.body).model
        return new Response('{"choices":[{"message":{"content":"{}"}}]}', { status: 200 })
      },
      env
    })
    await result.finalizeAttempt()
  }
  assert.deepEqual(models, {
    structured_task: 'deepseek/deepseek-v4-flash',
    roster_confirm: 'gpt-5.6-sol'
  })
})
