import {
  CHARACTER_MEDIA_JOB_TYPES,
  REQUIRED_CHARACTER_MEDIA,
  normalizeCharacterAnchor
} from './book-markup.mjs'
import { createOperationalLogger } from './operational-log.mjs'
import { voiceForGender } from './voices.mjs'
import { normalizeBookDisplayIdentity } from './book-identity.mjs'

export const BOOK_MARKUP_WORKER_JOB_TYPES = Object.freeze([
  'book_markup',
  'catalog_cover',
  'scene_image',
  'character_bundle',
  ...Object.values(CHARACTER_MEDIA_JOB_TYPES)
])
const JOB_TYPES = new Set(['book_identity', ...BOOK_MARKUP_WORKER_JOB_TYPES])
const JOB_LABELS = {
  book_markup: 'разметка книги',
  book_identity: 'название книги',
  catalog_cover: 'каталожная обложка',
  scene_image: 'иллюстрация сцены',
  character_bundle: 'пакет персонажа',
  character_portrait: 'портрет персонажа',
  character_audio: 'голос персонажа',
  character_animation: 'анимация персонажа'
}
const ASSET_LABELS = {
  primary_portrait: 'портрет',
  greeting_audio: 'голосовое приветствие',
  idle_animation: 'idle-анимация'
}

function invalidResult(message) {
  const error = new Error(message)
  error.code = 'GENERATION_RESULT_INVALID'
  return error
}

function safeErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(candidate) ? candidate : 'UNKNOWN'
}

function stringValue(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function stringValues(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems)
}

function claimString(value, maxLength) {
  return stringValue(
    value && typeof value === 'object' && !Array.isArray(value) ? value.value : value,
    maxLength
  )
}

function claimStrings(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => claimString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

function safeTextOffset(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function normalizeBookSceneResult(value) {
  const asset = value?.asset
  if (
    !asset || typeof asset.objectKey !== 'string' || !asset.objectKey ||
    typeof asset.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(asset.contentHash) ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType) ||
    !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1
  ) {
    throw invalidResult('book scene result is invalid')
  }
  return { asset }
}

/**
 * Converts both server markup and legacy local-character-v1 profiles into the
 * exact character shape accepted by the internal generator. Source text and
 * local-only profile fields deliberately never cross this service boundary.
 */
export function normalizeCharacterBundleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidResult('character bundle input must be an object')
  }
  const {
    character: rawCharacter,
    firstAppearanceTextOffset: rawFirstAppearanceTextOffset,
    warmupTextOffset: rawWarmupTextOffset,
    ...request
  } = input
  const source = rawCharacter && typeof rawCharacter === 'object' && !Array.isArray(rawCharacter)
    ? rawCharacter
    : {}
  const passport = source.passport && typeof source.passport === 'object' && !Array.isArray(source.passport)
    ? source.passport
    : {}
  const claimedGender = claimString(source.gender, 32)
  const gender = ['male', 'female', 'unspecified'].includes(claimedGender)
    ? claimedGender
    : 'unspecified'
  const name = stringValue(request.name, 160)
  const fullName = stringValue(request.fullName, 240) || name
  const firstAppearanceTextOffset = safeTextOffset(
    rawFirstAppearanceTextOffset,
    safeTextOffset(source.firstAppearanceTextOffset)
  )
  const warmupTextOffset = Math.min(
    firstAppearanceTextOffset,
    safeTextOffset(rawWarmupTextOffset, safeTextOffset(source.warmupTextOffset))
  )
  const role = claimString(source.role, 400)
  const traits = claimStrings(source.traits, 5, 120)
  const speechStyle = claimString(source.speechStyle, 1_000)
  const description = claimString(source.description, 2_000) || [
    role,
    traits.length ? `Черты: ${traits.join(', ')}` : '',
    speechStyle ? `Манера речи: ${speechStyle}` : ''
  ].filter(Boolean).join('. ').slice(0, 2_000)
  const appearancePrompt = stringValue(source.creative?.appearancePrompt, 3_000) ||
    stringValue(source.appearancePrompt, 3_000) ||
    claimStrings(source.appearance, 16, 500).join(', ').slice(0, 3_000) || [
    stringValue(passport.build, 300),
    stringValue(passport.hair, 300),
    stringValue(passport.eyes, 300),
    stringValue(passport.face, 500),
    stringValue(passport.outfit, 500)
  ].filter(Boolean).join(', ').slice(0, 3_000)
  const requestedVoice = stringValue(source.creative?.voice, 32) || stringValue(source.voice, 32)
  const voice = voiceForGender(requestedVoice, gender)

  return {
    ...request,
    name,
    fullName,
    character: {
      characterKey: request.characterKey,
      name,
      fullName,
      aliases: stringValues(source.aliases, 10, 160),
      gender,
      age: claimString(source.age, 120) || (
        typeof passport.age === 'number' && Number.isFinite(passport.age)
          ? String(passport.age)
          : ''
      ),
      role,
      description,
      appearancePrompt,
      greeting: stringValue(source.creative?.greeting, 2_000) || stringValue(source.greeting, 2_000),
      voice,
      firstAppearanceTextOffset,
      warmupTextOffset
    }
  }
}

export function normalizeBookMarkupResult(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.characters)) {
    throw invalidResult('book markup must contain characters')
  }
  if (value.characters.length < 1 || value.characters.length > 32) {
    throw invalidResult('book markup must contain 1-32 characters')
  }
  if (!Number.isSafeInteger(value.textLength) || value.textLength < 1) {
    throw invalidResult('book markup must contain a positive textLength')
  }
  const seen = new Set()
  const characters = value.characters.map((candidate, index) => {
    const anchor = normalizeCharacterAnchor(candidate)
    if (seen.has(anchor.characterKey)) {
      throw invalidResult(`duplicate character key: ${anchor.characterKey}`)
    }
    seen.add(anchor.characterKey)
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
      throw invalidResult(`characters[${index}].name is required`)
    }
    if (typeof candidate.fullName !== 'string' || !candidate.fullName.trim()) {
      throw invalidResult(`characters[${index}].fullName is required`)
    }
    if (anchor.firstAppearanceTextOffset > value.textLength) {
      throw invalidResult(`characters[${index}] appears after textLength`)
    }
    return {
      ...candidate,
      ...anchor,
      name: candidate.name.trim(),
      fullName: candidate.fullName.trim()
    }
  })
  return { ...value, characters }
}

export function normalizeCharacterBundleResult(value, requiredMedia = REQUIRED_CHARACTER_MEDIA) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.assets)) {
    throw invalidResult('character bundle must contain assets')
  }
  const byType = new Map()
  for (const asset of value.assets) {
    if (!asset || typeof asset !== 'object' || typeof asset.type !== 'string') {
      throw invalidResult('character bundle contains an invalid asset')
    }
    if (byType.has(asset.type)) throw invalidResult(`duplicate asset type: ${asset.type}`)
    if (
      typeof asset.objectKey !== 'string' || !asset.objectKey ||
      typeof asset.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(asset.contentHash) ||
      typeof asset.mimeType !== 'string' || !asset.mimeType ||
      !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 0
    ) {
      throw invalidResult(`asset ${asset.type} has invalid storage metadata`)
    }
    byType.set(asset.type, { ...asset })
  }
  if (!Array.isArray(requiredMedia) || !requiredMedia.length ||
      requiredMedia.some((type) => !REQUIRED_CHARACTER_MEDIA.includes(type))) {
    throw invalidResult('required character media contract is invalid')
  }
  for (const type of requiredMedia) {
    if (!byType.has(type)) throw invalidResult(`character bundle is missing ${type}`)
  }
  if (byType.size !== requiredMedia.length) {
    throw invalidResult('character bundle contains an unexpected asset type')
  }
  return { assets: requiredMedia.map((type) => byType.get(type)) }
}

export function normalizeBookIdentityResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResult('book identity must be an object')
  }
  const identity = normalizeBookDisplayIdentity(value)
  if (!identity.title) throw invalidResult('book identity title is required')
  return {
    ...identity,
    source: value.source === 'llm' ? 'llm' : 'deterministic'
  }
}

/**
 * A single-claim worker. The repository owns leases and durable transactions;
 * the generator owns provider calls and object-storage writes.
 */
export function createGenerationWorker({
  repository,
  generator,
  workerId,
  logger = console,
  leaseRenewMs = 60_000
}) {
  if (!repository || !generator) throw new TypeError('repository and generator are required')
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  const log = createOperationalLogger({ component: 'book-worker', logger })

  async function runBookMarkup(job) {
    const startedAt = Date.now()
    const input = await repository.getBookMarkupInput(job)
    log.info('markup.started', 'Начинаю разметку книги', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.title,
      scope: input.scope,
      format: input.format,
      source_bytes: input.byteSize
    })
    const markup = normalizeBookMarkupResult(await generator.generateBookMarkup(input))
    log.info('markup.generated', 'Разметка сформирована, сохраняю результат', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.title,
      characters: markup.characters.map((character) => character.name),
      character_count: markup.characters.length,
      text_chars: markup.textLength,
      duration_ms: Date.now() - startedAt
    })
    if (typeof input.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.contentSha256)) {
      throw invalidResult('book markup input requires contentSha256')
    }
    markup.inputHash = input.contentSha256
    await repository.publishBookMarkup(job, markup)
    log.info('markup.published', 'Разметка книги опубликована и доступна клиенту', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.title,
      character_count: markup.characters.length,
      duration_ms: Date.now() - startedAt
    })
    if (input.scope === 'catalog') {
      if (typeof repository.enqueueCatalogCover === 'function') {
        await repository.enqueueCatalogCover({ bookEditionId: job.bookEditionId })
      }
      const bundleRequests = await Promise.allSettled(markup.characters.map((character) =>
        repository.ensureCharacterBundle({
          bookEditionId: job.bookEditionId,
          characterKey: character.characterKey
        })
      ))
      const failedBundleRequests = bundleRequests.filter((result) => result.status === 'rejected')
      if (failedBundleRequests.length) {
        log.error('bundle.enqueue_incomplete', 'Не все персонажи добавлены в очередь генерации', {
          job: job.id,
          edition: job.bookEditionId,
          queued: bundleRequests.length - failedBundleRequests.length,
          failed: failedBundleRequests.length
        })
      } else {
        log.info('bundle.enqueued', 'Все персонажи добавлены в очередь генерации', {
          job: job.id,
          edition: job.bookEditionId,
          character_count: bundleRequests.length
        })
      }
    }
    return { characterCount: markup.characters.length }
  }

  async function runBookIdentity(job) {
    const startedAt = Date.now()
    const input = await repository.getBookIdentityInput(job)
    log.info('identity.started', 'Определяю отображаемое название книги', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.title,
      scope: input.scope
    })
    const identity = normalizeBookIdentityResult(await generator.generateBookIdentity(input))
    const publication = await repository.publishBookIdentity(job, identity)
    if (publication?.status === 'stale') {
      log.warn('identity.stale', 'Устаревший результат названия пропущен', {
        job: job.id,
        edition: job.bookEditionId,
        duration_ms: Date.now() - startedAt
      })
      return { identity, published: false }
    }
    log.info('identity.published', 'Отображаемое название книги опубликовано', {
      job: job.id,
      edition: job.bookEditionId,
      book: identity.title,
      source: identity.source,
      duration_ms: Date.now() - startedAt
    })
    return { identity }
  }

  async function runCharacterBundle(job) {
    const startedAt = Date.now()
    const input = normalizeCharacterBundleInput(await repository.getCharacterBundleInput(job))
    log.info('bundle.started', 'Начинаю формировать пакет персонажа', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.bookTitle,
      character: input.name,
      character_key: input.characterKey,
      scope: input.scope
    })
    const requiredMedia = Array.isArray(job.payload?.required_media) && job.payload.required_media.length
      ? job.payload.required_media
      : [...REQUIRED_CHARACTER_MEDIA]
    const bundle = normalizeCharacterBundleResult(
      await generator.generateCharacterBundle(input, requiredMedia),
      requiredMedia
    )
    for (const asset of bundle.assets) {
      log.info('bundle.asset_ready', 'Артефакт персонажа готов', {
        job: job.id,
        edition: job.bookEditionId,
        character: input.name,
        asset: ASSET_LABELS[asset.type] || asset.type,
        bytes: asset.byteSize
      })
    }
    await repository.publishCharacterBundle(job, bundle)
    log.info('bundle.published', 'Пакет персонажа опубликован целиком', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.bookTitle,
      character: input.name,
      asset_count: bundle.assets.length,
      duration_ms: Date.now() - startedAt
    })
    return { assetCount: bundle.assets.length }
  }

  async function runCatalogCover(job) {
    const startedAt = Date.now()
    const input = await repository.getCatalogCoverInput(job)
    log.info('cover.started', 'Начинаю генерацию каталожной обложки', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.title
    })
    const result = await generator.generateCatalogCover(input)
    if (!result?.asset || typeof result.asset.objectKey !== 'string') {
      throw invalidResult('catalog cover result is invalid')
    }
    await repository.publishCatalogCover(job, result.asset)
    log.info('cover.published', 'Каталожная обложка опубликована', {
      job: job.id,
      edition: job.bookEditionId,
      book: input.title,
      duration_ms: Date.now() - startedAt
    })
    return { assetCount: 1 }
  }

  async function runBookScene(job) {
    const startedAt = Date.now()
    const input = await repository.getBookSceneInput(job)
    log.info('scene.started', 'Начинаю генерацию сцены книги', {
      job: job.id,
      edition: job.bookEditionId,
      scene_key: input.sceneKey,
      anchor_text_offset: input.anchorTextOffset
    })
    const result = normalizeBookSceneResult(await generator.generateBookScene(input))
    await repository.publishBookScene(job, result.asset)
    log.info('scene.published', 'Сцена книги опубликована', {
      job: job.id,
      edition: job.bookEditionId,
      scene_key: input.sceneKey,
      duration_ms: Date.now() - startedAt
    })
    return { assetCount: 1 }
  }

  async function withLeaseHeartbeat(job, operation) {
    if (typeof repository.renewGenerationLease !== 'function') return operation()
    const timer = setInterval(() => {
      void repository.renewGenerationLease(job).catch((error) => {
        log.error('job.lease_failed', 'Не удалось продлить аренду задания', {
          job: job.id,
          edition: job.bookEditionId,
          error_code: safeErrorCode(error)
        })
      })
    }, leaseRenewMs)
    timer.unref?.()
    try {
      return await operation()
    } finally {
      clearInterval(timer)
    }
  }

  return {
    async runOnce() {
      const job = await repository.claimGenerationJob(workerId)
      if (!job) return { status: 'idle' }
      const startedAt = Date.now()
      log.info('job.claimed', 'Получено новое задание', {
        job: job.id,
        type: JOB_LABELS[job.type] || job.type,
        edition: job.bookEditionId,
        character_key: job.characterKey,
        attempt: job.attempts,
        worker: workerId
      })
      if (!JOB_TYPES.has(job.type)) {
        const error = Object.assign(new Error(`unsupported job type: ${job.type}`), {
          code: 'UNSUPPORTED_JOB'
        })
        await repository.failGenerationJob(job, error.code)
        log.error('job.unsupported', 'Задание отклонено: неизвестный тип', {
          job: job.id,
          type: job.type,
          edition: job.bookEditionId
        })
        return { status: 'failed', jobId: job.id, errorCode: error.code }
      }
      try {
        const result = await withLeaseHeartbeat(job, () => {
          if (job.type === 'book_markup') return runBookMarkup(job)
          if (job.type === 'book_identity') return runBookIdentity(job)
          if (job.type === 'catalog_cover') return runCatalogCover(job)
          if (job.type === 'scene_image') return runBookScene(job)
          return runCharacterBundle(job)
        })
        log.info('job.completed', 'Задание успешно завершено', {
          job: job.id,
          type: JOB_LABELS[job.type],
          edition: job.bookEditionId,
          character_key: job.characterKey,
          duration_ms: Date.now() - startedAt
        })
        return { status: 'completed', jobId: job.id, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        const failure = await repository.failGenerationJob(job, errorCode)
        const fields = {
          job: job.id,
          type: JOB_LABELS[job.type] || job.type,
          edition: job.bookEditionId,
          character_key: job.characterKey,
          error_code: errorCode,
          duration_ms: Date.now() - startedAt
        }
        if (failure?.status === 'queued') {
          log.warn('job.retry_scheduled', 'Задание завершилось ошибкой; запланирована повторная попытка', fields)
        } else {
          log.error('job.failed', 'Задание завершилось ошибкой; автоматические попытки исчерпаны', fields)
        }
        return { status: 'failed', jobId: job.id, errorCode }
      }
    }
  }
}
