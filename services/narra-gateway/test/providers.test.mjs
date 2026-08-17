import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coverImageConfig,
  coverRouteReadiness,
  llmRouteReadiness,
  maxTokensFor,
  normalizeImageTransportError,
  omitsTemperature,
  requestChat,
  requestCoverImage,
  requestCoverImageWithFallback,
  routeForPurpose
} from '../providers.mjs'

test('provider route is selected only from server environment', () => {
  const route = routeForPurpose('summary', {
    LLM_ROUTE_SUMMARY: 'litellm',
    LLM_FALLBACK_SUMMARY: 'giga'
  })
  assert.deepEqual(route, ['litellm', 'giga'])
})

test('provider request omits temperature when the caller leaves it unset', async () => {
  let body
  const result = await requestChat({
    messages: [{ role: 'user', content: 'hello' }],
    purpose: 'structured_task',
    stream: false,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
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
        data: [{ b64_json: 'aGVsbG8=' }]
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

  assert.deepEqual(result, {
    image: 'aGVsbG8=',
    mimeType: 'image/jpeg',
    model: 'gpt-image-2'
  })
  assert.equal(captured.url, 'https://litellm.test/v1/images/generations')
  assert.equal(captured.headers.get('authorization'), 'Bearer proxy-key')
  assert.equal(captured.headers.get('x-request-id'), 'cover-request-1')
  assert.deepEqual(captured.body, {
    model: 'gpt-image-2',
    prompt: 'front cover artwork',
    n: 1,
    size: '1024x1536',
    quality: 'high',
    output_format: 'jpeg'
  })
})

test('LiteLLM cover route falls back from GPT Image 2 to Nano Banana 2', async () => {
  const models = []
  const bodies = []
  const result = await requestCoverImageWithFallback({
    prompt: 'front cover artwork',
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
  assert.equal(bodies[0].quality, 'high')
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

test('OpenRouter image request accepts a server-selected portrait aspect ratio', async () => {
  const calls = []
  await requestCoverImage({
    prompt: 'character portrait',
    aspectRatio: '3:4',
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
