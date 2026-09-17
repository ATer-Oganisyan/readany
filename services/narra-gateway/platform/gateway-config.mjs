import {
  bookAnalysisAssignedPipelineForEdition,
  bookAnalysisCardsEditionsFromEnv,
  bookAnalysisPipelineFromEnv
} from '../analysis/book-analysis-pipeline.mjs'
import { createBookAnalysisScanPolicyFromEnv } from '../analysis/book-analysis-scan-policy.mjs'
import { createConcurrencyGate } from './concurrency.mjs'
import { parseEnvBool, parseEnvInt } from './env.mjs'
import { kandinskyImageTimeoutMs, kandinskyRequestTimeoutMs } from '../providers/image-timeouts.mjs'
import { coverImageConfig, normalizeImageQuality } from '../providers/providers.mjs'
import { insecureVideoEnvironmentAllowed, isSecureServiceUrl, serviceUrl } from './service-url.mjs'
import { verifiedSberCertificates } from '../providers/sber-tls.mjs'

/**
 * Разбирает и проверяет всё окружение gateway один раз на старте.
 *
 * Раньше эти ~250 строк жили в index.mjs и выполнялись как побочный эффект
 * импорта, вперемешку с провайдерами и маршрутами. Здесь они собраны в одну
 * функцию: конфигурация становится проверяемой, а несогласованные значения
 * роняют процесс на старте, а не на первом запросе.
 */
export function loadGatewayConfig(env = process.env) {
  const PORT = env.PORT || 8787
  const BOOK_ANALYSIS_PIPELINE = bookAnalysisPipelineFromEnv(env)
  // Список разбирается на старте, а не при создании прогона: оператор,
  // опечатавшийся в идентификаторе книги, узнаёт об этом сразу.
  bookAnalysisCardsEditionsFromEnv(env)
  const BOOK_ANALYSIS_PIPELINE_FOR_EDITION = (bookEditionId, scope = null) => (
    bookAnalysisAssignedPipelineForEdition(bookEditionId, env, scope)
  )
  const BOOK_ANALYSIS_SCAN_POLICY = createBookAnalysisScanPolicyFromEnv(env)
  const INSECURE = env.ALLOW_INSECURE_TLS === 'true'
  const PRODUCTION = env.NODE_ENV === 'production'
  const BUILD_VERSION = String(env.GATEWAY_BUILD_VERSION || 'development').slice(0, 120)


  if (PRODUCTION && INSECURE) throw new Error('ALLOW_INSECURE_TLS is forbidden in production')
  const ANALYTICS_ENV = env.ANALYTICS_ENV || (PRODUCTION ? 'production' : 'development')
  if (!['production', 'staging', 'development', 'test'].includes(ANALYTICS_ENV)) {
    throw new Error('ANALYTICS_ENV must be production, staging, development or test')
  }
  const VIDEO_REQUIRED = parseEnvBool(env, 'VIDEO_REQUIRED', false)
  const BOOK_BACKEND_REQUIRED = parseEnvBool(env, 'BOOK_BACKEND_REQUIRED', false)
  const BOOK_SEARCH_ENABLED = parseEnvBool(env, 'BOOK_SEARCH_ENABLED', false)
  const BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED = parseEnvBool(
    env,
    'BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED',
    true
  )
  // Подогрев медиа по старту раньше был безусловным: каждый перезапуск шлюза
  // брал тысячу персонажей с неготовым бандлом и дозаказывал им недостающее.
  // На проде, где такие бандлы висят неготовыми неделями, это значит «платить
  // за картинки за каждый деплой», причём молча. Теперь это явная просьба.
  const BOOK_CHARACTER_MEDIA_BACKFILL = parseEnvBool(
    env,
    'BOOK_CHARACTER_MEDIA_BACKFILL',
    false
  )
  const BOOK_SHADOW_PREVIEW_ENABLED = parseEnvBool(
    env,
    'BOOK_SHADOW_PREVIEW_ENABLED',
    ANALYTICS_ENV !== 'production'
  )
  const ALLOW_INSECURE_VIDEO_HTTP = env.ALLOW_INSECURE_VIDEO_HTTP === 'true'
  const INSECURE_VIDEO_ENV_ALLOWED = insecureVideoEnvironmentAllowed({
    production: PRODUCTION,
    analyticsEnvironment: ANALYTICS_ENV
  })
  if (ALLOW_INSECURE_VIDEO_HTTP && !INSECURE_VIDEO_ENV_ALLOWED) {
    throw new Error('ALLOW_INSECURE_VIDEO_HTTP is forbidden outside staging or local development/test')
  }
  const VIDEO_INSECURE_HTTP_HOSTS = String(env.VIDEO_INSECURE_HTTP_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const ALLOW_INSECURE_LLM_HTTP = parseEnvBool(env, 'ALLOW_INSECURE_LLM_HTTP', false)
  const LLM_INSECURE_HTTP_HOSTS = String(env.LLM_INSECURE_HTTP_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  function envInt(name, fallback, max) {
    return parseEnvInt(env, name, fallback, max)
  }
  const REGISTRATION_LIMIT = envInt('REGISTRATION_LIMIT_PER_HOUR', 10, 1_000)
  const REGISTRATION_GLOBAL_LIMIT = envInt('REGISTRATION_GLOBAL_LIMIT_PER_HOUR', 500, 100_000)
  const REGISTRATION_GLOBAL_DAILY_LIMIT = envInt('REGISTRATION_GLOBAL_LIMIT_PER_DAY', 250, 100_000)
  const INSTALLATION_REGISTRY_MAX = envInt('INSTALLATION_REGISTRY_MAX', 10_000, 100_000)
  const INSTALLATION_INACTIVE_RETENTION_DAYS = envInt('INSTALLATION_INACTIVE_RETENTION_DAYS', 30, 365)
  const INSTALLATION_TOKEN_TTL_SECONDS = envInt('INSTALLATION_TOKEN_TTL_SECONDS', 15 * 60, 24 * 60 * 60)
  if (INSTALLATION_TOKEN_TTL_SECONDS < 5 * 60) {
    throw new Error('INSTALLATION_TOKEN_TTL_SECONDS must be at least 300 seconds')
  }
  const REFRESH_LIMIT = envInt('REFRESH_LIMIT_PER_HOUR', 20, 1_000)
  const REFRESH_ATTEMPT_LIMIT = envInt('REFRESH_ATTEMPT_LIMIT_PER_HOUR', 40, 10_000)
  // Каталог берёт по запросу на страницу и ещё по одному на подписанную ссылку
  // каждой обложки. При 1500 книгах 120 запросов в минуту выбирались обычной
  // прокруткой, и следующее действие читателя — открыть книгу — получало 429.
  const API_LIMIT = envInt('API_LIMIT_PER_MINUTE', 600, 10_000)
  const EVENT_LIMIT = envInt('EVENT_LIMIT_PER_MINUTE', 10, 1_000)
  const AI_LIMIT = envInt('AI_LIMIT_PER_MINUTE', 30, 1_000)
  const AI_DAILY_LIMIT = envInt('AI_LIMIT_PER_DAY', 500, 100_000)
  const AI_GLOBAL_DAILY_LIMIT = envInt('AI_GLOBAL_LIMIT_PER_DAY', 25_000, 10_000_000)
  const SPEECH_LIMIT = envInt('SPEECH_LIMIT_PER_MINUTE', 60, 2_000)
  const SPEECH_DAILY_LIMIT = envInt('SPEECH_LIMIT_PER_DAY', 1_000, 100_000)
  const SPEECH_GLOBAL_DAILY_LIMIT = envInt('SPEECH_GLOBAL_LIMIT_PER_DAY', 50_000, 10_000_000)
  const IMAGE_DAILY_LIMIT = envInt('IMAGE_LIMIT_PER_DAY', 100, 10_000)
  const IMAGE_GLOBAL_DAILY_LIMIT = envInt('IMAGE_GLOBAL_LIMIT_PER_DAY', 5_000, 1_000_000)
  const COVER_DAILY_LIMIT = envInt('COVER_LIMIT_PER_DAY', 60, 10_000)
  const COVER_GLOBAL_DAILY_LIMIT = envInt('COVER_GLOBAL_LIMIT_PER_DAY', 3_000, 1_000_000)
  const VIDEO_LIMIT = envInt('VIDEO_LIMIT_PER_HOUR', 8, 500)
  const VIDEO_DAILY_LIMIT = envInt('VIDEO_LIMIT_PER_DAY', 20, 2_000)
  const VIDEO_GLOBAL_DAILY_LIMIT = envInt('VIDEO_GLOBAL_LIMIT_PER_DAY', 500, 100_000)
  const IMPORT_LIMIT = envInt('IMPORT_LIMIT_PER_MINUTE', 6, 100)
  const IMPORT_DAILY_LIMIT = envInt('IMPORT_LIMIT_PER_DAY', 20, 1_000)
  const IMPORT_GLOBAL_DAILY_LIMIT = envInt('IMPORT_GLOBAL_LIMIT_PER_DAY', 1_000, 100_000)
  const IMPORT_DAILY_BYTES_MB = envInt('IMPORT_LIMIT_MIB_PER_DAY', 300, 30_000)
  const IMPORT_GLOBAL_DAILY_BYTES_MB = envInt('IMPORT_GLOBAL_LIMIT_MIB_PER_DAY', 10_000, 300_000)
  const IMPORT_CONCURRENCY = envInt('IMPORT_CONCURRENCY', 2, 20)
  const IMPORT_QUEUE_LIMIT = envInt('IMPORT_QUEUE_LIMIT', 2, 50)
  const BOOK_UPLOAD_MAX_BYTES = envInt('BOOK_UPLOAD_MAX_MIB', 50, 500) * 1024 * 1024
  const PRIVATE_MATERIAL_TTL_DAYS = envInt('PRIVATE_MATERIAL_TTL_DAYS', 7, 365)
  const PRIVATE_MATERIAL_CLEANUP_MS = envInt(
    'PRIVATE_MATERIAL_CLEANUP_MS',
    60 * 60 * 1_000,
    24 * 60 * 60 * 1_000
  )
  const PRIVATE_MATERIAL_CLEANUP_BATCH_SIZE = envInt('PRIVATE_MATERIAL_CLEANUP_BATCH_SIZE', 100, 1_000)
  const LLM_RESPONSE_MAX_BYTES = envInt('LLM_RESPONSE_MAX_MIB', 8, 64) * 1024 * 1024
  const KANDINSKY_QUEUE_LIMIT = envInt('KANDINSKY_QUEUE_LIMIT', 6, 100)
  const KANDINSKY_IMAGE_TIMEOUT_MS = kandinskyImageTimeoutMs(env)
  const KANDINSKY_REQUEST_TIMEOUT_MS = kandinskyRequestTimeoutMs(env)
  const VIDEO_QUEUE_LIMIT = envInt('VIDEO_QUEUE_LIMIT', 4, 100)
  const LLM_CONCURRENCY = envInt('LLM_CONCURRENCY', 12, 100)
  const LLM_QUEUE_LIMIT = envInt('LLM_QUEUE_LIMIT', 16, 500)
  // SALUTE_SPEECH_PERS is capped at five upstream streams. Reject a stale or
  // accidental Railway override above the verified upstream scope.
  const SPEECH_CONCURRENCY = envInt('SPEECH_CONCURRENCY', 5, 5)
  const SPEECH_QUEUE_LIMIT = envInt('SPEECH_QUEUE_LIMIT', 16, 500)
  const IMAGE_CONCURRENCY = envInt('IMAGE_CONCURRENCY', 4, 50)
  const IMAGE_QUEUE_LIMIT = envInt('IMAGE_QUEUE_LIMIT', 12, 200)
  const COVER_CONCURRENCY = envInt('COVER_CONCURRENCY', 2, 20)
  const COVER_QUEUE_LIMIT = envInt('COVER_QUEUE_LIMIT', 8, 100)
  const COVER_JOB_MAX = envInt('COVER_JOB_MAX', 1_000, 10_000)
  const COVER_JOB_TTL_HOURS = envInt('COVER_JOB_TTL_HOURS', 24, 168)
  const COVER_JOB_MAX_RESULT_MIB = envInt('COVER_JOB_MAX_RESULT_MIB', 16, 64)
  const COVER_JOB_MAX_ATTEMPTS = envInt('COVER_JOB_MAX_ATTEMPTS', 3, 10)
  const COVER_JOB_ATTEMPT_TIMEOUT_SECONDS = envInt('COVER_JOB_ATTEMPT_TIMEOUT_SECONDS', 32 * 60, 2 * 60 * 60)
  const COVER_JOB_WORKER_ENABLED = parseEnvBool(env, 'COVER_JOB_WORKER_ENABLED', true)
  const SCENE_JOB_MAX = envInt('SCENE_JOB_MAX', 1_000, 10_000)
  const SCENE_JOB_TTL_HOURS = envInt('SCENE_JOB_TTL_HOURS', 24, 168)
  const SCENE_JOB_MAX_ATTEMPTS = envInt('SCENE_JOB_MAX_ATTEMPTS', 3, 10)
  const SCENE_JOB_ATTEMPT_TIMEOUT_SECONDS = envInt('SCENE_JOB_ATTEMPT_TIMEOUT_SECONDS', 15 * 60, 60 * 60)
  const SCENE_JOB_WORKER_ENABLED = parseEnvBool(env, 'SCENE_JOB_WORKER_ENABLED', true)
  // env, а не process.env: всё остальное здесь читается из переданного
  // окружения, и провайдер картинок — единственное, что читалось из чужого.
  // Из-за этого конфигурация с COVER_IMAGE_PROVIDER=litellm возвращала
  // openrouter вместе с его моделью и таймаутом, а проверка бюджета времени
  // ниже считалась по этим же чужим настройкам.
  const coverProviderConfig = coverImageConfig(env)
  const CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED = parseEnvBool(
    env,
    'CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED',
    false
  )
  const configuredPortraitFallbacks = Object.hasOwn(env, 'CHARACTER_PORTRAIT_FALLBACK_MODELS')
    ? String(env.CHARACTER_PORTRAIT_FALLBACK_MODELS ?? '').split(',')
    : [coverProviderConfig.fallbackModel]
  const CHARACTER_PORTRAIT_FALLBACK_MODELS = Object.freeze(
    CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED
      ? [...new Set(configuredPortraitFallbacks.map((model) => model?.trim()).filter(Boolean))]
        .filter((model) => model !== coverProviderConfig.model)
      : []
  )
  if (CHARACTER_PORTRAIT_FALLBACK_MODELS.length > 8) {
    throw new Error('CHARACTER_PORTRAIT_FALLBACK_MODELS supports at most 8 models')
  }
  const COVER_IMAGE_QUALITY = normalizeImageQuality(env.COVER_IMAGE_QUALITY)
  const CHARACTER_PORTRAIT_IMAGE_QUALITY = normalizeImageQuality(
    env.CHARACTER_PORTRAIT_IMAGE_QUALITY
  )
  const SCENE_IMAGE_QUALITY = normalizeImageQuality(env.SCENE_IMAGE_QUALITY)
  const coverProviderCallsPerAttempt =
    coverProviderConfig.fallbackModel && coverProviderConfig.fallbackModel !== coverProviderConfig.model ? 2 : 1
  const minimumCoverAttemptTimeoutMs =
    coverProviderConfig.timeoutMs * coverProviderCallsPerAttempt + 15_000
  if (COVER_JOB_ATTEMPT_TIMEOUT_SECONDS * 1_000 < minimumCoverAttemptTimeoutMs) {
    throw new Error(
      'COVER_JOB_ATTEMPT_TIMEOUT_SECONDS must cover every configured cover image model timeout plus 15 seconds'
    )
  }
  const llmGate = createConcurrencyGate({ limit: LLM_CONCURRENCY, queueLimit: LLM_QUEUE_LIMIT, name: 'LLM' })
  const speechGate = createConcurrencyGate({ limit: SPEECH_CONCURRENCY, queueLimit: SPEECH_QUEUE_LIMIT, name: 'Speech' })
  const imageGate = createConcurrencyGate({ limit: IMAGE_CONCURRENCY, queueLimit: IMAGE_QUEUE_LIMIT, name: 'Image' })
  const coverGate = createConcurrencyGate({ limit: COVER_CONCURRENCY, queueLimit: COVER_QUEUE_LIMIT, name: 'Cover' })
  const importGate = createConcurrencyGate({ limit: IMPORT_CONCURRENCY, queueLimit: IMPORT_QUEUE_LIMIT, name: 'Import' })
  // Собирает Basic key из готового значения либо client id + secret.
  function buildBasicKey(direct, clientId, clientSecret) {
    const d = (direct || '').trim()
    if (d) return d
    const id = (clientId || '').trim()
    const secret = (clientSecret || '').trim()
    if (id && secret) return Buffer.from(`${id}:${secret}`).toString('base64')
    return ''
  }
  // SaluteSpeech (speech.giga.chat): логин 'gigacons' + секрет → Basic base64(логин:секрет).
  const SALUTE_CLIENT = (env.SBER_SALUTE_CLIENT || 'gigacons').trim()
  const _saluteSecret = (env.SBER_SALUTE_AUTH_KEY || '').trim()
  const SALUTE_KEY = _saluteSecret
    ? SALUTE_CLIENT
      ? Buffer.from(`${SALUTE_CLIENT}:${_saluteSecret}`).toString('base64')
      : _saluteSecret
    : buildBasicKey(
        env.SALUTESPEECH_AUTH_KEY,
        env.SALUTESPEECH_CLIENT_ID,
        env.SALUTESPEECH_CLIENT_SECRET
      )
  // Основной командный LiteLLM-шлюз для GigaChat.
  const LLM_BASE_URL = serviceUrl('LLM_BASE_URL', env.LLM_BASE_URL, {
    allowPrivateHttp: true,
    allowInsecureHttp: ALLOW_INSECURE_LLM_HTTP,
    allowedInsecureHosts: LLM_INSECURE_HTTP_HOSTS
  })
  const LLM_TRANSPORT_SECURE = isSecureServiceUrl(LLM_BASE_URL)
  if (LLM_BASE_URL && !LLM_TRANSPORT_SECURE) {
    console.warn('[security] LLM_BASE_URL uses explicitly allowed plaintext HTTP; prompts and bearer credentials are not encrypted in transit')
  }
  const LLM_API_KEY = (env.LLM_API_KEY || '').trim() // виртуальный ключ LiteLLM (sk-...)
  const LLM_MODEL = (env.LLM_MODEL || 'gigachat-3-ultra').trim()
  // Независимый LiteLLM fallback. Он может маршрутизировать запросы в OpenRouter,
  // но gateway знает только OpenAI-compatible proxy contract и отдельный proxy key.
  const LITELLM_BASE_URL = serviceUrl('LITELLM_BASE_URL', env.LITELLM_BASE_URL, {
    allowPrivateHttp: true,
    allowInsecureHttp: ALLOW_INSECURE_LLM_HTTP,
    allowedInsecureHosts: LLM_INSECURE_HTTP_HOSTS
  })
  const LITELLM_TRANSPORT_SECURE = !LITELLM_BASE_URL || isSecureServiceUrl(LITELLM_BASE_URL)
  if (LITELLM_BASE_URL && !LITELLM_TRANSPORT_SECURE) {
    console.warn('[security] LITELLM_BASE_URL uses explicitly allowed plaintext HTTP; prompts and bearer credentials are not encrypted in transit')
  }
  const TEXT_LLM_TRANSPORT_SECURE = Boolean(LLM_BASE_URL || LITELLM_BASE_URL) &&
    (!LLM_BASE_URL || LLM_TRANSPORT_SECURE) && LITELLM_TRANSPORT_SECURE

  // Kandinsky 6.0 (studio.kandinskylab.ai) — один Bearer-токен
  const KANDINSKY_TOKEN = (env.KANDINSKY_TOKEN || '').trim()
  // SaluteSpeech — URL настраиваются через .env (у команды могут быть свои).
  const SALUTE_OAUTH_URL = serviceUrl('SBER_SALUTE_OAUTH_URL', env.SBER_SALUTE_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth')
  const SALUTE_SYNTH_URL = serviceUrl('SBER_SALUTE_SYNTH_URL', env.SBER_SALUTE_SYNTH_URL || 'https://smartspeech.sber.ru/rest/v1/text:synthesize')
  const SALUTE_RECOGNIZE_URL = serviceUrl('SBER_SALUTE_RECOGNIZE_URL', env.SBER_SALUTE_RECOGNIZE_URL || 'https://smartspeech.sber.ru/rest/v1/speech:recognize')
  const SALUTE_RECOGNITION_MODEL = (env.SBER_SALUTE_RECOGNITION_MODEL || 'voice_messaging').trim()
  const SBER_CA_VERIFIED = verifiedSberCertificates.length === 2
  const KANDINSKY_HOST = 'https://studio.kandinskylab.ai/api'
  // Видео/аватар API (GigaAvatar: image + audio → говорящее видео)
  const VIDEO_BASE_URL = serviceUrl('VIDEO_BASE_URL', env.VIDEO_BASE_URL, {
    allowPrivateHttp: true,
    allowInsecureHttp: ALLOW_INSECURE_VIDEO_HTTP,
    allowedInsecureHosts: VIDEO_INSECURE_HTTP_HOSTS
  })
  const VIDEO_TRANSPORT_SECURE = isSecureServiceUrl(VIDEO_BASE_URL)
  if (VIDEO_BASE_URL && !VIDEO_TRANSPORT_SECURE) {
    console.warn('[security] VIDEO_BASE_URL uses explicitly allowed plaintext HTTP; media and bearer credentials are not encrypted in transit')
  }
  serviceUrl('OPENROUTER_BASE_URL', env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
  const TRACTION_INGEST_URL = serviceUrl('TRACTION_INGEST_URL', env.TRACTION_INGEST_URL)
  const TRACTION_INGEST_TOKEN = String(env.TRACTION_INGEST_TOKEN || '').trim()
  if (Boolean(TRACTION_INGEST_URL) !== Boolean(TRACTION_INGEST_TOKEN)) {
    throw new Error('TRACTION_INGEST_URL and TRACTION_INGEST_TOKEN must be configured together')
  }
  if (PRODUCTION && TRACTION_INGEST_TOKEN && TRACTION_INGEST_TOKEN.length < 32) {
    throw new Error('TRACTION_INGEST_TOKEN must contain at least 32 characters in production')
  }
  const INSTALLATION_OPERATOR_TOKEN = String(env.INSTALLATION_OPERATOR_TOKEN || '').trim()
  if (PRODUCTION && INSTALLATION_OPERATOR_TOKEN.length < 32) {
    throw new Error('INSTALLATION_OPERATOR_TOKEN must contain at least 32 characters in production')
  }
  const CATALOG_INGEST_TOKEN = String(env.CATALOG_INGEST_TOKEN || '').trim()
  if (PRODUCTION && CATALOG_INGEST_TOKEN.length < 32) {
    throw new Error('CATALOG_INGEST_TOKEN must contain at least 32 characters in production')
  }
  const BOOK_OPERATOR_USERNAME = String(env.BOOK_OPERATOR_USERNAME || 'narra').trim()
  const BOOK_OPERATOR_PASSWORD = String(env.BOOK_OPERATOR_PASSWORD || '').trim()
  if (PRODUCTION && (BOOK_OPERATOR_USERNAME.length < 1 || BOOK_OPERATOR_PASSWORD.length < 20)) {
    throw new Error('BOOK_OPERATOR_USERNAME and a 20+ character BOOK_OPERATOR_PASSWORD are required in production')
  }

  return Object.freeze({
    PORT,
    BOOK_ANALYSIS_PIPELINE,
    BOOK_ANALYSIS_PIPELINE_FOR_EDITION,
    BOOK_ANALYSIS_SCAN_POLICY,
    INSECURE,
    PRODUCTION,
    BUILD_VERSION,
    ANALYTICS_ENV,
    VIDEO_REQUIRED,
    BOOK_BACKEND_REQUIRED,
    BOOK_SEARCH_ENABLED,
    BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED,
    BOOK_CHARACTER_MEDIA_BACKFILL,
    BOOK_SHADOW_PREVIEW_ENABLED,
    ALLOW_INSECURE_VIDEO_HTTP,
    INSECURE_VIDEO_ENV_ALLOWED,
    VIDEO_INSECURE_HTTP_HOSTS,
    ALLOW_INSECURE_LLM_HTTP,
    LLM_INSECURE_HTTP_HOSTS,
    REGISTRATION_LIMIT,
    REGISTRATION_GLOBAL_LIMIT,
    REGISTRATION_GLOBAL_DAILY_LIMIT,
    INSTALLATION_REGISTRY_MAX,
    INSTALLATION_INACTIVE_RETENTION_DAYS,
    INSTALLATION_TOKEN_TTL_SECONDS,
    REFRESH_LIMIT,
    REFRESH_ATTEMPT_LIMIT,
    API_LIMIT,
    EVENT_LIMIT,
    AI_LIMIT,
    AI_DAILY_LIMIT,
    AI_GLOBAL_DAILY_LIMIT,
    SPEECH_LIMIT,
    SPEECH_DAILY_LIMIT,
    SPEECH_GLOBAL_DAILY_LIMIT,
    IMAGE_DAILY_LIMIT,
    IMAGE_GLOBAL_DAILY_LIMIT,
    COVER_DAILY_LIMIT,
    COVER_GLOBAL_DAILY_LIMIT,
    VIDEO_LIMIT,
    VIDEO_DAILY_LIMIT,
    VIDEO_GLOBAL_DAILY_LIMIT,
    IMPORT_LIMIT,
    IMPORT_DAILY_LIMIT,
    IMPORT_GLOBAL_DAILY_LIMIT,
    IMPORT_DAILY_BYTES_MB,
    IMPORT_GLOBAL_DAILY_BYTES_MB,
    IMPORT_CONCURRENCY,
    IMPORT_QUEUE_LIMIT,
    BOOK_UPLOAD_MAX_BYTES,
    PRIVATE_MATERIAL_TTL_DAYS,
    PRIVATE_MATERIAL_CLEANUP_MS,
    PRIVATE_MATERIAL_CLEANUP_BATCH_SIZE,
    LLM_RESPONSE_MAX_BYTES,
    KANDINSKY_QUEUE_LIMIT,
    KANDINSKY_IMAGE_TIMEOUT_MS,
    KANDINSKY_REQUEST_TIMEOUT_MS,
    VIDEO_QUEUE_LIMIT,
    LLM_CONCURRENCY,
    LLM_QUEUE_LIMIT,
    SPEECH_CONCURRENCY,
    SPEECH_QUEUE_LIMIT,
    IMAGE_CONCURRENCY,
    IMAGE_QUEUE_LIMIT,
    COVER_CONCURRENCY,
    COVER_QUEUE_LIMIT,
    COVER_JOB_MAX,
    COVER_JOB_TTL_HOURS,
    COVER_JOB_MAX_RESULT_MIB,
    COVER_JOB_MAX_ATTEMPTS,
    COVER_JOB_ATTEMPT_TIMEOUT_SECONDS,
    COVER_JOB_WORKER_ENABLED,
    SCENE_JOB_MAX,
    SCENE_JOB_TTL_HOURS,
    SCENE_JOB_MAX_ATTEMPTS,
    SCENE_JOB_ATTEMPT_TIMEOUT_SECONDS,
    SCENE_JOB_WORKER_ENABLED,
    coverProviderConfig,
    CHARACTER_PORTRAIT_RETRY_FALLBACK_ENABLED,
    CHARACTER_PORTRAIT_FALLBACK_MODELS,
    COVER_IMAGE_QUALITY,
    CHARACTER_PORTRAIT_IMAGE_QUALITY,
    SCENE_IMAGE_QUALITY,
    coverProviderCallsPerAttempt,
    minimumCoverAttemptTimeoutMs,
    llmGate,
    speechGate,
    imageGate,
    coverGate,
    importGate,
    SALUTE_CLIENT,
    SALUTE_KEY,
    LLM_BASE_URL,
    LLM_TRANSPORT_SECURE,
    LLM_API_KEY,
    LLM_MODEL,
    LITELLM_BASE_URL,
    LITELLM_TRANSPORT_SECURE,
    TEXT_LLM_TRANSPORT_SECURE,
    KANDINSKY_TOKEN,
    SALUTE_OAUTH_URL,
    SALUTE_SYNTH_URL,
    SALUTE_RECOGNIZE_URL,
    SALUTE_RECOGNITION_MODEL,
    SBER_CA_VERIFIED,
    KANDINSKY_HOST,
    VIDEO_BASE_URL,
    VIDEO_TRANSPORT_SECURE,
    TRACTION_INGEST_URL,
    TRACTION_INGEST_TOKEN,
    INSTALLATION_OPERATOR_TOKEN,
    CATALOG_INGEST_TOKEN,
    BOOK_OPERATOR_USERNAME,
    BOOK_OPERATOR_PASSWORD
  })
}
