import { randomUUID } from 'node:crypto'
import {
  BOOK_TTS_MARKUP_VERSION,
  bookTtsScriptContentHash
} from './book-tts-markup.mjs'

function statusRow(row) {
  if (!row) return null
  return {
    jobId: row.job_id,
    bookEditionId: row.book_edition_id,
    sourcePublicationId: row.source_publication_id,
    status: row.status === 'running' ? 'processing' : row.status,
    version: row.analysis_version,
    revision: row.revision == null ? null : Number(row.revision),
    normalizedTextHash: row.normalized_text_hash,
    errorCode: row.error_code ?? null,
    retryAfterMs: ['queued', 'running'].includes(row.status) ? 10_000 : null
  }
}

function claimedRow(row) {
  if (!row) return null
  return {
    id: row.id,
    bookEditionId: row.book_edition_id,
    sourcePublicationId: row.source_publication_id,
    leaseToken: row.lease_token
  }
}

export function createPostgresBookTtsMarkupRepository(pool, { idFactory = randomUUID } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool is required')

  return {
    async ensureBookTtsMarkup({ bookEditionId, sourcePublicationId }) {
      const source = await pool.query(
        `SELECT publication.id, publication.content_hash,
                run.normalized_text_hash
         FROM book_analysis_publications AS publication
         JOIN book_analysis_runs AS run ON run.id = publication.run_id
         WHERE publication.id = $1 AND publication.book_edition_id = $2
           AND publication.channel = 'shadow'
           AND run.normalized_text_hash IS NOT NULL`,
        [sourcePublicationId, bookEditionId]
      )
      const row = source.rows[0]
      if (!row) return null
      await pool.query(
        `INSERT INTO book_tts_markup_jobs (
           id, book_edition_id, source_publication_id, source_markup_content_hash,
           normalized_text_hash, analysis_version, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'queued')
         ON CONFLICT (source_publication_id, analysis_version) DO NOTHING`,
        [idFactory(), bookEditionId, sourcePublicationId, row.content_hash,
          row.normalized_text_hash, BOOK_TTS_MARKUP_VERSION]
      )
      return this.getBookTtsMarkupStatus({ bookEditionId, sourcePublicationId })
    },

    async getBookTtsMarkupStatus({ bookEditionId, sourcePublicationId }) {
      const result = await pool.query(
        `SELECT job.id AS job_id, job.book_edition_id, job.source_publication_id,
                job.status, job.analysis_version, job.normalized_text_hash, job.error_code,
                publication.revision
         FROM book_tts_markup_jobs AS job
         LEFT JOIN book_tts_markup_publications AS publication ON publication.job_id = job.id
         WHERE job.book_edition_id = $1 AND job.source_publication_id = $2
           AND job.analysis_version = $3`,
        [bookEditionId, sourcePublicationId, BOOK_TTS_MARKUP_VERSION]
      )
      return statusRow(result.rows[0])
    },

    async getBookTtsMarkupSection({ bookEditionId, sectionIndex }) {
      const result = await pool.query(
        `SELECT publication.analysis_version, publication.revision,
                publication.normalized_text_hash, publication.data
         FROM book_tts_markup_publications AS publication
         WHERE publication.book_edition_id = $1
         ORDER BY publication.published_at DESC, publication.id DESC
         LIMIT 1`,
        [bookEditionId]
      )
      const publication = result.rows[0]
      if (!publication) return null
      const section = publication.data?.sections?.find((value) => value.index === sectionIndex)
      if (!section) return null
      return {
        status: 'ready',
        version: publication.analysis_version,
        revision: Number(publication.revision),
        normalizedTextHash: publication.normalized_text_hash,
        section
      }
    },

    async claimJob(workerId, { leaseSeconds = 300 } = {}) {
      const leaseToken = idFactory()
      const result = await pool.query(
        `WITH candidate AS (
           SELECT id FROM book_tts_markup_jobs
           WHERE status = 'queued'
              OR (status = 'running' AND lease_expires_at < now())
           ORDER BY created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE book_tts_markup_jobs AS job
         SET status = 'running', lease_owner = $1, lease_token = $2,
             lease_expires_at = now() + ($3 * interval '1 second'),
             attempt_count = attempt_count + 1, error_code = NULL, updated_at = now()
         FROM candidate
         WHERE job.id = candidate.id
         RETURNING job.*`,
        [workerId, leaseToken, leaseSeconds]
      )
      return claimedRow(result.rows[0])
    },

    async getJobInput(job) {
      const result = await pool.query(
        `SELECT job.id, job.book_edition_id, job.source_publication_id,
                job.source_markup_content_hash, job.normalized_text_hash,
                run.normalized_text_object_key, run.text_length, run.content_navigation,
                edition.title, edition.author, publication.data
         FROM book_tts_markup_jobs AS job
         JOIN book_analysis_publications AS publication ON publication.id = job.source_publication_id
         JOIN book_analysis_runs AS run ON run.id = publication.run_id
         JOIN book_editions AS edition ON edition.id = job.book_edition_id
         WHERE job.id = $1 AND job.lease_token = $2 AND job.status = 'running'`,
        [job.id, job.leaseToken]
      )
      const row = result.rows[0]
      if (!row) throw Object.assign(new Error('TTS markup lease is stale'), { code: 'LEASE_LOST' })
      return {
        title: row.title,
        author: row.author,
        normalizedTextObjectKey: row.normalized_text_object_key,
        normalizedTextHash: row.normalized_text_hash,
        sourceMarkupContentHash: row.source_markup_content_hash,
        textLength: Number(row.text_length),
        navigation: row.content_navigation,
        characters: (row.data?.markup?.characters ?? []).map((character) => ({
          characterKey: character.characterKey,
          name: character.name,
          fullName: character.fullName,
          aliases: character.aliases ?? []
        }))
      }
    },

    async renewJobLease(job, { leaseSeconds = 300 } = {}) {
      const result = await pool.query(
        `UPDATE book_tts_markup_jobs
         SET lease_expires_at = now() + ($3 * interval '1 second'), updated_at = now()
         WHERE id = $1 AND lease_token = $2 AND status = 'running'`,
        [job.id, job.leaseToken, leaseSeconds]
      )
      if (result.rowCount !== 1) throw Object.assign(new Error('TTS markup lease is stale'), { code: 'LEASE_LOST' })
    },

    async completeJob(job, script) {
      const client = typeof pool.connect === 'function' ? await pool.connect() : pool
      try {
        await client.query('BEGIN')
        const locked = await client.query(
          `SELECT * FROM book_tts_markup_jobs
           WHERE id = $1 AND lease_token = $2 AND status = 'running'
           FOR UPDATE`,
          [job.id, job.leaseToken]
        )
        const row = locked.rows[0]
        if (!row) throw Object.assign(new Error('TTS markup lease is stale'), { code: 'LEASE_LOST' })
        const revisionResult = await client.query(
          `SELECT coalesce(max(revision), 0)::integer + 1 AS revision
           FROM book_tts_markup_publications WHERE book_edition_id = $1`,
          [row.book_edition_id]
        )
        const revision = Number(revisionResult.rows[0].revision)
        await client.query(
          `INSERT INTO book_tts_markup_publications (
             id, job_id, book_edition_id, source_publication_id, analysis_version,
             revision, normalized_text_hash, content_hash, data
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [idFactory(), row.id, row.book_edition_id, row.source_publication_id,
            BOOK_TTS_MARKUP_VERSION, revision, row.normalized_text_hash,
            bookTtsScriptContentHash(script), script]
        )
        await client.query(
          `UPDATE book_tts_markup_jobs
           SET status = 'ready', lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, updated_at = now()
           WHERE id = $1`,
          [row.id]
        )
        await client.query('COMMIT')
        return { status: 'ready', revision }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        if (client !== pool) client.release()
      }
    },

    async failJob(job, errorCode) {
      await pool.query(
        `UPDATE book_tts_markup_jobs
         SET status = 'failed', error_code = $3, lease_owner = NULL, lease_token = NULL,
             lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND lease_token = $2 AND status = 'running'`,
        [job.id, job.leaseToken, String(errorCode || 'UNKNOWN').slice(0, 64)]
      )
    }
  }
}
