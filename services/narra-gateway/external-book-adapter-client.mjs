import {
  EXTERNAL_ADAPTER_CONTRACT_VERSION,
  EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION,
  EXTERNAL_UPSTREAM_REVISION
} from './book-analysis-pipeline.mjs'
import { serviceUrl } from './service-url.mjs'

const SHA256 = /^[0-9a-f]{64}$/

function adapterError(code, message) {
  return Object.assign(new Error(message), { code })
}

function requiredToken(value) {
  const token = String(value || '').trim()
  if (token.length < 32) {
    throw new Error('AUTIOBOOK_ADAPTER_TOKEN must be at least 32 characters')
  }
  return token
}

async function readJson(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    throw adapterError('EXTERNAL_RESPONSE_TOO_LARGE', 'external adapter response is too large')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > maxBytes) {
    throw adapterError('EXTERNAL_RESPONSE_TOO_LARGE', 'external adapter response is too large')
  }
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw adapterError('EXTERNAL_INVALID_JSON', 'external adapter returned invalid JSON')
  }
}

function validateResponse(payload) {
  const diagnosticNames = [
    'rawCharacters',
    'usedCharacters',
    'alignedSegments',
    'exactDialogueSegments',
    'droppedSegments',
    'unmappedSpeakers',
    'groundedAliases'
  ]
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw adapterError('EXTERNAL_RESPONSE_INVALID', 'external adapter response must be an object')
  }
  if (
    payload.contractVersion !== EXTERNAL_ADAPTER_CONTRACT_VERSION ||
    payload.provider?.name !== 'autiobook' ||
    payload.provider?.upstreamRevision !== EXTERNAL_UPSTREAM_REVISION ||
    typeof payload.provider?.model !== 'string' || !payload.provider.model ||
    payload.provider?.castChunkWords !== 1_500 ||
    payload.provider?.castOverlapWords !== 400 ||
    payload.provider?.revise !== false ||
    payload.extractorVersion !== EXTERNAL_ADAPTER_CONTRACT_VERSION ||
    !SHA256.test(payload.sourceSha256) ||
    !Array.isArray(payload.observations) ||
    payload.observations.length > 100_000 ||
    !payload.diagnostics || typeof payload.diagnostics !== 'object' ||
    diagnosticNames.some((name) =>
      !Number.isSafeInteger(payload.diagnostics[name]) || payload.diagnostics[name] < 0
    )
  ) {
    throw adapterError(
      'EXTERNAL_RESPONSE_INVALID',
      'external adapter response violates autiobook-adapter-v1'
    )
  }
  return payload
}

export function createExternalBookAdapterClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 3_600_000,
  maxResponseBytes = 128 * 1024 * 1024,
  production = process.env.NODE_ENV === 'production'
}) {
  const url = serviceUrl('AUTIOBOOK_ADAPTER_BASE_URL', baseUrl, {
    allowPrivateHttp: true,
    production
  })
  if (!url) throw new Error('AUTIOBOOK_ADAPTER_BASE_URL is required')
  const serviceToken = requiredToken(token)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 14_400_000) {
    throw new RangeError('AUTIOBOOK_ADAPTER_TIMEOUT_MS must be between 1000 and 14400000')
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1_024) {
    throw new RangeError('maxResponseBytes must be at least 1024')
  }

  return {
    async analyzeBook({
      runId,
      text,
      sourceSha256,
      normalizationVersion,
      outputSchemaVersion
    }) {
      if (typeof runId !== 'string' || !runId) throw new TypeError('runId is required')
      if (typeof text !== 'string' || !text) throw new TypeError('text is required')
      if (!SHA256.test(sourceSha256)) throw new TypeError('sourceSha256 must be a SHA-256')
      let response
      try {
        response = await fetchImpl(new URL('internal/v1/analyze', `${url}/`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${serviceToken}`,
            'content-type': 'application/json',
            accept: 'application/json'
          },
          body: JSON.stringify({
            contractVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
            idempotencyKey: [
              runId,
              'external',
              EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION,
              sourceSha256,
              normalizationVersion,
              `schema-${outputSchemaVersion}`
            ].join(':'),
            source: { text, sha256: sourceSha256 }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        })
      } catch (error) {
        if (error?.name === 'TimeoutError') {
          throw adapterError('EXTERNAL_TIMEOUT', 'external adapter request timed out')
        }
        throw adapterError('EXTERNAL_UNAVAILABLE', 'external adapter request failed')
      }
      const payload = await readJson(response, maxResponseBytes)
      if (!response.ok) {
        throw adapterError(
          response.status >= 500 ? 'EXTERNAL_UPSTREAM_FAILED' : `EXTERNAL_HTTP_${response.status}`,
          `external adapter request failed with HTTP ${response.status}`
        )
      }
      return validateResponse(payload)
    }
  }
}
