import { normalizeBookMarkupV3 } from './book-analysis-contracts.mjs'

/**
 * Опубликованная разметка книги в таблицах, которые читает читатель.
 *
 * Раньше это было первой половиной `materializeMediaProjection`, и никто, кроме
 * неё, `book_markup_versions` и `book_characters` не заполнял. Конвейеру
 * карточек нужна ровно эта половина и не нужна вторая: медиа он ставит сам, по
 * ревизии карточки, и общая проекция заказала бы персонажам вторую пачку по
 * ключам старой разметки. Поэтому половина вынесена, а не скопирована: двух
 * разных пониманий того, что такое «книга опубликована», быть не должно.
 *
 * Возвращает нормализованную разметку — вызывающий работает с ней, а не с тем,
 * что ему передали: у уже существующей версии состав персонажей канонический,
 * и он может отличаться от переданного.
 */
export async function materializeMarkupVersion(client, {
  bookEditionId,
  contentHash: markupContentHash,
  markup: rawMarkup,
  publishedAt = null,
  idFactory,
  notFound,
  schemaVersion,
  analysisVersion
}) {
  let markup = normalizeBookMarkupV3(rawMarkup)
  const editionResult = await client.query(
    `SELECT id, scope, expires_at
     FROM book_editions WHERE id = $1 FOR UPDATE`,
    [bookEditionId]
  )
  const edition = editionResult.rows[0]
  if (!edition) throw notFound()
  const existing = await client.query(
    `SELECT id, revision, status
     FROM book_markup_versions
     WHERE book_edition_id = $1 AND analysis_version = $2 AND input_hash = $3
     LIMIT 1 FOR UPDATE`,
    [bookEditionId, analysisVersion, markupContentHash]
  )
  let markupId = existing.rows[0]?.id
  let revision = existing.rows[0] ? Number(existing.rows[0].revision) : null
  let created = false
  if (!markupId) {
    const revisionResult = await client.query(
      `SELECT COALESCE(MAX(revision), 0) + 1 AS revision
       FROM book_markup_versions WHERE book_edition_id = $1`,
      [bookEditionId]
    )
    revision = Number(revisionResult.rows[0].revision)
    markupId = idFactory()
    await client.query(
      `UPDATE book_markup_versions SET status = 'ready'
       WHERE book_edition_id = $1 AND status = 'published'`,
      [bookEditionId]
    )
    await client.query(
      `INSERT INTO book_markup_versions (
         id, book_edition_id, schema_version, analysis_version, revision,
         status, input_hash, text_length, published_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'published', $6, $7,
         COALESCE($8::timestamptz, now()), $9)`,
      [
        markupId, bookEditionId, schemaVersion,
        analysisVersion, revision, markupContentHash,
        markup.textLength, publishedAt, edition.scope === 'private' ? edition.expires_at : null
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
          character.name, character.fullName, character.firstAppearanceTextOffset,
          character.warmupTextOffset,
          JSON.stringify({ ...character, analysisSource: analysisVersion })
        ]
      )
    }
    created = true
  } else if (existing.rows[0].status !== 'published') {
    await client.query(
      `UPDATE book_markup_versions SET status = 'ready'
       WHERE book_edition_id = $1 AND status = 'published' AND id <> $2`,
      [bookEditionId, markupId]
    )
    await client.query(
      `UPDATE book_markup_versions
       SET status = 'published', published_at = COALESCE($2::timestamptz, now())
       WHERE id = $1`,
      [markupId, publishedAt]
    )
  }
  if (!created) {
    const canonicalCharacters = await client.query(
      `SELECT character_key
       FROM book_characters
       WHERE markup_version_id = $1
       ORDER BY sort_order, character_key`,
      [markupId]
    )
    const profileByKey = new Map(markup.characters.map((character) => [
      character.characterKey,
      character
    ]))
    markup = {
      ...markup,
      characters: canonicalCharacters.rows
        .map(({ character_key: characterKey }) => profileByKey.get(characterKey))
        .filter(Boolean)
    }
  }
  await client.query(
    `UPDATE reader_book_positions
     SET text_offset = ROUND(reading_fraction * $2)::bigint,
         updated_at = now()
     WHERE book_edition_id = $1 AND reading_fraction IS NOT NULL`,
    [bookEditionId, markup.textLength]
  )
  const frontier = await client.query(
    `SELECT COALESCE(MAX(text_offset), 0)::bigint AS text_offset
     FROM reader_book_positions WHERE book_edition_id = $1`,
    [bookEditionId]
  )
  const readerTextOffset = Number(frontier.rows[0]?.text_offset ?? 0)
  // Книга становится доступной читателю ровно здесь: до этого manifest отдаёт
  // «в обработке», а сцены — MARKUP_PROCESSING.
  await client.query(
    `UPDATE book_editions SET status = 'base_ready', updated_at = now()
     WHERE id = $1 AND status IN ('marking_up', 'generating_portraits', 'failed')`,
    [bookEditionId]
  )
  return { edition, markup, markupId, revision, created, readerTextOffset }
}
