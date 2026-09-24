import { randomUUID } from 'node:crypto'
import { withTimeout } from '../platform/concurrency.mjs'
import { PORTRAIT_CASCADE_MAX_BUDGET_MS } from '../platform/generation-timeouts.mjs'
import {
  PORTRAIT_CASCADE_EXHAUSTED,
  imageUpstreamError
} from './image-policy.mjs'
import { purposeChain } from './purpose-inheritance.mjs'
import { requestOptionsForModel } from './model-request-config.mjs'
export { omitsJsonResponseFormat } from './model-request-config.mjs'
import { serviceUrl } from '../platform/service-url.mjs'

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504])
const PURPOSES = [
  'assistant', 'character_chat', 'structured_task', 'roster_confirm',
  'summary', 'scenario', 'memory'
]

/**
 * Назначение, у которого настройка наследуется.
 *
 * Подтверждение состава — структурная задача, и по умолчанию оно идёт туда же,
 * куда все структурные. Своя запись нужна ему потому, что это единственная
 * стадия, где решение принимается суждением, а не извлечением: там дороже
 * ошибка и нужна другая модель. Без наследования добавление назначения увело
 * бы его на маршрут по умолчанию — молча и у всех сразу.
 */

function purposeSetting(env, prefix, purpose, suffix = '') {
  for (const name of purposeChain(purpose)) {
    const key = `${prefix}${name.toUpperCase()}${suffix}`
    if (Object.hasOwn(env, key) && String(env[key] ?? '').trim()) return env[key]
  }
  return ''
}

function purposeSettingDeclared(env, prefix, purpose) {
  for (const name of purposeChain(purpose)) {
    const key = `${prefix}${name.toUpperCase()}`
    if (Object.hasOwn(env, key)) return { declared: true, value: env[key] }
  }
  return { declared: false, value: undefined }
}
const TEXT_PROVIDERS = new Set(['giga', 'litellm'])
const MODERATION_RESPONSE = /content.?filter|moderation|safety|unsafe|censor|blocked|bad_[a-z_]*lemmas|запрещ|цензур|безопасност/i
const IMAGE_ERROR_CODES = new Set([
  'AUTH', 'NO_KEY', 'NETWORK', 'RATE', 'TIMEOUT', 'VALIDATION',
  'CENSOR', 'PARSE', 'UNKNOWN', 'CANCELLED'
])

function httpErrorCode(status, detail) {
  if (MODERATION_RESPONSE.test(String(detail || ''))) return 'CENSOR'
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 408) return 'TIMEOUT'
  if (status === 429) return 'RATE'
  if (status >= 400 && status < 500 && ![404, 409].includes(status)) return 'VALIDATION'
  return 'NETWORK'
}

// Reasoning-модели (gpt-5.6-luna и родня) принимают только температуру по
// умолчанию и отвечают 400 на любое явное значение. Клиентский контракт при
// этом температуру шлёт, поэтому убираем её на выходе из шлюза, а не у клиента.
export function omitsTemperature(providerName, env = process.env) {
  const raw = providerName === 'litellm'
    ? env.LITELLM_OMIT_TEMPERATURE
    : env.LLM_OMIT_TEMPERATURE
  return String(raw ?? '').trim().toLowerCase() === 'true'
}

function openAiBaseUrl(raw) {
  const value = String(raw || '').replace(/\/+$/, '')
  if (!value) return ''
  return value.endsWith('/v1') ? value : `${value}/v1`
}

function providerConfig(name, purpose, env) {
  if (name === 'litellm') {
    return {
      name,
      baseUrl: openAiBaseUrl(env.LITELLM_BASE_URL),
      apiKey: String(env.LITELLM_API_KEY || '').trim(),
      model: String(
        purposeSetting(env, 'LITELLM_MODEL_', purpose) || env.LITELLM_MODEL || ''
      ).trim(),
      headers: {}
    }
  }
  return {
    name: 'giga',
    baseUrl: openAiBaseUrl(env.LLM_BASE_URL),
    apiKey: String(env.LLM_API_KEY || '').trim(),
    model: String(
      purposeSetting(env, 'LLM_MODEL_', purpose) || env.LLM_MODEL || 'gigachat-3-ultra'
    ).trim(),
    headers: {}
  }
}

// Потолок ответа LLM. Жёсткие 1024 токена на стриме обрезали structured-ответы
// (анализ героев рвался на середине JSON — «Сервис не распознал персонажей»),
// поэтому лимиты конфигурируются: LLM_MAX_TOKENS_<PURPOSE> точечно,
// LLM_MAX_TOKENS_STREAM / LLM_MAX_TOKENS_COMPLETE по умолчанию для режима.
export function maxTokensFor(purpose, stream, env = process.env) {
  const fallback = stream ? 4096 : 8000
  const raw =
    purposeSetting(env, 'LLM_MAX_TOKENS_', String(purpose || '')) ||
    env[stream ? 'LLM_MAX_TOKENS_STREAM' : 'LLM_MAX_TOKENS_COMPLETE'] ||
    ''
  const value = Number(String(raw).trim() || fallback)
  if (!Number.isFinite(value) || value < 256) return fallback
  return Math.min(Math.round(value), 32_000)
}

/**
 * Сколько ждать ответа модели.
 *
 * Потолок был зашит в код: 120 секунд на любой нестримовый вызов. Подтверждение
 * состава большой книги в них не укладывается — «1Q84» на 756 тысячах знаков и
 * 128 кандидатах упиралась в 504 ровно на 120.5 секунды и уходила в повтор,
 * чтобы упереться снова. Ни модель, ни размер книги на это не влияли: менять
 * было нечего.
 *
 * Наследование то же, что у потолка токенов: `LLM_TIMEOUT_MS_<PURPOSE>` точечно,
 * `LLM_TIMEOUT_MS_STREAM` / `LLM_TIMEOUT_MS_COMPLETE` по умолчанию для режима.
 * Верхняя граница — пять минут: дальше истекает запрос самого генератора, и
 * ждать дольше значит держать воркер на задании, которое уже некому принять.
 */
export function timeoutMsFor(purpose, stream, env = process.env) {
  const fallback = stream ? 180_000 : 120_000
  const raw =
    purposeSetting(env, 'LLM_TIMEOUT_MS_', String(purpose || '')) ||
    env[stream ? 'LLM_TIMEOUT_MS_STREAM' : 'LLM_TIMEOUT_MS_COMPLETE'] ||
    ''
  const value = Number(String(raw).trim() || fallback)
  if (!Number.isFinite(value) || value < 1_000) return fallback
  return Math.min(Math.round(value), 300_000)
}

export function routeForPurpose(purpose, env = process.env) {
  // Narra Assistant is the public mobile proxy path. When LiteLLM is configured,
  // prefer it by default so the app reaches OpenRouter through the server-owned
  // route without requiring another environment migration. An explicit
  // assistant route still wins and keeps provider selection server-owned.
  const implicitPrimary = purpose === 'assistant' &&
    env.LITELLM_BASE_URL && env.LITELLM_API_KEY &&
    (env.LITELLM_MODEL_ASSISTANT || env.LITELLM_MODEL)
    ? 'litellm'
    : 'giga'
  const primary = String(
    purposeSetting(env, 'LLM_ROUTE_', purpose) ||
    (implicitPrimary === 'litellm' ? implicitPrimary : (env.LLM_ROUTE_DEFAULT || implicitPrimary))
  ).toLowerCase()
  // An explicitly empty purpose fallback disables fallback for this purpose.
  // This is important for book analysis: BOOK_ANALYSIS_LLM_FALLBACK= must not
  // silently inherit a global GigaChat fallback.
  const declaredFallback = purposeSettingDeclared(env, 'LLM_FALLBACK_', purpose)
  const fallback = String(
    declaredFallback.declared ? declaredFallback.value : (env.LLM_FALLBACK_DEFAULT || '')
  ).toLowerCase()
  if (!TEXT_PROVIDERS.has(primary)) throw new Error(`Unsupported provider route: ${primary}`)
  if (fallback && !TEXT_PROVIDERS.has(fallback)) throw new Error(`Unsupported fallback route: ${fallback}`)
  return [primary, fallback].filter((value, index, all) => value && all.indexOf(value) === index)
}

export function llmRouteReadiness(env = process.env) {
  const purposes = {}
  let ready = true
  for (const purpose of PURPOSES) {
    try {
      const route = routeForPurpose(purpose, env)
      const configured = route.filter((provider) => {
        const config = providerConfig(provider, purpose, env)
        return Boolean(config.apiKey && config.baseUrl && config.model)
      })
      purposes[purpose] = { route, configured, ready: configured.length > 0 }
      if (!configured.length) ready = false
    } catch (error) {
      purposes[purpose] = { route: [], configured: [], ready: false, error: String(error?.message || error) }
      ready = false
    }
  }
  return { ready, purposes }
}

export async function requestChat({
  messages,
  tools,
  toolChoice,
  parallelToolCalls,
  purpose,
  stream,
  requestId,
  env = process.env,
  fetchImpl = fetch,
  onAttempt = async () => {},
  signal
}) {
  const id = requestId || randomUUID()
  const attempts = []
  let last
  const route = routeForPurpose(purpose, env)
  for (const [retryIndex, providerName] of route.entries()) {
    const config = providerConfig(providerName, purpose, env)
    const attemptId = randomUUID()
    const started = Date.now()
    if (!config.apiKey || !config.baseUrl || !config.model) {
      last = { status: 503, error: `${providerName}: provider is not configured`, code: 'NO_KEY' }
      attempts.push({
        attempt_id: attemptId,
        event_id: randomUUID(),
        provider: providerName,
        model: config.model,
        status: 'not_configured',
        retry_index: retryIndex
      })
      await onAttempt(attempts.at(-1))
      continue
    }
    const startedAttempt = {
      attempt_id: attemptId,
      event_id: randomUUID(),
      provider: providerName,
      model: config.model,
      status: 'started',
      retry_index: retryIndex
    }
    await onAttempt(startedAttempt)
    try {
      const modelRequestOptions = requestOptionsForModel({
        provider: providerName,
        model: config.model,
        purpose,
        env
      })
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'X-Request-ID': id,
          ...config.headers
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          max_tokens: maxTokensFor(purpose, stream, env),
          stream,
          ...(tools ? { tools } : {}),
          ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
          ...(parallelToolCalls !== undefined ? { parallel_tool_calls: parallelToolCalls } : {}),
          ...modelRequestOptions,
          ...(stream && TEXT_PROVIDERS.has(providerName)
            ? { stream_options: { include_usage: true } }
            : {})
        }),
        signal: withTimeout(signal, timeoutMsFor(purpose, stream, env))
      })
      const terminalAttempt = {
        attempt_id: attemptId,
        provider: providerName,
        model: config.model,
        status: 'failed',
        http_status: response.status,
        response_cost: responseCost(response),
        latency_ms: Date.now() - started,
        retry_index: retryIndex
      }
      if (response.ok && response.body) {
        let finalized = false
        const finalizeAttempt = async ({ status = 'completed', error_code: errorCode } = {}) => {
          if (finalized) return
          finalized = true
          const attempt = {
            ...terminalAttempt,
            event_id: randomUUID(),
            status,
            ...(status === 'failed'
              ? { error_code: errorCode || 'NETWORK' }
              : { error_code: undefined }),
            latency_ms: Date.now() - started
          }
          attempts.push(attempt)
          console.info(JSON.stringify({ type: 'provider_attempt', request_id: id, purpose, ...attempt }))
          await onAttempt(attempt)
        }
        return {
          response,
          requestId: id,
          attempts,
          provider: providerName,
          model: config.model,
          responseCost: terminalAttempt.response_cost,
          finalizeAttempt
        }
      }
      const detail = (await response.text().catch(() => '')).slice(0, 180)
      const errorCode = httpErrorCode(response.status, detail)
      // Самая частая причина внезапного 400 после смены модели: провайдер не
      // принимает явную температуру. Подсказываем конкретный флаг, иначе
      // отказ выглядит как загадочный сбой всех AI-запросов сразу.
      if (response.status === 400 && /temperature/i.test(detail)) {
        console.error(
          `[llm] ${providerName}/${config.model} не принимает temperature; ` +
          `выставьте ${providerName === 'litellm' ? 'LITELLM_OMIT_TEMPERATURE' : 'LLM_OMIT_TEMPERATURE'}=true`
        )
      }
      // То же для JSON-формата: структурные задачи просят его по умолчанию, и
      // отказ провайдера должен читаться как настройка, а не как поломка всех
      // запросов анализа разом.
      if (response.status === 400 && /response_format|json_object/i.test(detail)) {
        console.error(
          `[llm] ${providerName}/${config.model} не принимает response_format; ` +
          `выставьте ${providerName === 'litellm' ? 'LITELLM_OMIT_JSON_RESPONSE_FORMAT' : 'LLM_OMIT_JSON_RESPONSE_FORMAT'}=true`
        )
      }
      const failedAttempt = {
        ...terminalAttempt,
        event_id: randomUUID(),
        error_code: errorCode
      }
      attempts.push(failedAttempt)
      console.info(JSON.stringify({ type: 'provider_attempt', request_id: id, purpose, ...failedAttempt }))
      await onAttempt(failedAttempt)
      last = {
        status: response.status === 401 || response.status === 403 ? 502 : response.status,
        error: errorCode === 'CENSOR'
          ? `${providerName}: response blocked by content safety`
          : `${providerName} ${response.status}: ${detail}`,
        code: errorCode
      }
      // Authentication and model availability failures belong to this provider;
      // a configured fallback may still be healthy. Other non-retryable 4xx
      // usually mean the shared request itself is invalid and must stop.
      if (!RETRYABLE.has(response.status) && ![401, 403, 404].includes(response.status)) break
    } catch (error) {
      const attempt = {
        attempt_id: attemptId,
        event_id: randomUUID(),
        provider: providerName,
        model: config.model,
        status: 'failed',
        error_code: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK',
        latency_ms: Date.now() - started,
        retry_index: retryIndex
      }
      attempts.push(attempt)
      console.info(JSON.stringify({ type: 'provider_attempt', request_id: id, purpose, ...attempt }))
      await onAttempt(attempt)
      last = { status: error?.name === 'TimeoutError' ? 504 : 502, error: String(error?.message || error), code: attempt.error_code }
    }
  }
  const error = new Error(last?.error || 'No LLM route is configured')
  error.status = last?.status || 503
  error.code = last?.code || 'NO_KEY'
  error.requestId = id
  error.attempts = attempts
  throw error
}

// ================= Обложки книг (server-owned image route) =================
// Prompt policy, model, provider and credentials are owned by the gateway.
const COVER_IMAGE_PROVIDERS = new Set(['openrouter', 'litellm'])
const IMAGE_QUALITIES = new Set(['low', 'medium', 'high'])
const NANO_BANANA_OPENROUTER_MODEL = 'google/gemini-3.1-flash-image'
const NANO_BANANA_LITELLM_MODEL = `openrouter/${NANO_BANANA_OPENROUTER_MODEL}`

export function normalizeImageQuality(value = 'high') {
  const quality = String(value || 'high').trim().toLowerCase()
  if (!IMAGE_QUALITIES.has(quality)) {
    throw new Error(`Unsupported image quality: ${quality}`)
  }
  return quality
}

export function mediaImageQualityForDimensions({
  width,
  height,
  portraitQuality = 'high',
  sceneQuality = 'high'
}) {
  return normalizeImageQuality(height > width ? portraitQuality : sceneQuality)
}

function coverImageTimeoutMs(env, provider) {
  const raw = env.COVER_IMAGE_TIMEOUT_MS || (
    provider === 'litellm'
      ? env.LITELLM_IMAGE_TIMEOUT_MS
      : env.OPENROUTER_IMAGE_TIMEOUT_MS
  )
  const configured = Number(raw || 15 * 60_000)
  return Number.isSafeInteger(configured) && configured >= 30_000
    ? Math.min(configured, 30 * 60_000)
    : 15 * 60_000
}

function coverProviderBaseUrl(name, raw, env, { openAiCompatible = false } = {}) {
  const value = String(raw || '').trim()
  if (!value) return ''
  const parsed = new URL(value)
  const analyticsEnvironment = String(
    env.ANALYTICS_ENV || (env.NODE_ENV === 'production' ? 'production' : 'development')
  ).trim().toLowerCase()
  const production = analyticsEnvironment === 'production'
  const allowInsecureHttp = String(env.ALLOW_INSECURE_LLM_HTTP || '').trim().toLowerCase() === 'true'
  const allowedInsecureHosts = String(env.LLM_INSECURE_HTTP_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  if (parsed.protocol === 'http:' && production) {
    throw new Error(`${name} plaintext HTTP is forbidden in production`)
  }
  const validated = serviceUrl(name, value, {
    allowPrivateHttp: false,
    allowInsecureHttp,
    allowedInsecureHosts,
    production: env.NODE_ENV === 'production'
  })
  return openAiCompatible ? openAiBaseUrl(validated) : validated.replace(/\/+$/, '')
}

export function coverImageConfig(env = process.env) {
  const provider = String(env.COVER_IMAGE_PROVIDER || 'openrouter').trim().toLowerCase()
  if (!COVER_IMAGE_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported cover image provider: ${provider}`)
  }
  if (provider === 'litellm') {
    return {
      provider,
      label: 'LiteLLM',
      baseUrl: coverProviderBaseUrl('LITELLM_BASE_URL', env.LITELLM_BASE_URL, env, {
        openAiCompatible: true
      }),
      apiKey: String(env.LITELLM_API_KEY || '').trim(),
      model: String(env.LITELLM_IMAGE_MODEL || 'openai/gpt-image-2').trim(),
      fallbackModel: String(
        env.LITELLM_IMAGE_FALLBACK_MODEL || NANO_BANANA_LITELLM_MODEL
      ).trim() || null,
      timeoutMs: coverImageTimeoutMs(env, provider),
      headers: {}
    }
  }
  return {
    provider,
    label: 'OpenRouter',
    baseUrl: coverProviderBaseUrl(
      'OPENROUTER_BASE_URL',
      env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      env
    ),
    apiKey: String(env.OPENROUTER_API_KEY || '').trim(),
    model: String(env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-image-2').trim(),
    fallbackModel: String(
      env.OPENROUTER_IMAGE_FALLBACK_MODEL || NANO_BANANA_OPENROUTER_MODEL
    ).trim() || null,
    timeoutMs: coverImageTimeoutMs(env, provider),
    headers: {
      ...(env.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': env.OPENROUTER_HTTP_REFERER } : {}),
      ...(env.OPENROUTER_APP_NAME ? { 'X-Title': env.OPENROUTER_APP_NAME } : {})
    }
  }
}

export function normalizeImageTransportError(error, provider = 'OpenRouter') {
  if (IMAGE_ERROR_CODES.has(error?.code)) return error
  const fingerprint = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  let code = 'NETWORK'
  let status = 502
  if (
    error?.name === 'TimeoutError' ||
    /\b(?:e?timedout|timeout)|timed out|und_err_[a-z_]*timeout/.test(fingerprint)
  ) {
    code = 'TIMEOUT'
    status = 504
  } else if (
    error?.name === 'AbortError' ||
    /client disconnected|cancelled|canceled|aborted/.test(fingerprint)
  ) {
    code = 'CANCELLED'
    status = 499
  }
  return Object.assign(
    new Error(`${provider}: ${code === 'TIMEOUT' ? 'таймаут запроса' : code === 'CANCELLED' ? 'запрос отменён' : 'сетевая ошибка'}`),
    { code, status, cause: error }
  )
}

export function coverRouteReadiness(env = process.env) {
  const config = coverImageConfig(env)
  return {
    ready: Boolean(config.apiKey && config.baseUrl && config.model),
    provider: config.provider,
    model: config.model,
    fallbackModel: config.fallbackModel
  }
}

function liteLlmImageSize(aspectRatio) {
  if (aspectRatio === '3:2' || aspectRatio === '4:3') return '1536x1024'
  if (aspectRatio === '1:1') return '1024x1024'
  return '1024x1536'
}

function isNanoBananaModel(model) {
  return /(?:^|\/)google\/gemini-[a-z0-9.-]*image(?:$|[-:])/i.test(model)
}

/** Предел на одну референсную картинку: портрет заведомо меньше. */
const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_REFERENCE_IMAGES = 3

/**
 * Умеет ли модель принимать картинки на вход.
 *
 * Проверка по имени модели, а не по попытке: неподдерживаемый вход роутер
 * отвергает по-разному — от 400 до молчаливого игнорирования, — и полагаться на
 * это в пути, где картинка либо есть, либо сцена рисуется без неё, нельзя.
 * Kandinsky картинок на вход не принимает и остаётся текстовым fallback'ом.
 */
export function imageInputSupported(model) {
  const value = String(model || '')
  return isNanoBananaModel(value) || /(?:^|\/)(?:openai\/)?gpt-image/i.test(value)
}

function referenceImageParts(referenceImages) {
  return referenceImages.slice(0, MAX_REFERENCE_IMAGES).map(({ bytes, mimeType, label }) => {
    if (!Buffer.isBuffer(bytes) || !bytes.byteLength || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
      const error = new Error('референсная картинка не проходит проверку размера')
      error.code = 'REFERENCE_IMAGE_INVALID'
      error.status = 400
      throw error
    }
    return {
      label: String(label || ''),
      mimeType: /^image\/(?:jpeg|png|webp)$/.test(String(mimeType)) ? mimeType : 'image/png',
      base64: bytes.toString('base64')
    }
  })
}

/**
 * Запрос с референсными картинками.
 *
 * Форма зависит от роутера, и это ровно тот spike, который work order требовал
 * до P5: LiteLLM повторяет OpenAI `/images/edits` с multipart, OpenRouter
 * принимает картинки частями сообщения chat completions. Обе формы здесь
 * собраны по документации провайдеров и **на живом роутере не проверены** —
 * ключей image-маршрута в этом окружении нет. Поэтому путь без референсов
 * остался буквально прежним, а с референсами включается только для моделей,
 * которые вход картинками объявляют.
 */
function referenceImageRequest(config, { prompt, aspectRatio, selectedModel, quality, parts }) {
  if (config.provider === 'litellm') {
    const form = new FormData()
    form.append('model', selectedModel)
    form.append('prompt', prompt)
    form.append('n', '1')
    form.append('size', liteLlmImageSize(aspectRatio))
    form.append('output_format', 'png')
    if (!isNanoBananaModel(selectedModel)) form.append('quality', quality)
    for (const [index, part] of parts.entries()) {
      form.append(
        'image[]',
        new Blob([Buffer.from(part.base64, 'base64')], { type: part.mimeType }),
        `reference-${index + 1}.${part.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`
      )
    }
    return { url: `${config.baseUrl}/images/edits`, form, shape: 'images_edits' }
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    shape: 'chat_image_parts',
    body: {
      model: selectedModel,
      modalities: ['image', 'text'],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...parts.map((part) => ({
            type: 'image_url',
            image_url: { url: `data:${part.mimeType};base64,${part.base64}` }
          }))
        ]
      }]
    }
  }
}

function coverImageRequest(config, { prompt, aspectRatio, selectedModel, quality, parts = [] }) {
  if (parts.length) {
    return referenceImageRequest(config, { prompt, aspectRatio, selectedModel, quality, parts })
  }
  const nanoBanana = isNanoBananaModel(selectedModel)
  if (config.provider === 'litellm') {
    return {
      url: `${config.baseUrl}/images/generations`,
      body: {
        model: selectedModel,
        prompt,
        n: 1,
        size: liteLlmImageSize(aspectRatio),
        ...(nanoBanana
          ? { aspect_ratio: aspectRatio, resolution: '1K' }
          : { quality }),
        output_format: 'png'
      }
    }
  }
  return {
    url: `${config.baseUrl}/images`,
    body: {
      model: selectedModel,
      prompt,
      aspect_ratio: aspectRatio,
      ...(nanoBanana ? { resolution: '1K' } : { quality }),
      output_format: 'png',
      n: 1
    }
  }
}

function imageMimeTypeFromBase64(value) {
  const bytes = Buffer.from(value.slice(0, 24), 'base64')
  if (
    bytes.byteLength >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png'
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return 'image/jpeg'
  if (
    bytes.byteLength >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp'
  return ''
}

function chatImagePayloadResult(payload, provider) {
  const images = payload?.choices?.[0]?.message?.images
  const url = Array.isArray(images) ? images[0]?.image_url?.url : null
  const dataUrl = typeof url === 'string'
    ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url)
    : null
  if (!dataUrl) {
    throw imageUpstreamError({
      provider,
      phase: 'result',
      detail: 'chat-ответ не содержит картинки'
    })
  }
  return {
    image: dataUrl[2],
    mimeType: imageMimeTypeFromBase64(dataUrl[2]) || dataUrl[1],
    usage: payload?.usage ?? null
  }
}

function imagePayloadResult(payload, provider) {
  const image = payload?.data?.[0]
  const raw = typeof image?.b64_json === 'string' ? image.b64_json.trim() : ''
  if (!raw) {
    const detail = typeof payload?.error?.message === 'string'
      ? payload.error.message.slice(0, 500)
      : ''
    const error = imageUpstreamError({ provider, phase: 'result', detail })
    if (error.code === 'UNKNOWN' && detail) error.message = `${provider}: ${detail}`
    throw error
  }
  const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(raw)
  const imageBase64 = dataUrl ? dataUrl[2] : raw
  return {
    image: imageBase64,
    mimeType: imageMimeTypeFromBase64(imageBase64) || image.media_type || dataUrl?.[1] || 'image/png',
    usage: payload?.usage || image?.usage || null
  }
}

function responseCost(response) {
  const raw = response?.headers?.get?.('x-litellm-response-cost')
  if (raw == null || !String(raw).trim()) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : undefined
}

function imageAttemptError(error, { requestId, attempts }) {
  error.requestId = requestId
  error.attempts = attempts
  return error
}

export async function requestCoverImage({
  prompt,
  aspectRatio = '2:3',
  quality = 'high',
  model,
  referenceImages = [],
  requestId,
  retryIndex = 0,
  env = process.env,
  fetchImpl = fetch,
  signal
}) {
  const config = coverImageConfig(env)
  const id = requestId || randomUUID()
  const selectedModel = String(model || config.model).trim()
  const selectedQuality = normalizeImageQuality(quality)
  const attemptId = randomUUID()
  const attempts = []
  const started = Date.now()
  const failedAttempt = (error, fields = {}) => {
    attempts.push({
      attempt_id: attemptId,
      event_id: randomUUID(),
      provider: config.provider,
      model: selectedModel,
      status: 'failed',
      error_code: error?.code || 'UNKNOWN',
      latency_ms: Date.now() - started,
      retry_index: retryIndex,
      ...fields
    })
    throw imageAttemptError(error, { requestId: id, attempts })
  }
  if (!config.apiKey || !config.baseUrl || !selectedModel) {
    const error = new Error(`Обложки: ${config.label} image route не настроен`)
    error.status = 503
    error.code = 'NO_KEY'
    attempts.push({
      attempt_id: attemptId,
      event_id: randomUUID(),
      provider: config.provider,
      model: selectedModel,
      status: 'not_configured',
      error_code: error.code,
      latency_ms: Date.now() - started,
      retry_index: retryIndex
    })
    throw imageAttemptError(error, { requestId: id, attempts })
  }
  // Референсы прикладываются только к модели, которая вход картинками
  // объявляет. Иначе они молча отбрасываются, и сцена рисуется по тексту:
  // отсутствие портрета — это худшая картинка, а не упавшее задание.
  const parts = referenceImages.length && imageInputSupported(selectedModel)
    ? referenceImageParts(referenceImages)
    : []
  const referenceImagesDropped = referenceImages.length > 0 && parts.length === 0
  const request = coverImageRequest(config, {
    prompt,
    aspectRatio,
    selectedModel,
    quality: selectedQuality,
    parts
  })
  const requestSignal = withTimeout(signal, config.timeoutMs)
  let response
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        // multipart сам ставит boundary в Content-Type, поэтому его не задаём.
        ...(request.form ? {} : { 'Content-Type': 'application/json' }),
        'X-Request-ID': id,
        ...config.headers
      },
      body: request.form ?? JSON.stringify(request.body),
      signal: requestSignal
    })
  } catch (error) {
    failedAttempt(normalizeImageTransportError(
      requestSignal.aborted ? requestSignal.reason : error,
      config.label
    ))
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 4_000)
    failedAttempt(imageUpstreamError({
      provider: config.label,
      phase: 'create',
      status: response.status,
      detail
    }), { http_status: response.status, response_cost: responseCost(response) })
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    failedAttempt(Object.assign(new Error(`${config.label}: некорректный JSON ответа`), {
      code: 'PARSE',
      status: 502,
      cause: error
    }), { http_status: response.status })
  }
  let image
  try {
    image = request.shape === 'chat_image_parts'
      ? chatImagePayloadResult(payload, config.label)
      : imagePayloadResult(payload, config.label)
  } catch (error) {
    failedAttempt(error, { http_status: response.status })
  }
  attempts.push({
    attempt_id: attemptId,
    event_id: randomUUID(),
    provider: config.provider,
    model: selectedModel,
    status: 'completed',
    http_status: response.status,
    latency_ms: Date.now() - started,
    retry_index: retryIndex
  })
  return {
    ...image,
    model: selectedModel,
    provider: config.provider,
    requestId: id,
    referenceImageCount: parts.length,
    referenceImagesDropped,
    attempts,
    responseCost: responseCost(response)
  }
}

async function requestPortraitImageCascade(options, config) {
  const requestId = options.requestId || randomUUID()
  const models = [...new Set([
    config.model,
    ...(options.fallbackModels ?? [config.fallbackModel])
  ].map((model) => String(model || '').trim()).filter(Boolean))]
  const attempts = []
  const cascadeBudgetMs = Number.isFinite(options.cascadeBudgetMs)
    ? Math.min(options.cascadeBudgetMs, PORTRAIT_CASCADE_MAX_BUDGET_MS)
    : PORTRAIT_CASCADE_MAX_BUDGET_MS
  const deadlineAt = performance.now() + cascadeBudgetMs

  for (const [retryIndex, model] of models.entries()) {
    const remainingMs = deadlineAt - performance.now()
    if (remainingMs <= 0) {
      throw imageAttemptError(
        normalizeImageTransportError(new DOMException('Portrait cascade timed out', 'TimeoutError'), config.label),
        { requestId, attempts }
      )
    }
    const attemptBudgetMs = Math.max(1, Math.floor(remainingMs / (models.length - retryIndex)))
    try {
      const result = await requestCoverImage({
        ...options,
        requestId,
        retryIndex,
        model,
        signal: withTimeout(options.signal, attemptBudgetMs)
      })
      return { ...result, attempts: [...attempts, ...result.attempts] }
    } catch (error) {
      attempts.push(...(Array.isArray(error?.attempts) ? error.attempts : []))
      error.requestId = requestId
      error.attempts = [...attempts]
      const status = Number(error?.status)
      const nextModel = models[retryIndex + 1]
      if (status === 400 && !nextModel) {
        error.code = PORTRAIT_CASCADE_EXHAUSTED
        throw error
      }
      // Only HTTP 400 advances the cascade; 5xx stays with the delayed job retry.
      if (status !== 400 || !nextModel) throw error
      console.error(`[image] ${config.provider}/${model} не удалось, фоллбэк на ${nextModel}:`, error.message)
    }
  }
}

async function requestImageFallbackChain(options, config, fallbackModels) {
  const requestId = options.requestId || randomUUID()
  const models = [...new Set([
    config.model,
    ...fallbackModels
  ].map((model) => String(model || '').trim()).filter(Boolean))]
  const attempts = []
  const deadlineAt = Number.isFinite(options.cascadeBudgetMs)
    ? performance.now() + Math.max(1, options.cascadeBudgetMs)
    : null

  for (const [retryIndex, model] of models.entries()) {
    let signal = options.signal
    if (deadlineAt !== null) {
      const remainingMs = deadlineAt - performance.now()
      if (remainingMs <= 0) {
        throw imageAttemptError(
          normalizeImageTransportError(new DOMException('Image cascade timed out', 'TimeoutError'), config.label),
          { requestId, attempts }
        )
      }
      const attemptBudgetMs = Math.max(1, Math.floor(remainingMs / (models.length - retryIndex)))
      signal = withTimeout(options.signal, attemptBudgetMs)
    }
    try {
      const result = await requestCoverImage({
        ...options,
        requestId,
        retryIndex,
        model,
        signal
      })
      return { ...result, attempts: [...attempts, ...result.attempts] }
    } catch (error) {
      attempts.push(...(Array.isArray(error?.attempts) ? error.attempts : []))
      error.requestId = requestId
      error.attempts = [...attempts]
      const nextModel = models[retryIndex + 1]
      if (!nextModel) throw error
      console.error(`[image] ${config.provider}/${model} не удалось, фоллбэк на ${nextModel}:`, error.message)
    }
  }
}

export async function requestCoverImageWithFallback(options) {
  const config = coverImageConfig(options.env)
  if (options.cascadeOnHttp400 === true) {
    return requestPortraitImageCascade(options, config)
  }
  const fallbackModels = options.cascadeOnAnyError === true
    ? (options.fallbackModels ?? [config.fallbackModel])
    : [config.fallbackModel]
  return requestImageFallbackChain(options, config, fallbackModels)
}

export function interactivePortraitCascadeOptions({
  aspectRatio,
  fallbackModels,
  cascadeBudgetMs
}) {
  if (aspectRatio !== '3:4') return {}
  return {
    cascadeOnAnyError: true,
    fallbackModels,
    cascadeBudgetMs
  }
}
