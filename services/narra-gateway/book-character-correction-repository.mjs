import {
  BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION,
  applyBookCharacterCorrection,
  normalizeBookCharacterCorrection
} from './book-character-correction.mjs'
import { BOOK_ANALYSIS_MARKUP_VERSION } from './book-analysis-contracts.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

function repositoryError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status })
}

function identifier(value, name) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!UUID.test(normalized)) throw repositoryError('VALIDATION', `${name}: invalid UUID`)
  return normalized
}

function documentHash(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!SHA256.test(normalized)) {
    throw repositoryError('VALIDATION', 'documentHash: invalid SHA-256')
  }
  return normalized
}

function operatorId(value) {
  const normalized = String(value || '').normalize('NFKC').trim()
  if (!normalized || normalized.length > 120 || /\p{Cc}/u.test(normalized)) {
    throw repositoryError('VALIDATION', 'operatorId: invalid value')
  }
  return normalized
}

function iso(value) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function correctionValue(row) {
  if (!row) return null
  return {
    bookEditionId: row.book_edition_id,
    base: {
      markupVersionId: row.base_markup_version_id,
      publicationId: row.base_publication_id,
      contentHash: row.base_content_hash
    },
    correctionVersion: Number(row.correction_version),
    contractVersion: BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION,
    status: row.status,
    document: row.document,
    documentHash: row.document_hash,
    validation: row.validation,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    enabledBy: row.enabled_by ?? null,
    disabledBy: row.disabled_by ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    enabledAt: iso(row.enabled_at),
    disabledAt: iso(row.disabled_at)
  }
}

function baseValue({ edition, markup, publication }) {
  if (!edition || !markup || !publication?.data?.markup) return null
  return {
    bookEditionId: edition.id,
    title: edition.title,
    author: edition.author,
    markupVersionId: markup.id,
    publicationId: publication.id,
    contentHash: markup.input_hash,
    revision: Number(markup.revision),
    analysisVersion: markup.analysis_version,
    publicationRunId: publication.run_id,
    publishedAt: iso(publication.published_at),
    markup: publication.data.markup
  }
}

async function currentBase(client, bookEditionId, { lock = false } = {}) {
  const editionResult = await client.query(
    `/* character-correction:base-markup */
     SELECT edition.id, edition.title, edition.author,
            markup.id AS markup_id, markup.input_hash, markup.revision,
            markup.analysis_version, markup.published_at AS markup_published_at
     FROM book_editions AS edition
     LEFT JOIN book_markup_versions AS markup
       ON markup.book_edition_id = edition.id
      AND markup.status = 'published'
      AND markup.analysis_version = $2
     WHERE edition.id = $1
     ${lock ? 'FOR UPDATE OF edition' : ''}`,
    [bookEditionId, BOOK_ANALYSIS_MARKUP_VERSION]
  )
  const row = editionResult.rows[0]
  if (!row) return { exists: false, base: null }
  if (!row.markup_id) return { exists: true, base: null }
  const publicationResult = await client.query(
    `/* character-correction:base-publication */
     SELECT publication.*
     FROM book_analysis_publications AS publication
     WHERE publication.book_edition_id = $1
       AND publication.channel = 'shadow'
       AND publication.content_hash = $2
     ORDER BY publication.published_at DESC, publication.id DESC
     LIMIT 1`,
    [bookEditionId, row.input_hash]
  )
  return {
    exists: true,
    base: baseValue({
      edition: { id: row.id, title: row.title, author: row.author },
      markup: {
        id: row.markup_id,
        input_hash: row.input_hash,
        revision: row.revision,
        analysis_version: row.analysis_version
      },
      publication: publicationResult.rows[0]
    })
  }
}

function requiredBase(value) {
  if (!value.exists) throw repositoryError('NOT_FOUND', 'Книга не найдена', 404)
  if (!value.base) {
    throw repositoryError(
      'CHARACTER_CORRECTION_BASE_UNAVAILABLE',
      'Для книги нет согласованной опубликованной разметки v3',
      409
    )
  }
  return value.base
}

function previewValue(base, result) {
  return {
    base: {
      bookEditionId: base.bookEditionId,
      title: base.title,
      author: base.author,
      markupVersionId: base.markupVersionId,
      publicationId: base.publicationId,
      contentHash: base.contentHash,
      revision: base.revision,
      publishedAt: base.publishedAt
    },
    document: result.document,
    documentHash: result.documentHash,
    diff: result.diff,
    projectedCharacters: result.markup.characters.map((character) => ({
      characterKey: character.characterKey,
      name: character.name,
      fullName: character.fullName,
      aliases: character.aliases,
      role: character.role,
      description: character.description
    }))
  }
}

async function transaction(pool, operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const value = await operation(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function storedCorrection(client, bookEditionId, { lock = false } = {}) {
  const result = await client.query(
    `SELECT * FROM book_character_corrections
     WHERE book_edition_id = $1
     ${lock ? 'FOR UPDATE' : ''}`,
    [bookEditionId]
  )
  return correctionValue(result.rows[0])
}

function matchesBase(correction, base) {
  return Boolean(correction && base &&
    correction.base.markupVersionId === base.markupVersionId &&
    correction.base.publicationId === base.publicationId &&
    correction.base.contentHash === base.contentHash)
}

export function createPostgresBookCharacterCorrectionRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }

  return {
    async getCorrectionState(bookEditionIdValue) {
      const bookEditionId = identifier(bookEditionIdValue, 'bookEditionId')
      const [baseResult, correction] = await Promise.all([
        currentBase(pool, bookEditionId),
        storedCorrection(pool, bookEditionId)
      ])
      if (!baseResult.exists) return null
      return {
        base: baseResult.base && {
          bookEditionId: baseResult.base.bookEditionId,
          title: baseResult.base.title,
          author: baseResult.base.author,
          markupVersionId: baseResult.base.markupVersionId,
          publicationId: baseResult.base.publicationId,
          contentHash: baseResult.base.contentHash,
          revision: baseResult.base.revision,
          publishedAt: baseResult.base.publishedAt
        },
        correction,
        stale: Boolean(correction && !matchesBase(correction, baseResult.base)),
        effective: Boolean(correction?.status === 'enabled' && matchesBase(correction, baseResult.base))
      }
    },

    async previewCorrection(bookEditionIdValue, rawDocument) {
      const bookEditionId = identifier(bookEditionIdValue, 'bookEditionId')
      const base = requiredBase(await currentBase(pool, bookEditionId))
      const result = applyBookCharacterCorrection(rawDocument, {
        markup: base.markup,
        base
      })
      return previewValue(base, result)
    },

    async stageCorrection({ bookEditionId: bookEditionIdValue, document, operatorId: rawOperatorId }) {
      const bookEditionId = identifier(bookEditionIdValue, 'bookEditionId')
      const actor = operatorId(rawOperatorId)
      return transaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `book-character-correction:${bookEditionId}`
        ])
        const base = requiredBase(await currentBase(client, bookEditionId, { lock: true }))
        const existing = await storedCorrection(client, bookEditionId, { lock: true })
        if (existing?.status === 'enabled') {
          throw repositoryError(
            'CHARACTER_CORRECTION_ALREADY_ENABLED',
            'Сначала явно отключите действующий correction, затем сохраняйте новый draft',
            409
          )
        }
        const result = applyBookCharacterCorrection(document, { markup: base.markup, base })
        const correctionVersion = (existing?.correctionVersion ?? 0) + 1
        const validation = { valid: true, diff: result.diff }
        const saved = await client.query(
          `INSERT INTO book_character_corrections (
             book_edition_id, base_markup_version_id, base_publication_id,
             base_content_hash, correction_version, status, document,
             document_hash, validation, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb, $7, $8::jsonb, $9, $9)
           ON CONFLICT (book_edition_id) DO UPDATE SET
             base_markup_version_id = EXCLUDED.base_markup_version_id,
             base_publication_id = EXCLUDED.base_publication_id,
             base_content_hash = EXCLUDED.base_content_hash,
             correction_version = EXCLUDED.correction_version,
             status = 'draft',
             document = EXCLUDED.document,
             document_hash = EXCLUDED.document_hash,
             validation = EXCLUDED.validation,
             updated_by = EXCLUDED.updated_by,
             enabled_by = NULL,
             disabled_by = NULL,
             updated_at = now(),
             enabled_at = NULL,
             disabled_at = NULL
           RETURNING *`,
          [
            bookEditionId,
            base.markupVersionId,
            base.publicationId,
            base.contentHash,
            correctionVersion,
            JSON.stringify(result.document),
            result.documentHash,
            JSON.stringify(validation),
            actor
          ]
        )
        return {
          correction: correctionValue(saved.rows[0]),
          preview: previewValue(base, result)
        }
      })
    },

    async enableCorrection({ bookEditionId: bookEditionIdValue, documentHash: rawHash, operatorId: rawOperatorId }) {
      const bookEditionId = identifier(bookEditionIdValue, 'bookEditionId')
      const expectedHash = documentHash(rawHash)
      const actor = operatorId(rawOperatorId)
      return transaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `book-character-correction:${bookEditionId}`
        ])
        const base = requiredBase(await currentBase(client, bookEditionId, { lock: true }))
        const correction = await storedCorrection(client, bookEditionId, { lock: true })
        if (!correction) throw repositoryError('NOT_FOUND', 'Correction для книги не найден', 404)
        if (correction.documentHash !== expectedHash) {
          throw repositoryError(
            'CHARACTER_CORRECTION_CHANGED',
            'Correction изменился после проверки; повторите preview',
            409
          )
        }
        if (!matchesBase(correction, base)) {
          throw repositoryError(
            'CHARACTER_CORRECTION_STALE',
            'Опубликованная разметка изменилась; correction не включён',
            409
          )
        }
        applyBookCharacterCorrection(correction.document, { markup: base.markup, base })
        const saved = await client.query(
          `UPDATE book_character_corrections
           SET status = 'enabled', enabled_by = $3, enabled_at = now(),
               disabled_by = NULL, disabled_at = NULL,
               updated_by = $3, updated_at = now()
           WHERE book_edition_id = $1 AND document_hash = $2
           RETURNING *`,
          [bookEditionId, expectedHash, actor]
        )
        return correctionValue(saved.rows[0])
      })
    },

    async disableCorrection({ bookEditionId: bookEditionIdValue, documentHash: rawHash, operatorId: rawOperatorId }) {
      const bookEditionId = identifier(bookEditionIdValue, 'bookEditionId')
      const expectedHash = documentHash(rawHash)
      const actor = operatorId(rawOperatorId)
      return transaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `book-character-correction:${bookEditionId}`
        ])
        const correction = await storedCorrection(client, bookEditionId, { lock: true })
        if (!correction || correction.documentHash !== expectedHash) {
          throw repositoryError(
            'CHARACTER_CORRECTION_CHANGED',
            'Correction не найден или изменился после проверки',
            409
          )
        }
        const result = await client.query(
          `UPDATE book_character_corrections
           SET status = 'disabled', disabled_by = $3, disabled_at = now(),
               updated_by = $3, updated_at = now()
           WHERE book_edition_id = $1 AND document_hash = $2
           RETURNING *`,
          [bookEditionId, expectedHash, actor]
        )
        return correctionValue(result.rows[0])
      })
    },

    async getEnabledCorrection({
      bookEditionId: bookEditionIdValue,
      markupVersionId: markupVersionIdValue,
      publicationId: publicationIdValue = null,
      contentHash: contentHashValue
    }) {
      const bookEditionId = identifier(bookEditionIdValue, 'bookEditionId')
      const markupVersionId = identifier(markupVersionIdValue, 'markupVersionId')
      const publicationId = publicationIdValue == null
        ? null
        : identifier(publicationIdValue, 'publicationId')
      const contentHashValueNormalized = String(contentHashValue || '').trim().toLowerCase()
      if (!SHA256.test(contentHashValueNormalized)) return null
      const result = await pool.query(
        `SELECT * FROM book_character_corrections
         WHERE book_edition_id = $1
           AND base_markup_version_id = $2
           AND base_content_hash = $3
           AND status = 'enabled'
           AND base_publication_id = COALESCE(
             $4::uuid,
             (
               SELECT publication.id
               FROM book_analysis_publications AS publication
               WHERE publication.book_edition_id = $1
                 AND publication.channel = 'shadow'
               ORDER BY publication.published_at DESC, publication.id DESC
               LIMIT 1
             )
           )
         LIMIT 1`,
        [bookEditionId, markupVersionId, contentHashValueNormalized, publicationId]
      )
      const correction = correctionValue(result.rows[0])
      if (!correction) return null
      // Treat malformed stored data as unavailable rather than breaking reader traffic.
      try {
        correction.document = normalizeBookCharacterCorrection(correction.document)
        return correction
      } catch {
        return null
      }
    }
  }
}
