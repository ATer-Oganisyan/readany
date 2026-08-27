import { parseEnvInt } from './env.mjs'
import { serviceUrl } from './service-url.mjs'

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])

function embeddingError(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable })
}

function apiBaseUrl(raw, production) {
  const safe = serviceUrl('BOOK_EMBEDDING_BASE_URL', raw, {
    allowPrivateHttp: true,
    production
  })
  if (!safe) return ''
  return safe.endsWith('/v1') ? safe : `${safe}/v1`
}

function finiteEmbedding(value, dimensions) {
  if (
    !Array.isArray(value) || value.length !== dimensions ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw embeddingError(
      'EMBEDDING_RESULT_INVALID',
      `embedding response must contain ${dimensions} finite numbers`
    )
  }
  return value
}

export function createBookEmbeddingClient({
  baseUrl,
  apiKey = '',
  model = 'text-embedding-3-large',
  dimensions = 1024,
  provider = 'openai-compatible',
  inputUsdPerMillion = 0,
  timeoutMs = 60_000,
  fetchImpl = fetch,
  production = process.env.NODE_ENV === 'production'
}) {
  const url = apiBaseUrl(baseUrl, production)
  if (!url) throw new Error('BOOK_EMBEDDING_BASE_URL is required')
  if (typeof model !== 'string' || !model.trim()) throw new Error('BOOK_EMBEDDING_MODEL is required')
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 4096) {
    throw new Error('BOOK_EMBEDDING_DIMENSIONS must be between 1 and 4096')
  }
  if (!Number.isFinite(inputUsdPerMillion) || inputUsdPerMillion < 0) {
    throw new Error('BOOK_EMBEDDING_INPUT_USD_PER_MILLION must be non-negative')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('BOOK_EMBEDDING_TIMEOUT_MS must be between 1 and 300000')
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required')

  return {
    model: model.trim(),
    dimensions,
    provider,

    async embedText(input, { signal } = {}) {
      if (typeof input !== 'string' || !input.trim()) {
        throw embeddingError('EMBEDDING_INPUT_INVALID', 'embedding input is required')
      }
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      let response
      try {
        response = await fetchImpl(new URL('embeddings', `${url}/`), {
          method: 'POST',
          headers: {
            ...(String(apiKey).trim() ? { authorization: `Bearer ${String(apiKey).trim()}` } : {}),
            'content-type': 'application/json',
            accept: 'application/json'
          },
          body: JSON.stringify({ input, model: model.trim(), dimensions }),
          signal: requestSignal
        })
      } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
          throw embeddingError('EMBEDDING_TIMEOUT', 'embedding request timed out', true)
        }
        throw embeddingError('EMBEDDING_NETWORK', 'embedding request failed', true)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength > 2 * 1024 * 1024) {
        throw embeddingError('EMBEDDING_RESULT_TOO_LARGE', 'embedding response is too large')
      }
      let payload
      try {
        payload = bytes.byteLength ? JSON.parse(bytes.toString('utf8')) : {}
      } catch {
        throw embeddingError('EMBEDDING_RESULT_INVALID', 'embedding response is not JSON')
      }
      if (!response.ok) {
        throw embeddingError(
          `EMBEDDING_HTTP_${response.status}`,
          `embedding request failed with HTTP ${response.status}`,
          RETRYABLE_STATUS.has(response.status)
        )
      }
      const embedding = finiteEmbedding(payload?.data?.[0]?.embedding, dimensions)
      const inputUnits = Number(payload?.usage?.prompt_tokens ?? payload?.usage?.total_tokens ?? 0)
      const safeInputUnits = Number.isSafeInteger(inputUnits) && inputUnits >= 0 ? inputUnits : 0
      return {
        embedding,
        provider,
        model: model.trim(),
        inputUnits: safeInputUnits,
        estimatedCostUsd: inputUsdPerMillion > 0
          ? (safeInputUnits * inputUsdPerMillion) / 1_000_000
          : null
      }
    }
  }
}

export function createBookEmbeddingClientFromEnv(env = process.env) {
  const baseUrl = String(env.BOOK_EMBEDDING_BASE_URL || env.LITELLM_BASE_URL || '').trim()
  if (!baseUrl) return null
  const rawPrice = Number(env.BOOK_EMBEDDING_INPUT_USD_PER_MILLION || 0)
  if (!Number.isFinite(rawPrice) || rawPrice < 0) {
    throw new Error('BOOK_EMBEDDING_INPUT_USD_PER_MILLION must be non-negative')
  }
  return createBookEmbeddingClient({
    baseUrl,
    apiKey: env.BOOK_EMBEDDING_API_KEY || env.LITELLM_API_KEY || '',
    model: env.BOOK_EMBEDDING_MODEL || 'text-embedding-3-large',
    dimensions: parseEnvInt(env, 'BOOK_EMBEDDING_DIMENSIONS', 1024, 4096),
    provider: env.BOOK_EMBEDDING_PROVIDER || 'openai-compatible',
    inputUsdPerMillion: rawPrice,
    timeoutMs: parseEnvInt(env, 'BOOK_EMBEDDING_TIMEOUT_MS', 60_000, 300_000),
    production: env.NODE_ENV === 'production'
  })
}
