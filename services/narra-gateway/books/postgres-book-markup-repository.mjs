import { createHash, randomUUID } from 'node:crypto'
import { assertLeaseSeconds, claimJobSql, jobQueueColumns, renewLeaseSql } from '../db/pg-job-queue.mjs'
import { transaction } from '../db/postgres-runtime.mjs'
import {
  BOOK_IDENTITY_VERSION,
  bookIdentityTargetVersion,
  normalizeBookDisplayIdentity,
  normalizeBookIdentityValue
} from './book-identity.mjs'
import {
  BOOK_MARKUP_ANALYSIS_VERSION,
  BOOK_MARKUP_SCHEMA_VERSION,
  CHARACTER_MEDIA_JOB_TYPES,
  CHARACTER_BUNDLE_VERSION,
  REQUIRED_CHARACTER_MEDIA,
  characterMediaIdempotencyKey,
  characterMediaTargetVersion,
  hasReaderReachedCharacter
} from './book-markup.mjs'
import {
  bookMediaFrontier,
  bookSceneFrontier,
  bookScenePregenerationMode,
  bookReaderSceneAt,
  bookSceneIdempotencyKey,
  bookSceneSlotAt,
  bookSceneStretchAt,
  bookSceneSlotsThrough,
  normalizeBookScenePolicy
} from '../generation/book-scenes.mjs'
import {
  BOOK_ANALYSIS_NORMALIZATION_VERSION,
  bookAnalysisPublicationProvenance
} from '../analysis/book-analysis-pipeline.mjs'
import {
  BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION,
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION
} from '../analysis/book-analysis-contracts.mjs'
import { materializeMarkupVersion } from '../analysis/book-markup-materialization.mjs'
import {
  CARD_MEDIA_PRIORITY,
  CHARACTER_CARD_TARGET_VERSION
} from '../analysis/book-character-card.mjs'
import { ROSTER_CONFIRMATION_VERSION } from '../analysis/book-roster-confirmation.mjs'
import {
  cardWindowChapterFrontier,
  nextCardWindow
} from '../analysis/book-card-window-schedule.mjs'
import {
  characterCardProjection,
  validateCharacterCard
} from '../analysis/book-character-card-contract.mjs'

const BOOK_MIME_TYPES = Object.freeze({
  epub: 'application/epub+zip',
  fb2: 'application/x-fictionbook+xml',
  fbz: 'application/zip',
  txt: 'text/plain',
  pdf: 'application/pdf'
})

const CATALOG_COVER_VERSION = 'catalog-cover-v4'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function catalogCoverTargetVersion(contentSha256) {
  return `${CATALOG_COVER_VERSION}-${contentSha256.slice(0, 16)}`
}

const GENERATION_QUEUE = 'generation_jobs'
// В generation_jobs нет колонки срока аренды — он вычисляется от locked_at;
// потолка попыток в момент захвата тоже нет, ретраями управляет оператор.
const GENERATION_COLUMNS = jobQueueColumns({ maxAttempts: null, leaseExpiresAt: null })

function leaseLost(jobId) {
  const error = new Error(`generation job lease lost: ${jobId}`)
  error.code = 'LEASE_LOST'
  return error
}

function jobRow(row) {
  if (!row) return null
  return {
    id: row.id,
    type: row.job_type,
    bookEditionId: row.book_edition_id,
    characterKey: row.character_key ?? undefined,
    targetVersion: row.target_version,
    status: row.status,
    attempts: row.attempts,
    leaseToken: row.lease_token ?? undefined,
    payload: row.payload ?? {}
  }
}

function editionRow(row) {
  if (!row) return null
  const fallbackIdentity = normalizeBookDisplayIdentity({ title: row.title, author: row.author })
  const displayTitle = row.display_title
    ? normalizeBookIdentityValue(row.display_title)
    : fallbackIdentity.title
  const displayAuthor = row.display_author != null
    ? normalizeBookIdentityValue(row.display_author)
    : fallbackIdentity.author
  const edition = {
    id: row.id,
    scope: row.scope,
    catalogKey: row.catalog_key ?? undefined,
    contentSha256: row.content_sha256,
    title: displayTitle || 'Untitled book',
    author: displayAuthor,
    genres: Array.isArray(row.genres) ? row.genres.filter((genre) => typeof genre === 'string') : [],
    language: row.language ?? null,
    catalogPopularityRank: row.catalog_popularity_rank == null
      ? null
      : Number(row.catalog_popularity_rank),
    format: row.format,
    status: row.status,
    sourceStorage: row.source_storage || 'stored',
    expiresAt: row.expires_at == null
      ? null
      : row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at)
  }
  if (row.cover_status === 'ready') {
    edition.cover = {
      objectKey: row.cover_object_key,
      contentHash: row.cover_content_hash,
      mimeType: row.cover_mime_type,
      byteSize: Number(row.cover_byte_size)
    }
  }
  return edition
}

function catalogCoverRow(row) {
  if (!row) return null
  return {
    bookEditionId: row.book_edition_id,
    objectKey: row.object_key,
    contentHash: row.content_hash,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    status: row.status
  }
}

async function requireLeasedJob(client, job) {
  const result = await client.query(
    `SELECT * FROM generation_jobs
     WHERE id = $1 AND status = 'running' AND lease_token = $2::uuid
     FOR UPDATE`,
    [job.id, job.leaseToken]
  )
  if (!result.rows[0]) throw leaseLost(job.id)
  return result.rows[0]
}

/**
 * PostgreSQL implementation without a hard dependency on one driver. Pass a
 * pg-compatible Pool exposing connect(), query() and client.release().
 */
export function createPostgresBookMarkupRepository(pool, {
  idFactory = randomUUID,
  privateMaterialTtlDays = 7,
  beforeCreateReaderScene = async () => {},
  /**
   * Ставить ли портрет и приветствие сразу за публикацией карточки.
   *
   * Разметка каталога публикует карточки сотнями, и каждая тянет за собой два
   * медиа-задания: на пятистах книгах это порядка двенадцати тысяч картинок и
   * озвучек на одном media-воркере. Когда нужна только разметка, эта автоматика
   * выключается — на запрос читателя (`ensureCharacterBundle`) медиа
   * по-прежнему собирается, иначе открытая книга осталась бы без портретов.
   */
  cardMediaEnqueueEnabled = true
} = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  if (!Number.isSafeInteger(privateMaterialTtlDays) || privateMaterialTtlDays < 1 || privateMaterialTtlDays > 365) {
    throw new RangeError('privateMaterialTtlDays must be between 1 and 365')
  }
  if (typeof beforeCreateReaderScene !== 'function') {
    throw new TypeError('beforeCreateReaderScene must be a function')
  }
  if (typeof cardMediaEnqueueEnabled !== 'boolean') {
    throw new TypeError('cardMediaEnqueueEnabled must be a boolean')
  }

  async function touchPrivateRetention(client, bookEditionId) {
    await client.query(
      `WITH touched AS (
         UPDATE book_editions
         SET expires_at = now() + make_interval(days => $2), updated_at = now()
         WHERE id = $1 AND scope = 'private'
         RETURNING id, expires_at
       ), markup AS (
         UPDATE book_markup_versions AS value
         SET expires_at = touched.expires_at
         FROM touched WHERE value.book_edition_id = touched.id
       ), bundles AS (
         UPDATE character_media_bundles AS value
         SET expires_at = touched.expires_at, updated_at = now()
         FROM touched WHERE value.book_edition_id = touched.id
       )
       UPDATE media_assets AS value
       SET expires_at = touched.expires_at
       FROM touched WHERE value.book_edition_id = touched.id`,
      [bookEditionId, privateMaterialTtlDays]
    )
  }

  async function queueBookObjectDeletions(client, bookEditionIds) {
    const sources = await client.query(
      'SELECT object_key FROM book_files WHERE book_edition_id = ANY($1::uuid[])',
      [bookEditionIds]
    )
    const analysis = await client.query(
      `SELECT normalized_text_object_key AS object_key
       FROM book_analysis_runs
       WHERE book_edition_id = ANY($1::uuid[])
         AND normalized_text_object_key IS NOT NULL`,
      [bookEditionIds]
    )
    const media = await client.query(
      'SELECT object_key FROM media_assets WHERE book_edition_id = ANY($1::uuid[])',
      [bookEditionIds]
    )
    const jobs = await client.query(
      'SELECT idempotency_key FROM generation_jobs WHERE book_edition_id = ANY($1::uuid[])',
      [bookEditionIds]
    )
    const objectKeys = [...new Set([
      ...sources.rows.map((row) => row.object_key),
      ...analysis.rows.map((row) => row.object_key),
      ...media.rows.map((row) => row.object_key),
      ...jobs.rows.map((row) =>
        `generated/cache/${createHash('sha256').update(row.idempotency_key).digest('hex')}.json`
      )
    ])]
    if (!objectKeys.length) return 0
    const queued = await client.query(
      `INSERT INTO book_object_deletions (object_key)
       SELECT unnest($1::text[])
       ON CONFLICT (object_key) DO NOTHING
       RETURNING object_key`,
      [objectKeys]
    )
    return queued.rows.length
  }

  async function ensureJob({
    idempotencyKey,
    type,
    bookEditionId,
    characterKey = null,
    targetVersion,
    priority = 50,
    payload = {}
  }) {
    return transaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO generation_jobs (
           id, idempotency_key, job_type, book_edition_id, character_key,
           target_version, status, priority, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          idFactory(), idempotencyKey, type, bookEditionId, characterKey,
          targetVersion, priority, JSON.stringify(payload)
        ]
      )
      if (inserted.rows[0]) return { row: inserted.rows[0], created: true }
      const existing = await client.query(
        'SELECT * FROM generation_jobs WHERE idempotency_key = $1',
        [idempotencyKey]
      )
      if (!existing.rows[0]) throw new Error('idempotent generation job disappeared')
      return { row: existing.rows[0], created: false }
    })
  }

  async function loadSceneContext(client, { subjectId = null, bookEditionId }) {
    const result = await client.query(
      `SELECT edition.id, edition.scope, edition.title, edition.author,
              edition.expires_at, markup.id AS markup_version_id,
              markup.text_length, markup.input_hash,
              publication.content_hash AS publication_content_hash,
              publication.data->'markup'->'scenePolicy' AS scene_policy,
              run.normalized_text_object_key, run.normalized_text_hash,
              latest_run.id AS analysis_run_id,
              latest_run.stage AS analysis_stage,
              latest_run.status AS analysis_status,
              latest_run.last_error_code AS analysis_error_code,
              latest_run.updated_at AS analysis_updated_at
       FROM book_editions AS edition
       LEFT JOIN LATERAL (
         SELECT value.*
         FROM book_markup_versions AS value
         WHERE value.book_edition_id = edition.id
           AND value.status = 'published'
           AND value.analysis_version = 'book-markup-v3'
         ORDER BY value.published_at DESC, value.id DESC
         LIMIT 1
       ) AS markup ON true
       LEFT JOIN LATERAL (
         SELECT value.content_hash, value.run_id, value.data
         FROM book_analysis_publications AS value
         WHERE value.book_edition_id = edition.id AND value.channel = 'shadow'
           AND value.content_hash = markup.input_hash
         ORDER BY value.published_at DESC, value.id DESC
         LIMIT 1
       ) AS publication ON true
       LEFT JOIN book_analysis_runs AS run ON run.id = publication.run_id
       LEFT JOIN LATERAL (
         SELECT value.id, value.stage, value.status, value.last_error_code, value.updated_at
         FROM book_analysis_runs AS value
         WHERE value.book_edition_id = edition.id
           AND value.input_hash = edition.content_sha256
         ORDER BY value.run_sequence DESC, value.created_at DESC, value.id DESC
         LIMIT 1
       ) AS latest_run ON true
       WHERE edition.id = $1 AND (
         $2::uuid IS NULL OR
         (edition.scope = 'catalog' AND edition.status IN ('base_ready', 'published')) OR
         (edition.scope = 'private' AND edition.owner_subject_id = $2::uuid
           AND edition.expires_at > now())
       )
       LIMIT 1 FOR UPDATE OF edition`,
      [bookEditionId, subjectId]
    )
    const row = result.rows[0]
    if (!row) return null
    if (
      !row.markup_version_id ||
      !row.normalized_text_object_key ||
      !row.normalized_text_hash
    ) {
      if (['queued', 'running'].includes(row.analysis_status)) {
        return {
          bookEditionId: row.id,
          scope: row.scope,
          prerequisite: 'processing',
          analysis: {
            runId: row.analysis_run_id,
            stage: row.analysis_stage,
            status: row.analysis_status,
            retryable: false,
            errorCode: row.analysis_error_code ?? undefined,
            updatedAt: row.analysis_updated_at instanceof Date
              ? row.analysis_updated_at.toISOString()
              : row.analysis_updated_at ?? undefined
          }
        }
      }
      if (['failed', 'cancelled'].includes(row.analysis_status)) {
        return {
          bookEditionId: row.id,
          scope: row.scope,
          prerequisite: 'failed',
          analysis: {
            runId: row.analysis_run_id,
            stage: row.analysis_stage,
            status: row.analysis_status,
            retryable: row.scope === 'private',
            errorCode: row.analysis_error_code ?? undefined,
            updatedAt: row.analysis_updated_at instanceof Date
              ? row.analysis_updated_at.toISOString()
              : row.analysis_updated_at ?? undefined
          }
        }
      }
      return null
    }
    const textLength = Number(row.text_length)
    return {
      bookEditionId: row.id,
      scope: row.scope,
      title: row.title,
      author: row.author,
      markupVersionId: row.markup_version_id,
      markupContentHash: row.publication_content_hash || row.input_hash,
      normalizedTextObjectKey: row.normalized_text_object_key,
      normalizedTextHash: row.normalized_text_hash,
      textLength,
      policy: normalizeBookScenePolicy(row.scene_policy, textLength)
    }
  }

  async function ensureSceneSlot(client, context, slot, priority = 45, beforeCreate = async () => {}) {
    const policyVersion = slot.policyVersion ?? context.policy.version
    const idempotencyKey = bookSceneIdempotencyKey({
      bookEditionId: context.bookEditionId,
      markupContentHash: context.markupContentHash,
      policyVersion,
      slotIndex: slot.slotIndex
    })
    const targetVersion = `${policyVersion}:${context.markupContentHash.slice(0, 16)}`
    const payload = {
      markup_version_id: context.markupVersionId,
      scene_key: slot.sceneKey,
      slot_index: slot.slotIndex,
      anchor_text_offset: slot.anchorTextOffset,
      excerpt_start_text_offset: slot.excerptStartTextOffset,
      excerpt_end_text_offset: slot.excerptEndTextOffset,
      normalized_text_object_key: context.normalizedTextObjectKey,
      normalized_text_hash: context.normalizedTextHash
    }
    const proposedJobId = idFactory()
    const insertedJob = await client.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, character_key,
         target_version, status, priority, payload
       ) VALUES ($1, $2, 'scene_image', $3, NULL, $4, 'queued', $5, $6::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        proposedJobId, idempotencyKey, context.bookEditionId, targetVersion,
        priority, JSON.stringify(payload)
      ]
    )
    if (insertedJob.rows[0]) await beforeCreate()
    const job = insertedJob.rows[0] || (await client.query(
      'SELECT * FROM generation_jobs WHERE idempotency_key = $1',
      [idempotencyKey]
    )).rows[0]
    if (!job) throw new Error('idempotent scene generation job disappeared')
    if (job.status === 'failed' && priority >= 70) {
      await client.query(
        `UPDATE generation_jobs
         SET status = 'queued', attempts = 0, last_error_code = NULL,
             available_at = now(), locked_at = NULL, locked_by = NULL,
             lease_token = NULL, updated_at = now()
         WHERE id = $1 AND status = 'failed'`,
        [job.id]
      )
      job.status = 'queued'
    }
    await client.query(
      `INSERT INTO book_scene_slots (
         id, book_edition_id, markup_version_id, policy_version, scene_key,
         slot_index, anchor_text_offset, excerpt_start_text_offset,
         excerpt_end_text_offset, job_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (markup_version_id, slot_index) DO NOTHING`,
      [
        idFactory(), context.bookEditionId, context.markupVersionId,
        policyVersion, slot.sceneKey, slot.slotIndex, slot.anchorTextOffset,
        slot.excerptStartTextOffset, slot.excerptEndTextOffset, job.id
      ]
    )
    const result = await client.query(
      `SELECT scene.scene_key, scene.slot_index, scene.anchor_text_offset,
              job.id AS job_id,
              job.status, asset.id AS asset_id, asset.object_key,
              asset.type, asset.content_hash, asset.mime_type, asset.byte_size
       FROM book_scene_slots AS scene
       JOIN generation_jobs AS job ON job.id = scene.job_id
       LEFT JOIN media_assets AS asset
         ON asset.id = scene.asset_id AND asset.status = 'ready'
       WHERE scene.markup_version_id = $1 AND scene.slot_index = $2`,
      [context.markupVersionId, slot.slotIndex]
    )
    const row = result.rows[0]
    if (!row) throw new Error('durable scene slot disappeared')
    return {
      sceneKey: row.scene_key,
      jobId: row.job_id,
      slotIndex: Number(row.slot_index),
      anchorTextOffset: Number(row.anchor_text_offset),
      status: row.asset_id ? 'ready' : row.status === 'ready' ? 'failed' : row.status,
      asset: row.asset_id
        ? {
            assetId: row.asset_id,
            objectKey: row.object_key,
            type: row.type,
            contentHash: row.content_hash,
            mimeType: row.mime_type,
            byteSize: Number(row.byte_size)
          }
        : null
    }
  }

  /**
   * Готовая сцена интервала, в который попал читатель, — если она есть.
   *
   * Предгенерация рисует одну картинку на интервал книги, чтение просит
   * картинку к точной позиции, и ключи у них разные по построению. Без этой
   * проверки заранее оплаченная картинка не достаётся никому: читатель всегда
   * запускал рисование заново и ждал его двадцать секунд. Берём прогретую
   * только когда она действительно готова — незаконченная ничем не лучше
   * собственной, а ждать чужую очередь читателю незачем.
   */
  async function warmSceneAt(client, context, readerTextOffset) {
    const slot = bookSceneSlotAt(context.policy, context.textLength, readerTextOffset)
    const result = await client.query(
      `SELECT scene.scene_key, scene.slot_index, scene.anchor_text_offset,
              job.id AS job_id, job.status,
              asset.id AS asset_id, asset.object_key, asset.type,
              asset.content_hash, asset.mime_type, asset.byte_size
       FROM book_scene_slots AS scene
       JOIN generation_jobs AS job ON job.id = scene.job_id
       JOIN media_assets AS asset
         ON asset.id = scene.asset_id AND asset.status = 'ready'
       WHERE scene.markup_version_id = $1 AND scene.slot_index = $2
         AND scene.policy_version = $3`,
      [context.markupVersionId, slot.slotIndex, context.policy.version]
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      sceneKey: row.scene_key,
      jobId: row.job_id,
      slotIndex: Number(row.slot_index),
      anchorTextOffset: Number(row.anchor_text_offset),
      stretchEndFraction: bookSceneStretchAt(
        context.policy, context.textLength, readerTextOffset
      ).endFraction,
      status: 'ready',
      asset: {
        assetId: row.asset_id,
        objectKey: row.object_key,
        type: row.type,
        contentHash: row.content_hash,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size)
      }
    }
  }

  function identityJobSpec(edition) {
    const targetVersion = bookIdentityTargetVersion({
      contentSha256: edition.content_sha256,
      title: edition.title,
      author: edition.author
    })
    return {
      targetVersion,
      idempotencyKey: `${edition.id}:book-identity:${targetVersion}`
    }
  }

  async function ensureBookIdentityJob(client, edition, priority = 60) {
    const spec = identityJobSpec(edition)
    if (edition.identity_version === spec.targetVersion) return null
    const inserted = await client.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, character_key,
         target_version, status, priority, payload
       ) VALUES ($1, $2, 'book_identity', $3, NULL, $4, 'queued', $5, $6::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        idFactory(), spec.idempotencyKey, edition.id, spec.targetVersion, priority,
        JSON.stringify({ identity_version: BOOK_IDENTITY_VERSION })
      ]
    )
    if (inserted.rows[0]) {
      return { ...jobRow(inserted.rows[0]), created: true, ...spec }
    }
    const existing = await client.query(
      'SELECT * FROM generation_jobs WHERE idempotency_key = $1',
      [spec.idempotencyKey]
    )
    if (!existing.rows[0]) throw new Error('idempotent book identity job disappeared')
    return { ...jobRow(existing.rows[0]), created: false, ...spec }
  }

  /**
   * Постановка карточек одного окна внутри уже открытой транзакции.
   *
   * Вынесено из `enqueueCardWindow`, потому что подтверждение состава ставит
   * карточки своего окна в той же транзакции, в которой пишет roster: иначе
   * roster оказался бы записан, а карточек никто бы не поставил, и по прогону
   * было бы не понять, чего он ждёт.
   */
  async function enqueueCardWindowJobs(client, { runId, bookEditionId, windowIndex, priority }) {
        const window = await client.query(
          `SELECT start_offset, end_offset, assign_start_offset, assign_end_offset,
                  priority_class, status
           FROM book_card_windows
           WHERE run_id = $1 AND window_index = $2
           FOR UPDATE`,
          [runId, windowIndex]
        )
        if (!window.rows[0]) {
          const error = new Error(`card window ${windowIndex} does not exist`)
          error.code = 'CARD_WINDOW_MISSING'
          throw error
        }
        const row = window.rows[0]
        if (row.status !== 'queued') {
          return { status: row.status, windowIndex, created: 0, jobs: [] }
        }
        // Карточки ставятся по **подтверждённым** персонажам, а не по
        // кандидатам инвентаря. Раньше запрос группировал сырые фрагменты по
        // их `name:*`, и подтверждение оказывалось выброшенным: слитые Аркадий
        // и Кирсанов получали по отдельной карточке, а место, которое модель
        // отнесла к `other`, получало карточку наравне с людьми. Состав окна
        // берётся по первому упоминанию персонажа в диапазоне `assign_*`,
        // фрагменты — по барьеру и по всем ключам кандидатов, из которых
        // персонаж собран: это разные границы, и смешивать их нельзя.
        const characters = await client.query(
          `SELECT roster.character_key, roster.canonical_name, roster.names,
                  roster.candidate_keys, roster.mention_count,
                  roster.first_mention_text_offset,
                  COUNT(fragment.fragment_id)::int AS fragment_count
           FROM book_character_roster AS roster
           LEFT JOIN book_character_fragments AS fragment
             ON fragment.run_id = roster.run_id
            AND fragment.character_key = ANY(roster.candidate_keys)
            -- Абзац принадлежит окну, в котором он начинается. Предикат тот же,
            -- что у сборки карточки, и это важнее самой границы: пока они
            -- расходились, персонаж с единственным абзацем на границе окна
            -- сначала падал на CARD_FRAGMENTS_MISSING, а после «целиком внутри»
            -- стал пропадать молча — «Александр Троекуров» с четырнадцатью
            -- фрагментами остался без карточки вовсе.
            AND fragment.start_offset < $2
           WHERE roster.run_id = $1
             AND roster.first_mention_text_offset >= $3
             AND roster.first_mention_text_offset < $4
           GROUP BY roster.character_key, roster.canonical_name, roster.names,
                    roster.candidate_keys, roster.mention_count,
                    roster.first_mention_text_offset
           HAVING COUNT(fragment.fragment_id) > 0
           ORDER BY roster.first_mention_text_offset, roster.character_key`,
          [runId, row.end_offset, row.assign_start_offset, row.assign_end_offset]
        )
        const jobs = []
        for (const character of characters.rows) {
          const idempotencyKey =
            `${runId}:character-card:${windowIndex}:${character.character_key}`
          const inserted = await client.query(
            `INSERT INTO generation_jobs (
               id, idempotency_key, job_type, book_edition_id, character_key,
               target_version, status, priority, payload, analysis_run_id, card_window_index
             ) VALUES ($1, $2, 'character_card', $3, $4, $5, 'queued', $6, $7::jsonb, $8, $9)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id`,
            [
              idFactory(), idempotencyKey, bookEditionId, character.character_key,
              CHARACTER_CARD_TARGET_VERSION, priority,
              JSON.stringify({
                card_revision: 1,
                fragment_count: Number(character.fragment_count),
                first_mention_text_offset: Number(character.first_mention_text_offset),
                // Имя приходит подтверждённое: генератор читает его только из
                // payload, и без него получал технический ключ вместо имени.
                character_name: character.canonical_name,
                character_names: character.names ?? [],
                mention_count: Number(character.mention_count)
              }),
              runId, windowIndex
            ]
          )
          if (inserted.rows[0]) jobs.push(inserted.rows[0].id)
        }
        await client.query(
          `UPDATE book_card_windows
           SET status = CASE WHEN $3 > 0 THEN 'running' ELSE 'ready' END,
               started_at = COALESCE(started_at, now()),
               finished_at = CASE WHEN $3 > 0 THEN NULL ELSE now() END
           WHERE run_id = $1 AND window_index = $2`,
          [runId, windowIndex, jobs.length]
        )
        return {
          status: jobs.length ? 'running' : 'ready',
          windowIndex,
          priorityClass: row.priority_class,
          created: jobs.length,
          jobs
        }
  }

  /**
   * Имя персонажа и его варианты из инвентаря прогона, по ключу кандидата.
   *
   * Единственный сохранённый источник имён на момент постановки карточки —
   * документ инвентаря: подтверждённый roster в базе ещё не живёт, его пишет
   * стадийный поток, который пока не подведён. Поэтому имена берутся отсюда, а
   * payload задания остаётся приоритетным: когда поток подведут, он положит в
   * задание подтверждённые имена, и они перекроют инвентарные.
   */
  /**
   * Общая часть ключей кандидата и подтверждённого персонажа.
   *
   * Одна сущность живёт под двумя именами: инвентарь зовёт её
   * `name:raskolnikov`, подтверждение — `char:raskolnikov`, и второе строится из
   * первого заменой префикса (`applyRosterConfirmation`). Пока подтверждённый
   * roster не сохраняется в базу, связь между ними восстанавливается только так;
   * когда стадийный поток положит roster с его `candidateKeys`, связь станет
   * явной, а эта функция — ненужной.
   */
  function characterIdentityKey(key) {
    return String(key ?? '').replace(/^(?:name|char):/, '')
  }

  async function inventoryNamesByKey(client, runId) {
    const result = await client.query(
      `SELECT document->'candidates' AS candidates
       FROM book_name_inventory WHERE run_id = $1`,
      [runId]
    )
    const candidates = result.rows[0]?.candidates
    if (!Array.isArray(candidates)) return new Map()
    const names = new Map()
    for (const candidate of candidates) {
      if (typeof candidate?.candidateKey !== 'string') continue
      const entry = {
        name: candidate.displayName ?? candidate.candidateKey,
        names: [...new Set([
          candidate.displayName,
          candidate.fullName,
          ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])
        ].filter((value) => typeof value === 'string' && value.trim()))],
        mentionCount: Number.isFinite(candidate.count) ? candidate.count : 0
      }
      // Ключ кладётся и как есть, и без префикса. Инвентарь именует кандидата
      // `name:raskolnikov`, а подтверждение отдаёт персонажа
      // `char:raskolnikov` — `applyRosterConfirmation` строит второй из первого
      // ровно этой заменой. Из-за разных префиксов поиск по ключу задания не
      // находил ничего, и генератор получал технический ключ вместо имени.
      names.set(candidate.candidateKey, entry)
      names.set(characterIdentityKey(candidate.candidateKey), entry)
    }
    return names
  }

  /**
   * Источник медиа персонажа: опубликованная разметка или включённая карточка.
   *
   * Различается только этот запрос — постановка bundle, пересчёт ревизии и
   * вставка заданий у обоих путей общие. У карточки роль `source_markup_hash`
   * играет хэш её документа, поэтому ревизия медиа меняется ровно тогда, когда
   * включается новая `card_revision`, и ни секундой раньше: карточка
   * неизменяема, значит и портрет по ней переспрашивать незачем.
   */
  async function characterCardMediaSource(
    client,
    { bookEditionId, characterKey, bundleVersion, runId }
  ) {
    if (!runId) {
      const error = new Error('runId is required to pick a card as the media source')
      error.code = 'CARD_MEDIA_SOURCE_RUN_REQUIRED'
      throw error
    }
    // Прогон обязателен. Уникальность карточки и выключение прежней ревизии
    // ограничены `run_id`, поэтому после повторного анализа одной книги
    // включённых карточек одного персонажа может быть несколько — по одной на
    // прогон. Запрос без фильтра брал любую через LIMIT 1: новая карточка
    // получала медиа предыдущего анализа, а смена её документа портрет не
    // обновляла, потому что `source_markup_hash` в bundle оставался чужим.
    // Источник медиа — не вся карточка, а только то, из чего медиа делается.
    // Пока им был `document_hash`, любая пересборка карточки перерисовывала
    // портрет и переозвучивала приветствие: в хэш входят и `createdAt`, и
    // счётчик упоминаний, и границы окна. У «Задачи трёх тел» после повторного
    // разбора у половины персонажей промпт внешности совпал побайтно, а
    // портреты всё равно рисовались заново; у ван Тоха их набралось тринадцать
    // при одной-единственной ревизии карточки.
    //
    // Поля ровно те, что читает генератор: портрет строится по внешности, био,
    // роли и возрасту, приветствие — по greeting, голос — по полу и имени.
    const result = await client.query(
      `SELECT lpad(md5(
                concat_ws(E'\n',
                  coalesce(card.document->>'name', ''),
                  coalesce(card.document->>'fullName', ''),
                  coalesce(card.document->>'gender', ''),
                  coalesce(card.document->>'age', ''),
                  coalesce(card.document->'role'->>'value', ''),
                  coalesce(card.document->'bio'->>'value', ''),
                  coalesce(card.document->>'appearancePrompt', ''),
                  coalesce(card.document->>'greeting', ''))
              ), 64, '0') AS source_markup_hash,
              card.card_revision, card.run_id, card.window_index,
              bundle.id AS bundle_id, bundle.status AS bundle_status,
              bundle.source_markup_hash AS previous_source_markup_hash,
              bundle.media_revision
       FROM book_character_cards AS card
       LEFT JOIN character_media_bundles AS bundle
         ON bundle.book_edition_id = card.book_edition_id
        AND bundle.character_key = card.character_key
        AND bundle.bundle_version = $3
       WHERE card.book_edition_id = $1 AND card.character_key = $2 AND card.enabled
         AND card.run_id = $4
       ORDER BY card.card_revision DESC
       LIMIT 1
       FOR UPDATE OF card`,
      [bookEditionId, characterKey, bundleVersion, runId]
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      row,
      payload: {
        card_revision: Number(row.card_revision),
        analysis_run_id: row.run_id,
        card_window_index: Number(row.window_index)
      }
    }
  }

  async function ensureCharacterMediaJobs({
    bookEditionId,
    characterKey,
    bundleVersion,
    priority,
    sourceKind = 'markup',
    runId = null,
    client: outerClient = null,
    /**
     * Сверять ли отпечаток источника с тем, что лежит в бандле.
     *
     * Сверка означает «содержимое персонажа изменилось — перевыпустить медиа»:
     * ревизия растёт, готовые артефакты удаляются, портрет рисуется заново.
     * Право на этот вывод есть только у того, кто персонажа и переписал, —
     * у публикации карточки.
     *
     * Запрос читателя ничего не переписывает, он лишь просит показать медиа. Но
     * отпечаток он считал по-своему — брал `content_hash` последней публикации
     * книги, — а конвейер карточек публикует разметку на каждом закрытом окне.
     * Выходило, что каждое новое окно объявляло все портреты книги устаревшими:
     * у «Войны с саламандрами» 19 публикаций и 17 ревизий медиа, у «Дубровского»
     * 24 и 12. По каталогу 1206 персонажей нарисованы от двух до семнадцати раз.
     */
    reconcileSource = true
  }) {
    const body = async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2 || ':' || $3))`,
        [bookEditionId, characterKey, bundleVersion]
      )
      if (sourceKind === 'card') {
        const resolved = await characterCardMediaSource(client, {
          bookEditionId, characterKey, bundleVersion, runId
        })
        if (!resolved) {
          const error = new Error('no enabled character card is available for media generation')
          error.code = 'CARD_MEDIA_SOURCE_MISSING'
          throw error
        }
        return ensureFromSource(client, resolved.row, resolved.payload)
      }
      const source = await client.query(
        `SELECT markup.id AS markup_version_id,
                COALESCE(publication.content_hash,
                  lpad(md5(character.data::text), 64, '0')) AS source_markup_hash,
                bundle.id AS bundle_id, bundle.status AS bundle_status,
                bundle.source_markup_hash AS previous_source_markup_hash,
                bundle.media_revision
         FROM book_markup_versions AS markup
         JOIN book_characters AS character
           ON character.markup_version_id = markup.id AND character.character_key = $2
         LEFT JOIN LATERAL (
           SELECT value.content_hash
           FROM book_analysis_publications AS value
           WHERE value.book_edition_id = markup.book_edition_id
           ORDER BY value.published_at DESC, value.id DESC
           LIMIT 1
         ) AS publication ON true
         LEFT JOIN character_media_bundles AS bundle
           ON bundle.book_edition_id = markup.book_edition_id
          AND bundle.character_key = character.character_key
          AND bundle.bundle_version = $3
         WHERE markup.book_edition_id = $1 AND markup.status = 'published'
         LIMIT 1
         FOR UPDATE OF markup, character`,
        [bookEditionId, characterKey, bundleVersion]
      )
      const row = source.rows[0]
      if (!row) throw new Error('published character is unavailable for media generation')
      return ensureFromSource(client, row, { markup_version_id: row.markup_version_id })
    }

    async function ensureFromSource(client, row, payloadExtras) {
      let bundleId = row.bundle_id
      let mediaRevision = Number(row.media_revision ?? 1)
      // Без сверки отпечаток берётся из бандла: он и есть то, по чему медиа уже
      // сделано. Свой, только что вычисленный, нужен лишь новому бандлу.
      const sourceMarkupHash = reconcileSource || !row.previous_source_markup_hash
        ? row.source_markup_hash
        : row.previous_source_markup_hash
      let sourceChanged = false
      if (!bundleId) {
        bundleId = idFactory()
        await client.query(
          `INSERT INTO character_media_bundles (
             id, book_edition_id, character_key, bundle_version, status,
             source_markup_hash, media_revision, expires_at
           ) VALUES ($1, $2, $3, $4, 'queued', $5, 1,
             CASE WHEN EXISTS (
               SELECT 1 FROM book_editions WHERE id = $2 AND scope = 'private'
             ) THEN now() + make_interval(days => $6) ELSE NULL END)`,
          [
            bundleId, bookEditionId, characterKey, bundleVersion,
            sourceMarkupHash, privateMaterialTtlDays
          ]
        )
        sourceChanged = true
      } else if (!row.previous_source_markup_hash) {
        await client.query(
          `UPDATE character_media_bundles
           SET source_markup_hash = $2, updated_at = now() WHERE id = $1`,
          [bundleId, sourceMarkupHash]
        )
      } else if (reconcileSource && row.previous_source_markup_hash !== sourceMarkupHash) {
        mediaRevision += 1
        sourceChanged = true
        await client.query(
          `UPDATE character_media_bundles
           SET source_markup_hash = $2, media_revision = $3,
               status = 'queued', published_at = NULL, updated_at = now()
           WHERE id = $1`,
          [bundleId, sourceMarkupHash, mediaRevision]
        )
        await client.query(
          'DELETE FROM character_bundle_assets WHERE bundle_id = $1',
          [bundleId]
        )
      }
      const complete = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM character_bundle_assets AS link
         JOIN media_assets AS asset ON asset.id = link.asset_id AND asset.status = 'ready'
         WHERE link.bundle_id = $1 AND link.asset_type = ANY($2::text[])`,
        [bundleId, REQUIRED_CHARACTER_MEDIA]
      )
      if (!sourceChanged &&
          Number(complete.rows[0].count) === REQUIRED_CHARACTER_MEDIA.length) {
        if (row.bundle_status !== 'ready') {
          await client.query(
            `UPDATE character_media_bundles
             SET status = 'ready', published_at = COALESCE(published_at, now()),
                 updated_at = now()
             WHERE id = $1`,
            [bundleId]
          )
        }
        return { status: 'ready', created: false, jobs: [], bundleId, mediaRevision }
      }
      const targetVersion = characterMediaTargetVersion({ bundleVersion, mediaRevision })
      const jobs = []
      for (const assetType of REQUIRED_CHARACTER_MEDIA) {
        const idempotencyKey = characterMediaIdempotencyKey({
          bookEditionId, characterKey, targetVersion, assetType
        })
        const inserted = await client.query(
          `INSERT INTO generation_jobs (
             id, idempotency_key, job_type, book_edition_id, character_key,
             target_version, status, priority, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8::jsonb)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING *`,
          [
            idFactory(), idempotencyKey, CHARACTER_MEDIA_JOB_TYPES[assetType],
            bookEditionId, characterKey, targetVersion, priority,
            JSON.stringify({
              asset_type: assetType,
              required_media: [assetType],
              bundle_version: bundleVersion,
              source_markup_hash: sourceMarkupHash,
              media_revision: mediaRevision,
              ...payloadExtras
            })
          ]
        )
        let job = inserted.rows[0]
        if (!job) {
          const existing = await client.query(
            'SELECT * FROM generation_jobs WHERE idempotency_key = $1',
            [idempotencyKey]
          )
          job = existing.rows[0]
        }
        jobs.push({ ...jobRow(job), created: Boolean(inserted.rows[0]), idempotencyKey })
      }
      await client.query(
        `UPDATE character_media_bundles
         SET job_id = $2, status = CASE
           WHEN status = 'ready' AND $3 = false THEN status
           ELSE 'queued'
         END, updated_at = now()
         WHERE id = $1`,
        [bundleId, jobs.find((job) => job.type === 'character_portrait')?.id ?? null, sourceChanged]
      )
      return {
        status: jobs.every((job) => job.status === 'ready') ? 'ready' : 'queued',
        created: jobs.some((job) => job.created),
        jobs,
        bundleId,
        mediaRevision
      }
    }

    // Постановка медиа от карточки идёт в транзакции самой карточки: карточка
    // без поставленного портрета — молчаливая дыра, которую потом никто не
    // заметит. Путь от разметки открывает транзакцию сам, как и раньше.
    return outerClient ? body(outerClient) : transaction(pool, body)
  }

  return {
    async registerLocalBook({
      subjectId,
      proposedBookEditionId,
      contentSha256,
      title,
      author,
      format,
      language = null
    }) {
      return transaction(pool, async (client) => {
        const catalog = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions
           WHERE scope = 'catalog' AND content_sha256 = $1
             AND status IN ('base_ready', 'published')
           LIMIT 1`,
          [contentSha256]
        )
        if (catalog.rows[0]) return editionRow(catalog.rows[0])

        const existing = await client.query(
          `SELECT id, expires_at
           FROM book_editions
           WHERE scope = 'private' AND owner_subject_id = $1::uuid
             AND content_sha256 = $2
           FOR UPDATE`,
          [subjectId, contentSha256]
        )
        if (existing.rows[0]?.expires_at && new Date(existing.rows[0].expires_at) <= new Date()) {
          await queueBookObjectDeletions(client, [existing.rows[0].id])
          await client.query('DELETE FROM book_editions WHERE id = $1', [existing.rows[0].id])
        }

        await client.query(
          `INSERT INTO book_editions (
             id, scope, owner_subject_id, content_sha256, title, author, format, language,
             status, source_storage, expires_at
           ) VALUES (
             $1, 'private', $2::uuid, $3, $4, $5, $6, $7,
             'marking_up', 'local_only', now() + make_interval(days => $8)
           )
           ON CONFLICT (owner_subject_id, content_sha256) WHERE scope = 'private'
           DO UPDATE SET
             display_title = CASE
               WHEN book_editions.title IS DISTINCT FROM EXCLUDED.title OR
                    book_editions.author IS DISTINCT FROM EXCLUDED.author
                 THEN NULL ELSE book_editions.display_title END,
             display_author = CASE
               WHEN book_editions.title IS DISTINCT FROM EXCLUDED.title OR
                    book_editions.author IS DISTINCT FROM EXCLUDED.author
                 THEN NULL ELSE book_editions.display_author END,
             identity_version = CASE
               WHEN book_editions.title IS DISTINCT FROM EXCLUDED.title OR
                    book_editions.author IS DISTINCT FROM EXCLUDED.author
                 THEN NULL ELSE book_editions.identity_version END,
             identity_source = CASE
               WHEN book_editions.title IS DISTINCT FROM EXCLUDED.title OR
                    book_editions.author IS DISTINCT FROM EXCLUDED.author
                 THEN NULL ELSE book_editions.identity_source END,
             identity_updated_at = CASE
               WHEN book_editions.title IS DISTINCT FROM EXCLUDED.title OR
                    book_editions.author IS DISTINCT FROM EXCLUDED.author
                 THEN NULL ELSE book_editions.identity_updated_at END,
             title = EXCLUDED.title,
             author = EXCLUDED.author,
             format = EXCLUDED.format,
             language = COALESCE(EXCLUDED.language, book_editions.language),
             expires_at = now() + make_interval(days => $8),
             updated_at = now()`,
          [
            proposedBookEditionId, subjectId, contentSha256, title, author, format, language,
            privateMaterialTtlDays
          ]
        )
        const result = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions
           WHERE scope = 'private' AND owner_subject_id = $1::uuid
             AND content_sha256 = $2`,
          [subjectId, contentSha256]
        )
        await touchPrivateRetention(client, result.rows[0].id)
        return editionRow(result.rows[0])
      })
    },

    async beginPrivateBookUpload({
      subjectId,
      bookEditionId,
      contentSha256,
      objectKey,
      mimeType,
      byteSize
    }) {
      return transaction(pool, async (client) => {
        const editionResult = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions
           WHERE id = $1 AND scope = 'private' AND owner_subject_id = $2::uuid
             AND expires_at > now()
           FOR UPDATE`,
          [bookEditionId, subjectId]
        )
        const current = editionResult.rows[0]
        if (!current) return null
        if (current.content_sha256 !== contentSha256) {
          throw Object.assign(new Error('SHA-256 файла книги не совпадает с регистрацией'), {
            code: 'UPLOAD_INTEGRITY', status: 409
          })
        }
        if (BOOK_MIME_TYPES[current.format] !== mimeType) {
          throw Object.assign(new Error('Content-Type не совпадает с форматом книги'), {
            code: 'UPLOAD_INTEGRITY', status: 409
          })
        }
        const existingResult = await client.query(
          'SELECT * FROM book_files WHERE book_edition_id = $1 FOR UPDATE',
          [bookEditionId]
        )
        const existing = existingResult.rows[0]
        if (
          existing?.status === 'ready' &&
          existing.object_key === objectKey &&
          existing.content_hash === contentSha256 &&
          existing.mime_type === mimeType &&
          Number(existing.byte_size) === byteSize
        ) {
          await touchPrivateRetention(client, bookEditionId)
          return {
            edition: editionRow({ ...current, source_storage: 'temporary' }),
            uploadRequired: false,
            file: { objectKey, contentSha256, mimeType, byteSize }
          }
        }
        if (existing?.object_key && existing.object_key !== objectKey) {
          await client.query(
            `INSERT INTO book_object_deletions (object_key)
             VALUES ($1) ON CONFLICT (object_key) DO NOTHING`,
            [existing.object_key]
          )
        }
        await client.query(
          `INSERT INTO book_files (
             book_edition_id, object_key, mime_type, byte_size, content_hash, status
           ) VALUES ($1, $2, $3, $4, $5, 'staging')
           ON CONFLICT (book_edition_id) DO UPDATE SET
             object_key = EXCLUDED.object_key,
             mime_type = EXCLUDED.mime_type,
             byte_size = EXCLUDED.byte_size,
             content_hash = EXCLUDED.content_hash,
             status = 'staging'`,
          [bookEditionId, objectKey, mimeType, byteSize, contentSha256]
        )
        await client.query(
          `UPDATE book_editions
           SET source_storage = 'temporary', status = 'marking_up',
               expires_at = now() + make_interval(days => $2), updated_at = now()
           WHERE id = $1`,
          [bookEditionId, privateMaterialTtlDays]
        )
        return {
          edition: editionRow({
            ...current,
            status: 'marking_up',
            source_storage: 'temporary',
            expires_at: new Date(Date.now() + privateMaterialTtlDays * 86_400_000)
          }),
          uploadRequired: true,
          file: { objectKey, contentSha256, mimeType, byteSize }
        }
      })
    },

    async completePrivateBookUpload({ subjectId, bookEditionId }) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `SELECT edition.id, edition.content_sha256, edition.title, edition.author,
                  edition.identity_version
           FROM book_editions AS edition
           JOIN book_files AS file ON file.book_edition_id = edition.id
           WHERE edition.id = $1 AND edition.scope = 'private'
             AND edition.owner_subject_id = $2::uuid
             AND edition.expires_at > now()
           FOR UPDATE OF edition, file`,
          [bookEditionId, subjectId]
        )
        if (!result.rows[0]) return null
        await client.query(
          `UPDATE book_files SET status = 'ready' WHERE book_edition_id = $1`,
          [bookEditionId]
        )
        await client.query(
          `UPDATE book_editions
           SET source_storage = 'temporary', status = 'marking_up',
               expires_at = now() + make_interval(days => $2), updated_at = now()
           WHERE id = $1`,
          [bookEditionId, privateMaterialTtlDays]
        )
        await ensureBookIdentityJob(client, result.rows[0])
        const edition = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions WHERE id = $1`,
          [bookEditionId]
        )
        return editionRow(edition.rows[0])
      })
    },

    async publishLocalBookMarkup({
      subjectId,
      bookEditionId,
      analysisVersion,
      inputHash,
      textLength,
      characters
    }) {
      return transaction(pool, async (client) => {
        const editionResult = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions
           WHERE id = $1 AND scope = 'private' AND owner_subject_id = $2::uuid
             AND source_storage = 'local_only' AND expires_at > now()
           FOR UPDATE`,
          [bookEditionId, subjectId]
        )
        if (!editionResult.rows[0]) return null
        const existing = await client.query(
          `SELECT id, revision
           FROM book_markup_versions
           WHERE book_edition_id = $1 AND status = 'published'
             AND analysis_version = $2 AND input_hash = $3
           LIMIT 1`,
          [bookEditionId, analysisVersion, inputHash]
        )
        if (existing.rows[0]) {
          await touchPrivateRetention(client, bookEditionId)
          return {
            edition: editionRow(editionResult.rows[0]),
            markupId: existing.rows[0].id,
            revision: Number(existing.rows[0].revision),
            created: false
          }
        }

        const revisionResult = await client.query(
          `SELECT COALESCE(MAX(revision), 0) + 1 AS revision
           FROM book_markup_versions WHERE book_edition_id = $1`,
          [bookEditionId]
        )
        const revision = Number(revisionResult.rows[0].revision)
        const markupId = idFactory()
        await client.query(
          `UPDATE book_markup_versions SET status = 'ready'
           WHERE book_edition_id = $1 AND status = 'published'`,
          [bookEditionId]
        )
        await client.query(
          `INSERT INTO book_markup_versions (
             id, book_edition_id, schema_version, analysis_version, revision,
             status, input_hash, text_length, published_at, expires_at
           ) VALUES (
             $1, $2, $3, $4, $5, 'published', $6, $7, now(),
             now() + make_interval(days => $8)
           )`,
          [
            markupId, bookEditionId, BOOK_MARKUP_SCHEMA_VERSION, analysisVersion,
            revision, inputHash, textLength, privateMaterialTtlDays
          ]
        )
        for (const [index, character] of characters.entries()) {
          await client.query(
            `INSERT INTO book_characters (
               id, markup_version_id, character_key, sort_order, name, full_name,
               first_appearance_text_offset, warmup_text_offset, data
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
            [
              idFactory(), markupId, character.characterKey, index,
              character.name, character.fullName,
              character.firstAppearanceTextOffset, character.warmupTextOffset,
              JSON.stringify(character.profile)
            ]
          )
        }
        await client.query(
          `UPDATE book_editions
           SET status = 'base_ready', expires_at = now() + make_interval(days => $2),
               updated_at = now()
           WHERE id = $1`,
          [bookEditionId, privateMaterialTtlDays]
        )
        await touchPrivateRetention(client, bookEditionId)
        return {
          edition: editionRow({
            ...editionResult.rows[0],
            status: 'base_ready',
            expires_at: new Date(Date.now() + privateMaterialTtlDays * 86_400_000)
          }),
          markupId,
          revision,
          created: true
        }
      })
    },

    async beginCatalogBookUpload({
      proposedBookEditionId,
      catalogKey,
      contentSha256,
      title,
      author,
      format,
      language = null,
      objectKey,
      mimeType,
      byteSize
    }) {
      return transaction(pool, async (client) => {
        const existingResult = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions
           WHERE scope = 'catalog' AND catalog_key = $1
           FOR UPDATE`,
          [catalogKey]
        )
        const existing = existingResult.rows[0]
        if (existing && existing.content_sha256 !== contentSha256) {
          throw Object.assign(new Error('catalog key already belongs to different source bytes'), {
            code: 'CATALOG_CONFLICT', status: 409
          })
        }
        if (existing && language && existing.language !== language) {
          await client.query(
            'UPDATE book_editions SET language = $2, updated_at = now() WHERE id = $1',
            [existing.id, language]
          )
          existing.language = language
        }
        if (!existing) {
          await client.query(
            `INSERT INTO book_editions (
               id, scope, catalog_key, content_sha256, title, author, format, language,
               status, source_storage
             ) VALUES ($1, 'catalog', $2, $3, $4, $5, $6, $7, 'uploading', 'stored')`,
            [proposedBookEditionId, catalogKey, contentSha256, title, author, format, language]
          )
        }
        const editionId = existing?.id || proposedBookEditionId
        const fileResult = await client.query(
          'SELECT status FROM book_files WHERE book_edition_id = $1',
          [editionId]
        )
        if (fileResult.rows[0]?.status === 'ready') {
          return { edition: editionRow(existing), uploadRequired: false, fileReady: true }
        }
        await client.query(
          `INSERT INTO book_files (
             book_edition_id, object_key, mime_type, byte_size, content_hash, status
           ) VALUES ($1, $2, $3, $4, $5, 'staging')
           ON CONFLICT (book_edition_id) DO UPDATE SET
             object_key = EXCLUDED.object_key,
             mime_type = EXCLUDED.mime_type,
             byte_size = EXCLUDED.byte_size,
             content_hash = EXCLUDED.content_hash,
             status = 'staging'`,
          [editionId, objectKey, mimeType, byteSize, contentSha256]
        )
        const editionResult = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions WHERE id = $1`,
          [editionId]
        )
        return {
          edition: editionRow(editionResult.rows[0]),
          uploadRequired: true,
          fileReady: false,
          file: { objectKey, mimeType, byteSize, contentSha256 }
        }
      })
    },

    async getCatalogBookUpload({ bookEditionId }) {
      const result = await pool.query(
        `SELECT edition.id, edition.scope, edition.catalog_key,
                edition.content_sha256, edition.title, edition.author,
                edition.display_title, edition.display_author,
                edition.language, edition.format, edition.status, edition.source_storage,
                edition.expires_at, edition.created_at,
                file.object_key, file.mime_type, file.byte_size,
                file.content_hash, file.status AS file_status
         FROM book_editions AS edition
         JOIN book_files AS file ON file.book_edition_id = edition.id
         WHERE edition.id = $1 AND edition.scope = 'catalog'`,
        [bookEditionId]
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        edition: editionRow(row),
        file: {
          objectKey: row.object_key,
          mimeType: row.mime_type,
          byteSize: Number(row.byte_size),
          contentSha256: row.content_hash,
          status: row.file_status
        }
      }
    },

    async completeCatalogBookUpload({ bookEditionId }) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `SELECT edition.id, edition.content_sha256, edition.title, edition.author,
                  edition.identity_version
           FROM book_editions AS edition
           JOIN book_files AS file ON file.book_edition_id = edition.id
           WHERE edition.id = $1 AND edition.scope = 'catalog'
           FOR UPDATE OF edition, file`,
          [bookEditionId]
        )
        if (!result.rows[0]) return null
        await client.query(
          `UPDATE book_files SET status = 'ready' WHERE book_edition_id = $1`,
          [bookEditionId]
        )
        await client.query(
          `UPDATE book_editions SET status = 'marking_up', updated_at = now()
           WHERE id = $1 AND status IN ('draft', 'uploading', 'failed')`,
          [bookEditionId]
        )
        const targetVersion = catalogCoverTargetVersion(result.rows[0].content_sha256)
        await client.query(
          `INSERT INTO generation_jobs (
             id, idempotency_key, job_type, book_edition_id, character_key,
             target_version, status, priority, payload
           ) VALUES ($1, $2, 'catalog_cover', $3, NULL, $4, 'queued', 45, $5::jsonb)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            idFactory(), `${bookEditionId}:catalog-cover:${targetVersion}`,
            bookEditionId, targetVersion,
            JSON.stringify({ content_sha256: result.rows[0].content_sha256 })
          ]
        )
        await ensureBookIdentityJob(client, result.rows[0])
        const edition = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format,
                  status, source_storage, expires_at, created_at
           FROM book_editions WHERE id = $1`,
          [bookEditionId]
        )
        return editionRow(edition.rows[0])
      })
    },

    async beginCatalogCoverUpload({
      bookEditionId,
      objectKey,
      contentSha256,
      mimeType,
      byteSize
    }) {
      return transaction(pool, async (client) => {
        const edition = await client.query(
          `SELECT id FROM book_editions
           WHERE id = $1 AND scope = 'catalog'
           FOR UPDATE`,
          [bookEditionId]
        )
        if (!edition.rows[0]) return null
        const currentResult = await client.query(
          'SELECT * FROM catalog_book_covers WHERE book_edition_id = $1 FOR UPDATE',
          [bookEditionId]
        )
        const current = currentResult.rows[0]
        if (
          current?.status === 'ready' &&
          current.content_hash === contentSha256 &&
          current.mime_type === mimeType &&
          Number(current.byte_size) === byteSize
        ) {
          return { cover: catalogCoverRow(current), uploadRequired: false }
        }
        if (current?.object_key && current.object_key !== objectKey) {
          await client.query(
            `INSERT INTO book_object_deletions (object_key)
             VALUES ($1) ON CONFLICT (object_key) DO NOTHING`,
            [current.object_key]
          )
        }
        const result = await client.query(
          `INSERT INTO catalog_book_covers (
             book_edition_id, object_key, content_hash, mime_type, byte_size, status
           ) VALUES ($1, $2, $3, $4, $5, 'staging')
           ON CONFLICT (book_edition_id) DO UPDATE SET
             object_key = EXCLUDED.object_key,
             content_hash = EXCLUDED.content_hash,
             mime_type = EXCLUDED.mime_type,
             byte_size = EXCLUDED.byte_size,
             status = 'staging',
             updated_at = now()
           RETURNING *`,
          [bookEditionId, objectKey, contentSha256, mimeType, byteSize]
        )
        return { cover: catalogCoverRow(result.rows[0]), uploadRequired: true }
      })
    },

    async getCatalogCoverUpload({ bookEditionId }) {
      const result = await pool.query(
        `SELECT cover.*
         FROM catalog_book_covers AS cover
         JOIN book_editions AS edition ON edition.id = cover.book_edition_id
         WHERE cover.book_edition_id = $1 AND edition.scope = 'catalog'`,
        [bookEditionId]
      )
      return catalogCoverRow(result.rows[0])
    },

    async completeCatalogCoverUpload({ bookEditionId }) {
      const result = await pool.query(
        `UPDATE catalog_book_covers AS cover
         SET status = 'ready', updated_at = now()
         FROM book_editions AS edition
         WHERE cover.book_edition_id = $1
           AND edition.id = cover.book_edition_id
           AND edition.scope = 'catalog'
         RETURNING cover.*`,
        [bookEditionId]
      )
      return catalogCoverRow(result.rows[0])
    },

    async getReaderBookSource({ bookEditionId }) {
      const result = await pool.query(
        `SELECT file.object_key, file.mime_type, file.byte_size, file.content_hash,
                edition.title, edition.format
         FROM book_editions AS edition
         JOIN book_files AS file ON file.book_edition_id = edition.id AND file.status = 'ready'
         WHERE edition.id = $1 AND edition.scope = 'catalog'
           AND edition.status IN ('base_ready', 'published')`,
        [bookEditionId]
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        objectKey: row.object_key,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        contentHash: row.content_hash,
        filename: `${row.title || 'book'}.${row.format}`
      }
    },

    async getReaderBookContent({ bookEditionId }) {
      const result = await pool.query(
         `SELECT edition.id AS book_edition_id, edition.content_sha256,
                prepared.normalized_text_object_key, prepared.normalized_text_hash,
                prepared.text_length, prepared.normalization_version,
                prepared.content_navigation
         FROM book_editions AS edition
         JOIN LATERAL (
           SELECT run.normalized_text_object_key, run.normalized_text_hash,
                  run.text_length, run.normalization_version, run.content_navigation
           FROM book_analysis_runs AS run
           WHERE run.book_edition_id = edition.id
             AND run.input_hash = edition.content_sha256
             AND run.status = 'ready'
             AND run.normalization_version = ANY($2::text[])
             AND run.normalized_text_object_key IS NOT NULL
             AND run.normalized_text_hash IS NOT NULL
           ORDER BY array_position($2::text[], run.normalization_version),
                    run.run_sequence DESC, run.created_at DESC
           LIMIT 1
         ) AS prepared ON true
         WHERE edition.id = $1 AND edition.scope = 'catalog'
           AND edition.status IN ('base_ready', 'published')`,
        [bookEditionId, [BOOK_ANALYSIS_NORMALIZATION_VERSION, 'normalized-text-v1']]
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        bookEditionId: row.book_edition_id,
        sourceContentHash: row.content_sha256,
        objectKey: row.normalized_text_object_key,
        contentHash: row.normalized_text_hash,
        textLength: Number(row.text_length),
        normalizationVersion: row.normalization_version,
        navigation: row.content_navigation ?? null
      }
    },

    async getCatalogBookCover({ bookEditionId }) {
      const result = await pool.query(
        `SELECT cover.object_key, cover.mime_type, cover.byte_size, cover.content_hash
         FROM catalog_book_covers AS cover
         JOIN book_editions AS edition ON edition.id = cover.book_edition_id
         WHERE cover.book_edition_id = $1
           AND cover.status = 'ready'
           AND edition.scope = 'catalog'
           AND edition.status IN ('base_ready', 'published')`,
        [bookEditionId]
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        objectKey: row.object_key,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        contentHash: row.content_hash,
        filename: `cover.${row.mime_type === 'image/png' ? 'png' : row.mime_type === 'image/webp' ? 'webp' : 'jpg'}`
      }
    },

    async getReaderMediaAsset({
      subjectId,
      bookEditionId,
      assetId,
      bundleVersion = CHARACTER_BUNDLE_VERSION
    }) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `SELECT asset.id, asset.object_key, asset.type, asset.content_hash,
                  asset.mime_type, asset.byte_size, edition.scope,
                  character.character_key, character.first_appearance_text_offset,
                  character.warmup_text_offset, character.data,
                  position.text_offset AS reader_text_offset,
                  position.section_index AS reader_section_index,
                  position.section_fraction AS reader_section_fraction
           FROM book_editions AS edition
           JOIN book_markup_versions AS markup
             ON markup.book_edition_id = edition.id AND markup.status = 'published'
           JOIN book_characters AS character ON character.markup_version_id = markup.id
           JOIN character_media_bundles AS bundle
             ON bundle.book_edition_id = edition.id
            AND bundle.character_key = character.character_key
            AND bundle.bundle_version = $4
           JOIN character_bundle_assets AS link ON link.bundle_id = bundle.id
           JOIN media_assets AS asset
             ON asset.id = link.asset_id AND asset.status = 'ready'
           LEFT JOIN reader_book_positions AS position
             ON position.subject_id = $2::uuid AND position.book_edition_id = edition.id
           WHERE edition.id = $1 AND asset.id = $3::uuid
             AND (
               (edition.scope = 'catalog' AND edition.status IN ('base_ready', 'published')) OR
               (edition.scope = 'private' AND edition.owner_subject_id = $2::uuid
                 AND edition.expires_at > now())
             )`,
          [bookEditionId, subjectId, assetId, bundleVersion]
        )
        const row = result.rows[0]
        if (!row) return null
        if (!hasReaderReachedCharacter({
          characterKey: row.character_key,
          firstAppearanceTextOffset: Number(row.first_appearance_text_offset),
          warmupTextOffset: Number(row.warmup_text_offset),
          data: row.data
        }, {
          textOffset: Number(row.reader_text_offset ?? 0),
          sectionIndex: row.reader_section_index == null
            ? null
            : Number(row.reader_section_index),
          sectionFraction: row.reader_section_fraction == null
            ? null
            : Number(row.reader_section_fraction)
        })) return null
        if (row.scope === 'private') await touchPrivateRetention(client, bookEditionId)
        return {
          assetId: row.id,
          objectKey: row.object_key,
          type: row.type,
          contentHash: row.content_hash,
          mimeType: row.mime_type,
          byteSize: Number(row.byte_size)
        }
      })
    },

    async ensureReaderBookScene({
      subjectId,
      bookEditionId,
      readerTextOffset = null,
      progressFraction = null,
      priority = 70
    }) {
      return transaction(pool, async (client) => {
        const context = await loadSceneContext(client, { subjectId, bookEditionId })
        if (!context) return null
        if (context.prerequisite) {
          if (context.scope === 'private') await touchPrivateRetention(client, bookEditionId)
          return {
            status: context.prerequisite,
            errorCode: context.prerequisite === 'processing'
              ? 'MARKUP_PROCESSING'
              : 'MARKUP_FAILED',
            retryable: context.analysis.retryable,
            analysis: context.analysis
          }
        }
        const canonicalOffset = progressFraction != null
          ? Math.round(context.textLength * Math.min(1, Math.max(0, progressFraction)))
          : readerTextOffset
        const anchorTextOffset = Math.min(
          context.textLength - 1,
          Math.max(0, canonicalOffset ?? 0)
        )
        const warm = await warmSceneAt(client, context, anchorTextOffset)
        if (warm) {
          if (context.scope === 'private') await touchPrivateRetention(client, bookEditionId)
          return warm
        }
        const stretch = bookSceneStretchAt(context.policy, context.textLength, anchorTextOffset)
        const slot = bookReaderSceneAt(context.textLength, anchorTextOffset)
        const scene = await ensureSceneSlot(
          client,
          context,
          slot,
          priority,
          () => beforeCreateReaderScene(subjectId)
        )
        if (context.scope === 'private') await touchPrivateRetention(client, bookEditionId)
        return { ...scene, stretchEndFraction: stretch.endFraction }
      })
    },

    async recordSceneDownloadReady(jobId) {
      if (!UUID.test(String(jobId))) throw new TypeError('jobId must be a UUID')
      await pool.query(
        `UPDATE generation_jobs
         SET first_download_at = coalesce(first_download_at, now())
         WHERE id = $1 AND job_type = 'scene_image' AND status = 'ready'`,
        [jobId]
      )
    },

    async ensureBookScenesThrough({
      subjectId,
      bookEditionId,
      readerTextOffset,
      priority = 45,
      // Режим решает вызывающий, а не окружение процесса: операторская команда
      // просит пачку осознанно и должна работать даже там, где фоновый подогрев
      // выключен. Настройку читает тот, кто ходит за читателем.
      mode = bookScenePregenerationMode()
    }) {
      if (mode === 'none') return { requested: 0, ready: 0, pending: 0, failed: 0 }
      return transaction(pool, async (client) => {
        const context = await loadSceneContext(client, { subjectId, bookEditionId })
        if (!context) return { requested: 0, ready: 0, pending: 0, failed: 0 }
        if (context.prerequisite) {
          if (context.scope === 'private') await touchPrivateRetention(client, bookEditionId)
          return { requested: 0, ready: 0, pending: 0, failed: 0 }
        }
        const frontier = bookSceneFrontier({
          scope: context.scope,
          textLength: context.textLength,
          readerTextOffset,
          mode
        })
        const slots = bookSceneSlotsThrough(context.policy, context.textLength, frontier)
        const scenes = []
        for (const slot of slots) scenes.push(await ensureSceneSlot(client, context, slot, priority))
        if (context.scope === 'private') await touchPrivateRetention(client, bookEditionId)
        return {
          requested: scenes.length,
          ready: scenes.filter(({ status }) => status === 'ready').length,
          pending: scenes.filter(({ status }) => status === 'queued' || status === 'running').length,
          failed: scenes.filter(({ status }) => status === 'failed').length
        }
      })
    },

    async listCatalogBooks({ limit, cursor = null, language = null }) {
      const result = await pool.query(
        `SELECT edition.id, edition.scope, edition.catalog_key,
                edition.content_sha256, edition.title, edition.author,
                edition.display_title, edition.display_author,
                COALESCE((
                  SELECT array_agg(link.genre ORDER BY link.position)
                  FROM book_edition_genres AS link
                  WHERE link.book_edition_id = edition.id
                ), ARRAY[]::text[]) AS genres,
                edition.language, edition.format, edition.status, edition.source_storage,
                edition.expires_at, edition.created_at,
                popularity.popularity_rank AS catalog_popularity_rank,
                cover.object_key AS cover_object_key,
                cover.content_hash AS cover_content_hash,
                cover.mime_type AS cover_mime_type,
                cover.byte_size AS cover_byte_size,
                cover.status AS cover_status
         FROM book_editions AS edition
         LEFT JOIN catalog_book_covers AS cover
           ON cover.book_edition_id = edition.id AND cover.status = 'ready'
         LEFT JOIN catalog_book_popularity_aliases AS popularity_alias
           ON popularity_alias.catalog_key = edition.catalog_key
         LEFT JOIN catalog_book_popularity AS popularity
           ON popularity.source_key = COALESCE(popularity_alias.source_key, CASE
             WHEN edition.catalog_key ~ '^narra-ru-top100-.+-[0-9a-f]{8}$' THEN
               regexp_replace(
                 substr(edition.catalog_key, length('narra-ru-top100-') + 1),
                 '-[0-9a-f]{8}$',
                 ''
               )
             WHEN edition.catalog_key ~ '^narra-ru-[0-9]+-.+$' THEN
               regexp_replace(edition.catalog_key, '^narra-ru-[0-9]+-', '')
             ELSE edition.catalog_key
           END)
         WHERE edition.scope = 'catalog'
           AND edition.status IN ('base_ready', 'published')
           AND edition.catalog_hidden_at IS NULL
           AND (
             $2::timestamptz IS NULL OR
             COALESCE(popularity.popularity_rank, 2147483647) >
               COALESCE($1::integer, 2147483647) OR
             (
               COALESCE(popularity.popularity_rank, 2147483647) =
                 COALESCE($1::integer, 2147483647)
               AND (edition.created_at, edition.id) < ($2::timestamptz, $3::uuid)
             )
           )
           AND ($5::text IS NULL OR edition.language = $5)
         ORDER BY popularity.popularity_rank ASC NULLS LAST,
                  edition.created_at DESC, edition.id DESC
         LIMIT $4`,
        [
          cursor?.popularityRank ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          limit + 1,
          language
        ]
      )
      const hasMore = result.rows.length > limit
      const items = result.rows.slice(0, limit).map(editionRow)
      const last = items.at(-1)
      return {
        items,
        nextCursor: hasMore && last
          ? {
              popularityRank: last.catalogPopularityRank,
              createdAt: last.createdAt,
              id: last.id
            }
          : null
      }
    },

    async hideReplacedCatalogBook({ bookEditionId, replacedByBookEditionId }) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE book_editions AS old_edition
           SET catalog_hidden_at = now(),
               replaced_by_book_edition_id = replacement.id,
               updated_at = now()
           FROM book_editions AS replacement
           WHERE old_edition.id = $1
             AND replacement.id = $2
             AND old_edition.id <> replacement.id
             AND old_edition.scope = 'catalog'
             AND replacement.scope = 'catalog'
             AND old_edition.language IS NOT DISTINCT FROM replacement.language
             AND lower(btrim(COALESCE(NULLIF(old_edition.display_title, ''), old_edition.title))) =
                 lower(btrim(COALESCE(NULLIF(replacement.display_title, ''), replacement.title)))
             AND old_edition.content_sha256 <> replacement.content_sha256
             AND replacement.status IN ('base_ready', 'published')
             AND EXISTS (
               SELECT 1 FROM book_analysis_publications AS publication
               WHERE publication.book_edition_id = replacement.id
             )
           RETURNING old_edition.id, old_edition.catalog_hidden_at,
                     old_edition.replaced_by_book_edition_id`,
          [bookEditionId, replacedByBookEditionId]
        )
        return result.rows[0] || null
      })
    },

    async resolveBook({ subjectId, source, catalogKey, contentSha256 }) {
      if (source === 'catalog') {
        const result = await pool.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format,
                  status, source_storage, expires_at, created_at
           FROM book_editions
           WHERE scope = 'catalog' AND catalog_key = $1
             AND status <> 'failed'
           LIMIT 1`,
          [catalogKey]
        )
        return editionRow(result.rows[0])
      }
      return transaction(pool, async (client) => {
        const result = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format,
                  status, source_storage, expires_at, created_at
           FROM book_editions
           WHERE content_sha256 = $2 AND (
             (scope = 'catalog' AND status IN ('base_ready', 'published')) OR
             (scope = 'private' AND owner_subject_id = $1::uuid
               AND expires_at > now())
           )
           ORDER BY CASE WHEN scope = 'catalog' THEN 0 ELSE 1 END, created_at DESC
           LIMIT 1`,
          [subjectId, contentSha256]
        )
        const edition = editionRow(result.rows[0])
        if (edition?.scope === 'private') await touchPrivateRetention(client, edition.id)
        return edition
      })
    },

    async getReaderBookIdentity({ subjectId, bookEditionId }) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `SELECT id, scope, content_sha256, title, author,
                  display_title, display_author, identity_version,
                  identity_source, identity_updated_at
           FROM book_editions
           WHERE id = $1 AND (
             (scope = 'catalog' AND status <> 'failed') OR
             (scope = 'private' AND owner_subject_id = $2::uuid
               AND expires_at > now())
           )
           FOR UPDATE`,
          [bookEditionId, subjectId]
        )
        const edition = result.rows[0]
        if (!edition) return null
        if (edition.scope === 'private') await touchPrivateRetention(client, edition.id)

        const spec = identityJobSpec(edition)
        if (edition.identity_version === spec.targetVersion && edition.display_title) {
          const identity = normalizeBookDisplayIdentity({
            title: edition.display_title,
            author: edition.display_author
          })
          return {
            bookEditionId: edition.id,
            version: BOOK_IDENTITY_VERSION,
            status: 'ready',
            title: identity.title,
            author: identity.author,
            source: edition.identity_source === 'llm' ? 'llm' : 'deterministic',
            updatedAt: edition.identity_updated_at instanceof Date
              ? edition.identity_updated_at.toISOString()
              : String(edition.identity_updated_at)
          }
        }

        const jobResult = await client.query(
          `SELECT status, last_error_code
           FROM generation_jobs
           WHERE book_edition_id = $1 AND job_type = 'book_identity'
             AND target_version = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [bookEditionId, spec.targetVersion]
        )
        const job = jobResult.rows[0]
        return {
          bookEditionId: edition.id,
          version: BOOK_IDENTITY_VERSION,
          status: job?.status === 'failed' ? 'failed' : 'processing',
          errorCode: job?.status === 'failed' && typeof job.last_error_code === 'string'
            ? job.last_error_code
            : undefined
        }
      })
    },

    async getReaderBookManifest({ subjectId, bookEditionId, bundleVersion }) {
      return transaction(pool, async (client) => {
        const editionResult = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author,
                  display_title, display_author, language, format, status,
                  source_storage, expires_at, created_at
           FROM book_editions
           WHERE id = $1 AND (
             (scope = 'catalog' AND status IN ('base_ready', 'published')) OR
             (scope = 'private' AND owner_subject_id = $2::uuid
               AND expires_at > now())
           )
           FOR UPDATE`,
          [bookEditionId, subjectId]
        )
        const edition = editionRow(editionResult.rows[0])
        if (!edition) return null
        if (edition.scope === 'private') await touchPrivateRetention(client, edition.id)
        const positionResult = await client.query(
          `SELECT text_offset, reading_fraction, section_index, section_fraction
           FROM reader_book_positions
           WHERE subject_id = $1::uuid AND book_edition_id = $2`,
          [subjectId, bookEditionId]
        )
        const readerTextOffset = Number(positionResult.rows[0]?.text_offset ?? 0)
        const readingFraction = positionResult.rows[0]?.reading_fraction == null
          ? null
          : Number(positionResult.rows[0].reading_fraction)
        const readerSectionIndex = positionResult.rows[0]?.section_index == null
          ? null
          : Number(positionResult.rows[0].section_index)
        const readerSectionFraction = positionResult.rows[0]?.section_fraction == null
          ? null
          : Number(positionResult.rows[0].section_fraction)
        const markupResult = await client.query(
          `SELECT id, schema_version, analysis_version, revision, input_hash,
                  text_length, published_at
           FROM book_markup_versions
           WHERE book_edition_id = $1 AND status = 'published'
           LIMIT 1`,
          [bookEditionId]
        )
        const markupRow = markupResult.rows[0]
        if (!markupRow) {
          return {
            edition,
            readerTextOffset,
            readingFraction,
            readerSectionIndex,
            readerSectionFraction,
            markup: null,
            characters: []
          }
        }
        const characterResult = await client.query(
          `SELECT character.character_key, character.name, character.full_name,
                  character.first_appearance_text_offset,
                  character.warmup_text_offset, character.data,
                  bundle.id AS bundle_id, bundle.bundle_version,
                  bundle.media_revision, bundle.status AS bundle_status,
                  asset.id AS asset_id, asset.type AS asset_type,
                  asset.content_hash, asset.mime_type, asset.byte_size,
                  asset.status AS asset_status
           FROM book_characters AS character
           LEFT JOIN character_media_bundles AS bundle
             ON bundle.book_edition_id = $2
            AND bundle.character_key = character.character_key
            AND bundle.bundle_version = $3
           LEFT JOIN character_bundle_assets AS link ON link.bundle_id = bundle.id
           LEFT JOIN media_assets AS asset ON asset.id = link.asset_id
           WHERE character.markup_version_id = $1
           ORDER BY character.sort_order, asset.type`,
          [markupRow.id, bookEditionId, bundleVersion]
        )
        const characters = []
        const byKey = new Map()
        for (const row of characterResult.rows) {
          let character = byKey.get(row.character_key)
          if (!character) {
            character = {
              characterKey: row.character_key,
              name: row.name,
              fullName: row.full_name,
              firstAppearanceTextOffset: Number(row.first_appearance_text_offset),
              warmupTextOffset: Number(row.warmup_text_offset),
              data: row.data,
              bundle: row.bundle_id
                ? {
                    version: Number(row.media_revision ?? 1) > 1
                      ? `${row.bundle_version}:r${Number(row.media_revision)}`
                      : row.bundle_version,
                    status: row.bundle_status,
                    assets: []
                  }
                : null
            }
            byKey.set(row.character_key, character)
            characters.push(character)
          }
          if (row.asset_id && character.bundle) {
            character.bundle.assets.push({
              assetId: row.asset_id,
              type: row.asset_type,
              contentHash: row.content_hash,
              mimeType: row.mime_type,
              byteSize: Number(row.byte_size),
              status: row.asset_status
            })
          }
        }
        return {
          edition,
          readerTextOffset,
          readingFraction,
          readerSectionIndex,
          readerSectionFraction,
          markup: {
            id: markupRow.id,
            inputHash: markupRow.input_hash,
            schemaVersion: Number(markupRow.schema_version),
            analysisVersion: markupRow.analysis_version,
            revision: Number(markupRow.revision),
            textLength: markupRow.text_length == null ? null : Number(markupRow.text_length),
            publishedAt: markupRow.published_at instanceof Date
              ? markupRow.published_at.toISOString()
              : String(markupRow.published_at)
          },
          characters
        }
      })
    },

    async advanceReaderPosition({
      subjectId,
      bookEditionId,
      progressFraction = null,
      textOffset = null,
      chapterKey = null,
      sectionIndex = null,
      sectionFraction = null
    }) {
      return transaction(pool, async (client) => {
        const edition = await client.query(
          `SELECT edition.id, edition.scope, markup.id AS markup_version_id,
                  markup.input_hash AS markup_input_hash,
                  markup.text_length, markup.analysis_version
           FROM book_editions AS edition
           LEFT JOIN book_markup_versions AS markup
             ON markup.book_edition_id = edition.id AND markup.status = 'published'
           WHERE edition.id = $1 AND (
             (edition.scope = 'catalog' AND edition.status IN ('base_ready', 'published')) OR
             (edition.scope = 'private' AND edition.owner_subject_id = $2::uuid
               AND edition.expires_at > now())
           )
           FOR UPDATE OF edition`,
          [bookEditionId, subjectId]
        )
        if (!edition.rows[0]) return null
        await touchPrivateRetention(client, bookEditionId)
        const textLength = edition.rows[0].text_length == null
          ? null
          : Number(edition.rows[0].text_length)
        const canonicalOffset = progressFraction != null && textLength
          ? Math.round(textLength * progressFraction)
          : 0
        const proposedTextOffset = Math.max(textOffset ?? 0, canonicalOffset)
        const position = await client.query(
           `INSERT INTO reader_book_positions (
             subject_id, book_edition_id, text_offset, reading_fraction, chapter_key,
             section_index, section_fraction
           ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (subject_id, book_edition_id) DO UPDATE SET
             chapter_key = CASE
               WHEN EXCLUDED.text_offset > reader_book_positions.text_offset OR (
                 EXCLUDED.text_offset = reader_book_positions.text_offset AND
                 COALESCE(EXCLUDED.reading_fraction, -1) >=
                   COALESCE(reader_book_positions.reading_fraction, -1)
               )
               THEN EXCLUDED.chapter_key
               ELSE reader_book_positions.chapter_key
             END,
             text_offset = GREATEST(reader_book_positions.text_offset, EXCLUDED.text_offset),
             reading_fraction = CASE
               WHEN EXCLUDED.reading_fraction IS NULL
               THEN reader_book_positions.reading_fraction
               ELSE GREATEST(
                 COALESCE(reader_book_positions.reading_fraction, 0),
                 EXCLUDED.reading_fraction
               )
             END,
             section_index = CASE
               WHEN EXCLUDED.section_index IS NULL AND (
                 EXCLUDED.text_offset > reader_book_positions.text_offset OR
                 COALESCE(EXCLUDED.reading_fraction, -1) >
                   COALESCE(reader_book_positions.reading_fraction, -1)
               ) THEN NULL
               WHEN EXCLUDED.section_index IS NOT NULL AND (
                 reader_book_positions.section_index IS NULL OR
                 EXCLUDED.section_index > reader_book_positions.section_index OR (
                   EXCLUDED.section_index = reader_book_positions.section_index AND
                   COALESCE(EXCLUDED.section_fraction, 0) >=
                     COALESCE(reader_book_positions.section_fraction, 0)
                 )
               ) THEN EXCLUDED.section_index
               ELSE reader_book_positions.section_index
             END,
             section_fraction = CASE
               WHEN EXCLUDED.section_index IS NULL AND (
                 EXCLUDED.text_offset > reader_book_positions.text_offset OR
                 COALESCE(EXCLUDED.reading_fraction, -1) >
                   COALESCE(reader_book_positions.reading_fraction, -1)
               ) THEN NULL
               WHEN EXCLUDED.section_index IS NOT NULL AND (
                 reader_book_positions.section_index IS NULL OR
                 EXCLUDED.section_index > reader_book_positions.section_index OR (
                   EXCLUDED.section_index = reader_book_positions.section_index AND
                   COALESCE(EXCLUDED.section_fraction, 0) >=
                     COALESCE(reader_book_positions.section_fraction, 0)
                 )
               ) THEN EXCLUDED.section_fraction
               ELSE reader_book_positions.section_fraction
             END,
             updated_at = now()
           RETURNING text_offset, reading_fraction, chapter_key, section_index, section_fraction`,
          [
            subjectId, bookEditionId, proposedTextOffset, progressFraction, chapterKey,
            sectionIndex, sectionFraction
          ]
        )
        const readerTextOffset = Number(position.rows[0].text_offset)
        const readingFraction = position.rows[0].reading_fraction == null
          ? null
          : Number(position.rows[0].reading_fraction)
        const readerSectionIndex = position.rows[0].section_index == null
          ? null
          : Number(position.rows[0].section_index)
        const readerSectionFraction = position.rows[0].section_fraction == null
          ? null
          : Number(position.rows[0].section_fraction)
        const mediaFrontier = textLength
          ? bookMediaFrontier({
              scope: edition.rows[0].scope,
              textLength,
              readerTextOffset
            })
          : readerTextOffset
        const due = await client.query(
          `SELECT character.character_key,
                  character.first_appearance_text_offset,
                  character.warmup_text_offset
           FROM book_markup_versions AS markup
           JOIN book_characters AS character ON character.markup_version_id = markup.id
           WHERE markup.book_edition_id = $1 AND markup.status = 'published'
             AND character.warmup_text_offset <= $2
           ORDER BY character.warmup_text_offset,
                    character.first_appearance_text_offset,
                    character.character_key`,
          [bookEditionId, mediaFrontier]
        )
        return {
          scope: edition.rows[0].scope,
          analysisVersion: edition.rows[0].analysis_version ?? null,
          markupVersionId: edition.rows[0].markup_version_id ?? null,
          markupInputHash: edition.rows[0].markup_input_hash ?? null,
          readerTextOffset,
          readingFraction,
          chapterKey: position.rows[0].chapter_key,
          readerSectionIndex,
          readerSectionFraction,
          mediaFrontier,
          charactersDue: due.rows.map((row) => ({
            characterKey: row.character_key,
            firstAppearanceTextOffset: Number(row.first_appearance_text_offset),
            warmupTextOffset: Number(row.warmup_text_offset)
          }))
        }
      })
    },

    async enqueueBookMarkup({
      bookEditionId,
      analysisVersion = BOOK_MARKUP_ANALYSIS_VERSION,
      priority = 50
    }) {
      const idempotencyKey = `${bookEditionId}:book-markup:${analysisVersion}`
      const ensured = await ensureJob({
        idempotencyKey,
        type: 'book_markup',
        bookEditionId,
        targetVersion: analysisVersion,
        priority
      })
      return { ...jobRow(ensured.row), created: ensured.created, idempotencyKey }
    },

    async enqueueBookMarkupBackfill({
      analysisVersion = BOOK_MARKUP_ANALYSIS_VERSION,
      priority = 40,
      limit = 100
    } = {}) {
      const candidates = await pool.query(
        `SELECT edition.id
         FROM book_editions AS edition
         JOIN book_files AS file
           ON file.book_edition_id = edition.id AND file.status = 'ready'
         WHERE NOT EXISTS (
           SELECT 1 FROM book_markup_versions AS markup
           WHERE markup.book_edition_id = edition.id
             AND markup.status = 'published'
             AND markup.analysis_version = $1
             AND markup.text_length IS NOT NULL
         ) AND NOT EXISTS (
           SELECT 1 FROM generation_jobs AS job
           WHERE job.book_edition_id = edition.id
             AND job.job_type = 'book_markup'
             AND job.target_version = $1
         )
         ORDER BY edition.created_at, edition.id
         LIMIT $2`,
        [analysisVersion, limit]
      )
      const jobs = []
      for (const candidate of candidates.rows) {
        const idempotencyKey = `${candidate.id}:book-markup:${analysisVersion}`
        const ensured = await ensureJob({
          idempotencyKey,
          type: 'book_markup',
          bookEditionId: candidate.id,
          targetVersion: analysisVersion,
          priority
        })
        jobs.push({ ...jobRow(ensured.row), created: ensured.created, idempotencyKey })
      }
      return jobs
    },

    async enqueueBookIdentity({ bookEditionId, priority = 60 }) {
      return transaction(pool, async (client) => {
        const edition = await client.query(
          `SELECT edition.id, edition.content_sha256, edition.title, edition.author,
                  edition.identity_version
           FROM book_editions AS edition
           JOIN book_files AS file
             ON file.book_edition_id = edition.id AND file.status = 'ready'
           WHERE edition.id = $1
           FOR SHARE OF edition`,
          [bookEditionId]
        )
        if (!edition.rows[0]) return null
        return ensureBookIdentityJob(client, edition.rows[0], priority)
      })
    },

    async enqueueMissingBookIdentities({ priority = 60, limit = 10_000 } = {}) {
      const candidates = await pool.query(
        `SELECT edition.id, edition.content_sha256, edition.title, edition.author,
                edition.identity_version
         FROM book_editions AS edition
         JOIN book_files AS file
           ON file.book_edition_id = edition.id AND file.status = 'ready'
         WHERE edition.identity_version IS NULL
            OR edition.identity_version NOT LIKE $2
         ORDER BY edition.created_at, edition.id
         LIMIT $1`,
        [limit, `${BOOK_IDENTITY_VERSION}-%`]
      )
      const jobs = []
      for (const candidate of candidates.rows) {
        const job = await this.enqueueBookIdentity({
          bookEditionId: candidate.id,
          priority
        })
        if (job) jobs.push(job)
      }
      return jobs
    },

    async replaceBookEditionGenres({ bookEditionId, genres }) {
      return transaction(pool, async (client) => {
        const edition = await client.query(
          `SELECT id FROM book_editions
           WHERE id = $1 AND scope = 'catalog'
           FOR UPDATE`,
          [bookEditionId]
        )
        if (!edition.rows[0]) return false
        await client.query(
          'DELETE FROM book_edition_genres WHERE book_edition_id = $1',
          [bookEditionId]
        )
        if (genres.length > 0) {
          await client.query(
            `INSERT INTO book_edition_genres (book_edition_id, genre, position)
             SELECT $1, value, ordinality::smallint
             FROM unnest($2::text[]) WITH ORDINALITY AS item(value, ordinality)`,
            [bookEditionId, genres]
          )
        }
        return true
      })
    },

    async enqueueCatalogCover({
      bookEditionId,
      priority = 45
    }) {
      const edition = await pool.query(
        `SELECT edition.id, edition.content_sha256
         FROM book_editions AS edition
         WHERE edition.id = $1 AND edition.scope = 'catalog'
           AND edition.status IN ('marking_up', 'generating_portraits', 'base_ready', 'published')
           AND NOT EXISTS (
             SELECT 1 FROM catalog_book_covers AS cover
             WHERE cover.book_edition_id = edition.id AND cover.status = 'ready'
           )`,
        [bookEditionId]
      )
      const row = edition.rows[0]
      if (!row) return null
      const targetVersion = catalogCoverTargetVersion(row.content_sha256)
      const idempotencyKey = `${bookEditionId}:catalog-cover:${targetVersion}`
      const ensured = await ensureJob({
        idempotencyKey,
        type: 'catalog_cover',
        bookEditionId,
        targetVersion,
        priority,
        payload: { content_sha256: row.content_sha256 }
      })
      return { ...jobRow(ensured.row), created: ensured.created, idempotencyKey }
    },

    async enqueueMissingCatalogCovers({ priority = 45, limit = 1_000 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new RangeError('catalog cover limit must be between 1 and 10000')
      }
      const candidates = await pool.query(
        `SELECT edition.id
         FROM book_editions AS edition
         WHERE edition.scope = 'catalog'
           AND edition.status IN ('marking_up', 'generating_portraits', 'base_ready', 'published')
           AND NOT EXISTS (
             SELECT 1 FROM catalog_book_covers AS cover
             WHERE cover.book_edition_id = edition.id AND cover.status = 'ready'
           )
         ORDER BY edition.created_at, edition.id
         LIMIT $1`,
        [limit]
      )
      const jobs = []
      for (const candidate of candidates.rows) {
        const job = await this.enqueueCatalogCover({
          bookEditionId: candidate.id,
          priority
        })
        if (job) jobs.push(job)
      }
      return jobs
    },

    async ensureCharacterBundle({
      bookEditionId,
      characterKey,
      bundleVersion = CHARACTER_BUNDLE_VERSION,
      priority = 50
    }) {
      const ensured = await ensureCharacterMediaJobs({
        // Запрос читателя ничего не переписывает: он просит показать медиа, а
        // не объявляет персонажа изменившимся. Сверка отпечатка здесь означала
        // бы перерисовку готового портрета при каждой новой публикации книги.
        bookEditionId, characterKey, bundleVersion, priority, reconcileSource: false
      })
      return {
        id: ensured.jobs[0]?.id,
        idempotencyKey: ensured.jobs[0]?.idempotencyKey,
        status: ensured.status,
        created: ensured.created,
        jobs: ensured.jobs,
        bundleVersion,
        mediaRevision: ensured.mediaRevision
      }
    },

    async enqueueCharacterMediaBackfill({ priority = 40, limit = 1_000 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new RangeError('character media backfill limit must be between 1 and 10000')
      }
      const candidates = await pool.query(
        `SELECT markup.book_edition_id, character.character_key,
                CASE WHEN markup.analysis_version = 'book-markup-v3'
                  THEN 'character-bundle-v3'
                  ELSE $1
                END AS bundle_version
         FROM book_markup_versions AS markup
         JOIN book_editions AS edition ON edition.id = markup.book_edition_id
         JOIN book_characters AS character ON character.markup_version_id = markup.id
         LEFT JOIN character_media_bundles AS bundle
           ON bundle.book_edition_id = markup.book_edition_id
          AND bundle.character_key = character.character_key
          AND bundle.bundle_version = CASE WHEN markup.analysis_version = 'book-markup-v3'
            THEN 'character-bundle-v3'
            ELSE $1
          END
         WHERE markup.status = 'published'
           AND (bundle.id IS NULL OR bundle.status <> 'ready')
           AND (
             edition.scope = 'catalog' OR
             character.warmup_text_offset <= LEAST(
               markup.text_length,
               COALESCE((
                 SELECT MAX(position.text_offset)
                 FROM reader_book_positions AS position
                 WHERE position.book_edition_id = markup.book_edition_id
               ), 0) + CEIL(markup.text_length * 0.1)::bigint
             )
           )
         ORDER BY markup.book_edition_id, character.sort_order, character.character_key
         LIMIT $2`,
        [CHARACTER_BUNDLE_VERSION, limit]
      )
      const jobs = []
      for (const candidate of candidates.rows) {
        const ensured = await ensureCharacterMediaJobs({
          // Подогрев дозаказывает недостающее, а не переиздаёт сделанное.
          bookEditionId: candidate.book_edition_id,
          characterKey: candidate.character_key,
          bundleVersion: candidate.bundle_version,
          priority,
          reconcileSource: false
        })
        jobs.push(...ensured.jobs)
      }
      return jobs
    },

    async enqueueBookSceneBackfill({ priority = 35, limit = 1_000 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new RangeError('book scene backfill limit must be between 1 and 10000')
      }
      const candidates = await pool.query(
        `SELECT edition.id,
                COALESCE(MAX(position.text_offset), 0)::bigint AS reader_text_offset
         FROM book_editions AS edition
         JOIN book_markup_versions AS markup
           ON markup.book_edition_id = edition.id
          AND markup.status = 'published'
          AND markup.analysis_version = 'book-markup-v3'
         LEFT JOIN reader_book_positions AS position
           ON position.book_edition_id = edition.id
         WHERE edition.scope = 'catalog' OR edition.expires_at > now()
         GROUP BY edition.id, edition.created_at
         ORDER BY edition.created_at, edition.id
         LIMIT $1`,
        [limit]
      )
      const results = []
      for (const candidate of candidates.rows) {
        const result = await transaction(pool, async (client) => {
          const context = await loadSceneContext(client, {
            subjectId: null,
            bookEditionId: candidate.id
          })
          if (!context) return { requested: 0, ready: 0, pending: 0, failed: 0 }
          const frontier = bookMediaFrontier({
            scope: context.scope,
            textLength: context.textLength,
            readerTextOffset: Number(candidate.reader_text_offset)
          })
          const scenes = []
          for (const slot of bookSceneSlotsThrough(context.policy, context.textLength, frontier)) {
            scenes.push(await ensureSceneSlot(client, context, slot, priority))
          }
          return {
            requested: scenes.length,
            ready: scenes.filter(({ status }) => status === 'ready').length,
            pending: scenes.filter(({ status }) => status === 'queued' || status === 'running').length,
            failed: scenes.filter(({ status }) => status === 'failed').length
          }
        })
        results.push({ bookEditionId: candidate.id, ...result })
      }
      return results
    },

    /**
     * Повтор провалившихся заданий генерации, с необязательным сужением.
     *
     * Без сужения повтор берёт самые старые провалы очереди. На установке, где
     * их десятки тысяч, это значит «повторить чужое»: адресно вернуть в работу
     * три задания конкретной книги было нечем, и оставался ручной UPDATE по
     * продовой базе. Фильтры и добавлены под это — операторская задача, а не
     * запрос в psql.
     */
    async retryFailedGenerationJobs({ limit = 100, jobTypes = null, bookEditionIds = null } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new RangeError('retry limit must be between 1 and 1000')
      }
      const safeJobTypes = jobTypes === null ? null : [...new Set(jobTypes)]
      if (safeJobTypes !== null && !safeJobTypes.length) {
        throw new RangeError('jobTypes must name at least one job type')
      }
      const safeEditionIds = bookEditionIds === null
        ? null
        : [...new Set(bookEditionIds)].map((value) => {
          if (!UUID.test(String(value))) throw new TypeError('bookEditionId must be a UUID')
          return String(value)
        })
      if (safeEditionIds !== null && !safeEditionIds.length) {
        throw new RangeError('bookEditionIds must name at least one edition')
      }
      return transaction(pool, async (client) => {
        const retried = await client.query(
          `WITH candidates AS (
             SELECT id FROM generation_jobs
             WHERE status = 'failed' AND operator_pause_id IS NULL
               AND ($2::text[] IS NULL OR job_type = ANY($2::text[]))
               AND ($3::uuid[] IS NULL OR book_edition_id = ANY($3::uuid[]))
             ORDER BY updated_at, created_at
             FOR UPDATE SKIP LOCKED
             LIMIT $1
           )
           UPDATE generation_jobs AS job
           SET status = 'queued', attempts = 0, last_error_code = NULL,
               available_at = now(), locked_at = NULL, locked_by = NULL,
               lease_token = NULL, updated_at = now()
           FROM candidates
           WHERE job.id = candidates.id
           RETURNING job.*`,
          [limit, safeJobTypes, safeEditionIds]
        )
        const characterJobs = retried.rows.filter((row) => row.character_key)
        for (const row of characterJobs) {
          const bundleVersion = row.payload?.bundle_version ?? row.target_version
          await client.query(
            `UPDATE character_media_bundles
             SET status = 'queued', updated_at = now()
             WHERE book_edition_id = $1 AND character_key = $2
               AND bundle_version = $3`,
            [row.book_edition_id, row.character_key, bundleVersion]
          )
        }
        return retried.rows.map((row) => jobRow(row))
      })
    },

    async purgeExpiredPrivateEditions({ limit = 100 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new RangeError('cleanup limit must be between 1 and 1000')
      }
      return transaction(pool, async (client) => {
        const candidates = await client.query(
          `SELECT id
           FROM book_editions
           WHERE scope = 'private' AND expires_at <= now()
           ORDER BY expires_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1`,
          [limit]
        )
        const ids = candidates.rows.map((row) => row.id)
        if (!ids.length) return { deletedEditions: 0, queuedObjects: 0 }
        const queuedObjects = await queueBookObjectDeletions(client, ids)
        await client.query(
          'DELETE FROM book_editions WHERE id = ANY($1::uuid[])',
          [ids]
        )
        return { deletedEditions: ids.length, queuedObjects }
      })
    },

    async listBookObjectDeletions({ limit = 100 } = {}) {
      const result = await pool.query(
        `SELECT object_key
         FROM book_object_deletions
         ORDER BY requested_at, object_key
         LIMIT $1`,
        [limit]
      )
      return result.rows.map((row) => row.object_key)
    },

    async acknowledgeBookObjectDeletions(objectKeys) {
      if (!Array.isArray(objectKeys) || !objectKeys.length) return 0
      const result = await pool.query(
        `DELETE FROM book_object_deletions
         WHERE object_key = ANY($1::text[])
         RETURNING object_key`,
        [objectKeys]
      )
      return result.rows.length
    },

    async failBookObjectDeletions(objectKeys, errorCode) {
      if (!Array.isArray(objectKeys) || !objectKeys.length) return 0
      const result = await pool.query(
        `UPDATE book_object_deletions
         SET attempts = attempts + 1, last_error_code = $2, updated_at = now()
         WHERE object_key = ANY($1::text[])
         RETURNING object_key`,
        [objectKeys, errorCode]
      )
      return result.rows.length
    },

    async claimGenerationJob(workerId, {
      leaseSeconds = 300,
      jobTypes = null,
      bookEditionIds = null
    } = {}) {
      const allowedJobTypes = Array.isArray(jobTypes) && jobTypes.length
        ? [...new Set(jobTypes)]
        : null
      const allowedBookEditionIds = Array.isArray(bookEditionIds) && bookEditionIds.length
        ? [...new Set(bookEditionIds)]
        : null
      if (allowedBookEditionIds?.some((value) => !UUID.test(String(value)))) {
        throw new TypeError('bookEditionIds must contain UUIDs')
      }
      assertLeaseSeconds(leaseSeconds)
      const leaseToken = idFactory()
      const result = await pool.query(
        claimJobSql({
          table: GENERATION_QUEUE,
          columns: GENERATION_COLUMNS,
          where: [
            '($4::text[] IS NULL OR job.job_type = ANY($4::text[]))',
            '($5::uuid[] IS NULL OR job.book_edition_id = ANY($5::uuid[]))',
            'job.operator_pause_id IS NULL',
            // Анимация ждёт готовый портрет того же персонажа.
            `(job.job_type <> 'character_animation' OR EXISTS (
               SELECT 1 FROM generation_jobs AS portrait
               WHERE portrait.book_edition_id = job.book_edition_id
                 AND portrait.character_key = job.character_key
                 AND portrait.target_version = job.target_version
                 AND portrait.job_type = 'character_portrait'
                 AND portrait.status = 'ready'
             ))`,
            // Медиа от карточки ждёт включённую карточку той же ревизии.
            // Карточка неизменяема, но её ревизию могут выключить, и рисовать
            // портрет по выключенной карточке — то же, что рисовать по
            // устаревшему тексту.
            //
            // Само задание карточки под этот гейт не попадает: оно карточку и
            // создаёт, и требовать от него уже существующей карточки значило бы
            // никогда его не выдать.
            `(job.job_type = 'character_card' OR NOT (job.payload ? 'card_revision') OR EXISTS (
               SELECT 1 FROM book_character_cards AS card
               WHERE card.book_edition_id = job.book_edition_id
                 AND card.character_key = job.character_key
                 AND card.card_revision = (job.payload->>'card_revision')::integer
                 AND card.enabled
             ))`,
            // Обложка не рисуется, пока identity книги ещё в очереди.
            `(job.job_type <> 'catalog_cover' OR NOT EXISTS (
               SELECT 1 FROM generation_jobs AS identity
               WHERE identity.book_edition_id = job.book_edition_id
                 AND identity.job_type = 'book_identity'
                 AND identity.status IN ('queued', 'running')
             ))`
          ],
          lockedBy: '$1',
          leaseSeconds: '$2',
          leaseToken: '$3'
        }),
        [workerId, leaseSeconds, leaseToken, allowedJobTypes, allowedBookEditionIds]
      )
      const job = jobRow(result.rows[0])
      if (job?.characterKey) {
        const bundleVersion = job.payload?.bundle_version ?? job.targetVersion
        await pool.query(
          `UPDATE character_media_bundles
           SET status = 'running', updated_at = now()
           WHERE book_edition_id = $1 AND character_key = $2 AND bundle_version = $3`,
          [job.bookEditionId, job.characterKey, bundleVersion]
        )
      }
      return job
    },

    async getBookMarkupInput(job) {
      const result = await pool.query(
        `SELECT edition.scope, edition.title, edition.author, edition.format,
                edition.content_sha256, file.object_key, file.mime_type, file.byte_size
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_files AS file ON file.book_edition_id = edition.id AND file.status = 'ready'
         WHERE job.id = $1 AND job.status = 'running' AND job.lease_token = $2::uuid`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      return {
        bookEditionId: job.bookEditionId,
        analysisVersion: job.targetVersion,
        scope: row.scope,
        title: row.title,
        author: row.author,
        format: row.format,
        contentSha256: row.content_sha256,
        objectKey: row.object_key,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size)
      }
    },

    async getBookIdentityInput(job) {
      const result = await pool.query(
        `SELECT edition.scope, edition.title, edition.author, edition.format,
                edition.content_sha256, file.object_key, file.mime_type, file.byte_size
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_files AS file ON file.book_edition_id = edition.id AND file.status = 'ready'
         WHERE job.id = $1 AND job.job_type = 'book_identity'
           AND job.status = 'running' AND job.lease_token = $2::uuid`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      return {
        bookEditionId: job.bookEditionId,
        targetVersion: job.targetVersion,
        scope: row.scope,
        title: row.title,
        author: row.author,
        format: row.format,
        contentSha256: row.content_sha256,
        objectKey: row.object_key,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size)
      }
    },

    async renewGenerationLease(job) {
      const result = await pool.query(
        renewLeaseSql({
          table: GENERATION_QUEUE,
          columns: GENERATION_COLUMNS,
          id: '$1',
          leaseToken: '$2'
        }),
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
    },

    /**
     * Ставит карточки одного окна и отмечает окно работающим.
     *
     * Барьер окна и его состав героев — разные вещи. Барьер (`start_offset`,
     * `end_offset`) у всех окон начинается с нуля: карточка персонажа из главы 5
     * опирается на весь текст до конца главы 6. Состав задаёт отдельный
     * диапазон `assign_*`, посчитанный тем же правилом, что
     * `cardWindowIndexForOffset`. Пока состав брался из барьера, каждый ранний
     * персонаж выбирался заново в каждом следующем окне, а персонаж главы 2
     * получал карточку уже по первым двум главам — не по правилу D1.
     */
    async enqueueCardWindow({ runId, bookEditionId, windowIndex, priority }) {
      return transaction(pool, async (client) =>
        enqueueCardWindowJobs(client, { runId, bookEditionId, windowIndex, priority }))
    },

    /**
     * Закрывает окно, когда его карточки закончились, и ставит следующее.
     *
     * Следующее окно ставится только после того, как предыдущее закрыто: иначе
     * очередь заполнится фоновыми заданиями большой книги, и окно первых глав
     * следующей книги будет ждать за ними.
     */
    /**
     * Перенести карточку персонажа в окно, где у него есть чем обосноваться.
     *
     * Персонаж попадает в окно первого упоминания, и там у него может быть один
     * проходной абзац. Карточка из одного фрагмента падает на `CARD_BIO_MISSING`
     * — и персонаж теряется для всей книги, хотя дальше у него сто абзацев:
     * «Иван Матвеевич» из «Обломова» с 95 фрагментами не получил карточки
     * вовсе, потому что впервые был назван мимоходом в первом окне.
     *
     * Переносим в ближайшее окно, где фрагментов у него станет больше, а не в
     * следующее по счёту: соседнее окно часто не добавляет ничего, и перенос в
     * него был бы тем же падением через минуту. Если такого окна нет — значит
     * больше про персонажа в книге и не сказано, и падение честное.
     */
    async deferCharacterCard({ runId, bookEditionId, characterKey, windowIndex, priority = 50 }) {
      if (!runId || !bookEditionId || !characterKey) {
        throw new TypeError('runId, bookEditionId and characterKey are required')
      }
      if (!Number.isSafeInteger(windowIndex) || windowIndex < 0) {
        throw new TypeError('windowIndex must be a non-negative integer')
      }
      return transaction(pool, async (client) => {
        const target = await client.query(
          `WITH roster AS (
             SELECT candidate_keys, canonical_name, names, mention_count,
                    first_mention_text_offset
               FROM book_character_roster
              WHERE run_id = $1 AND character_key = $2
           ),
           current AS (
             SELECT count(fragment.fragment_id)::int AS fragment_count
               FROM roster
               LEFT JOIN book_character_fragments AS fragment
                 ON fragment.run_id = $1
                AND fragment.character_key = ANY(roster.candidate_keys)
                AND fragment.start_offset < (
                  SELECT end_offset FROM book_card_windows
                   WHERE run_id = $1 AND window_index = $3
                )
           )
           -- window — зарезервированное слово SQL, и алиас с таким именем
           -- делает запрос синтаксически неверным. Ошибка ловилась и уходила в
           -- лог, а перенос молча не случался ни разу: 49 персонажей так и
           -- остались без карточек при живых цитатах дальше по книге.
           SELECT card_window.window_index, roster.canonical_name, roster.names,
                  roster.mention_count, roster.first_mention_text_offset,
                  count(fragment.fragment_id)::int AS fragment_count
             FROM book_card_windows AS card_window
             CROSS JOIN roster
             CROSS JOIN current
             LEFT JOIN book_character_fragments AS fragment
               ON fragment.run_id = $1
              AND fragment.character_key = ANY(roster.candidate_keys)
              AND fragment.start_offset < card_window.end_offset
            WHERE card_window.run_id = $1
              AND card_window.window_index > $3
              AND card_window.status <> 'cancelled'
            GROUP BY card_window.window_index, roster.canonical_name, roster.names,
                     roster.mention_count, roster.first_mention_text_offset,
                     current.fragment_count
           HAVING count(fragment.fragment_id) > max(current.fragment_count)
            ORDER BY card_window.window_index
            LIMIT 1`,
          [runId, characterKey, windowIndex]
        )
        const row = target.rows[0]
        if (!row) return { deferred: false, windowIndex: null }
        const nextWindow = Number(row.window_index)
        const inserted = await client.query(
          `INSERT INTO generation_jobs (
             id, idempotency_key, job_type, book_edition_id, character_key,
             target_version, status, priority, payload, analysis_run_id, card_window_index
           ) VALUES ($1, $2, 'character_card', $3, $4, $5, 'queued', $6, $7::jsonb, $8, $9)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [
            idFactory(),
            `${runId}:character-card:${nextWindow}:${characterKey}`,
            bookEditionId, characterKey, CHARACTER_CARD_TARGET_VERSION, priority,
            JSON.stringify({
              card_revision: 1,
              fragment_count: Number(row.fragment_count),
              first_mention_text_offset: Number(row.first_mention_text_offset),
              character_name: row.canonical_name,
              character_names: row.names ?? [],
              mention_count: Number(row.mention_count),
              deferred_from_window: windowIndex
            }),
            runId, nextWindow
          ]
        )
        return {
          deferred: true,
          windowIndex: nextWindow,
          jobId: inserted.rows[0]?.id ?? null,
          fragmentCount: Number(row.fragment_count)
        }
      })
    },

    async advanceCardWindows({
      // Прогон тоже можно не называть: читатель знает только книгу, а карточный
      // прогон у неё один — последний. Без этого шаг читателя не мог бы
      // разбудить цепочку, потому что идентификатор прогона ему взять неоткуда.
      runId: requestedRunId = null,
      bookEditionId,
      scope,
      // Позиция читателя по умолчанию читается здесь же, а не приходит нулём от
      // вызывающего. Ни воркер карточки, ни операторская команда её не знают, и
      // пока она была аргументом со значением 0, фронт приватной книги навсегда
      // оставался «нулевая глава плюс две»: цепочка вставала на третьем окне,
      // сколько бы человек ни прочитал. Область видимости берётся тут же и по
      // той же причине.
      readerTextOffset = null,
      // Задание, которое прямо сейчас падает. Воркер пометит его провалившимся
      // только после того, как раннер вернёт управление, поэтому здесь оно ещё
      // `running` — и окно, где оно было последним, считало бы себя незакрытым
      // навсегда. Ровно тот случай, ради которого цепочку и стали двигать по
      // завершению карточки, а не по её успеху.
      failingJobId = null
    }) {
      const runId = requestedRunId ?? (await pool.query(
        `SELECT id FROM book_analysis_runs
          WHERE book_edition_id = $1 AND pipeline_id = 'cards'
          ORDER BY run_sequence DESC, created_at DESC LIMIT 1`,
        [bookEditionId]
      )).rows[0]?.id
      if (!runId) return { closed: [], enqueued: null }
      const windows = await pool.query(
        `SELECT window_index, start_offset, end_offset, chapter_indexes,
                priority_class, status
         FROM book_card_windows WHERE run_id = $1 ORDER BY window_index`,
        [runId]
      )
      if (!windows.rows.length) return { closed: [], enqueued: null }
      // Область видимости — свойство книги, а не аргумент вызывающего:
      // воркер карточки о ней не знает, а ошибиться здесь значит либо
      // остановить каталог, либо раскатать приватную книгу вперёд читателя.
      const bookScope = scope ?? (await pool.query(
        'SELECT scope FROM book_editions WHERE id = $1',
        [bookEditionId]
      )).rows[0]?.scope
      if (!bookScope) return { closed: [], enqueued: null }
      const frontierTextOffset = readerTextOffset ?? Number((await pool.query(
        `SELECT COALESCE(MAX(text_offset), 0)::bigint AS text_offset
         FROM reader_book_positions WHERE book_edition_id = $1`,
        [bookEditionId]
      )).rows[0]?.text_offset ?? 0)
      const closed = []
      for (const row of windows.rows) {
        if (row.status !== 'running') continue
        const pending = await pool.query(
          `SELECT count(*)::int AS count FROM generation_jobs
           WHERE analysis_run_id = $1 AND card_window_index = $2
             AND job_type = 'character_card' AND status IN ('queued', 'running')
             AND ($3::uuid IS NULL OR id <> $3::uuid)`,
          [runId, row.window_index, failingJobId]
        )
        if (Number(pending.rows[0].count) > 0) continue
        await pool.query(
          `UPDATE book_card_windows
           SET status = 'ready', finished_at = COALESCE(finished_at, now())
           WHERE run_id = $1 AND window_index = $2 AND status = 'running'`,
          [runId, row.window_index]
        )
        closed.push(row.window_index)
      }
      const refreshed = closed.length
        ? (await pool.query(
            `SELECT window_index, start_offset, end_offset, chapter_indexes,
                    priority_class, status
             FROM book_card_windows WHERE run_id = $1 ORDER BY window_index`,
            [runId]
          )).rows
        : windows.rows
      const scheduleWindows = refreshed.map((row) => ({
        windowIndex: Number(row.window_index),
        startOffset: Number(row.start_offset),
        endOffset: Number(row.end_offset),
        chapterIndexes: (row.chapter_indexes ?? []).map(Number),
        priorityClass: row.priority_class,
        status: row.status
      }))
      const maxChapterIndex = cardWindowChapterFrontier({
        scope: bookScope,
        windows: scheduleWindows,
        readerTextOffset: frontierTextOffset
      })
      const next = nextCardWindow({ windows: scheduleWindows, maxChapterIndex })
      if (!next) return { closed, enqueued: null, maxChapterIndex }
      // Дальше первого окна цепочка не идёт, пока состав книги не подтверждён
      // целиком. До полного захода roster знает только героев первых глав, и
      // остальные окна выбрали бы пустоту: каждое встало бы `ready` без единой
      // карточки, и цепочка добежала бы до конца книги вхолостую.
      const bookPass = await pool.query(
        `SELECT 1 FROM generation_jobs
          WHERE analysis_run_id = $1 AND job_type = 'roster_confirm'
            AND card_window_index IS NULL AND status = 'ready'
          LIMIT 1`,
        [runId]
      )
      if (!bookPass.rows.length) {
        return { closed, enqueued: null, maxChapterIndex, waitingForBookRoster: true }
      }
      // Пустое окно проходится насквозь. Окно, в котором не оказалось ни
      // одного персонажа, закрывается сразу и карточек не даёт — а цепочку
      // двигает именно завершённая карточка. На «Герое» и «Дубровском» это
      // останавливало книгу на третьем окне: второе пустое, и дальше не шёл
      // никто, хотя в следующем персонажи были.
      let enqueued = null
      let cursor = next
      for (let step = 0; step < scheduleWindows.length && cursor; step += 1) {
        enqueued = await this.enqueueCardWindow({
          runId,
          bookEditionId,
          windowIndex: cursor.windowIndex,
          priority: cursor.priority
        })
        if (enqueued.created > 0) break
        closed.push(cursor.windowIndex)
        const passed = scheduleWindows.map((window) => window.windowIndex === cursor.windowIndex
          ? { ...window, status: 'ready' }
          : window)
        scheduleWindows.length = 0
        scheduleWindows.push(...passed)
        cursor = nextCardWindow({ windows: scheduleWindows, maxChapterIndex })
      }
      return { closed, enqueued, maxChapterIndex }
    },

    /**
     * Вход задания подтверждения состава.
     *
     * Кандидаты берутся из инвентаря, а не из отдельной таблицы: инвентарь —
     * и есть их источник, и второй источник истины тут не нужен. Фрагменты
     * читаются целиком, даже когда подтверждается одно окно: по ним считаются
     * со-упоминания, а это защита от слияния двух участников одной сцены, и
     * считать её по части книги значит ослабить.
     */
    async getRosterConfirmationInput(job) {
      const result = await pool.query(
        `SELECT job.analysis_run_id, job.card_window_index,
                edition.title, edition.author, edition.language,
                run.normalized_text_object_key, run.normalized_text_hash, run.text_length,
                inventory.inventory_version, inventory.document AS inventory_document,
                card_window.start_offset, card_window.end_offset,
                card_window.assign_start_offset, card_window.assign_end_offset
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_analysis_runs AS run ON run.id = job.analysis_run_id
         LEFT JOIN book_name_inventory AS inventory ON inventory.run_id = job.analysis_run_id
         LEFT JOIN book_card_windows AS card_window
           ON card_window.run_id = job.analysis_run_id
          AND card_window.window_index = job.card_window_index
         WHERE job.id = $1 AND job.job_type = 'roster_confirm'
           AND job.status = 'running' AND job.lease_token = $2::uuid`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      // Инвентарь без имён — не поломка, а книга без персонажей: так выглядит
      // текст на языке, чьи имена разметка не разбирает, и просто короткий
      // файл без единого имени. Раньше это была ошибка, задание исчерпывало
      // попытки, окно оставалось `queued`, и книга навсегда висела в
      // «обрабатывается» — читателю неотличимо от работающей. Пустой состав
      // раннер уже умеет подтвердить; отказываем только когда инвентаря нет
      // вовсе, потому что это действительно сломанный прогон.
      if (!row.inventory_document) {
        const error = new Error(`run ${row.analysis_run_id} has no name inventory to confirm`)
        error.code = 'ROSTER_INVENTORY_MISSING'
        throw error
      }
      const candidates = Array.isArray(row.inventory_document.candidates)
        ? row.inventory_document.candidates
        : []
      const fragments = await pool.query(
        `SELECT character_key, fragment_id, paragraph_index, chapter_index,
                start_offset, end_offset, mention_count
         FROM book_character_fragments
         WHERE run_id = $1
         ORDER BY character_key, start_offset`,
        [row.analysis_run_id]
      )
      const byCharacter = new Map()
      for (const fragment of fragments.rows) {
        const entry = byCharacter.get(fragment.character_key) ?? []
        entry.push({
          fragmentId: fragment.fragment_id,
          characterKey: fragment.character_key,
          paragraphIndex: Number(fragment.paragraph_index),
          chapterIndex: Number(fragment.chapter_index),
          startOffset: Number(fragment.start_offset),
          endOffset: Number(fragment.end_offset),
          mentionCount: Number(fragment.mention_count)
        })
        byCharacter.set(fragment.character_key, entry)
      }
      const previous = await pool.query(
        `SELECT character_key, canonical_name, names, candidate_keys, mention_count,
                first_mention_text_offset, tier
         FROM book_character_roster WHERE run_id = $1`,
        [row.analysis_run_id]
      )
      return {
        runId: row.analysis_run_id,
        bookEditionId: job.bookEditionId,
        windowIndex: row.card_window_index === null ? null : Number(row.card_window_index),
        title: row.title,
        author: row.author ?? '',
        language: row.language ?? '',
        textLength: Number(row.text_length),
        normalizedTextObjectKey: row.normalized_text_object_key,
        normalizedTextHash: row.normalized_text_hash,
        inventoryVersion: row.inventory_version ?? '',
        window: row.start_offset === null
          ? null
          : {
              startOffset: Number(row.start_offset),
              endOffset: Number(row.end_offset),
              assignStartOffset: Number(row.assign_start_offset),
              assignEndOffset: Number(row.assign_end_offset)
            },
        candidates,
        fragments: {
          characters: [...byCharacter.entries()].map(([characterKey, entry]) => ({
            characterKey,
            fragments: entry
          }))
        },
        previousRoster: previous.rows.map((character) => ({
          characterKey: character.character_key,
          canonicalName: character.canonical_name,
          names: character.names ?? [],
          candidateKeys: character.candidate_keys ?? [],
          mentionCount: Number(character.mention_count),
          firstMentionTextOffset: Number(character.first_mention_text_offset),
          tier: character.tier
        }))
      }
    },

    /**
     * Запись подтверждённого состава и постановка следующего шага.
     *
     * Всё одной транзакцией: roster, карточки окна и следующий заход
     * подтверждения. Частичный результат оставил бы прогон в состоянии, из
     * которого не видно, что делать дальше, — roster записан, а карточек никто
     * не поставил.
     */
    async completeRosterConfirmation(job, {
      runId,
      bookEditionId,
      windowIndex,
      roster,
      revisions = [],
      skipped = false
    }) {
      return transaction(pool, async (client) => {
        // Аренда проверяется и блокируется до записи. Подтверждение ходит в
        // модель минутами, аренда за это время может истечь, и задание заберёт
        // другой исполнитель; без проверки прежний записал бы свой результат
        // поверх чужой работы и сбросил бы новую аренду.
        await requireLeasedJob(client, job)
        // Кандидат принадлежит ровно одному персонажу прогона — это держит
        // `book_character_roster_candidate_unique`. Но подтверждение как раз и
        // перегруппировывает кандидатов: полный заход по книге собирает
        // «Дубровского» из тех же имён, из которых окно собрало «Дубровском», и
        // под другим ключом. Upsert идёт по (run_id, character_key) и такую
        // строку не видит — заход падал на нарушении уникальности и не мог
        // завершиться никогда.
        //
        // Снимаются только строки, чьих кандидатов забрал другой персонаж
        // нового состава. Всё остальное остаётся: подтверждение уточняет
        // состав, а не переписывает историю прогона.
        const claimedCandidates = roster
          .map((character) => (character.candidateKeys ?? [])[0])
          .filter(Boolean)
        if (claimedCandidates.length) {
          await client.query(
            `DELETE FROM book_character_roster
              WHERE run_id = $1
                AND candidate_keys[1] = ANY($2::text[])
                AND character_key <> ALL($3::text[])`,
            [runId, claimedCandidates, roster.map((character) => character.characterKey)]
          )
        }
        for (const character of roster) {
          await client.query(
            `INSERT INTO book_character_roster (
               run_id, character_key, canonical_name, names, candidate_keys,
               mention_count, first_mention_text_offset, tier, window_index
             ) VALUES ($1, $2, $3, $4::text[], $5::text[], $6, $7, $8, $9)
             ON CONFLICT (run_id, character_key) DO UPDATE SET
               canonical_name = EXCLUDED.canonical_name,
               names = EXCLUDED.names,
               candidate_keys = EXCLUDED.candidate_keys,
               mention_count = EXCLUDED.mention_count,
               first_mention_text_offset = EXCLUDED.first_mention_text_offset,
               tier = EXCLUDED.tier,
               window_index = EXCLUDED.window_index,
               confirmed_at = now()`,
            [
              runId, character.characterKey, character.canonicalName,
              character.names ?? [], character.candidateKeys ?? [],
              character.mentionCount, character.firstMentionTextOffset,
              character.tier, windowIndex
            ]
          )
        }

        let cardJobsCreated = 0
        // Окно закрывается и тогда, когда подтверждать было некого: карточек
        // в нём не будет ни одной, и оставить его `queued` значит остановить
        // цепочку навсегда. Пустое окно проходится насквозь — так же, как
        // окно, где персонажей не нашлось.
        if (windowIndex !== null) {
          const enqueued = await enqueueCardWindowJobs(client, {
            runId, bookEditionId, windowIndex, priority: CARD_MEDIA_PRIORITY.foreground
          })
          cardJobsCreated = enqueued.created
        }

        // Полный заход ставится после окна: он длинный, и держать за ним
        // первые карточки незачем.
        let nextConfirmation = 'none'
        if (windowIndex !== null) {
          const inserted = await client.query(
            `INSERT INTO generation_jobs (
               id, idempotency_key, job_type, book_edition_id,
               target_version, status, priority, payload, analysis_run_id
             ) VALUES ($1, $2, 'roster_confirm', $3, $4, 'queued', $5, '{}'::jsonb, $6)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              idFactory(), `${runId}:roster-confirm:book`, bookEditionId,
              ROSTER_CONFIRMATION_VERSION, CARD_MEDIA_PRIORITY.background, runId
            ]
          )
          nextConfirmation = inserted.rows[0] ? 'book' : 'already_queued'
        }

        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
               locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, JSON.stringify({
            window_index: windowIndex,
            character_count: roster.length,
            revision_count: revisions.length,
            card_jobs_created: cardJobsCreated,
            next_confirmation: nextConfirmation,
            skipped
          })]
        )
        return { cardJobsCreated, nextConfirmation, characterCount: roster.length }
      })
    },

    /**
     * Включённые карточки книги для манифеста.
     *
     * До последнего окна книга на `pipeline=cards` не публикует v3 (решение
     * D2), и это единственный источник персонажей для читателя. Отдаётся
     * проекция карточки — те же поля, что читает клиент у профиля v3, — плюс
     * медиа-бандл, чтобы портрет доехал вместе с карточкой, а не вторым
     * запросом.
     *
     * Берётся последняя включённая ревизия каждого персонажа: карточка
     * неизменяема, а новая ревизия выключает прежнюю в той же транзакции.
     * Персонажи roster, у которых карточки ещё нет, сюда не попадают: их
     * список появится вместе с сохранением подтверждённого roster, а до тех
     * пор клиенту честнее показать меньше, чем выдумать пустые строки.
     */
    async listPublishedCharacterCards(bookEditionId, { bundleVersion = null, runId = null } = {}) {
      const result = await pool.query(
        // Карточки одного прогона, а не все включённые у издания. Выключение
        // прежней ревизии ограничено `run_id`, поэтому после повторного анализа
        // включёнными остаются и старые карточки: без этого ограничения
        // читатель получал бы старую и новую карточку с одним и тем же
        // `characterKey`. Актуальным считается прогон последней записанной
        // карточки — тот, который сейчас наполняет книгу.
        `WITH current_run AS (
           SELECT run_id FROM book_character_cards
           WHERE book_edition_id = $1 AND enabled
             AND ($3::uuid IS NULL OR run_id = $3)
           ORDER BY created_at DESC, run_id DESC
           LIMIT 1
         )
         SELECT card.character_key, card.document, card.first_mention_text_offset,
                bundle.id AS bundle_id, bundle.status AS bundle_status,
                bundle.media_revision
         FROM book_character_cards AS card
         JOIN current_run ON current_run.run_id = card.run_id
         LEFT JOIN character_media_bundles AS bundle
           ON bundle.book_edition_id = card.book_edition_id
          AND bundle.character_key = card.character_key
          AND ($2::text IS NULL OR bundle.bundle_version = $2)
         WHERE card.book_edition_id = $1 AND card.enabled
         ORDER BY card.first_mention_text_offset, card.character_key`,
        [bookEditionId, bundleVersion, runId]
      )
      return result.rows.map((row) => {
        // Документ перепроверяется контрактом: строка неизменяема, но
        // правленная руками строка не должна доехать до читателя как валидная.
        const projection = characterCardProjection(validateCharacterCard(row.document))
        return {
          ...projection,
          firstAppearanceTextOffset: Number(row.first_mention_text_offset),
          bundle: row.bundle_id
            ? {
                id: row.bundle_id,
                status: row.bundle_status,
                mediaRevision: Number(row.media_revision ?? 1)
              }
            : null
        }
      })
    },

    /**
     * Вход медиа-задания, поставленного от карточки.
     *
     * Проекция карточки отдаёт ровно те поля, которые читает построитель
     * промпта портрета (`appearancePrompt`, `description`, `role`, `age`), и
     * приветствие для audio. Поэтому портрет по карточке рисуется тем же
     * промптом, что и по профилю, — без второй ветки в генераторе.
     */
    async getCharacterCardBundleInput(job) {
      const result = await pool.query(
        `SELECT card.document, card.first_mention_text_offset,
                edition.scope, edition.title, edition.author
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_character_cards AS card
           ON card.book_edition_id = job.book_edition_id
          AND card.character_key = job.character_key
          AND card.card_revision = (job.payload->>'card_revision')::integer
          -- Прогон из payload, а не любая включённая карточка: иначе портрет
          -- рисуется по карточке другого анализа той же книги.
          AND card.run_id = (job.payload->>'analysis_run_id')::uuid
          AND card.enabled
         WHERE job.id = $1 AND job.status = 'running' AND job.lease_token = $2::uuid`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      // Хранимый документ перепроверяется контрактом до проекции: строка
      // карточки неизменяема, но правленная руками строка не должна доехать до
      // промпта портрета как валидная.
      const projection = characterCardProjection(validateCharacterCard(row.document))
      return {
        bookEditionId: job.bookEditionId,
        characterKey: projection.characterKey,
        name: projection.name,
        fullName: projection.fullName || projection.name,
        firstAppearanceTextOffset: Number(row.first_mention_text_offset),
        warmupTextOffset: Number(row.first_mention_text_offset),
        character: projection,
        scope: row.scope,
        bookTitle: row.title,
        bookAuthor: row.author,
        bundleVersion: job.targetVersion
      }
    },

    async getCharacterBundleInput(job) {
      // Задание, несущее `card_revision`, читает карточку, а не разметку: на
      // момент постановки опубликованной разметки может ещё не быть вовсе.
      if (job.payload?.card_revision != null) {
        return this.getCharacterCardBundleInput(job)
      }
      const result = await pool.query(
        `SELECT character.character_key, character.name, character.full_name,
                character.first_appearance_text_offset, character.warmup_text_offset,
                character.data, edition.scope, edition.title, edition.author
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_markup_versions AS markup
           ON markup.book_edition_id = edition.id AND (
             (job.payload ? 'markup_version_id'
               AND markup.id = (job.payload->>'markup_version_id')::uuid) OR
             (NOT (job.payload ? 'markup_version_id') AND markup.status = 'published')
           )
         JOIN book_characters AS character
           ON character.markup_version_id = markup.id AND character.character_key = job.character_key
         WHERE job.id = $1 AND job.status = 'running' AND job.lease_token = $2::uuid`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      return {
        bookEditionId: job.bookEditionId,
        characterKey: row.character_key,
        name: row.name,
        fullName: row.full_name,
        firstAppearanceTextOffset: Number(row.first_appearance_text_offset),
        warmupTextOffset: Number(row.warmup_text_offset),
        character: row.data,
        scope: row.scope,
        bookTitle: row.title,
        bookAuthor: row.author,
        bundleVersion: job.targetVersion
      }
    },

    async getBookSceneInput(job) {
      const result = await pool.query(
        `SELECT scene.scene_key, scene.slot_index, scene.anchor_text_offset,
                scene.excerpt_start_text_offset, scene.excerpt_end_text_offset,
                scene.markup_version_id, edition.scope, edition.title, edition.author,
                markup.text_length,
                job.payload->>'normalized_text_object_key' AS normalized_text_object_key,
                job.payload->>'normalized_text_hash' AS normalized_text_hash
         FROM generation_jobs AS job
         JOIN book_scene_slots AS scene ON scene.job_id = job.id
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_markup_versions AS markup ON markup.id = scene.markup_version_id
         WHERE job.id = $1 AND job.job_type = 'scene_image'
           AND job.status = 'running' AND job.lease_token = $2::uuid
           AND markup.status = 'published'`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      // Портрет ищется по готовому ассету, а не по соглашению об именах:
      // решение D4 требует прикладывать к сцене именно тот портрет, который
      // действительно опубликован.
      const characters = await pool.query(
        `SELECT character.character_key, character.name, character.full_name, character.data,
                portrait.object_key AS portrait_object_key
         FROM book_characters AS character
         LEFT JOIN LATERAL (
           SELECT asset.object_key
           FROM character_bundle_assets AS link
           JOIN character_media_bundles AS bundle ON bundle.id = link.bundle_id
           JOIN media_assets AS asset ON asset.id = link.asset_id
           WHERE bundle.book_edition_id = $3
             AND bundle.character_key = character.character_key
             AND link.asset_type = 'primary_portrait'
             AND asset.status = 'ready'
           ORDER BY bundle.media_revision DESC
           LIMIT 1
         ) AS portrait ON true
         WHERE character.markup_version_id = $1
           AND character.first_appearance_text_offset <= $2
         ORDER BY character.sort_order, character.character_key`,
        [row.markup_version_id, row.excerpt_end_text_offset, job.bookEditionId]
      )
      return {
        bookEditionId: job.bookEditionId,
        targetVersion: job.targetVersion,
        scope: row.scope,
        bookTitle: row.title,
        bookAuthor: row.author,
        sceneKey: row.scene_key,
        slotIndex: Number(row.slot_index),
        anchorTextOffset: Number(row.anchor_text_offset),
        excerptStartTextOffset: Number(row.excerpt_start_text_offset),
        excerptEndTextOffset: Number(row.excerpt_end_text_offset),
        textLength: Number(row.text_length),
        normalizedTextObjectKey: row.normalized_text_object_key,
        normalizedTextHash: row.normalized_text_hash,
        characters: characters.rows.map((character) => ({
          characterKey: character.character_key,
          name: character.name,
          fullName: character.full_name,
          profile: character.data,
          portraitObjectKey: character.portrait_object_key ?? ''
        }))
      }
    },

    /**
     * Вход задания карточки персонажа.
     *
     * Цитаты фрагментов здесь не возвращаются: в `book_character_fragments`
     * текст не дублируется, и раннер восстанавливает его из нормализованного
     * текста по этим же смещениям. Возвращается ровно окно этого задания —
     * фрагмент за его границей в выборку не попадает, и это тот же
     * спойлер-барьер, только выраженный в WHERE.
     */
    async getCharacterCardInput(job) {
      const result = await pool.query(
        `SELECT job.analysis_run_id, job.card_window_index,
                edition.title, edition.author, edition.language,
                run.normalized_text_object_key, run.normalized_text_hash,
                run.text_length,
                card_window.start_offset, card_window.end_offset, card_window.chapter_indexes,
                card_window.priority_class,
                inventory.inventory_version,
                -- Payload приоритетен, инвентарь — запас: задание, поставленное
                -- до того, как имена стали писаться в payload, всё равно должно
                -- дойти до модели с именем, а не с техническим ключом.
                COALESCE(job.payload->>'character_name',
                         candidate.value->>'displayName') AS character_name,
                COALESCE(job.payload->'character_names',
                         candidate.value->'aliases') AS character_names,
                COALESCE(job.payload->>'mention_count',
                         candidate.value->>'count') AS mention_count,
                candidate.value->>'fullName' AS character_full_name,
                roster.candidate_keys,
                roster.canonical_name AS roster_name,
                roster.names AS roster_names,
                roster.mention_count AS roster_mention_count,
                job.payload->>'card_revision' AS card_revision
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_analysis_runs AS run ON run.id = job.analysis_run_id
         JOIN book_card_windows AS card_window
           ON card_window.run_id = job.analysis_run_id
          AND card_window.window_index = job.card_window_index
         LEFT JOIN book_name_inventory AS inventory ON inventory.run_id = job.analysis_run_id
         LEFT JOIN book_character_roster AS roster
           ON roster.run_id = job.analysis_run_id
          AND roster.character_key = job.character_key
         LEFT JOIN LATERAL (
           SELECT value
           FROM jsonb_array_elements(COALESCE(inventory.document->'candidates', '[]'::jsonb))
           -- Сравниваются ключи без префикса: инвентарь пишет
           -- name:raskolnikov, подтверждение — char:raskolnikov, и прямое
           -- сравнение не находило ничего.
           WHERE regexp_replace(value->>'candidateKey', '^(name|char):', '')
                 = regexp_replace(job.character_key, '^(name|char):', '')
           LIMIT 1
         ) AS candidate ON true
         WHERE job.id = $1 AND job.job_type = 'character_card'
           AND job.status = 'running' AND job.lease_token = $2::uuid`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      // Фрагменты читаются по ключам кандидатов подтверждённого персонажа, а
      // не по ключу задания: персонаж собран из нескольких кандидатов
      // инвентаря, и фрагменты лежат под их ключами. Связь явная — она в
      // строке roster, — а не восстанавливается из общей части ключа.
      const candidateKeys = row.candidate_keys?.length
        ? row.candidate_keys
        : [job.characterKey]
      const fragments = await pool.query(
        `SELECT fragment_id, paragraph_index, chapter_index,
                start_offset, end_offset, mention_count
         FROM book_character_fragments
         WHERE run_id = $1 AND character_key = ANY($2::text[])
           AND start_offset >= $3 AND end_offset <= $4
         ORDER BY start_offset, fragment_id`,
        [row.analysis_run_id, candidateKeys, row.start_offset, row.end_offset]
      )
      if (!fragments.rows.length) {
        const error = new Error(`character ${job.characterKey} has no fragments in its card window`)
        error.code = 'CARD_FRAGMENTS_MISSING'
        throw error
      }
      // Подтверждённое имя сильнее инвентарного: инвентарь знает кандидата,
      // roster — человека.
      const names = [...new Set([
        row.roster_name ?? row.character_name,
        row.character_full_name,
        ...(Array.isArray(row.roster_names) ? row.roster_names : []),
        ...(Array.isArray(row.character_names) ? row.character_names : [])
      ].filter((value) => typeof value === 'string' && value.trim()))]
      return {
        runId: row.analysis_run_id,
        bookEditionId: job.bookEditionId,
        characterKey: job.characterKey,
        windowIndex: Number(row.card_window_index),
        title: row.title,
        author: row.author ?? '',
        language: row.language ?? '',
        textLength: Number(row.text_length),
        normalizedTextObjectKey: row.normalized_text_object_key,
        normalizedTextHash: row.normalized_text_hash,
        inventoryVersion: row.inventory_version ?? '',
        cardRevision: Number(row.card_revision ?? 1),
        priorityClass: row.priority_class,
        window: {
          startOffset: Number(row.start_offset),
          endOffset: Number(row.end_offset),
          chapterIndexes: (row.chapter_indexes ?? []).map(Number)
        },
        character: {
          canonicalName: row.roster_name ?? row.character_name ?? names[0] ?? job.characterKey,
          names,
          mentionCount: Number(row.roster_mention_count ?? row.mention_count ?? 0),
          firstMentionTextOffset: Number(fragments.rows[0].start_offset)
        },
        fragments: fragments.rows.map((fragment) => ({
          fragmentId: fragment.fragment_id,
          characterKey: job.characterKey,
          paragraphIndex: Number(fragment.paragraph_index),
          chapterIndex: Number(fragment.chapter_index),
          startOffset: Number(fragment.start_offset),
          endOffset: Number(fragment.end_offset),
          mentionCount: Number(fragment.mention_count)
        }))
      }
    },

    /**
     * Запись карточки. Строка неизменяема, поэтому вставка идёт с
     * `ON CONFLICT DO NOTHING` по (run, персонаж, ревизия): повторная попытка
     * задания не создаёт вторую карточку и не переписывает первую. Прежняя
     * включённая ревизия выключается в той же транзакции — частичное состояние
     * с двумя включёнными карточками одного героя ридер увидеть не должен.
     */
    async publishCharacterCard(job, {
      runId,
      bookEditionId,
      characterKey,
      windowIndex,
      cardRevision,
      fragmentSetHash,
      normalizedTextHash,
      promptVersion,
      mediaPriority = CARD_MEDIA_PRIORITY.background,
      card
    }) {
      return transaction(pool, async (client) => {
        await requireLeasedJob(client, job)
        const document = JSON.stringify(card)
        await client.query(
          `UPDATE book_character_cards SET enabled = FALSE
           WHERE run_id = $1 AND character_key = $2 AND enabled AND card_revision <> $3`,
          [runId, characterKey, cardRevision]
        )
        const inserted = await client.query(
          `INSERT INTO book_character_cards (
             id, run_id, book_edition_id, character_key, card_revision, window_index,
             enabled, first_mention_text_offset, window_start_offset, window_end_offset,
             document, document_hash, fragment_set_hash, normalized_text_hash, prompt_version
           ) VALUES (
             $1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10::jsonb, $11, $12, $13, $14
           )
           ON CONFLICT (run_id, character_key, card_revision) DO NOTHING
           RETURNING id`,
          [
            idFactory(), runId, bookEditionId, characterKey, cardRevision, windowIndex,
            card.firstMentionTextOffset, card.cardWindow.startOffset, card.cardWindow.endOffset,
            document, createHash('sha256').update(document).digest('hex'),
            fragmentSetHash, normalizedTextHash, promptVersion
          ]
        )
        // Портрет ставится здесь же и по хэшу этой карточки: `appearancePrompt`
        // берётся из неё, поэтому revision медиа меняется только вместе с
        // новой `card_revision`.
        const media = cardMediaEnqueueEnabled
          ? await ensureCharacterMediaJobs({
            bookEditionId,
            characterKey,
            bundleVersion: BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION,
            priority: mediaPriority,
            sourceKind: 'card',
            runId,
            client
          })
          : { status: 'skipped', created: false, jobs: [], bundleId: null, mediaRevision: null }
        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
               locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, JSON.stringify({
            character_key: characterKey,
            card_revision: cardRevision,
            trait_count: card.traits.length,
            inserted: Boolean(inserted.rows[0]),
            media_status: media.status,
            media_revision: media.mediaRevision
          })]
        )
        return {
          status: inserted.rows[0] ? 'published' : 'existing',
          cardId: inserted.rows[0]?.id ?? null,
          media
        }
      })
    },

    /**
     * Всё, из чего собирается публикация карточек: карточки и координаты цитат.
     *
     * Текст книги здесь не читается — только его адрес и хэш. Цитаты
     * восстанавливает вызывающий, у которого есть хранилище, и по тем же
     * правилам, что и карточка: в `book_character_fragments` текст намеренно не
     * дублируется, иначе у evidence появился бы второй источник истины.
     */
    async getCardPublicationInput({ runId }) {
      if (!UUID.test(String(runId))) throw new TypeError('runId must be a UUID')
      const run = await pool.query(
        `SELECT run.book_edition_id, run.normalized_text_object_key,
                run.normalized_text_hash, inventory.text_length
         FROM book_analysis_runs AS run
         LEFT JOIN book_name_inventory AS inventory ON inventory.run_id = run.id
         WHERE run.id = $1 AND run.pipeline_id = 'cards'`,
        [runId]
      )
      if (!run.rows[0]) return null
      const cards = await pool.query(
        `SELECT document FROM book_character_cards
         WHERE run_id = $1 AND enabled
         ORDER BY first_mention_text_offset, character_key`,
        [runId]
      )
      // Фрагменты лежат под ключами кандидатов инвентаря (`name:*`), карточки —
      // под подтверждёнными (`char:*`). Мост между ними — состав книги: он и
      // решил, какие формы имени принадлежат одному человеку. Без перевода
      // публикация не находит ни одной цитаты и отказывается собирать книгу.
      const fragments = await pool.query(
        `SELECT fragment.fragment_id, roster.character_key,
                fragment.chapter_index, fragment.start_offset, fragment.end_offset
         FROM book_character_fragments AS fragment
         JOIN book_character_roster AS roster
           ON roster.run_id = fragment.run_id
          AND fragment.character_key = ANY(roster.candidate_keys)
         WHERE fragment.run_id = $1
         ORDER BY roster.character_key, fragment.start_offset`,
        [runId]
      )
      return {
        runId,
        bookEditionId: run.rows[0].book_edition_id,
        normalizedTextObjectKey: run.rows[0].normalized_text_object_key,
        normalizedTextHash: run.rows[0].normalized_text_hash,
        textLength: run.rows[0].text_length == null ? null : Number(run.rows[0].text_length),
        cards: cards.rows.map(({ document }) => document),
        fragments: fragments.rows.map((row) => ({
          fragmentId: row.fragment_id,
          characterKey: row.character_key,
          chapterIndex: Number(row.chapter_index),
          startOffset: Number(row.start_offset),
          endOffset: Number(row.end_offset)
        }))
      }
    },

    /**
     * Публикация разметки, собранной из карточек.
     *
     * Конвейер карточек до сих пор ничего не публиковал: книге каталога
     * разметку уже дал narra, и надстройки хватало. Свежая приватная книга
     * оставалась в статусе marking_up навсегда — читатель видит книгу через
     * `book_markup_versions`, а их заполняет только публикация.
     *
     * Публикуется то, что готово сейчас, и публикуется снова, когда окна
     * открылись дальше. Неизменившийся снимок отбивается уникальностью
     * `(run_id, content_hash)` и no-op'ом возвращается вызывающему: повторная
     * публикация того же самого не должна ни плодить ревизии разметки, ни
     * трогать медиа.
     *
     * Медиа здесь не заказывается намеренно. Карточный путь ставит его сам, по
     * ревизии карточки; общий заказ выдал бы тем же персонажам вторую пачку по
     * ключам старой разметки.
     */
    /**
     * Завершить прогон книги, в которой не нашлось ни одного персонажа.
     *
     * Публиковать такой книге нечего: проекция требует хотя бы одну карточку,
     * и это правильно — пустая разметка не разметка. Но и остаться на
     * `synthesize` прогон не может: книга тогда навсегда висит в
     * «обрабатывается», и читателю это неотличимо от работающей. Так стояли
     * «Мцыри» (поэма, где героя ни разу не называют по имени) и текст на
     * языке, чьи имена разметка не разбирает.
     *
     * Условие жёсткое: ни одной карточки и ни одного незакрытого окна. Прогон,
     * который ещё работает, этот путь не трогает.
     */
    async finishCardsRunWithoutCharacters({ runId }) {
      if (!UUID.test(String(runId))) throw new TypeError('runId must be a UUID')
      return transaction(pool, async (client) => {
        const run = await client.query(
          `SELECT id, book_edition_id, stage, status FROM book_analysis_runs
            WHERE id = $1 AND pipeline_id = 'cards' AND status = 'running'
            FOR UPDATE`,
          [runId]
        )
        if (!run.rows[0]) return { finished: false, reason: 'RUN_NOT_RUNNING' }
        const blockers = await client.query(
          `SELECT
             (SELECT count(*) FROM book_character_cards WHERE run_id = $1 AND enabled)::int AS cards,
             (SELECT count(*) FROM book_card_windows
               WHERE run_id = $1 AND status IN ('queued', 'running'))::int AS open_windows,
             (SELECT count(*) FROM generation_jobs
               WHERE analysis_run_id = $1 AND status IN ('queued', 'running'))::int AS open_jobs`,
          [runId]
        )
        const { cards, open_windows: openWindows, open_jobs: openJobs } = blockers.rows[0]
        if (cards > 0) return { finished: false, reason: 'RUN_HAS_CARDS' }
        if (openWindows > 0 || openJobs > 0) return { finished: false, reason: 'RUN_STILL_WORKING' }
        // Двумя шагами, а не одним: триггер переходов смотрит на новый статус и
        // на смену стадии разом — «stage changes require a running analysis
        // run». Сначала прогон доходит до публикации, оставаясь работающим, и
        // только потом закрывается.
        if (run.rows[0].stage !== 'publish') {
          await client.query(
            "UPDATE book_analysis_runs SET stage = 'publish', updated_at = now() WHERE id = $1",
            [runId]
          )
        }
        await client.query(
          "UPDATE book_analysis_runs SET status = 'ready', updated_at = now() WHERE id = $1",
          [runId]
        )
        // Книга остаётся читаемой: персонажей у неё нет, но текст есть, и
        // держать её в «обрабатывается» не за что.
        await client.query(
          `UPDATE book_editions SET status = 'base_ready', updated_at = now()
            WHERE id = $1 AND status = 'marking_up'`,
          [run.rows[0].book_edition_id]
        )
        return { finished: true, bookEditionId: run.rows[0].book_edition_id }
      })
    },

    async publishCardsMarkup({
      runId,
      bookEditionId,
      snapshot,
      markup,
      markupContentHash,
      validation
    }) {
      if (!UUID.test(String(runId))) throw new TypeError('runId must be a UUID')
      if (!UUID.test(String(bookEditionId))) throw new TypeError('bookEditionId must be a UUID')
      if (validation?.valid !== true) {
        throw Object.assign(
          new Error('card markup did not pass validation'),
          { code: 'CARD_PUBLICATION_INVALID', errors: validation?.errors ?? [] }
        )
      }
      return transaction(pool, async (client) => {
        const run = await client.query(
          `SELECT * FROM book_analysis_runs
           WHERE id = $1 AND book_edition_id = $2 AND pipeline_id = 'cards'
             AND status = 'running'
           FOR UPDATE`,
          [runId, bookEditionId]
        )
        if (!run.rows[0]) {
          throw Object.assign(new Error('cards run is not running'), { code: 'RUN_STATE_CHANGED' })
        }
        if (!['synthesize', 'publish'].includes(run.rows[0].stage)) {
          throw Object.assign(
            new Error(`cards run cannot publish from ${run.rows[0].stage}`),
            { code: 'RUN_STATE_CHANGED' }
          )
        }
        const version = await client.query(
          `SELECT COALESCE(MAX(snapshot_version), 0) + 1 AS version
           FROM book_analysis_snapshots WHERE run_id = $1`,
          [runId]
        )
        const frozen = await client.query(
          `INSERT INTO book_analysis_snapshots (
             id, run_id, snapshot_version, content_hash, evidence_count, data
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (run_id, content_hash) DO NOTHING
           RETURNING id`,
          [
            snapshot.id, runId, Number(version.rows[0].version), snapshot.contentHash,
            snapshot.evidenceCount, JSON.stringify(snapshot.data)
          ]
        )
        // Снимок тот же — публиковать нечего. Это обычный случай: окно
        // закрылось, не добавив ни одной карточки.
        if (!frozen.rows[0]) return { published: false, reason: 'unchanged' }

        const artifactKey = `cards:${markupContentHash.slice(0, 16)}`
        const markupArtifactId = idFactory()
        await client.query(
          `INSERT INTO book_analysis_artifacts (
             id, run_id, snapshot_id, artifact_kind, artifact_key,
             schema_version, status, content_hash, data
           ) VALUES ($1, $2, $3, 'book_markup', $4, $5, 'valid', $6, $7::jsonb)`,
          [
            markupArtifactId, runId, snapshot.id, artifactKey,
            BOOK_ANALYSIS_SCHEMA_VERSION, markupContentHash, JSON.stringify(markup)
          ]
        )
        const report = {
          valid: true,
          checks: validation.checks ?? {},
          errors: [],
          bindings: {
            snapshotId: snapshot.id,
            snapshotContentHash: snapshot.contentHash,
            normalizedTextHash: run.rows[0].normalized_text_hash,
            markupArtifactId,
            markupContentHash
          }
        }
        await client.query(
          `INSERT INTO book_analysis_artifacts (
             id, run_id, snapshot_id, artifact_kind, artifact_key,
             schema_version, status, content_hash, data
           ) VALUES ($1, $2, $3, 'validation_report', $4, $5, 'valid', $6, $7::jsonb)`,
          [
            idFactory(), runId, snapshot.id, artifactKey, BOOK_ANALYSIS_SCHEMA_VERSION,
            createHash('sha256').update(JSON.stringify(report)).digest('hex'),
            JSON.stringify(report)
          ]
        )
        if (run.rows[0].stage === 'synthesize') {
          await client.query(
            "UPDATE book_analysis_runs SET stage = 'publish' WHERE id = $1",
            [runId]
          )
        }
        const publicationId = idFactory()
        await client.query(
          `INSERT INTO book_analysis_publications (
             id, run_id, book_edition_id, artifact_id, channel,
             analysis_version, content_hash, data
           ) VALUES ($1, $2, $3, $4, 'shadow', $5, $6, $7::jsonb)`,
          [
            publicationId, runId, bookEditionId, markupArtifactId,
            BOOK_ANALYSIS_MARKUP_VERSION, markupContentHash,
            JSON.stringify({
              schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
              analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
              artifactId: markupArtifactId,
              snapshotId: snapshot.id,
              provenance: bookAnalysisPublicationProvenance({
                pipelineId: 'cards',
                pipelineImplementationVersion: run.rows[0].pipeline_implementation_version,
                pipelineVersion: run.rows[0].pipeline_version,
                promptVersion: run.rows[0].prompt_version,
                normalizationVersion: run.rows[0].normalization_version,
                outputSchemaVersion: run.rows[0].output_schema_version,
                inputHash: run.rows[0].input_hash,
                normalizedTextHash: run.rows[0].normalized_text_hash
              }),
              markup
            })
          ]
        )
        const materialized = await materializeMarkupVersion(client, {
          bookEditionId,
          contentHash: markupContentHash,
          markup,
          idFactory,
          notFound: () => Object.assign(
            new Error('book edition is unavailable'),
            { code: 'BOOK_NOT_FOUND' }
          ),
          schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
          analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION
        })
        await client.query(
          `UPDATE book_analysis_artifacts
           SET status = 'published', published_at = now() WHERE id = $1`,
          [markupArtifactId]
        )
        return {
          published: true,
          publicationId,
          snapshotId: snapshot.id,
          markupVersionId: materialized.markupId,
          revision: materialized.revision,
          characterCount: markup.characters.length
        }
      })
    },

    async getCatalogCoverInput(job) {
      const result = await pool.query(
        `SELECT COALESCE(edition.display_title, edition.title) AS title,
                COALESCE(edition.display_author, edition.author) AS author,
                edition.scope, edition.format, edition.content_sha256,
                file.object_key, file.mime_type, file.byte_size
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_files AS file ON file.book_edition_id = edition.id AND file.status = 'ready'
         WHERE job.id = $1 AND job.job_type = 'catalog_cover'
           AND job.status = 'running' AND job.lease_token = $2::uuid`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
      const row = result.rows[0]
      return {
        bookEditionId: job.bookEditionId,
        targetVersion: job.targetVersion,
        scope: row.scope,
        title: row.title,
        author: row.author,
        format: row.format,
        contentSha256: row.content_sha256,
        objectKey: row.object_key,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        context: ''
      }
    },

    async publishBookMarkup(job, markup) {
      return transaction(pool, async (client) => {
        const leased = await requireLeasedJob(client, job)
        const revisionResult = await client.query(
          `SELECT COALESCE(MAX(revision), 0) + 1 AS revision
           FROM book_markup_versions WHERE book_edition_id = $1`,
          [job.bookEditionId]
        )
        const revision = Number(revisionResult.rows[0].revision)
        const markupId = idFactory()
        await client.query(
          `UPDATE book_markup_versions SET status = 'ready'
           WHERE book_edition_id = $1 AND status = 'published'`,
          [job.bookEditionId]
        )
        await client.query(
          `INSERT INTO book_markup_versions (
             id, book_edition_id, schema_version, analysis_version, revision,
             status, input_hash, text_length, published_at
           ) VALUES ($1, $2, $3, $4, $5, 'published', $6, $7, now())`,
          [
            markupId,
            job.bookEditionId,
            BOOK_MARKUP_SCHEMA_VERSION,
            leased.target_version,
            revision,
            markup.inputHash,
            markup.textLength
          ]
        )
        for (const [index, character] of markup.characters.entries()) {
          await client.query(
            `INSERT INTO book_characters (
               id, markup_version_id, character_key, sort_order, name, full_name,
               first_appearance_text_offset, warmup_text_offset, data
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
            [
              idFactory(), markupId, character.characterKey, index,
              character.name, character.fullName,
              character.firstAppearanceTextOffset, character.warmupTextOffset,
              JSON.stringify(character)
            ]
          )
        }
        await client.query(
          `UPDATE reader_book_positions
           SET text_offset = GREATEST(
             text_offset,
             ROUND(reading_fraction * $2)::bigint
           ), updated_at = now()
           WHERE book_edition_id = $1 AND reading_fraction IS NOT NULL`,
          [job.bookEditionId, markup.textLength]
        )
        await client.query(
          `UPDATE book_editions
           SET status = CASE WHEN scope = 'catalog' THEN 'generating_portraits' ELSE 'base_ready' END,
               updated_at = now()
           WHERE id = $1`,
          [job.bookEditionId]
        )
        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, locked_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [
            job.id,
            JSON.stringify({ markup_id: markupId, revision, text_length: markup.textLength })
          ]
        )
        return { markupId, revision }
      })
    },

    async publishCharacterBundle(job, bundle) {
      return transaction(pool, async (client) => {
        await requireLeasedJob(client, job)
        const bundleVersion = job.payload?.bundle_version ?? job.targetVersion
        const bundleResult = await client.query(
          `SELECT bundle.*, edition.scope
           FROM character_media_bundles AS bundle
           JOIN book_editions AS edition ON edition.id = bundle.book_edition_id
           WHERE bundle.book_edition_id = $1 AND bundle.character_key = $2
             AND bundle.bundle_version = $3
           FOR UPDATE OF bundle`,
          [job.bookEditionId, job.characterKey, bundleVersion]
        )
        const target = bundleResult.rows[0]
        if (!target) throw new Error(`character bundle missing for job ${job.id}`)
        for (const asset of bundle.assets) {
          const assetId = idFactory()
          const inserted = await client.query(
            `INSERT INTO media_assets (
               id, book_edition_id, visibility, type, object_key, content_hash,
               mime_type, byte_size, status, expires_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, 'ready',
               CASE WHEN $3 = 'private'
                 THEN now() + make_interval(days => $9)
                 ELSE NULL
               END
             )
             ON CONFLICT (object_key) DO UPDATE SET
               content_hash = EXCLUDED.content_hash,
               mime_type = EXCLUDED.mime_type,
               byte_size = EXCLUDED.byte_size,
               status = 'ready',
               expires_at = EXCLUDED.expires_at
             RETURNING id`,
            [
              assetId, job.bookEditionId, target.scope, asset.type,
              asset.objectKey, asset.contentHash, asset.mimeType, asset.byteSize,
              privateMaterialTtlDays
            ]
          )
          await client.query(
            `INSERT INTO character_bundle_assets (bundle_id, asset_type, asset_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (bundle_id, asset_type) DO UPDATE SET asset_id = EXCLUDED.asset_id`,
            [target.id, asset.type, inserted.rows[0].id]
          )
        }
        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
               locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, JSON.stringify({ bundle_id: target.id, assets: bundle.assets.map((asset) => asset.type) })]
        )
        const complete = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM character_bundle_assets AS link
           JOIN media_assets AS asset ON asset.id = link.asset_id AND asset.status = 'ready'
           WHERE link.bundle_id = $1 AND link.asset_type = ANY($2::text[])`,
          [target.id, REQUIRED_CHARACTER_MEDIA]
        )
        const independentJob = Object.values(CHARACTER_MEDIA_JOB_TYPES).includes(job.type)
        let bundleStatus = Number(complete.rows[0].count) === REQUIRED_CHARACTER_MEDIA.length
          ? 'ready'
          : 'running'
        if (independentJob) {
          const revisionJobs = await client.query(
            `SELECT status, COUNT(*)::int AS count
             FROM generation_jobs
             WHERE book_edition_id = $1 AND character_key = $2
               AND target_version = $3
               AND job_type = ANY($4::text[])
             GROUP BY status`,
            [job.bookEditionId, job.characterKey, job.targetVersion, Object.values(CHARACTER_MEDIA_JOB_TYPES)]
          )
          const counts = new Map(revisionJobs.rows.map((row) => [row.status, Number(row.count)]))
          bundleStatus = (counts.get('ready') ?? 0) === REQUIRED_CHARACTER_MEDIA.length
            ? 'ready'
            : (counts.get('failed') ?? 0) > 0 ? 'failed' : 'running'
        } else if (bundleStatus !== 'ready') {
          throw new Error('character bundle did not publish every required asset')
        }
        await client.query(
          `UPDATE character_media_bundles
           SET status = $4,
               published_at = CASE WHEN $4 = 'ready' THEN now() ELSE published_at END,
               updated_at = now(),
               expires_at = CASE WHEN $2 = 'private'
                 THEN now() + make_interval(days => $3)
                 ELSE NULL
               END
           WHERE id = $1`,
          [target.id, target.scope, privateMaterialTtlDays, bundleStatus]
        )
        if (target.scope === 'private') await touchPrivateRetention(client, job.bookEditionId)
        const missing = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM book_markup_versions AS markup
           JOIN book_characters AS character ON character.markup_version_id = markup.id
           LEFT JOIN character_media_bundles AS bundle
             ON bundle.book_edition_id = markup.book_edition_id
            AND bundle.character_key = character.character_key
            AND bundle.bundle_version = $2
            AND bundle.status = 'ready'
           WHERE markup.book_edition_id = $1 AND markup.status = 'published'
             AND bundle.id IS NULL`,
          [job.bookEditionId, bundleVersion]
        )
        if (Number(missing.rows[0].count) === 0) {
          await client.query(
            `UPDATE book_editions SET status = 'base_ready', updated_at = now()
             WHERE id = $1 AND scope = 'catalog' AND status = 'generating_portraits'`,
            [job.bookEditionId]
          )
        }
        return { bundleId: target.id, status: bundleStatus }
      })
    },

    async publishBookScene(job, asset) {
      return transaction(pool, async (client) => {
        await requireLeasedJob(client, job)
        if (
          !asset || typeof asset.objectKey !== 'string' || !asset.objectKey ||
          typeof asset.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(asset.contentHash) ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType) ||
          !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1
        ) {
          const error = new Error('book scene asset metadata is invalid')
          error.code = 'GENERATION_RESULT_INVALID'
          throw error
        }
        const target = await client.query(
          `SELECT scene.id, scene.asset_id, edition.scope
           FROM book_scene_slots AS scene
           JOIN book_editions AS edition ON edition.id = scene.book_edition_id
           WHERE scene.job_id = $1 FOR UPDATE OF scene`,
          [job.id]
        )
        if (!target.rows[0]) {
          await client.query(
            `UPDATE generation_jobs
             SET status = 'ready', result = '{"stale":true}'::jsonb,
                 locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
             WHERE id = $1`,
            [job.id]
          )
          return { status: 'stale' }
        }
        const assetId = idFactory()
        const inserted = await client.query(
          `INSERT INTO media_assets (
             id, book_edition_id, visibility, type, object_key, content_hash,
             mime_type, byte_size, status, expires_at
           ) VALUES (
             $1, $2, $3, 'scene_image', $4, $5, $6, $7, 'ready',
             CASE WHEN $3 = 'private'
               THEN now() + make_interval(days => $8)
               ELSE NULL
             END
           )
           ON CONFLICT (object_key) DO UPDATE SET
             content_hash = EXCLUDED.content_hash,
             mime_type = EXCLUDED.mime_type,
             byte_size = EXCLUDED.byte_size,
             status = 'ready',
             expires_at = EXCLUDED.expires_at
           RETURNING id`,
          [
            assetId, job.bookEditionId, target.rows[0].scope, asset.objectKey,
            asset.contentHash, asset.mimeType, asset.byteSize, privateMaterialTtlDays
          ]
        )
        await client.query(
          `UPDATE book_scene_slots SET asset_id = $2, updated_at = now() WHERE id = $1`,
          [target.rows[0].id, inserted.rows[0].id]
        )
        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
               locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, JSON.stringify({ asset_id: inserted.rows[0].id })]
        )
        if (target.rows[0].scope === 'private') {
          await touchPrivateRetention(client, job.bookEditionId)
        }
        return { status: 'ready', assetId: inserted.rows[0].id }
      })
    },

    async publishCatalogCover(job, asset) {
      return transaction(pool, async (client) => {
        await requireLeasedJob(client, job)
        if (
          !asset || typeof asset.objectKey !== 'string' || !asset.objectKey ||
          typeof asset.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(asset.contentHash) ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType) ||
          !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1
        ) {
          const error = new Error('catalog cover asset metadata is invalid')
          error.code = 'GENERATION_RESULT_INVALID'
          throw error
        }
        const previous = await client.query(
          `SELECT object_key FROM catalog_book_covers
           WHERE book_edition_id = $1 FOR UPDATE`,
          [job.bookEditionId]
        )
        const previousObjectKey = previous.rows[0]?.object_key
        await client.query(
          `INSERT INTO catalog_book_covers (
             book_edition_id, object_key, content_hash, mime_type, byte_size, status
           ) VALUES ($1, $2, $3, $4, $5, 'ready')
           ON CONFLICT (book_edition_id) DO UPDATE SET
             object_key = EXCLUDED.object_key,
             content_hash = EXCLUDED.content_hash,
             mime_type = EXCLUDED.mime_type,
             byte_size = EXCLUDED.byte_size,
             status = 'ready',
             updated_at = now()`,
          [job.bookEditionId, asset.objectKey, asset.contentHash, asset.mimeType, asset.byteSize]
        )
        if (previousObjectKey && previousObjectKey !== asset.objectKey) {
          await client.query(
            `INSERT INTO book_object_deletions (object_key)
             VALUES ($1) ON CONFLICT (object_key) DO NOTHING`,
            [previousObjectKey]
          )
        }
        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
               locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, JSON.stringify({ asset })]
        )
        return { bookEditionId: job.bookEditionId, status: 'ready' }
      })
    },

    async publishBookIdentity(job, identity) {
      return transaction(pool, async (client) => {
        await requireLeasedJob(client, job)
        const edition = await client.query(
          `SELECT id, content_sha256, title, author, identity_version
           FROM book_editions WHERE id = $1 FOR UPDATE`,
          [job.bookEditionId]
        )
        if (!edition.rows[0]) throw leaseLost(job.id)
        const currentTarget = identityJobSpec(edition.rows[0]).targetVersion
        if (currentTarget !== job.targetVersion) {
          await ensureBookIdentityJob(client, edition.rows[0])
          await client.query(
            `UPDATE generation_jobs
             SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
                 locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
             WHERE id = $1`,
            [job.id, JSON.stringify({ stale: true, current_target_version: currentTarget })]
          )
          return { bookEditionId: job.bookEditionId, status: 'stale' }
        }
        const generated = normalizeBookDisplayIdentity(identity)
        const fallback = normalizeBookDisplayIdentity(edition.rows[0])
        const normalized = {
          title: generated.title || fallback.title,
          author: generated.author || fallback.author
        }
        if (!normalized.title) {
          const error = new Error('book identity title is invalid')
          error.code = 'GENERATION_RESULT_INVALID'
          throw error
        }
        await client.query(
          `UPDATE book_editions
           SET display_title = $2, display_author = $3,
               identity_version = $4, identity_source = $5,
               identity_updated_at = now(), updated_at = now()
           WHERE id = $1`,
          [
            job.bookEditionId,
            normalized.title,
            normalized.author,
            job.targetVersion,
            identity.source === 'llm' ? 'llm' : 'deterministic'
          ]
        )
        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, last_error_code = NULL,
               locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, JSON.stringify({ identity: { ...normalized, source: identity.source } })]
        )
        return { bookEditionId: job.bookEditionId, status: 'ready' }
      })
    },

    async failGenerationJob(job, errorCode, { maxAttempts = 3 } = {}) {
      return transaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE generation_jobs
           SET status = CASE WHEN attempts < $4 THEN 'queued' ELSE 'failed' END,
               last_error_code = $3,
               available_at = now() + make_interval(
                 secs => LEAST(300, power(2, attempts)::int)
               ),
               locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1 AND status = 'running' AND lease_token = $2::uuid
           RETURNING status, book_edition_id, character_key, target_version`,
          [job.id, job.leaseToken, errorCode, maxAttempts]
        )
        if (!result.rows[0]) throw leaseLost(job.id)
        const failed = result.rows[0]
        if (failed.character_key) {
          const bundleVersion = job.payload?.bundle_version ?? failed.target_version
          await client.query(
            `UPDATE character_media_bundles SET status = $4, updated_at = now()
             WHERE book_edition_id = $1 AND character_key = $2 AND bundle_version = $3`,
            [
              failed.book_edition_id,
              failed.character_key,
              bundleVersion,
              failed.status
            ]
          )
        }
        return { status: failed.status }
      })
    }
  }
}
