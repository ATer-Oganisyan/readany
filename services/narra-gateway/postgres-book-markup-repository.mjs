import { createHash, randomUUID } from 'node:crypto'
import {
  BOOK_MARKUP_ANALYSIS_VERSION,
  BOOK_MARKUP_SCHEMA_VERSION,
  CHARACTER_BUNDLE_VERSION,
  REQUIRED_CHARACTER_MEDIA,
  characterBundleIdempotencyKey,
  hasReaderReachedCharacter
} from './book-markup.mjs'

function leaseLost(jobId) {
  const error = new Error(`generation job lease lost: ${jobId}`)
  error.code = 'LEASE_LOST'
  return error
}

async function transaction(pool, operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
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
  const edition = {
    id: row.id,
    scope: row.scope,
    catalogKey: row.catalog_key ?? undefined,
    contentSha256: row.content_sha256,
    title: row.title,
    author: row.author,
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
  privateMaterialTtlDays = 7
} = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  if (!Number.isSafeInteger(privateMaterialTtlDays) || privateMaterialTtlDays < 1 || privateMaterialTtlDays > 365) {
    throw new RangeError('privateMaterialTtlDays must be between 1 and 365')
  }

  async function touchPrivateRetention(client, bookEditionId) {
    await client.query(
      `WITH touched AS (
         UPDATE book_editions
         SET expires_at = now() + make_interval(days => $2), updated_at = now()
         WHERE id = $1 AND scope = 'private' AND source_storage = 'local_only'
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
    const media = await client.query(
      'SELECT object_key FROM media_assets WHERE book_edition_id = ANY($1::uuid[])',
      [bookEditionIds]
    )
    const jobs = await client.query(
      'SELECT idempotency_key FROM generation_jobs WHERE book_edition_id = ANY($1::uuid[])',
      [bookEditionIds]
    )
    const objectKeys = [...new Set([
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

  return {
    async registerLocalBook({
      subjectId,
      proposedBookEditionId,
      contentSha256,
      title,
      author,
      format
    }) {
      return transaction(pool, async (client) => {
        const catalog = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
                  status, source_storage, expires_at, created_at
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
             id, scope, owner_subject_id, content_sha256, title, author, format,
             status, source_storage, expires_at
           ) VALUES (
             $1, 'private', $2::uuid, $3, $4, $5, $6,
             'marking_up', 'local_only', now() + make_interval(days => $7)
           )
           ON CONFLICT (owner_subject_id, content_sha256) WHERE scope = 'private'
           DO UPDATE SET
             title = EXCLUDED.title,
             author = EXCLUDED.author,
             format = EXCLUDED.format,
             source_storage = 'local_only',
             expires_at = now() + make_interval(days => $7),
             updated_at = now()`,
          [
            proposedBookEditionId, subjectId, contentSha256, title, author, format,
            privateMaterialTtlDays
          ]
        )
        const result = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
                  status, source_storage, expires_at, created_at
           FROM book_editions
           WHERE scope = 'private' AND owner_subject_id = $1::uuid
             AND content_sha256 = $2`,
          [subjectId, contentSha256]
        )
        await touchPrivateRetention(client, result.rows[0].id)
        return editionRow(result.rows[0])
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
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
                  status, source_storage, expires_at, created_at
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
      objectKey,
      mimeType,
      byteSize
    }) {
      return transaction(pool, async (client) => {
        const existingResult = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
                  status, source_storage, expires_at, created_at
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
        if (!existing) {
          await client.query(
            `INSERT INTO book_editions (
               id, scope, catalog_key, content_sha256, title, author, format,
               status, source_storage
             ) VALUES ($1, 'catalog', $2, $3, $4, $5, $6, 'uploading', 'stored')`,
            [proposedBookEditionId, catalogKey, contentSha256, title, author, format]
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
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
                  status, source_storage, expires_at, created_at
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
                edition.format, edition.status, edition.source_storage,
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
          `SELECT edition.id
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
        const edition = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
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
            AND bundle.status = 'ready'
           JOIN character_bundle_assets AS link ON link.bundle_id = bundle.id
           JOIN media_assets AS asset
             ON asset.id = link.asset_id AND asset.status = 'ready'
           LEFT JOIN reader_book_positions AS position
             ON position.subject_id = $2::uuid AND position.book_edition_id = edition.id
           WHERE edition.id = $1 AND asset.id = $3::uuid
             AND (
               (edition.scope = 'catalog' AND edition.status IN ('base_ready', 'published')) OR
               (edition.scope = 'private' AND edition.owner_subject_id = $2::uuid
                 AND edition.source_storage = 'local_only' AND edition.expires_at > now())
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

    async listCatalogBooks({ limit, cursor = null }) {
      const result = await pool.query(
        `SELECT edition.id, edition.scope, edition.catalog_key,
                edition.content_sha256, edition.title, edition.author,
                edition.format, edition.status, edition.source_storage,
                edition.expires_at, edition.created_at,
                cover.object_key AS cover_object_key,
                cover.content_hash AS cover_content_hash,
                cover.mime_type AS cover_mime_type,
                cover.byte_size AS cover_byte_size,
                cover.status AS cover_status
         FROM book_editions AS edition
         LEFT JOIN catalog_book_covers AS cover
           ON cover.book_edition_id = edition.id AND cover.status = 'ready'
         WHERE edition.scope = 'catalog'
           AND edition.status IN ('base_ready', 'published')
           AND (
             $1::timestamptz IS NULL OR
             (edition.created_at, edition.id) < ($1::timestamptz, $2::uuid)
           )
         ORDER BY edition.created_at DESC, edition.id DESC
         LIMIT $3`,
        [cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
      )
      const hasMore = result.rows.length > limit
      const items = result.rows.slice(0, limit).map(editionRow)
      const last = items.at(-1)
      return {
        items,
        nextCursor: hasMore && last
          ? { createdAt: last.createdAt, id: last.id }
          : null
      }
    },

    async resolveBook({ subjectId, source, catalogKey, contentSha256 }) {
      if (source === 'catalog') {
        const result = await pool.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
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
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
                  status, source_storage, expires_at, created_at
           FROM book_editions
           WHERE content_sha256 = $2 AND (
             (scope = 'catalog' AND status IN ('base_ready', 'published')) OR
             (scope = 'private' AND owner_subject_id = $1::uuid
               AND source_storage = 'local_only' AND expires_at > now())
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

    async getReaderBookManifest({ subjectId, bookEditionId, bundleVersion }) {
      return transaction(pool, async (client) => {
        const editionResult = await client.query(
          `SELECT id, scope, catalog_key, content_sha256, title, author, format,
                  status, source_storage, expires_at, created_at
           FROM book_editions
           WHERE id = $1 AND (
             (scope = 'catalog' AND status IN ('base_ready', 'published')) OR
             (scope = 'private' AND owner_subject_id = $2::uuid
               AND source_storage = 'local_only' AND expires_at > now())
           )
           FOR SHARE`,
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
          `SELECT id, schema_version, analysis_version, revision, text_length, published_at
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
                  bundle.id AS bundle_id, bundle.bundle_version, bundle.status AS bundle_status,
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
                    version: row.bundle_version,
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
          `SELECT edition.id, edition.scope, markup.text_length
           FROM book_editions AS edition
           LEFT JOIN book_markup_versions AS markup
             ON markup.book_edition_id = edition.id AND markup.status = 'published'
           WHERE edition.id = $1 AND (
             (edition.scope = 'catalog' AND edition.status IN ('base_ready', 'published')) OR
             (edition.scope = 'private' AND edition.owner_subject_id = $2::uuid
               AND edition.source_storage = 'local_only' AND edition.expires_at > now())
           )
           FOR SHARE OF edition`,
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
          [bookEditionId, readerTextOffset]
        )
        return {
          scope: edition.rows[0].scope,
          readerTextOffset,
          readingFraction,
          chapterKey: position.rows[0].chapter_key,
          readerSectionIndex,
          readerSectionFraction,
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

    async ensureCharacterBundle({
      bookEditionId,
      characterKey,
      bundleVersion = CHARACTER_BUNDLE_VERSION,
      priority = 50
    }) {
      const idempotencyKey = characterBundleIdempotencyKey({
        bookEditionId,
        characterKey,
        bundleVersion
      })
      const ensured = await ensureJob({
        idempotencyKey,
        type: 'character_bundle',
        bookEditionId,
        characterKey,
        targetVersion: bundleVersion,
        priority,
        payload: { required_media: REQUIRED_CHARACTER_MEDIA }
      })
      await pool.query(
        `INSERT INTO character_media_bundles (
           id, book_edition_id, character_key, bundle_version, job_id, status, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           CASE WHEN EXISTS (
             SELECT 1 FROM book_editions WHERE id = $2 AND scope = 'private'
           ) THEN now() + make_interval(days => $7) ELSE NULL END
         )
         ON CONFLICT (book_edition_id, character_key, bundle_version) DO NOTHING`,
        [
          idFactory(), bookEditionId, characterKey, bundleVersion,
          ensured.row.id, ensured.row.status, privateMaterialTtlDays
        ]
      )
      return { ...jobRow(ensured.row), created: ensured.created, idempotencyKey }
    },

    async retryFailedGenerationJobs({ limit = 100 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new RangeError('retry limit must be between 1 and 1000')
      }
      return transaction(pool, async (client) => {
        const retried = await client.query(
          `WITH candidates AS (
             SELECT id FROM generation_jobs
             WHERE status = 'failed'
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
          [limit]
        )
        const characterJobs = retried.rows.filter((row) => row.character_key)
        for (const row of characterJobs) {
          await client.query(
            `UPDATE character_media_bundles
             SET status = 'queued', updated_at = now()
             WHERE book_edition_id = $1 AND character_key = $2
               AND bundle_version = $3`,
            [row.book_edition_id, row.character_key, row.target_version]
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
           WHERE scope = 'private' AND source_storage = 'local_only'
             AND expires_at <= now()
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

    async claimGenerationJob(workerId, { leaseSeconds = 300 } = {}) {
      const leaseToken = idFactory()
      const result = await pool.query(
        `WITH candidate AS (
           SELECT id
           FROM generation_jobs
           WHERE (
             status = 'queued' AND available_at <= now()
           ) OR (
             status = 'running' AND locked_at < now() - make_interval(secs => $2)
           )
           ORDER BY priority DESC, available_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE generation_jobs AS job
         SET status = 'running', locked_at = now(), locked_by = $1,
             lease_token = $3::uuid, attempts = attempts + 1, updated_at = now()
         FROM candidate
         WHERE job.id = candidate.id
         RETURNING job.*`,
        [workerId, leaseSeconds, leaseToken]
      )
      const job = jobRow(result.rows[0])
      if (job?.type === 'character_bundle') {
        await pool.query(
          `UPDATE character_media_bundles
           SET status = 'running', updated_at = now()
           WHERE book_edition_id = $1 AND character_key = $2 AND bundle_version = $3`,
          [job.bookEditionId, job.characterKey, job.targetVersion]
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

    async renewGenerationLease(job) {
      const result = await pool.query(
        `UPDATE generation_jobs SET locked_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'running' AND lease_token = $2::uuid
         RETURNING id`,
        [job.id, job.leaseToken]
      )
      if (!result.rows[0]) throw leaseLost(job.id)
    },

    async getCharacterBundleInput(job) {
      const result = await pool.query(
        `SELECT character.character_key, character.name, character.full_name,
                character.first_appearance_text_offset, character.warmup_text_offset,
                character.data, edition.scope, edition.title, edition.author
         FROM generation_jobs AS job
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         JOIN book_markup_versions AS markup
           ON markup.book_edition_id = edition.id AND markup.status = 'published'
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
        const bundleResult = await client.query(
          `SELECT bundle.*, edition.scope
           FROM character_media_bundles AS bundle
           JOIN book_editions AS edition ON edition.id = bundle.book_edition_id
           WHERE bundle.book_edition_id = $1 AND bundle.character_key = $2
             AND bundle.bundle_version = $3
           FOR UPDATE OF bundle`,
          [job.bookEditionId, job.characterKey, job.targetVersion]
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
        const complete = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM character_bundle_assets AS link
           JOIN media_assets AS asset ON asset.id = link.asset_id AND asset.status = 'ready'
           WHERE link.bundle_id = $1 AND link.asset_type = ANY($2::text[])`,
          [target.id, REQUIRED_CHARACTER_MEDIA]
        )
        if (Number(complete.rows[0].count) !== REQUIRED_CHARACTER_MEDIA.length) {
          throw new Error('character bundle did not publish every required asset')
        }
        await client.query(
          `UPDATE character_media_bundles
           SET status = 'ready', published_at = now(), updated_at = now(),
               expires_at = CASE WHEN $2 = 'private'
                 THEN now() + make_interval(days => $3)
                 ELSE NULL
               END
           WHERE id = $1`,
          [target.id, target.scope, privateMaterialTtlDays]
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
          [job.bookEditionId, job.targetVersion]
        )
        if (Number(missing.rows[0].count) === 0) {
          await client.query(
            `UPDATE book_editions SET status = 'base_ready', updated_at = now()
             WHERE id = $1 AND scope = 'catalog' AND status = 'generating_portraits'`,
            [job.bookEditionId]
          )
        }
        await client.query(
          `UPDATE generation_jobs
           SET status = 'ready', result = $2::jsonb, locked_at = NULL,
               locked_by = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, JSON.stringify({ bundle_id: target.id })]
        )
        return { bundleId: target.id }
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
          await client.query(
            `UPDATE character_media_bundles SET status = $4, updated_at = now()
             WHERE book_edition_id = $1 AND character_key = $2 AND bundle_version = $3`,
            [
              failed.book_edition_id,
              failed.character_key,
              failed.target_version,
              failed.status
            ]
          )
        }
        return { status: failed.status }
      })
    }
  }
}
