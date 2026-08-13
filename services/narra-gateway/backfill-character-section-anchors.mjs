import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { extractStructuredBookText } from './book-source-text.mjs'
import { sectionAnchorForTextOffset } from './book-markup.mjs'
import { parseEnvInt } from './env.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const limit = parseEnvInt(process.env, 'CHARACTER_SECTION_BACKFILL_LIMIT', 1_000, 10_000)
const storage = createBookObjectStorageFromEnv(process.env)
if (!storage) throw new Error('book object storage is required')

const pool = await createPostgresPoolFromEnv(process.env)
let updatedBooks = 0
let updatedCharacters = 0
let calibratedPositions = 0

function comparableSectionKey(value) {
  let key = String(value || '').trim().split('#')[0].replace(/^epub:/, '').replace(/^\.\//, '')
  try { key = decodeURIComponent(key) } catch {}
  return key.toLocaleLowerCase('en-US')
}
try {
  await runBookMarkupMigrations(pool)
  const candidates = await pool.query(
    `SELECT DISTINCT ON (edition.id)
            edition.id, edition.format, file.object_key, file.mime_type, file.byte_size,
            markup.id AS markup_id, markup.text_length
     FROM book_editions AS edition
     JOIN book_files AS file
       ON file.book_edition_id = edition.id AND file.status = 'ready'
     JOIN book_markup_versions AS markup
       ON markup.book_edition_id = edition.id AND markup.status = 'published'
     JOIN book_characters AS character ON character.markup_version_id = markup.id
     WHERE NOT (
       character.data ? 'firstAppearanceSectionIndex' AND
       character.data ? 'firstAppearanceSectionFraction'
     )
     ORDER BY edition.id, markup.revision DESC
     LIMIT $1`,
    [limit]
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
    if (Number(candidate.text_length) !== structured.textLength) {
      throw new Error(`extracted text length changed for edition ${candidate.id}`)
    }
    const sectionIndexByKey = new Map(structured.sections.map((section, index) => [
      comparableSectionKey(section.key),
      Number.isSafeInteger(section.sourceIndex) ? section.sourceIndex : index
    ]))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const characters = await client.query(
        `SELECT id, first_appearance_text_offset
         FROM book_characters
         WHERE markup_version_id = $1
         FOR UPDATE`,
        [candidate.markup_id]
      )
      for (const character of characters.rows) {
        const anchor = sectionAnchorForTextOffset(
          structured.sections,
          Number(character.first_appearance_text_offset)
        )
        await client.query(
          `UPDATE book_characters
           SET data = data || $2::jsonb
           WHERE id = $1`,
          [character.id, JSON.stringify(anchor)]
        )
        updatedCharacters += 1
      }
      const positions = await client.query(
        `SELECT subject_id, chapter_key
         FROM reader_book_positions
         WHERE book_edition_id = $1 AND section_index IS NULL`,
        [candidate.id]
      )
      for (const position of positions.rows) {
        const fallbackIndex = String(position.chapter_key || '').match(/^section:(\d+)$/)?.[1]
        const sectionIndex = sectionIndexByKey.get(comparableSectionKey(position.chapter_key)) ??
          (fallbackIndex == null ? null : Number(fallbackIndex))
        if (!Number.isSafeInteger(sectionIndex) || sectionIndex < 0) continue
        const result = await client.query(
          `UPDATE reader_book_positions
           SET section_index = $3, section_fraction = 0, updated_at = now()
           WHERE subject_id = $1 AND book_edition_id = $2 AND section_index IS NULL`,
          [position.subject_id, candidate.id, sectionIndex]
        )
        calibratedPositions += result.rowCount ?? 0
      }
      await client.query('COMMIT')
      updatedBooks += 1
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
  console.info('[character-section-backfill] complete', {
    candidates: candidates.rows.length,
    updatedBooks,
    updatedCharacters,
    calibratedPositions
  })
} finally {
  await pool.end()
}
