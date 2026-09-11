import { createHash } from 'node:crypto'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { extractStructuredBookText } from './book-source-text.mjs'
import { BOOK_ANALYSIS_NORMALIZATION_VERSION } from '../analysis/book-analysis-pipeline.mjs'
import { parseEnvInt } from '../platform/env.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

const limit = parseEnvInt(process.env, 'BOOK_CONTENT_NAVIGATION_BACKFILL_LIMIT', 1_000, 10_000)
// Refresh previously prepared EPUBs after navigation selection changes.
const refresh = process.env.BOOK_CONTENT_NAVIGATION_BACKFILL_REFRESH === '1'
const dryRun = process.env.BOOK_CONTENT_NAVIGATION_BACKFILL_DRY_RUN === '1'
const storage = createBookObjectStorageFromEnv(process.env)
if (!storage) throw new Error('book object storage is required')

const pool = await createPostgresPoolFromEnv(process.env)
let updatedBooks = 0

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

try {
  if (!dryRun) await runBookMarkupMigrations(pool)
  const candidates = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (run.book_edition_id)
              run.id AS run_id, run.book_edition_id, run.normalized_text_hash,
              run.text_length, run.content_navigation, edition.format,
              file.object_key, file.mime_type, file.byte_size
       FROM book_analysis_runs AS run
       JOIN book_editions AS edition ON edition.id = run.book_edition_id
       JOIN book_files AS file
         ON file.book_edition_id = edition.id AND file.status = 'ready'
       WHERE run.status = 'ready'
         AND run.normalization_version = ANY($3::text[])
         AND run.normalized_text_object_key IS NOT NULL
         AND run.normalized_text_hash IS NOT NULL
         AND run.input_hash = edition.content_sha256
       ORDER BY run.book_edition_id, array_position($3::text[], run.normalization_version),
                run.run_sequence DESC, run.created_at DESC
     )
     SELECT * FROM latest
     WHERE content_navigation IS NULL
        OR ($2::boolean AND format = 'epub'
            AND content_navigation->>'selectionVersion' IS DISTINCT FROM '2')
     ORDER BY book_edition_id
     LIMIT $1`,
    [limit, refresh, [BOOK_ANALYSIS_NORMALIZATION_VERSION, 'normalized-text-v1']]
  )

  for (const candidate of candidates.rows) {
    const stored = await storage.getBytes({
      objectKey: candidate.object_key,
      maxBytes: Math.min(512 * 1024 * 1024, Math.max(1, Number(candidate.byte_size)))
    })
    const structured = await extractStructuredBookText({
      bytes: stored.bytes,
      format: candidate.format,
      mimeType: candidate.mime_type
    })
    if (
      Number(candidate.text_length) !== structured.textLength ||
      candidate.normalized_text_hash !== sha256(structured.text)
    ) {
      throw new Error(`normalized text changed for edition ${candidate.book_edition_id}`)
    }
    console.info('[book-content-navigation-backfill] verified', {
      bookEditionId: candidate.book_edition_id,
      before: candidate.content_navigation?.items?.length ?? 0,
      after: structured.navigation.items.length,
      source: structured.navigation.source,
      dryRun
    })
    if (dryRun) continue
    const result = await pool.query(
      `UPDATE book_analysis_runs
       SET content_navigation = $2::jsonb, updated_at = now()
       WHERE id = $1 AND content_navigation IS NOT DISTINCT FROM $3::jsonb`,
      [candidate.run_id, JSON.stringify(structured.navigation), candidate.content_navigation == null ? null : JSON.stringify(candidate.content_navigation)]
    )
    updatedBooks += result.rowCount ?? 0
  }

  console.info('[book-content-navigation-backfill] complete', {
    candidates: candidates.rows.length,
    updatedBooks
  })
} finally {
  await pool.end()
}
