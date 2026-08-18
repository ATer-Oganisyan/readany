import { serviceUrl } from './service-url.mjs'

const SAFE_GENERATOR_ERROR_CODES = new Set([
  'EVIDENCE_MISMATCH',
  'GENERATION_RESULT_INVALID',
  'SCAN_RELATION_PARTICIPANT_MISSING'
])
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,48}$/

function safeGeneratorErrorCode(value) {
  return typeof value === 'string' && SAFE_ERROR_CODE.test(value)
    ? value
    : null
}

function requiredToken(value) {
  const token = String(value || '').trim()
  if (token.length < 32) throw new Error('GENERATOR_SERVICE_TOKEN must be at least 32 characters')
  return token
}

async function readJson(response, maxBytes = 8 * 1024 * 1024) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error('generator response is too large')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > maxBytes) throw new Error('generator response is too large')
  if (!buffer.byteLength) return {}
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    const error = new Error('generator returned invalid JSON')
    error.code = 'GENERATOR_INVALID_JSON'
    throw error
  }
}

export function createGenerationServiceClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 300_000,
  production = process.env.NODE_ENV === 'production'
}) {
  const url = serviceUrl('GENERATOR_BASE_URL', baseUrl, {
    allowPrivateHttp: true,
    production
  })
  if (!url) throw new Error('GENERATOR_BASE_URL is required')
  const serviceToken = requiredToken(token)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) {
    throw new Error('GENERATOR_TIMEOUT_MS must be between 1 and 900000')
  }

  async function post(path, body) {
    const response = await fetchImpl(new URL(path, `${url}/`), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceToken}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const payload = await readJson(response)
    if (!response.ok) {
      const error = new Error(`generator request failed with HTTP ${response.status}`)
      const providerCode = safeGeneratorErrorCode(payload?.code)
      error.code = providerCode && (
        SAFE_GENERATOR_ERROR_CODES.has(providerCode) || response.status >= 500
      )
        ? providerCode
        : `GENERATOR_HTTP_${response.status}`
      throw error
    }
    return payload.result ?? payload
  }

  return {
    reconcileBookCharacterIdentities(input) {
      return post('internal/v1/book-analysis/reconcile-character-identities', {
        idempotencyKey: [
          input.runId,
          'identity',
          input.pipelineVersion,
          input.reconciliationVersion,
          input.observationSetHash
        ].join(':'),
        ...input
      })
    },
    synthesizeCharacterProfile(input) {
      return post('internal/v1/book-analysis/synthesize-character', {
        idempotencyKey: [
          input.runId,
          'synthesize',
          input.snapshotId,
          input.entity.entityKey,
          input.synthesisVersion
        ].join(':'),
        ...input
      })
    },
    scanBookChunk(input) {
      return post('internal/v1/book-analysis/scan-chunk', {
        idempotencyKey: [
          input.runId,
          'scan',
          input.chunkId,
          input.extractorVersion
        ].join(':'),
        ...input
      })
    },
    generateBookMarkup(input) {
      return post('internal/v1/book-markup', {
        idempotencyKey: `${input.bookEditionId}:book-markup:${input.analysisVersion}`,
        ...input
      })
    },
    generateCatalogCover(input) {
      return post('internal/v1/catalog-covers', {
        idempotencyKey: `${input.bookEditionId}:catalog-cover:${input.targetVersion}`,
        ...input
      })
    },
    generateCharacterBundle(input, requiredMedia) {
      return post('internal/v1/character-bundles', {
        idempotencyKey: [
          input.bookEditionId,
          input.characterKey,
          input.bundleVersion,
          requiredMedia.join('+')
        ].join(':'),
        ...input,
        requiredMedia
      })
    }
  }
}
