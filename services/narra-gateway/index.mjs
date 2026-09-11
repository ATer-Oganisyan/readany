import express from 'express'
import { loadGatewayConfig } from './platform/gateway-config.mjs'
import { httpErr, statusFor } from './platform/gateway-errors.mjs'
import { createKandinskyImageClient } from './providers/provider-kandinsky-image.mjs'
import { createKandinskyVideoClient } from './providers/provider-kandinsky-video.mjs'
import cors from 'cors'
import { createHmac, randomUUID } from 'crypto'
import path from 'node:path'
import { httpsRequest } from './platform/http.mjs'
import {
  parseAvatarBody,
  parseChatBody,
  parseCoverBody,
  parseCoverJobBody,
  parseImageBody,
  parsePortraitBody,
  parseSynthesisBody,
  validationErrors
} from './platform/contracts.mjs'
import {
  llmRouteReadiness,
  mediaImageQualityForDimensions,
  requestChat,
  requestCoverImageWithFallback
} from './providers/providers.mjs'
import {
  completionText,
  settleProviderResponse,
  validateChatCompletionPayload
} from './providers/provider-response.mjs'
import { parseEventBatch } from './platform/events.mjs'
import { createEventStore } from './platform/event-store.mjs'
import { readBoundedBody } from './platform/safe-fetch.mjs'
import { fetchImportSource, importSourceFailure } from './platform/import-source.mjs'
import { requestAbortSignal, withTimeout } from './platform/concurrency.mjs'
import {
  analyticsRoute,
  completionProperties,
  createSseUsageCollector,
  providerAttemptProperties
} from './platform/analytics-properties.mjs'
import {
  shouldRetryKandinsky,
  shouldRetryKandinskyStatus,
  videoRetryDelay
} from './providers/retry-policy.mjs'
import {
  imageEmptyResultError,
  imageUpstreamError,
  simplifiedScenePrompt,
  shouldFallbackAfterImageError
} from './providers/image-policy.mjs'
import { sberCaBundle } from './providers/sber-tls.mjs'
import {
  createFixedWindowLimiter,
  createPersistentBudgetMiddleware,
  createTokenService,
  hashInstallationSecret,
  isCorsOriginAllowed,
  isInstallationId,
  requireGatewayAuth,
  requireOperatorAuth,
  resolveTokenSecret
} from './platform/security.mjs'
import { createInstallationRegistry } from './platform/installation-registry.mjs'
import { gatewayReadiness } from './platform/readiness.mjs'
import { createCoverJobStore } from './generation/cover-job-store.mjs'
import { createCoverJobRunner } from './generation/cover-job-runner.mjs'
import { bookCoverPrompt } from './generation/catalog-cover-prompt.mjs'
import { parseSceneJobBody, sceneGenerationPrompt } from './generation/scene-generation.mjs'
import { createBookCatalogRouter } from './catalog/book-catalog-api.mjs'
import { createBookEmbeddingClientFromEnv } from './search/book-embedding-client.mjs'
import { createBookSearchRouter } from './search/book-search-api.mjs'
import { createPostgresBookSearchRepository } from './search/book-search-repository.mjs'
import { createBookSearchService } from './search/book-search-service.mjs'
import { createCatalogIngestRouter } from './catalog/catalog-ingest-api.mjs'
import { createCatalogIngestService } from './catalog/catalog-ingest-service.mjs'
import { createPostgresBookAnalysisRepository } from './analysis/book-analysis-repository.mjs'
import { createBookOperatorRouter } from './books/book-operator-api.mjs'
import { createPostgresBookOperatorRepository } from './books/book-operator-repository.mjs'
import { createBookProgressRepository } from './books/book-progress-repository.mjs'
import { createPostgresBookCharacterCorrectionRepository } from './books/book-character-correction-repository.mjs'
import { createPostgresBookMarkupRepository } from './books/postgres-book-markup-repository.mjs'
import { createPostgresBookTtsMarkupRepository } from './tts/book-tts-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './db/postgres-runtime.mjs'
import { createBookObjectStorageFromEnv } from './books/book-object-storage.mjs'
import {
  createInternalGenerationRouter,
  createInternalGenerationService
} from './generation/internal-generation-service.mjs'
import { createGenerationCostLedger } from './generation/generation-cost-ledger.mjs'
import { createBestEffortGenerationCostRecorder } from './generation/generation-cost-recorder.mjs'
import { createOperationalMetricsRepository } from './db/operational-metrics-repository.mjs'
import {
  operationalRuntimeMetrics,
  recordProviderFailure
} from './platform/operational-runtime-metrics.mjs'
import { createLocalIdleAnimation } from './generation/local-idle-animation.mjs'
import { createPrivateMaterialCleanup } from './platform/private-material-cleanup.mjs'
import { withChatCompliance, withImageCompliance } from './providers/rf-compliance.mjs'

// ================= Конфигурация =================
const {
  PORT, BOOK_ANALYSIS_PIPELINE, BOOK_ANALYSIS_PIPELINE_FOR_EDITION, BOOK_ANALYSIS_SCAN_POLICY, INSECURE,
  PRODUCTION, BUILD_VERSION, ANALYTICS_ENV, VIDEO_REQUIRED,
  BOOK_BACKEND_REQUIRED, BOOK_SEARCH_ENABLED, BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED, BOOK_SHADOW_PREVIEW_ENABLED,
  ALLOW_INSECURE_VIDEO_HTTP, INSECURE_VIDEO_ENV_ALLOWED, VIDEO_INSECURE_HTTP_HOSTS, ALLOW_INSECURE_LLM_HTTP,
  LLM_INSECURE_HTTP_HOSTS, REGISTRATION_LIMIT, REGISTRATION_GLOBAL_LIMIT, REGISTRATION_GLOBAL_DAILY_LIMIT,
  INSTALLATION_REGISTRY_MAX, INSTALLATION_INACTIVE_RETENTION_DAYS, INSTALLATION_TOKEN_TTL_SECONDS, REFRESH_LIMIT,
  REFRESH_ATTEMPT_LIMIT, API_LIMIT, EVENT_LIMIT, AI_LIMIT,
  AI_DAILY_LIMIT, AI_GLOBAL_DAILY_LIMIT, SPEECH_LIMIT, SPEECH_DAILY_LIMIT,
  SPEECH_GLOBAL_DAILY_LIMIT, IMAGE_DAILY_LIMIT, IMAGE_GLOBAL_DAILY_LIMIT, COVER_DAILY_LIMIT,
  COVER_GLOBAL_DAILY_LIMIT, VIDEO_LIMIT, VIDEO_DAILY_LIMIT, VIDEO_GLOBAL_DAILY_LIMIT,
  IMPORT_LIMIT, IMPORT_DAILY_LIMIT, IMPORT_GLOBAL_DAILY_LIMIT, IMPORT_DAILY_BYTES_MB,
  IMPORT_GLOBAL_DAILY_BYTES_MB, IMPORT_CONCURRENCY, IMPORT_QUEUE_LIMIT, BOOK_UPLOAD_MAX_BYTES,
  PRIVATE_MATERIAL_TTL_DAYS, PRIVATE_MATERIAL_CLEANUP_MS, PRIVATE_MATERIAL_CLEANUP_BATCH_SIZE, LLM_RESPONSE_MAX_BYTES,
  KANDINSKY_QUEUE_LIMIT, KANDINSKY_IMAGE_TIMEOUT_MS, KANDINSKY_REQUEST_TIMEOUT_MS, VIDEO_QUEUE_LIMIT,
  LLM_CONCURRENCY, LLM_QUEUE_LIMIT, SPEECH_CONCURRENCY, SPEECH_QUEUE_LIMIT,
  IMAGE_CONCURRENCY, IMAGE_QUEUE_LIMIT, COVER_CONCURRENCY, COVER_QUEUE_LIMIT,
  COVER_JOB_MAX, COVER_JOB_TTL_HOURS, COVER_JOB_MAX_RESULT_MIB, COVER_JOB_MAX_ATTEMPTS,
  COVER_JOB_ATTEMPT_TIMEOUT_SECONDS, COVER_JOB_WORKER_ENABLED, SCENE_JOB_MAX, SCENE_JOB_TTL_HOURS,
  SCENE_JOB_MAX_ATTEMPTS, SCENE_JOB_ATTEMPT_TIMEOUT_SECONDS, SCENE_JOB_WORKER_ENABLED, coverProviderConfig,
  COVER_IMAGE_QUALITY, CHARACTER_PORTRAIT_IMAGE_QUALITY, SCENE_IMAGE_QUALITY, coverProviderCallsPerAttempt,
  minimumCoverAttemptTimeoutMs, llmGate, speechGate, imageGate,
  coverGate, importGate, SALUTE_CLIENT, SALUTE_KEY,
  LLM_BASE_URL, LLM_TRANSPORT_SECURE, LLM_API_KEY, LLM_MODEL,
  LITELLM_BASE_URL, LITELLM_TRANSPORT_SECURE, TEXT_LLM_TRANSPORT_SECURE, KANDINSKY_TOKEN,
  SALUTE_OAUTH_URL, SALUTE_SYNTH_URL, SALUTE_RECOGNIZE_URL, SALUTE_RECOGNITION_MODEL,
  SBER_CA_VERIFIED, KANDINSKY_HOST, VIDEO_BASE_URL, VIDEO_TRANSPORT_SECURE,
  TRACTION_INGEST_URL, TRACTION_INGEST_TOKEN, INSTALLATION_OPERATOR_TOKEN, CATALOG_INGEST_TOKEN,
  BOOK_OPERATOR_USERNAME, BOOK_OPERATOR_PASSWORD
} = loadGatewayConfig(process.env)

function recordProviderAttemptMetric(attempt) {
  if (attempt?.status !== 'failed') return
  const status = Number(attempt.http_status)
  const code = String(attempt.error_code || '').toUpperCase()
  const category = status === 429
    ? '429'
    : status >= 500
      ? '5xx'
      : code === 'TIMEOUT'
        ? 'timeout'
        : code === 'NETWORK'
          ? 'network'
          : 'other'
  recordProviderFailure(attempt.provider, category)
}

function recordProviderAttempts(attempts) {
  if (!Array.isArray(attempts)) return
  for (const attempt of attempts) recordProviderAttemptMetric(attempt)
}

async function requestCoverImageObserved(options) {
  try {
    const result = await requestCoverImageWithFallback(options)
    recordProviderAttempts(result.attempts)
    return result
  } catch (error) {
    recordProviderAttempts(error?.attempts)
    throw error
  }
}

// ================= Токены (кэш ~30 мин) =================
const tokenCache = {} // scope -> { token, expiresAt }

async function getToken(scope, basicKey, oauthUrl) {
  if (!basicKey) throw httpErr('NO_KEY', `Не задан ключ для scope ${scope}`)
  const now = Date.now()
  const c = tokenCache[scope]
  if (c && c.expiresAt - 60_000 > now) return c.token

  const res = await httpsRequest(oauthUrl, {
    method: 'POST',
    insecure: INSECURE,
    ca: sberCaBundle,
    timeoutMs: 20000,
    headers: {
      Authorization: `Basic ${basicKey}`,
      RqUID: randomUUID(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: `scope=${scope}`
  })
  if (res.status === 401 || res.status === 403) throw httpErr('AUTH', `OAuth отклонил ключ (${res.status}) для ${scope}`)
  if (res.status !== 200) throw httpErr('NETWORK', `OAuth статус ${res.status}: ${String(res.body).slice(0, 200)}`)
  const json = JSON.parse(res.body)
  const token = json.access_token || json.tok || json.token
  // exp у speech.giga.chat — в секундах; expires_at у Сбера — в мс
  const expiresAt = json.expires_at || (json.exp ? json.exp * 1000 : now + 25 * 60 * 1000)
  if (!token) throw httpErr('AUTH', 'OAuth: сервер не вернул токен')
  tokenCache[scope] = { token, expiresAt }
  return token
}

// ================= Клиенты провайдеров =================
const kandinskyImages = createKandinskyImageClient({
  token: KANDINSKY_TOKEN,
  host: KANDINSKY_HOST,
  insecure: INSECURE,
  queueLimit: KANDINSKY_QUEUE_LIMIT,
  imageTimeoutMs: KANDINSKY_IMAGE_TIMEOUT_MS,
  requestTimeoutMs: KANDINSKY_REQUEST_TIMEOUT_MS
})
const kandinskyVideo = createKandinskyVideoClient({
  token: KANDINSKY_TOKEN,
  baseUrl: VIDEO_BASE_URL,
  queueLimit: VIDEO_QUEUE_LIMIT
})
const kandinskyQueued = (prompt, width, height, signal) =>
  kandinskyImages.generate(prompt, width, height, signal)
const gigaAvatar = (image, audio, query, signal) =>
  kandinskyVideo.gigaAvatar(image, audio, query, signal)
const animatePortrait = (image, query, quality, signal) =>
  kandinskyVideo.animatePortrait(image, query, quality, signal)

const recordInternalGenerationCost = createBestEffortGenerationCostRecorder({
  getLedger: () => generationCostLedger
})

async function completeInternalChat({ messages, signal, costContext, purpose = 'structured_task' }) {
  let release
  const requestId = randomUUID()
  let providerResult
  let recorded = false
  try {
    release = await llmGate.acquire(signal)
    providerResult = await requestChat({
      messages,
      purpose,
      stream: false,
      requestId,
      onAttempt: recordProviderAttemptMetric,
      signal
    })
    const { response, finalizeAttempt } = providerResult
    const payload = await settleProviderResponse({
      finalizeAttempt,
      consume: async () => {
        const bytes = await readBoundedBody(response, LLM_RESPONSE_MAX_BYTES, signal)
        let json
        try {
          json = JSON.parse(bytes.toString('utf8'))
        } catch (error) {
          throw Object.assign(error, { code: 'PARSE', status: 502 })
        }
        return validateChatCompletionPayload(json)
      }
    })
    await recordInternalGenerationCost({
      context: costContext,
      modality: 'text',
      requestId,
      attempts: providerResult.attempts,
      usage: payload?.usage,
      responseCost: providerResult.responseCost
    })
    recorded = true
    return completionText(payload)
  } catch (error) {
    const attempts = providerResult?.attempts || error?.attempts
    if (!recorded && Array.isArray(attempts) && attempts.length) {
      await recordInternalGenerationCost({
        context: costContext,
        modality: 'text',
        requestId: providerResult?.requestId || error?.requestId || requestId,
        attempts,
        responseCost: providerResult?.responseCost
      })
    }
    throw error
  } finally {
    release?.()
  }
}

async function generateInternalPortrait(prompt, signal, costContext = null) {
  let release
  const requestId = randomUUID()
  const attempts = []
  let retryIndex = 0
  let costRecorded = false
  const attempt = async (provider, operation) => {
    const attemptId = randomUUID()
    const startedAt = Date.now()
    try {
      const value = await operation()
      attempts.push({
        attempt_id: attemptId,
        provider,
        model: provider,
        status: 'completed',
        retry_index: retryIndex,
        latency_ms: Date.now() - startedAt
      })
      retryIndex += 1
      return value
    } catch (error) {
      recordProviderAttemptMetric({
        provider,
        status: 'failed',
        error_code: error?.code,
        http_status: error?.status
      })
      attempts.push({
        attempt_id: attemptId,
        provider,
        model: provider,
        status: 'failed',
        retry_index: retryIndex,
        latency_ms: Date.now() - startedAt,
        error_code: error?.code || 'UNKNOWN',
        http_status: error?.status
      })
      retryIndex += 1
      throw error
    }
  }
  const recordCost = async () => {
    if (!costContext || costRecorded || !attempts.length) return
    await recordInternalGenerationCost({
      context: costContext,
      modality: 'image',
      requestId,
      attempts
    })
    costRecorded = true
  }
  try {
    release = await imageGate.acquire(signal)
    let base64
    let provider
    if (LLM_API_KEY) {
      try {
        base64 = await attempt('gigachat-image', () => gigachatImage(prompt, signal))
        provider = 'gigachat-image'
      } catch (error) {
        const failure = error
        if (!base64) {
          if (!shouldFallbackAfterImageError(failure) || !KANDINSKY_TOKEN) {
            await recordCost()
            throw failure
          }
          console.error('[internal-generation] portrait fallback to Kandinsky:', failure.message)
        }
      }
    }
    if (!base64 && KANDINSKY_TOKEN) {
      try {
        base64 = await attempt('kandinsky', () => kandinskyQueued(prompt, 1024, 1024, signal))
      } catch (error) {
        await recordCost()
        throw error
      }
      provider = 'kandinsky'
    }
    if (!base64) {
      const error = httpErr('NO_KEY', 'No image provider is configured')
      attempts.push({
        attempt_id: randomUUID(),
        provider: 'internal-image',
        model: 'unconfigured',
        status: 'not_configured',
        retry_index: retryIndex,
        error_code: error.code,
        latency_ms: 0
      })
      await recordCost()
      throw error
    }
    await recordCost()
    const bytes = Buffer.from(base64, 'base64')
    if (!bytes.byteLength || bytes.byteLength > 18 * 1024 * 1024) {
      throw httpErr('NETWORK', 'Image provider returned an invalid portrait')
    }
    return { bytes, mimeType: 'image/png', provider }
  } finally {
    release?.()
  }
}

async function measuredInternalImageRequest({
  prompt,
  aspectRatio,
  quality,
  referenceImages = [],
  signal,
  costContext
}) {
  try {
    const generated = await requestCoverImageObserved({
      prompt,
      aspectRatio,
      quality,
      referenceImages,
      requestId: randomUUID(),
      signal
    })
    await recordInternalGenerationCost({
      context: costContext,
      modality: 'image',
      requestId: generated.requestId,
      attempts: generated.attempts,
      usage: generated.usage,
      responseCost: generated.responseCost
    })
    return generated
  } catch (error) {
    if (Array.isArray(error?.attempts) && error.attempts.length) {
      await recordInternalGenerationCost({
        context: costContext,
        modality: 'image',
        requestId: error.requestId,
        attempts: error.attempts
      })
    }
    throw error
  }
}

async function generateInternalCover(prompt, signal, costContext) {
  let release
  try {
    release = await imageGate.acquire(signal)
    const generated = await measuredInternalImageRequest({
      prompt,
      aspectRatio: '2:3',
      quality: COVER_IMAGE_QUALITY,
      costContext,
      signal
    })
    const bytes = Buffer.from(generated.image, 'base64')
    if (!bytes.byteLength || bytes.byteLength > 18 * 1024 * 1024) {
      throw httpErr('NETWORK', 'Image provider returned an invalid cover')
    }
    return {
      bytes,
      mimeType: generated.mimeType,
      model: generated.model,
      provider: `${coverProviderConfig.provider}:${generated.model}`
    }
  } finally {
    release?.()
  }
}

async function generateInternalCharacterPortrait(prompt, signal, costContext) {
  let release
  try {
    release = await imageGate.acquire(signal)
    const generated = await measuredInternalImageRequest({
      prompt,
      aspectRatio: '3:4',
      quality: CHARACTER_PORTRAIT_IMAGE_QUALITY,
      costContext,
      signal
    })
    const bytes = Buffer.from(generated.image, 'base64')
    if (!bytes.byteLength || bytes.byteLength > 18 * 1024 * 1024) {
      throw httpErr('NETWORK', 'Image provider returned an invalid portrait')
    }
    return {
      bytes,
      mimeType: generated.mimeType,
      model: generated.model,
      provider: `${coverProviderConfig.provider}:${generated.model}`
    }
  } finally {
    release?.()
  }
}

async function generateInternalScene(prompt, signal, costContext, { referenceImages = [] } = {}) {
  let release
  try {
    release = await imageGate.acquire(signal)
    let generated
    try {
      generated = await measuredInternalImageRequest({
        prompt,
        aspectRatio: '4:3',
        quality: SCENE_IMAGE_QUALITY,
        referenceImages,
        costContext,
        signal
      })
    } catch (error) {
      if (error?.code !== 'VALIDATION') throw error
      console.warn('[internal-generation] scene prompt rejected; retrying simplified prompt', {
        provider_detail: error?.providerDetail
      })
      generated = await measuredInternalImageRequest({
        prompt: simplifiedScenePrompt(prompt),
        aspectRatio: '4:3',
        quality: SCENE_IMAGE_QUALITY,
        costContext,
        signal
      })
    }
    const bytes = Buffer.from(generated.image, 'base64')
    if (!bytes.byteLength || bytes.byteLength > 18 * 1024 * 1024) {
      throw httpErr('NETWORK', 'Image provider returned an invalid scene')
    }
    return {
      bytes,
      mimeType: generated.mimeType,
      model: generated.model,
      provider: `${coverProviderConfig.provider}:${generated.model}`
    }
  } finally {
    release?.()
  }
}

async function synthesizeInternalSpeech(text, voice, signal) {
  let release
  try {
    release = await speechGate.acquire(signal)
    const { providerVoice } = parseSynthesisBody({ text, voice })
    const token = await getToken('SALUTE_SPEECH_PERS', SALUTE_KEY, SALUTE_OAUTH_URL)
    const response = await httpsRequest(
      `${SALUTE_SYNTH_URL}?format=wav16&voice=${encodeURIComponent(providerVoice)}`,
      {
        method: 'POST',
        insecure: INSECURE,
        ca: sberCaBundle,
        timeoutMs: 60_000,
        maxResponseBytes: 16 * 1024 * 1024,
        signal,
        binary: true,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/text'
        },
        body: Buffer.from(text, 'utf8')
      }
    )
    if (response.status === 401) {
      delete tokenCache['SALUTE_SPEECH_PERS']
      throw httpErr('AUTH', 'SaluteSpeech rejected the service token')
    }
    if (response.status === 429) {
      recordProviderFailure('salute-speech', '429')
      throw httpErr('RATE', 'SaluteSpeech rate limit')
    }
    if (response.status !== 200 || !response.body?.length) {
      if (response.status >= 500) recordProviderFailure('salute-speech', '5xx')
      throw httpErr('NETWORK', `SaluteSpeech returned ${response.status}`)
    }
    return { bytes: Buffer.from(response.body), mimeType: 'audio/wav', provider: 'salute-speech' }
  } catch (error) {
    if (error?.code === 'TIMEOUT') recordProviderFailure('salute-speech', 'timeout')
    throw error
  } finally {
    release?.()
  }
}

async function generateInternalIdleAnimation(
  portraitBytes,
  signal,
  query = 'the character stays still, blinks slowly and breathes subtly, locked camera, no zoom',
  quality = 'lite'
) {
  if (KANDINSKY_TOKEN && VIDEO_BASE_URL) {
    try {
      const base64 = await animatePortrait(
        Buffer.from(portraitBytes).toString('base64'),
        query,
        quality,
        signal
      )
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.byteLength) return { bytes, mimeType: 'video/mp4', provider: 'kandinsky-video' }
    } catch (error) {
      console.error('[internal-generation] video provider failed, using local idle animation:', error.message)
    }
  }
  return { ...(await createLocalIdleAnimation(portraitBytes, signal)), provider: 'local-ffmpeg' }
}


// Долгие задачи: отвечаем сразу и шлём keep-alive пробелы, чтобы fetch клиента
// не обрывался по таймауту (undici ждёт первых байт максимум 5 минут).
// JSON.parse спокойно терпит ведущие пробелы.
async function longJob(res, job) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  const ka = setInterval(() => res.write(' '), 15000)
  try {
    const data = await job()
    clearInterval(ka)
    res.end(JSON.stringify(data))
  } catch (e) {
    clearInterval(ka)
    res.end(JSON.stringify({ error: e.message, code: e.code || 'UNKNOWN' }))
  }
}

// ================= Express =================
const app = express()
const allowedOrigins = new Set(
  String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(
  cors((req, callback) => {
    if (!isCorsOriginAllowed({
      origin: req.headers.origin,
      allowedOrigins,
      protocol: req.protocol,
      host: req.get('host')
    })) {
      return callback(new Error('Origin is not allowed'))
    }
    callback(null, {
      origin: true,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Audio-Type'],
      exposedHeaders: ['X-Narra-Auth-Error', 'RateLimit-Reset'],
      maxAge: 3600
    })
  })
)
const tokenSecret = resolveTokenSecret()
const tokenService = createTokenService(tokenSecret, { ttlSeconds: INSTALLATION_TOKEN_TTL_SECONDS })
const analyticsSecret = String(process.env.ANALYTICS_HMAC_SECRET || (!PRODUCTION ? tokenSecret : ''))
const installationSecretPepper = String(
  process.env.INSTALLATION_SECRET_PEPPER || (!PRODUCTION ? tokenSecret : '')
)
if (PRODUCTION && analyticsSecret.length < 32) throw new Error(
  'ANALYTICS_HMAC_SECRET must be a separate stable secret of at least 32 characters in production'
)
if (PRODUCTION && installationSecretPepper.length < 32) {
  throw new Error('INSTALLATION_SECRET_PEPPER must contain at least 32 characters in production')
}
if (PRODUCTION && analyticsSecret === tokenSecret) {
  throw new Error('ANALYTICS_HMAC_SECRET must differ from GATEWAY_TOKEN_SECRET in production')
}
if (
  PRODUCTION &&
  new Set([
    tokenSecret,
    analyticsSecret,
    installationSecretPepper,
    INSTALLATION_OPERATOR_TOKEN,
    CATALOG_INGEST_TOKEN,
    BOOK_OPERATOR_PASSWORD
  ]).size !== 6
) {
  throw new Error('Gateway, analytics, installation pepper, operator, catalog and book UI secrets must all differ')
}
const dataDir = process.env.DATA_DIR || (process.env.NODE_ENV === 'production'
  ? '/data'
  : new URL('./.data', import.meta.url).pathname)
if (PRODUCTION) {
  const railway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID)
  const railwayMount = String(process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim()
  const declaredMount = railway
    ? railwayMount
    : String(process.env.PERSISTENT_DATA_MOUNT_PATH || '').trim()
  if (railway && !railwayMount) {
    throw new Error('Railway production requires an attached Volume with RAILWAY_VOLUME_MOUNT_PATH')
  }
  if (!declaredMount || path.resolve(declaredMount) !== path.resolve(dataDir)) {
    throw new Error('Production DATA_DIR must exactly match the declared persistent Volume mount')
  }
  if (process.env.INSTALLATION_SINGLE_REPLICA_ACK !== 'true') {
    throw new Error('INSTALLATION_SINGLE_REPLICA_ACK=true is required for the file-backed registry')
  }
  if (railway) {
    const overlapSeconds = Number(process.env.RAILWAY_DEPLOYMENT_OVERLAP_SECONDS || 0)
    const drainingSeconds = Number(process.env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS || 0)
    if (!Number.isInteger(overlapSeconds) || overlapSeconds !== 0) {
      throw new Error('Railway deployment overlap must be exactly 0 seconds')
    }
    if (!Number.isInteger(drainingSeconds) || drainingSeconds < 30) {
      throw new Error('Railway deployment draining must be at least 30 seconds')
    }
  }
}
const installationRegistry = createInstallationRegistry({
  dataDir,
  environment: ANALYTICS_ENV,
  maxInstallations: INSTALLATION_REGISTRY_MAX,
  registrationLimitPerHour: REGISTRATION_GLOBAL_LIMIT,
  registrationLimitPerDay: REGISTRATION_GLOBAL_DAILY_LIMIT,
  inactiveRetentionDays: INSTALLATION_INACTIVE_RETENTION_DAYS
})
await installationRegistry.start()
const eventStore = createEventStore({
  dataDir,
  environment: ANALYTICS_ENV,
  tractionUrl: TRACTION_INGEST_URL,
  tractionToken: TRACTION_INGEST_TOKEN
})
eventStore.start()
const coverJobStore = createCoverJobStore({
  dataDir,
  environment: ANALYTICS_ENV,
  maxJobs: COVER_JOB_MAX,
  resultTtlMs: COVER_JOB_TTL_HOURS * 60 * 60 * 1000,
  maxResultBytes: COVER_JOB_MAX_RESULT_MIB * 1024 * 1024
})
await coverJobStore.start()
const coverJobRunner = createCoverJobRunner({
  store: coverJobStore,
  enabled: COVER_JOB_WORKER_ENABLED,
  concurrency: COVER_CONCURRENCY,
  maxAttempts: COVER_JOB_MAX_ATTEMPTS,
  attemptTimeoutMs: COVER_JOB_ATTEMPT_TIMEOUT_SECONDS * 1000,
  generate: async ({ prompt, signal }) => {
    const generated = await generateInternalCover(prompt, signal)
    return {
      image: generated.bytes.toString('base64'),
      mimeType: generated.mimeType,
      model: generated.model
    }
  }
})
coverJobRunner.start()
const sceneJobStore = createCoverJobStore({
  dataDir,
  environment: ANALYTICS_ENV,
  namespace: 'scene',
  maxJobs: SCENE_JOB_MAX,
  resultTtlMs: SCENE_JOB_TTL_HOURS * 60 * 60 * 1000,
  maxResultBytes: COVER_JOB_MAX_RESULT_MIB * 1024 * 1024
})
await sceneJobStore.start()
const sceneJobRunner = createCoverJobRunner({
  store: sceneJobStore,
  enabled: SCENE_JOB_WORKER_ENABLED,
  concurrency: IMAGE_CONCURRENCY,
  maxAttempts: SCENE_JOB_MAX_ATTEMPTS,
  attemptTimeoutMs: SCENE_JOB_ATTEMPT_TIMEOUT_SECONDS * 1000,
  generate: async ({ prompt, signal }) => {
    // Scene generation uses the same healthy server-owned image chain as
    // portraits. GigaChat is primary; Kandinsky remains its fallback.
    const generated = await generateInternalPortrait(prompt, signal)
    return {
      image: generated.bytes.toString('base64'),
      mimeType: generated.mimeType,
      model: generated.provider
    }
  }
})
sceneJobRunner.start()

let bookMarkupPool = null
let bookMarkupRepository = null
let bookAnalysisRepository = null
let bookTtsMarkupRepository = null
let bookOperatorRepository = null
let bookCharacterCorrectionRepository = null
let operationalMetricsRepository = null
let bookProgressRepository = null
let generationCostLedger = null
let bookSearchRepository = null
let bookSearchService = null
let privateMaterialCleanupTimer = null
let privateMaterialCleanupInitialTimer = null
const bookObjectStorage = createBookObjectStorageFromEnv(process.env)
const generatorServiceToken = String(process.env.GENERATOR_SERVICE_TOKEN || '').trim()
const internalGenerationService = bookObjectStorage && generatorServiceToken
  ? createInternalGenerationService({
      storage: bookObjectStorage,
      completeChat: completeInternalChat,
      generatePortrait: generateInternalCharacterPortrait,
      generateCover: generateInternalCover,
      generateScene: generateInternalScene,
      synthesizeSpeech: synthesizeInternalSpeech,
      generateIdleAnimation: generateInternalIdleAnimation,
      maxBookBytes: BOOK_UPLOAD_MAX_BYTES,
      scanPolicy: BOOK_ANALYSIS_SCAN_POLICY
    })
  : null
if (!internalGenerationService) {
  console.warn('[internal-generation] storage or GENERATOR_SERVICE_TOKEN is not configured; internal API is disabled')
}
if (process.env.DATABASE_URL) {
  bookMarkupPool = await createPostgresPoolFromEnv(process.env)
  await runBookMarkupMigrations(bookMarkupPool)
  generationCostLedger = createGenerationCostLedger(bookMarkupPool, {
    required: String(process.env.GENERATION_COST_LEDGER_REQUIRED || 'true').trim().toLowerCase() !== 'false'
  })
  bookMarkupRepository = createPostgresBookMarkupRepository(bookMarkupPool, {
    privateMaterialTtlDays: PRIVATE_MATERIAL_TTL_DAYS,
    beforeCreateReaderScene: reserveSceneJobBudget
  })
  bookAnalysisRepository = createPostgresBookAnalysisRepository(bookMarkupPool, {
    defaultPipelineId: BOOK_ANALYSIS_PIPELINE,
    pipelineForEdition: BOOK_ANALYSIS_PIPELINE_FOR_EDITION,
    mediaGenerationEnabled: BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED
  })
  bookTtsMarkupRepository = createPostgresBookTtsMarkupRepository(bookMarkupPool)
  bookOperatorRepository = createPostgresBookOperatorRepository(bookMarkupPool)
  bookProgressRepository = createBookProgressRepository(bookMarkupPool)
  bookCharacterCorrectionRepository = createPostgresBookCharacterCorrectionRepository(bookMarkupPool)
  operationalMetricsRepository = createOperationalMetricsRepository(bookMarkupPool)
  if (BOOK_SEARCH_ENABLED) {
    bookSearchRepository = createPostgresBookSearchRepository(bookMarkupPool)
    bookSearchService = createBookSearchService({
      repository: bookSearchRepository,
      embeddingClient: createBookEmbeddingClientFromEnv(process.env)
    })
    console.info('[book-search] API enabled; books are enqueued only by explicit operator command')
  }
  if (internalGenerationService && BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED) {
    const identityJobs = await bookMarkupRepository.enqueueMissingBookIdentities()
    const coverJobs = await bookMarkupRepository.enqueueMissingCatalogCovers()
    const characterMediaJobs = await bookMarkupRepository.enqueueCharacterMediaBackfill()
    console.info('[book-identity] durable backfill checked', {
      jobs: identityJobs.length,
      created: identityJobs.filter((job) => job.created).length
    })
    console.info('[catalog-cover] durable backfill checked', {
      jobs: coverJobs.length,
      created: coverJobs.filter((job) => job.created).length
    })
    console.info('[character-media] independent backfill checked', {
      jobs: characterMediaJobs.length,
      created: characterMediaJobs.filter((job) => job.created).length
    })
    console.info('[book-scenes] automatic backfill disabled; on-demand only')
  } else if (internalGenerationService) {
    console.info('[book-media] generation and startup backfills are disabled')
  }
  if (bookObjectStorage) {
    const cleanup = createPrivateMaterialCleanup({
      repository: bookMarkupRepository,
      storage: bookObjectStorage,
      batchSize: PRIVATE_MATERIAL_CLEANUP_BATCH_SIZE
    })
    const runCleanup = () => void cleanup.runOnce().catch((error) => {
      console.error('[book-cleanup] cleanup loop failed', error)
    })
    privateMaterialCleanupInitialTimer = setTimeout(runCleanup, 5_000)
    privateMaterialCleanupInitialTimer.unref?.()
    privateMaterialCleanupTimer = setInterval(runCleanup, PRIVATE_MATERIAL_CLEANUP_MS)
    privateMaterialCleanupTimer.unref?.()
  }
} else {
  console.warn('[book-markup] DATABASE_URL is not configured; catalog API is disabled')
}

async function checkBookBackendReady() {
  if (!bookMarkupPool || !bookObjectStorage || !internalGenerationService) return false
  try {
    await Promise.all([
      bookMarkupPool.query('SELECT 1'),
      bookObjectStorage.checkReady({ signal: AbortSignal.timeout(3_000) })
    ])
    return true
  } catch {
    return false
  }
}

function actorIdFor(req) {
  return createHmac('sha256', analyticsSecret).update(req.installation.sub).digest('hex')
}

async function appendInternalEvent(req, eventName, properties, eventId = randomUUID()) {
  try {
    await eventStore.append([{
      event_id: eventId,
      event_name: eventName,
      actor_id: actorIdFor(req),
      occurred_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      session_id: null,
      schema_version: 1,
      properties
    }])
  } catch (error) {
    // Product requests must keep working if the analytics volume is degraded.
    console.error('[analytics] internal event was not persisted:', error?.message || error)
  }
}
const registrationLimit = createFixedWindowLimiter({
  windowMs: 60 * 60 * 1000,
  limit: REGISTRATION_LIMIT,
  key: (req) => req.ip
})
const refreshAttemptLimit = createFixedWindowLimiter({
  windowMs: 60 * 60 * 1000,
  limit: REFRESH_ATTEMPT_LIMIT,
  key: (req) => `${req.ip}:${req.body?.installation_id || ''}`
})
const refreshSuccessLimit = createFixedWindowLimiter({
  windowMs: 60 * 60 * 1000,
  limit: REFRESH_LIMIT,
  key: (req) => req.body.installation_id
})
const apiLimit = createFixedWindowLimiter({
  windowMs: 60 * 1000,
  limit: API_LIMIT,
  key: (req) => req.installation?.sub || req.ip
})
const installationKey = (req) => req.installation?.sub || req.ip
const eventLimit = createFixedWindowLimiter({ windowMs: 60 * 1000, limit: EVENT_LIMIT, key: installationKey })
const aiLimit = createFixedWindowLimiter({
  windowMs: 60 * 1000,
  limit: AI_LIMIT,
  key: installationKey
})
const aiDailyLimit = createPersistentBudgetMiddleware({
  registry: installationRegistry,
  metric: 'ai_requests',
  perInstallationLimit: AI_DAILY_LIMIT,
  globalLimit: AI_GLOBAL_DAILY_LIMIT
})
const videoLimit = createFixedWindowLimiter({
  windowMs: 60 * 60 * 1000,
  limit: VIDEO_LIMIT,
  key: installationKey
})
const videoDailyLimit = createPersistentBudgetMiddleware({
  registry: installationRegistry,
  metric: 'video_requests',
  perInstallationLimit: VIDEO_DAILY_LIMIT,
  globalLimit: VIDEO_GLOBAL_DAILY_LIMIT
})
const speechLimit = createFixedWindowLimiter({
  windowMs: 60 * 1000,
  limit: SPEECH_LIMIT,
  key: installationKey
})
const speechDailyLimit = createPersistentBudgetMiddleware({
  registry: installationRegistry,
  metric: 'speech_requests',
  perInstallationLimit: SPEECH_DAILY_LIMIT,
  globalLimit: SPEECH_GLOBAL_DAILY_LIMIT
})
const imageDailyLimit = createPersistentBudgetMiddleware({
  registry: installationRegistry,
  metric: 'image_requests',
  perInstallationLimit: IMAGE_DAILY_LIMIT,
  globalLimit: IMAGE_GLOBAL_DAILY_LIMIT
})
const coverDailyLimit = createPersistentBudgetMiddleware({
  registry: installationRegistry,
  metric: 'cover_requests',
  perInstallationLimit: COVER_DAILY_LIMIT,
  globalLimit: COVER_GLOBAL_DAILY_LIMIT
})
const importLimit = createFixedWindowLimiter({ windowMs: 60 * 1000, limit: IMPORT_LIMIT, key: installationKey })
const importDailyLimit = createPersistentBudgetMiddleware({
  registry: installationRegistry,
  metric: 'import_requests',
  perInstallationLimit: IMPORT_DAILY_LIMIT,
  globalLimit: IMPORT_GLOBAL_DAILY_LIMIT
})
const importByteBudget = createPersistentBudgetMiddleware({
  registry: installationRegistry,
  metric: 'import_bytes',
  amount: () => 30 * 1024 * 1024,
  perInstallationLimit: IMPORT_DAILY_BYTES_MB * 1024 * 1024,
  globalLimit: IMPORT_GLOBAL_DAILY_BYTES_MB * 1024 * 1024
})

app.get('/health', (_req, res) => {
  const llm = llmRouteReadiness()
  const durableImageReady = Boolean(LLM_API_KEY || KANDINSKY_TOKEN)
  res.json({
    ok: true,
    version: BUILD_VERSION,
    environment: ANALYTICS_ENV,
    services: {
      gigachat: llm.ready,
      salutespeech: !!SALUTE_KEY && SBER_CA_VERIFIED,
      kandinsky: !!KANDINSKY_TOKEN,
      cover: durableImageReady,
      video: !!KANDINSKY_TOKEN && !!VIDEO_BASE_URL,
      book_markup: Boolean(bookMarkupRepository),
      book_storage: Boolean(bookObjectStorage),
      internal_generation: Boolean(internalGenerationService),
      book_backend_required: BOOK_BACKEND_REQUIRED
    },
    media_transport: {
      llm_https: TEXT_LLM_TRANSPORT_SECURE,
      litellm_https: LITELLM_TRANSPORT_SECURE,
      llm_insecure_http_allowed: Boolean(
        ALLOW_INSECURE_LLM_HTTP &&
        ((LLM_BASE_URL && !LLM_TRANSPORT_SECURE) || (LITELLM_BASE_URL && !LITELLM_TRANSPORT_SECURE))
      ),
      video_https: VIDEO_TRANSPORT_SECURE,
      video_insecure_http_allowed: Boolean(VIDEO_BASE_URL && !VIDEO_TRANSPORT_SECURE && ALLOW_INSECURE_VIDEO_HTTP),
      sber_ca_verified: SBER_CA_VERIFIED
    },
    llm_routes: llm.purposes,
    book_analysis_scan_policy: {
      profile: BOOK_ANALYSIS_SCAN_POLICY.profile,
      semantic_max_attempts: BOOK_ANALYSIS_SCAN_POLICY.semanticMaxAttempts,
      empty_observation_mode: BOOK_ANALYSIS_SCAN_POLICY.emptyObservationMode,
      preserve_partial_results: BOOK_ANALYSIS_SCAN_POLICY.preservePartialResults,
      adaptive_split: BOOK_ANALYSIS_SCAN_POLICY.adaptiveSplit,
      chunk: BOOK_ANALYSIS_SCAN_POLICY.chunk
    },
    analytics_delivery: eventStore.status(),
    installation_registry: {
      storage_verified: installationRegistry.status().storage_verified,
      capacity_remaining: installationRegistry.status().capacity_remaining
    },
    cover_jobs: {
      ...coverJobStore.status(),
      worker: coverJobRunner.status()
    },
    scene_jobs: {
      ...sceneJobStore.status(),
      worker: sceneJobRunner.status()
    },
    concurrency: { llm: llmGate.status(), speech: speechGate.status(), image: imageGate.status(), cover: coverGate.status(), import: importGate.status() }
  })
})

app.get('/ready', async (_req, res) => {
  const llm = llmRouteReadiness()
  const coverReady = Boolean(LLM_API_KEY || KANDINSKY_TOKEN)
  const registryStatus = installationRegistry.status()
  const coverJobStatus = coverJobStore.status()
  const bookBackendReady = await checkBookBackendReady()
  const videoConfigured = !!KANDINSKY_TOKEN && !!VIDEO_BASE_URL
  const videoTransportAccepted =
    VIDEO_TRANSPORT_SECURE ||
    Boolean(ALLOW_INSECURE_VIDEO_HTTP && INSECURE_VIDEO_ENV_ALLOWED)
  const readiness = gatewayReadiness({
    llmReady: llm.ready,
    speechReady: !!SALUTE_KEY && SBER_CA_VERIFIED,
    imageReady: coverReady || !!KANDINSKY_TOKEN,
    storageReady: registryStatus.storage_verified && coverJobStatus.storage_verified,
    videoConfigured,
    videoTransportAccepted,
    videoRequired: VIDEO_REQUIRED,
    videoTransportSecure: VIDEO_TRANSPORT_SECURE,
    llmTransportSecure: TEXT_LLM_TRANSPORT_SECURE,
    environment: ANALYTICS_ENV,
    bookBackendRequired: BOOK_BACKEND_REQUIRED,
    bookBackendReady
  })
  res.status(readiness.ready ? 200 : 503).json({
    ok: readiness.ready,
    version: BUILD_VERSION,
    environment: ANALYTICS_ENV,
    degraded: readiness.degraded,
    checks: readiness.checks,
    media_transport: {
      llm_https: TEXT_LLM_TRANSPORT_SECURE,
      litellm_https: LITELLM_TRANSPORT_SECURE,
      llm_insecure_http_allowed: Boolean(
        ALLOW_INSECURE_LLM_HTTP &&
        ((LLM_BASE_URL && !LLM_TRANSPORT_SECURE) || (LITELLM_BASE_URL && !LITELLM_TRANSPORT_SECURE))
      ),
      video_https: VIDEO_TRANSPORT_SECURE,
      video_insecure_http_allowed: Boolean(
        videoConfigured && !VIDEO_TRANSPORT_SECURE && ALLOW_INSECURE_VIDEO_HTTP
      ),
      sber_ca_verified: SBER_CA_VERIFIED
    },
    llm_routes: llm.purposes,
    installation_registry: {
      storage_verified: registryStatus.storage_verified
    },
    cover_jobs: {
      storage_verified: coverJobStatus.storage_verified,
      worker_enabled: coverJobRunner.status().enabled
    }
  })
})

app.post('/v2/installations/register', registrationLimit, express.json({ limit: '16kb' }), async (req, res, next) => {
  const body = req.body || {}
  const keys = Object.keys(body)
  if (keys.some((key) => !['installation_id', 'installation_secret', 'app_version', 'platform', 'arch'].includes(key))) {
    return res.status(400).json({ error: 'Неизвестное поле регистрации', code: 'VALIDATION' })
  }
  if (!isInstallationId(body.installation_id)) {
    return res.status(400).json({ error: 'Некорректный installation_id', code: 'VALIDATION' })
  }
  const refreshSecretHash = hashInstallationSecret(body.installation_secret, installationSecretPepper)
  if (!refreshSecretHash) {
    return res.status(400).json({ error: 'Некорректный installation secret', code: 'VALIDATION' })
  }
  for (const key of ['app_version', 'platform', 'arch']) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 80)) {
      return res.status(400).json({ error: `Некорректное поле ${key}`, code: 'VALIDATION' })
    }
  }
  try {
    const registration = await installationRegistry.register({
      installationId: body.installation_id,
      refreshSecretHash,
      appVersion: body.app_version,
      platform: body.platform,
      arch: body.arch
    })
    if (!registration.ok) {
      if (registration.code === 'REVOKED') {
        return res.status(403).json({ error: 'Эта установка отозвана', code: 'AUTH' })
      }
      if (registration.code === 'INVALID_PROOF') {
        return res.status(403).json({ error: 'Installation proof отклонён', code: 'AUTH' })
      }
      if (registration.resetAt) {
        res.setHeader('RateLimit-Reset', String(Math.ceil(registration.resetAt / 1000)))
      }
      return res.status(429).json({
        error: registration.code === 'REGISTRY_FULL'
          ? 'Лимит зарегистрированных установок исчерпан'
          : 'Общий лимит регистраций исчерпан',
        code: 'RATE'
      })
    }
    return res.status(registration.created ? 201 : 200).json({
      token: tokenService.issue(
        body.installation_id,
        registration.record.token_version
      ),
      token_type: 'Bearer',
      expires_in: INSTALLATION_TOKEN_TTL_SECONDS
    })
  } catch (error) {
    next(error)
  }
})

app.post(
  '/v2/installations/refresh',
  express.json({ limit: '16kb' }),
  refreshAttemptLimit,
  async (req, res, next) => {
    try {
      const body = req.body || {}
      if (
        Object.keys(body).some((key) => !['installation_id', 'installation_secret'].includes(key)) ||
        !isInstallationId(body.installation_id)
      ) {
        return res.status(400).json({ error: 'Некорректный refresh payload', code: 'VALIDATION' })
      }
      const refreshSecretHash = hashInstallationSecret(
        body.installation_secret,
        installationSecretPepper
      )
      if (!refreshSecretHash) {
        return res.status(400).json({ error: 'Некорректный installation secret', code: 'VALIDATION' })
      }
      const refresh = await installationRegistry.refresh(body.installation_id, refreshSecretHash)
      if (!refresh.ok) {
        if (refresh.code === 'NOT_FOUND') {
          res.setHeader('X-Narra-Auth-Error', 'installation_not_found')
          return res.status(404).json({
            error: 'Установка больше не зарегистрирована',
            code: 'INSTALLATION_NOT_FOUND'
          })
        }
        if (refresh.code === 'REVOKED') {
          return res.status(403).json({ error: 'Установка отозвана', code: 'REVOKED' })
        }
        return res.status(403).json({ error: 'Installation proof отклонён', code: 'AUTH' })
      }
      return refreshSuccessLimit(req, res, () => {
        res.json({
          token: tokenService.issue(body.installation_id, refresh.record.token_version),
          token_type: 'Bearer',
          expires_in: INSTALLATION_TOKEN_TTL_SECONDS
        })
      })
    } catch (error) {
      next(error)
    }
  }
)

const operatorAuth = requireOperatorAuth(INSTALLATION_OPERATOR_TOKEN)
app.get('/v2/admin/metrics', operatorAuth, async (_req, res, next) => {
  if (!operationalMetricsRepository) {
    return res.status(503).json({ error: 'Метрики backend недоступны', code: 'UNAVAILABLE' })
  }
  try {
    res.json(await operationalMetricsRepository.snapshot({
      runtime: operationalRuntimeMetrics(),
      concurrency: {
        llm: llmGate.status(),
        speech: speechGate.status(),
        image: imageGate.status(),
        cover: coverGate.status(),
        import: importGate.status()
      },
      buildVersion: BUILD_VERSION
    }))
  } catch (error) {
    next(error)
  }
})
app.get('/v2/admin/installations/:installationId', operatorAuth, (req, res) => {
  if (!isInstallationId(req.params.installationId)) {
    return res.status(400).json({ error: 'Некорректный installation_id', code: 'VALIDATION' })
  }
  const record = installationRegistry.get(req.params.installationId)
  if (!record) return res.status(404).json({ error: 'Установка не найдена', code: 'NOT_FOUND' })
  res.json({ installation_id: req.params.installationId, ...record })
})
app.post(
  '/v2/admin/installations/:installationId/revoke',
  operatorAuth,
  express.json({ limit: '4kb' }),
  async (req, res, next) => {
    if (!isInstallationId(req.params.installationId)) {
      return res.status(400).json({ error: 'Некорректный installation_id', code: 'VALIDATION' })
    }
    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== 'reason') ||
      (req.body.reason !== undefined && typeof req.body.reason !== 'string')
    ) {
      return res.status(400).json({ error: 'Некорректная причина отзыва', code: 'VALIDATION' })
    }
    try {
      const record = await installationRegistry.revoke(
        req.params.installationId,
        req.body.reason
      )
      if (!record) return res.status(404).json({ error: 'Установка не найдена', code: 'NOT_FOUND' })
      res.json({
        installation_id: req.params.installationId,
        status: record.status,
        revoked_at: record.revoked_at
      })
    } catch (error) {
      next(error)
    }
  }
)

if (bookMarkupRepository && bookObjectStorage) {
  const catalogIngestService = createCatalogIngestService({
    repository: bookMarkupRepository,
    analysisRepository: bookAnalysisRepository,
    storage: bookObjectStorage
  })
  app.use('/v2/admin/catalog', createCatalogIngestRouter({
    token: CATALOG_INGEST_TOKEN,
    service: catalogIngestService,
    uploadMaxBytes: BOOK_UPLOAD_MAX_BYTES
  }))
  if (BOOK_OPERATOR_PASSWORD && bookOperatorRepository) {
    app.use('/operator', createBookOperatorRouter({
      username: BOOK_OPERATOR_USERNAME,
      password: BOOK_OPERATOR_PASSWORD,
      dashboardRepository: bookOperatorRepository,
      analysisRepository: bookAnalysisRepository,
      correctionRepository: bookCharacterCorrectionRepository,
      progressRepository: bookProgressRepository,
      catalogService: catalogIngestService,
      uploadMaxBytes: BOOK_UPLOAD_MAX_BYTES
    }))
  }
}

// Public generic update feed. Integrity comes from electron-builder SHA-512
// metadata plus the required Developer ID signature of the macOS app. Keeping
// it before /v2 auth is required because electron-updater does not hold an
// installation bearer token.
app.use('/v2/updates/files', express.static(new URL('./updates', import.meta.url).pathname, {
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', filePath.endsWith('.yml') ? 'no-store' : 'public, max-age=31536000, immutable')
  }
}))
app.use('/v2/updates/files', (_req, res) => res.status(404).json({ error: 'Update artifact not found' }))

if (internalGenerationService) {
  app.use('/internal', createInternalGenerationRouter({
    token: generatorServiceToken,
    service: internalGenerationService
  }))
}

app.use('/v2', requireGatewayAuth(tokenService, installationRegistry), apiLimit)
// Parsers deliberately live after bearer auth/rate limiting. Large unauthenticated
// bodies are rejected before Express buffers or parses them. Endpoint quotas
// are attached directly before each parser so Express path normalization cannot
// bypass them with case or trailing-slash variants.
if (bookMarkupRepository) {
  if (bookSearchService) {
    app.use('/v2/books', createBookSearchRouter({ service: bookSearchService }))
  }
  app.use('/v2/books', createBookCatalogRouter({
    repository: bookMarkupRepository,
    analysisRepository: bookAnalysisRepository,
    correctionRepository: bookCharacterCorrectionRepository,
    ttsMarkupRepository: bookTtsMarkupRepository,
    shadowPreviewEnabled: BOOK_SHADOW_PREVIEW_ENABLED,
    storage: bookObjectStorage,
    uploadMaxBytes: BOOK_UPLOAD_MAX_BYTES
  }))
}

app.post('/v2/events/batch', eventLimit, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (
      !req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== 'events') ||
      !Array.isArray(req.body.events) || req.body.events.length < 1 || req.body.events.length > 100
    ) {
      return res.status(400).json({ error: 'events: нужен массив из 1–100 событий', code: 'VALIDATION' })
    }
    const events = []
    const rejected = []
    for (const candidate of req.body.events) {
      try {
        events.push(parseEventBatch({ events: [candidate] })[0])
      } catch {
        rejected.push({
          event_id: typeof candidate?.eventId === 'string' ? candidate.eventId.slice(0, 36) : ''
        })
      }
    }
    const actorId = actorIdFor(req)
    const receivedAt = new Date().toISOString()
    if (events.length) {
      await eventStore.append(events.map((event) => ({
        ...event,
        actor_id: actorId,
        received_at: receivedAt
      })))
    }
    res.status(202).json({ accepted: events.length, rejected })
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code || 'UNKNOWN' })
  }
})

// --- Чат: стриминг через LiteLLM-шлюз (OpenAI /v1/chat/completions) ---
app.post('/v2/ai/chat/stream', aiLimit, aiDailyLimit, express.json({ limit: '1mb' }), async (req, res) => {
  const startedAt = Date.now()
  const clientSignal = requestAbortSignal(req, res)
  let requestId
  let release
  let analyticsOrigin = 'user'
  let recordActorAnalytics = true
  let requestPurpose
  try {
    release = await llmGate.acquire(clientSignal)
    const input = parseChatBody(req.body, { stream: true })
    // Правовые рамки РФ — обязанность сервера: старый или модифицированный
    // клиент не может их обойти. Идемпотентно к рамке, присланной клиентом.
    const messages = withChatCompliance(input.messages, input.purpose)
    analyticsOrigin = input.origin
    recordActorAnalytics = input.analyticsTier !== 'none'
    requestPurpose = input.purpose
    requestId = input.requestId || randomUUID()
    if (recordActorAnalytics) {
      await appendInternalEvent(req, 'ai_request_started', {
        request_id: requestId,
        purpose: input.purpose,
        origin: input.origin
      })
    }
    const { response: upstream, provider, model, responseCost, finalizeAttempt } = await requestChat({
      ...input,
      messages,
      requestId,
      stream: true,
      onAttempt: (attempt) => {
        recordProviderAttemptMetric(attempt)
        if (!recordActorAnalytics) return undefined
        return appendInternalEvent(
          req,
          `provider_attempt_${attempt.status}`,
          providerAttemptProperties(requestId, input.purpose, attempt),
          attempt.event_id
        )
      },
      signal: clientSignal
    })
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Request-Id', requestId)
    res.setHeader('X-Narra-Route', analyticsRoute(provider, model))
    let usageCollector
    const usage = await settleProviderResponse({
      finalizeAttempt,
      consume: async () => {
        let streamedBytes = 0
        usageCollector = createSseUsageCollector()
        for await (const chunk of upstream.body) {
          streamedBytes += Buffer.byteLength(chunk)
          if (streamedBytes > LLM_RESPONSE_MAX_BYTES) {
            await upstream.body.cancel().catch(() => {})
            throw Object.assign(new Error('LLM response exceeded the gateway limit'), { code: 'NETWORK', status: 502 })
          }
          usageCollector.push(chunk)
          res.write(chunk)
        }
        return usageCollector.value()
      }
    })
    res.end()
    const finishReason = usageCollector?.finishReason()
    if (finishReason === 'length') {
      console.warn(`[llm] ответ обрезан лимитом max_tokens: purpose=${input.purpose} request_id=${requestId}`)
    }
    if (recordActorAnalytics) {
      await appendInternalEvent(req, 'ai_request_completed', completionProperties({
        requestId,
        purpose: input.purpose,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        usage,
        responseCost,
        origin: input.origin,
        finishReason
      }))
    }
  } catch (e) {
    if (requestId && recordActorAnalytics) await appendInternalEvent(req, 'ai_request_failed', {
      request_id: requestId,
      ...(requestPurpose ? { purpose: requestPurpose } : {}),
      origin: analyticsOrigin,
      latency_ms: Date.now() - startedAt,
      error_code: e.code || 'NETWORK',
      success: false
    }).catch(() => {})
    if (!res.headersSent) {
      res.status(e.status || 502).json({
        error: String(e.message),
        code: e.code || 'NETWORK',
        request_id: e.requestId
      })
    } else {
      const code = [
        'PARSE', 'CENSOR', 'CANCELLED', 'TIMEOUT', 'NETWORK'
      ].includes(e.code) ? e.code : 'NETWORK'
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: { code } })}\n\n`)
      } catch {
        // The client may already have disconnected; analytics is still failed.
      }
      res.end()
    }
  } finally {
    release?.()
  }
})

// --- Чат: обычный ответ (для разметки/саммари/эмоций) ---
app.post('/v2/ai/chat/complete', aiLimit, aiDailyLimit, express.json({ limit: '1mb' }), async (req, res) => {
  const startedAt = Date.now()
  const clientSignal = requestAbortSignal(req, res)
  let requestId
  let release
  let analyticsOrigin = 'user'
  let recordActorAnalytics = true
  let requestPurpose
  try {
    release = await llmGate.acquire(clientSignal)
    const input = parseChatBody(req.body)
    // Диалоговые purposes и здесь получают серверную правовую рамку.
    const messages = withChatCompliance(input.messages, input.purpose)
    analyticsOrigin = input.origin
    recordActorAnalytics = input.analyticsTier !== 'none'
    requestPurpose = input.purpose
    requestId = input.requestId || randomUUID()
    if (recordActorAnalytics) {
      await appendInternalEvent(req, 'ai_request_started', {
        request_id: requestId,
        purpose: input.purpose,
        origin: input.origin
      })
    }
    const { response: r, provider, model, attempts, responseCost, finalizeAttempt } = await requestChat({
      ...input,
      messages,
      requestId,
      stream: false,
      onAttempt: (attempt) => {
        recordProviderAttemptMetric(attempt)
        if (!recordActorAnalytics) return undefined
        return appendInternalEvent(
          req,
          `provider_attempt_${attempt.status}`,
          providerAttemptProperties(requestId, input.purpose, attempt),
          attempt.event_id
        )
      },
      signal: clientSignal
    })
    const j = await settleProviderResponse({
      finalizeAttempt,
      consume: async () => {
        const responseBytes = await readBoundedBody(r, LLM_RESPONSE_MAX_BYTES, clientSignal)
        let payload
        try {
          payload = JSON.parse(responseBytes.toString('utf8'))
        } catch (error) {
          throw Object.assign(error, { code: 'PARSE', status: 502 })
        }
        return validateChatCompletionPayload(payload)
      }
    })
    const finishReason = j?.choices?.[0]?.finish_reason
    if (finishReason === 'length') {
      console.warn(`[llm] ответ обрезан лимитом max_tokens: purpose=${input.purpose} request_id=${requestId}`)
    }
    if (recordActorAnalytics) {
      await appendInternalEvent(req, 'ai_request_completed', completionProperties({
        requestId,
        purpose: input.purpose,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        usage: j?.usage,
        responseCost,
        origin: input.origin,
        finishReason
      }))
    }
    res.json({
      text: j?.choices?.[0]?.message?.content ?? '',
      request_id: requestId,
      route: analyticsRoute(provider, model),
      usage: j?.usage || null,
      attempts: attempts.length
    })
  } catch (e) {
    if (requestId && recordActorAnalytics) await appendInternalEvent(req, 'ai_request_failed', {
      request_id: requestId,
      ...(requestPurpose ? { purpose: requestPurpose } : {}),
      origin: analyticsOrigin,
      latency_ms: Date.now() - startedAt,
      error_code: e.code || 'NETWORK',
      success: false
    }).catch(() => {})
    res.status(e.status || 502).json({ error: String(e.message), code: e.code || 'NETWORK', request_id: e.requestId })
  } finally {
    release?.()
  }
})

// --- SaluteSpeech: синтез сегмента ---
app.post('/v2/speech/synthesize', speechLimit, speechDailyLimit, express.json({ limit: '1mb' }), async (req, res) => {
  const clientSignal = requestAbortSignal(req, res)
  let release
  try {
    release = await speechGate.acquire(clientSignal)
    const { text, ssml, providerVoice, sampleRate } = parseSynthesisBody(req.body)
    const isSsml = !!ssml
    const payload = isSsml ? ssml : text || ''
    const token = await getToken('SALUTE_SPEECH_PERS', SALUTE_KEY, SALUTE_OAUTH_URL)
    const url = `${SALUTE_SYNTH_URL}?format=wav16&voice=${encodeURIComponent(providerVoice)}`
    const r = await httpsRequest(url, {
      method: 'POST',
      insecure: INSECURE,
      ca: sberCaBundle,
      timeoutMs: 60000,
      maxResponseBytes: 16 * 1024 * 1024,
      signal: clientSignal,
      binary: true,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': isSsml ? 'application/ssml' : 'application/text'
      },
      body: Buffer.from(payload, 'utf8')
    })
    if (r.status === 401) {
      delete tokenCache['SALUTE_SPEECH_PERS']
      return res.status(401).json({ error: 'SaluteSpeech: токен отклонён', code: 'AUTH' })
    }
    if (r.status === 429) {
      recordProviderFailure('salutespeech', '429')
      const seconds = Number(r.headers?.['retry-after'])
      if (Number.isFinite(seconds) && seconds >= 0) {
        res.setHeader('Retry-After', String(Math.max(1, Math.min(60, Math.ceil(seconds)))))
      }
      return res.status(429).json({ error: 'SaluteSpeech: лимит', code: 'RATE' })
    }
    if (r.status !== 200) {
      if (r.status >= 500) recordProviderFailure('salutespeech', '5xx')
      return res.status(502).json({ error: 'SaluteSpeech временно недоступен', code: 'NETWORK' })
    }
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('X-Audio-Sample-Rate', String(sampleRate))
    res.send(r.body)
  } catch (e) {
    recordProviderFailure(
      'salutespeech',
      e?.code === 'TIMEOUT' ? 'timeout' : e?.code === 'NETWORK' ? 'network' : 'other'
    )
    res.status(statusFor(e.code)).json({ error: e.message, code: e.code || 'UNKNOWN' })
  } finally {
    release?.()
  }
})

// gigachat-image через шлюз — мгновенно, тем же ключом, без рейт-лимита Кандинского.
async function gigachatImage(prompt, signal) {
  const r = await fetch(`${LLM_BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gigachat-image', prompt: String(prompt).slice(0, 1000) }),
    signal: withTimeout(signal, 90_000)
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw imageUpstreamError({
      provider: 'GigaChat Image',
      phase: 'create',
      status: r.status,
      detail: t
    })
  }
  const j = await r.json()
  const b64 = j?.data?.[0]?.b64_json
  if (!b64) {
    throw imageEmptyResultError({
      provider: 'GigaChat Image',
      detail: JSON.stringify(j)
    })
  }
  return b64
}

// --- SaluteSpeech: распознавание речи (ASR) ---
app.post(
  '/v2/speech/recognize',
  speechLimit,
  speechDailyLimit,
  express.raw({ type: () => true, limit: '25mb' }),
  async (req, res) => {
    if (!SALUTE_KEY) return res.status(400).json({ error: 'ASR: ключ не задан', code: 'NO_KEY' })
    const clientSignal = requestAbortSignal(req, res)
    let release
    try {
      release = await speechGate.acquire(clientSignal)
      const token = await getToken('SALUTE_SPEECH_PERS', SALUTE_KEY, SALUTE_OAUTH_URL)
      const ct = String(req.headers['x-audio-type'] || 'audio/x-pcm;bit=16;rate=16000')
      const url =
        SALUTE_RECOGNIZE_URL +
        (SALUTE_RECOGNITION_MODEL ? `?model=${encodeURIComponent(SALUTE_RECOGNITION_MODEL)}` : '')
      const r = await httpsRequest(url, {
        method: 'POST',
        insecure: INSECURE,
        ca: sberCaBundle,
        timeoutMs: 60000,
        signal: clientSignal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': ct },
        body: req.body
      })
      if (r.status === 401) {
        delete tokenCache['SALUTE_SPEECH_PERS']
        return res.status(401).json({ error: 'ASR: токен отклонён', code: 'AUTH' })
      }
      if (r.status !== 200) {
        return res
          .status(502)
          .json({ error: `ASR ${r.status}: ${String(r.body).slice(0, 160)}`, code: 'NETWORK' })
      }
      const j = JSON.parse(r.body)
      const text = Array.isArray(j.result) ? j.result.join(' ') : j.result || j.text || ''
      res.json({ text })
    } catch (e) {
      res.status(statusFor(e.code)).json({ error: e.message, code: e.code || 'UNKNOWN' })
    } finally {
      release?.()
    }
  }
)

// --- Генерация изображения: gigachat-image (осн.), Kandinsky (фолбэк) ---
// Загрузка книг по ссылке (AO3 заблокирован в РФ — качаем сервером).
// Строгий белый список хостов, только https, лимит 30 МБ.
app.get('/v2/import/fetch', importLimit, importDailyLimit, importByteBudget, async (req, res) => {
  const clientSignal = requestAbortSignal(req, res)
  let release
  try {
    release = await importGate.acquire(clientSignal)
    const r = await fetchImportSource(String(req.query.url || ''), { signal: clientSignal })
    if (!r.ok) {
      const failure = importSourceFailure(r.status)
      await r.body?.cancel().catch(() => {})
      return res.status(failure.status).json({
        error: failure.code === 'RATE'
          ? 'Сайт временно ограничил загрузку (антифлуд). Подожди пару минут и попробуй снова.'
          : `Источник ответил ${r.status}`,
        code: failure.code
      })
    }
    const buf = await readBoundedBody(r, 30 * 1024 * 1024, clientSignal)
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream')
    res.send(buf)
  } catch (e) {
    res.status(e.status || 502).json({ error: String(e.message), code: e.code || 'NETWORK' })
  } finally {
    release?.()
  }
})

// Пиковую нагрузку регулирует imageGate внутри обработчика, а расходы — суточный
// бюджет. Почасовой middleware здесь нельзя ставить: он возвращает 429 раньше,
// чем основной image-провайдер успевает переключиться на fallback.
app.post('/v2/media/images', imageDailyLimit, express.json({ limit: '1mb' }), async (req, res) => {
  const signal = requestAbortSignal(req, res)
  let release
  try {
    release = await imageGate.acquire(signal)
    const { prompt, width, height, engine } = parseImageBody(req.body)
    // OpenRouter выбирается клиентом для legacy-портретов и selected-text сцен;
    // ключ и модель по-прежнему остаются на сервере. Вертикальные размеры
    // используют portrait quality, квадратные и горизонтальные — scene quality.
    // Provider fallback — Nano Banana; Kandinsky в этот путь не входит.
    if (engine === 'openrouter') {
      const aspectRatio = width * 4 === height * 3 ? '3:4' : width === height ? '1:1' : width > height ? '3:2' : '2:3'
      // Правовой блок добавляет сервер (идемпотентно к клиентскому): политика
      // не зависит от версии клиента. Kandinsky/gigachat-пути ниже режут запрос
      // до 950–1000 символов — там блок вытеснил бы сам промпт; эти провайдеры
      // закрыты собственной модерацией Сбера.
      const image = await requestCoverImageObserved({
        prompt: withImageCompliance(prompt),
        aspectRatio,
        quality: mediaImageQualityForDimensions({
          width,
          height,
          portraitQuality: CHARACTER_PORTRAIT_IMAGE_QUALITY,
          sceneQuality: SCENE_IMAGE_QUALITY
        }),
        signal
      })
      return res.json({ image: image.image, mime_type: image.mimeType })
    }
    // Вертикальные изображения (обложки) и явный engine='kandinsky' (сцены) — Kandinsky:
    // он соблюдает состав кадра, одежду и размер. Портреты — gigachat-image: быстро.
    // Взаимные фолбэки.
    const wantKandinsky = height > width || engine === 'kandinsky'
    if (wantKandinsky && KANDINSKY_TOKEN) {
      try {
        return res.json({ image: await kandinskyQueued(prompt, width, height, signal) })
      } catch (e) {
        if (!shouldFallbackAfterImageError(e)) throw e
        // сцены (engine=kandinsky) на gigachat-image не фолбэчим: он игнорирует
        // стиль и выдаёт фотореалистичные кинокадры — лучше честная ошибка и повтор
        if (engine === 'kandinsky') throw e
        console.error('[image] Kandinsky не удалось, фолбэк на gigachat-image:', e.message)
        if (!LLM_API_KEY) throw e
      }
    }
    if (LLM_API_KEY) {
      try {
        return res.json({ image: await gigachatImage(prompt, signal) })
      } catch (e) {
        if (!shouldFallbackAfterImageError(e)) throw e
        console.error('[image] gigachat-image не удалось, фолбэк на Kandinsky:', e.message)
        if (!KANDINSKY_TOKEN) throw e
      }
    }
    if (!KANDINSKY_TOKEN) return res.status(400).json({ error: 'Нет ключей для картинок', code: 'NO_KEY' })
    res.json({ image: await kandinskyQueued(prompt, width, height, signal) })
  } catch (e) {
    res.status(statusFor(e.code)).json({ error: e.message, code: e.code || 'UNKNOWN' })
  } finally {
    release?.()
  }
})

function coverJobPollAfter(job) {
  if (job.status === 'retry_wait') {
    return Math.min(60_000, Math.max(3_000, job.next_attempt_at - Date.now()))
  }
  return ['queued', 'running'].includes(job.status) ? 3_000 : 0
}

async function coverJobPayload(job, { includeImage = false } = {}) {
  const payload = {
    job_id: job.job_id,
    status: job.status,
    poll_after_ms: coverJobPollAfter(job),
    attempt_count: job.attempt_count,
    expires_at: job.expires_at
  }
  if (job.status === 'failed') {
    payload.code = job.error_code || 'UNKNOWN'
    payload.error = job.error_message || 'Не удалось создать обложку'
  }
  if (includeImage && job.status === 'completed') {
    const result = await coverJobStore.readResult(job)
    payload.image = result?.toString('base64')
    payload.mime_type = job.mime_type || 'image/jpeg'
    payload.model = job.model || undefined
  }
  return payload
}

async function sceneJobPayload(job, { includeImage = false } = {}) {
  const payload = {
    job_id: job.job_id,
    status: job.status,
    poll_after_ms: coverJobPollAfter(job),
    attempt_count: job.attempt_count,
    expires_at: job.expires_at
  }
  if (job.status === 'failed') {
    payload.code = job.error_code || 'UNKNOWN'
    payload.error = job.error_message || 'Не удалось создать сцену'
  }
  if (includeImage && job.status === 'completed') {
    const result = await sceneJobStore.readResult(job)
    payload.image = result?.toString('base64')
    payload.mime_type = job.mime_type || 'image/png'
    payload.model = job.model || undefined
  }
  return payload
}

async function reserveCoverJobBudget(installationId) {
  const reservation = await installationRegistry.reserve({
    installationId,
    metric: 'cover_requests',
    perInstallationLimit: COVER_DAILY_LIMIT,
    globalLimit: COVER_GLOBAL_DAILY_LIMIT
  })
  if (!reservation.ok) {
    const error = new Error(
      reservation.scope === 'global'
        ? 'Общий дневной бюджет сервиса исчерпан'
        : 'Дневной лимит установки исчерпан'
    )
    error.code = 'RATE'
    error.status = 429
    error.resetAt = reservation.resetAt
    throw error
  }
  return reservation
}

async function reserveSceneJobBudget(installationId) {
  const reservation = await installationRegistry.reserve({
    installationId,
    metric: 'image_requests',
    perInstallationLimit: IMAGE_DAILY_LIMIT,
    globalLimit: IMAGE_GLOBAL_DAILY_LIMIT
  })
  if (!reservation.ok) {
    const error = new Error(
      reservation.scope === 'global'
        ? 'Общий дневной бюджет сервиса исчерпан'
        : 'Дневной лимит установки исчерпан'
    )
    error.code = 'RATE'
    error.status = 429
    error.resetAt = reservation.resetAt
    throw error
  }
  return reservation
}

// Durable cover jobs: the HTTP request ends immediately, while the worker keeps
// GPT Image → Nano Banana running on the persistent gateway volume.
app.post('/v2/media/cover/jobs', express.json({ limit: '64kb' }), async (req, res) => {
  let reservation
  try {
    const { prompt: legacyPrompt, book, requestId } = parseCoverJobBody(req.body)
    const prompt = legacyPrompt ?? bookCoverPrompt(book)
    const result = await coverJobStore.createOrGet({
      installationId: req.installation.sub,
      requestId,
      prompt,
      beforeCreate: async () => {
        reservation = await reserveCoverJobBudget(req.installation.sub)
      }
    })
    if (reservation) {
      res.setHeader('RateLimit-Daily-Limit', String(COVER_DAILY_LIMIT))
      res.setHeader('RateLimit-Daily-Remaining', String(reservation.installationRemaining))
      res.setHeader('RateLimit-Global-Remaining', String(reservation.globalRemaining))
      res.setHeader('RateLimit-Reset', String(Math.ceil(reservation.resetAt / 1000)))
    }
    if (result.created) coverJobRunner.notify()
    const status = ['completed', 'failed'].includes(result.job.status) ? 200 : 202
    res.status(status).json(await coverJobPayload(result.job, {
      includeImage: result.job.status === 'completed'
    }))
  } catch (error) {
    if (error.resetAt) res.setHeader('RateLimit-Reset', String(Math.ceil(error.resetAt / 1000)))
    res.status(error.status || statusFor(error.code)).json({
      error: error.message,
      code: error.code || 'UNKNOWN'
    })
  }
})

app.get('/v2/media/cover/jobs/:jobId', async (req, res) => {
  try {
    const job = coverJobStore.getForInstallation(req.params.jobId, req.installation.sub)
    if (!job) return res.status(404).json({ error: 'Задача обложки не найдена', code: 'NOT_FOUND' })
    res.json(await coverJobPayload(job, { includeImage: true }))
  } catch (error) {
    res.status(error.status || statusFor(error.code)).json({
      error: error.message,
      code: error.code || 'UNKNOWN'
    })
  }
})

app.post('/v2/media/cover/jobs/:jobId/ack', async (req, res) => {
  try {
    const acknowledged = await coverJobStore.acknowledge(req.params.jobId, req.installation.sub)
    if (!acknowledged) return res.status(404).json({ error: 'Задача обложки не найдена', code: 'NOT_FOUND' })
    res.status(204).end()
  } catch (error) {
    res.status(error.status || statusFor(error.code)).json({
      error: error.message,
      code: error.code || 'UNKNOWN'
    })
  }
})

// Scene requests carry structured book facts. Prompt construction, credentials,
// provider selection, retry and persisted result ownership stay on the gateway.
app.post('/v2/media/scene/jobs', express.json({ limit: '64kb' }), async (req, res) => {
  let reservation
  try {
    const input = parseSceneJobBody(req.body)
    const result = await sceneJobStore.createOrGet({
      installationId: req.installation.sub,
      requestId: input.requestId,
      prompt: sceneGenerationPrompt(input),
      beforeCreate: async () => {
        reservation = await reserveSceneJobBudget(req.installation.sub)
      }
    })
    if (reservation) {
      res.setHeader('RateLimit-Daily-Limit', String(IMAGE_DAILY_LIMIT))
      res.setHeader('RateLimit-Daily-Remaining', String(reservation.installationRemaining))
      res.setHeader('RateLimit-Global-Remaining', String(reservation.globalRemaining))
      res.setHeader('RateLimit-Reset', String(Math.ceil(reservation.resetAt / 1000)))
    }
    if (result.created) sceneJobRunner.notify()
    const status = ['completed', 'failed'].includes(result.job.status) ? 200 : 202
    res.status(status).json(await sceneJobPayload(result.job, {
      includeImage: result.job.status === 'completed'
    }))
  } catch (error) {
    if (error.resetAt) res.setHeader('RateLimit-Reset', String(Math.ceil(error.resetAt / 1000)))
    res.status(error.status || statusFor(error.code)).json({
      error: error.message,
      code: error.code || 'UNKNOWN'
    })
  }
})

app.get('/v2/media/scene/jobs/:jobId', async (req, res) => {
  try {
    const job = sceneJobStore.getForInstallation(req.params.jobId, req.installation.sub)
    if (!job) return res.status(404).json({ error: 'Задача сцены не найдена', code: 'NOT_FOUND' })
    res.json(await sceneJobPayload(job, { includeImage: true }))
  } catch (error) {
    res.status(error.status || statusFor(error.code)).json({
      error: error.message,
      code: error.code || 'UNKNOWN'
    })
  }
})

app.post('/v2/media/scene/jobs/:jobId/ack', async (req, res) => {
  try {
    const acknowledged = await sceneJobStore.acknowledge(req.params.jobId, req.installation.sub)
    if (!acknowledged) return res.status(404).json({ error: 'Задача сцены не найдена', code: 'NOT_FOUND' })
    res.status(204).end()
  } catch (error) {
    res.status(error.status || statusFor(error.code)).json({
      error: error.message,
      code: error.code || 'UNKNOWN'
    })
  }
})

// Compatibility route for already released clients. Kandinsky is deliberately
// not part of the cover path; new clients use the durable job endpoints above.
app.post('/v2/media/cover', coverDailyLimit, express.json({ limit: '64kb' }), async (req, res) => {
  const signal = requestAbortSignal(req, res)
  let release
  try {
    release = await coverGate.acquire(signal)
    const { prompt } = parseCoverBody(req.body)
    const cover = await requestCoverImageObserved({
      prompt,
      quality: COVER_IMAGE_QUALITY,
      signal
    })
    res.json({ image: cover.image, mime_type: cover.mimeType })
  } catch (e) {
    res.status(e.status || statusFor(e.code)).json({ error: e.message, code: e.code || 'UNKNOWN' })
  } finally {
    release?.()
  }
})

// --- GigaAvatar: портрет + аудио → говорящее видео ---
app.post('/v2/media/avatar', videoLimit, videoDailyLimit, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { image, audio, query } = parseAvatarBody(req.body)
    if (!KANDINSKY_TOKEN) return res.status(400).json({ error: 'Видео: токен не задан на сервере', code: 'NO_KEY' })
    const signal = requestAbortSignal(req, res)
    longJob(res, async () => ({ video: await gigaAvatar(image, audio, query, signal) }))
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code || 'UNKNOWN' })
  }
})

// --- Idle-анимация портрета (image → короткое видео, без звука) ---
app.post('/v2/media/portrait-animation', videoLimit, videoDailyLimit, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { image, query, quality } = parsePortraitBody(req.body)
    const signal = requestAbortSignal(req, res)
    longJob(res, async () => {
      const generated = await generateInternalIdleAnimation(
        Buffer.from(image, 'base64'), signal, query, quality
      )
      return { video: generated.bytes.toString('base64'), provider: generated.provider }
    })
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code || 'UNKNOWN' })
  }
})

app.use(validationErrors)
app.use((error, _req, res, _next) => {
  if (error?.message === 'Origin is not allowed') {
    return res.status(403).json({ error: 'Origin is not allowed', code: 'AUTH' })
  }
  console.error('[gateway]', error)
  res.status(500).json({ error: 'Внутренняя ошибка gateway', code: 'UNKNOWN' })
})

const httpServer = app.listen(PORT, () => {
  const llm = llmRouteReadiness()
  console.log(`[narra-proxy] слушает :${PORT}`)
  console.log(`  чат(LLM): ${llm.ready ? 'ok' : '—'}  salutespeech: ${SALUTE_KEY ? 'ok' : '—'}  kandinsky: ${KANDINSKY_TOKEN ? 'ok' : '—'}`)
  console.log(`  шлюз: ${LLM_BASE_URL}  модель: ${LLM_MODEL}`)
  console.log(`  fallback LiteLLM: ${LITELLM_BASE_URL || '—'}`)
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  if (privateMaterialCleanupTimer) clearInterval(privateMaterialCleanupTimer)
  if (privateMaterialCleanupInitialTimer) clearTimeout(privateMaterialCleanupInitialTimer)
  console.log(`[narra-proxy] ${signal}: draining HTTP and analytics outbox`)
  const force = setTimeout(() => process.exit(1), 25_000)
  force.unref?.()
  httpServer.close(async (error) => {
    try {
      await coverJobRunner.stop()
      await sceneJobRunner.stop()
      await Promise.all([
        eventStore.stop(),
        installationRegistry.stop(),
        coverJobStore.stop(),
        sceneJobStore.stop(),
        bookMarkupPool?.end()
      ])
      if (error) throw error
      clearTimeout(force)
      process.exit(0)
    } catch (shutdownError) {
      console.error('[narra-proxy] graceful shutdown failed', shutdownError)
      process.exit(1)
    }
  })
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
