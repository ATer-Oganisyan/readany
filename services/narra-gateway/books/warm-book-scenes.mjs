import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

/**
 * Прогреть сцены книги до позиции читателя — сейчас, не дожидаясь его шага.
 *
 * Обычно пачку двигает сам читатель: `advanceProgress` зовёт
 * `ensureBookScenesThrough`, когда включён `BOOK_SCENE_PREGENERATION=reader`.
 * Но первую пачку кто-то должен поставить, а книга могла стоять с тех пор, как
 * очередь сцен чистили руками: слоты в ней остались `failed`, и фоновый
 * подогрев их не трогает.
 *
 * Приоритет 70 и выше — это и есть «оператор просит»: с ним провалившийся слот
 * внутри фронтира возвращается в очередь. Фоновая пачка (45) молчит и только
 * сообщает, сколько слотов лежит.
 *
 * Usage:
 *   node books/warm-book-scenes.mjs --edition UUID [--reader-offset N] [--priority N] [--mode reader|book]
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseArgs(argv) {
  const bookEditionIds = []
  let readerTextOffset = null
  let priority = 70
  let mode = 'reader'
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]]
    if (value === undefined) {
      throw Object.assign(new Error(`${name} requires a value`), { code: 'USAGE' })
    }
    if (name === '--edition') {
      if (!UUID.test(value)) {
        throw Object.assign(new Error(`--edition: invalid UUID: ${value}`), { code: 'USAGE' })
      }
      bookEditionIds.push(value.toLowerCase())
    } else if (name === '--reader-offset') {
      readerTextOffset = Number(value)
      if (!Number.isSafeInteger(readerTextOffset) || readerTextOffset < 0) {
        throw Object.assign(new Error('--reader-offset must be a non-negative integer'), { code: 'USAGE' })
      }
    } else if (name === '--priority') {
      priority = Number(value)
      if (!Number.isSafeInteger(priority) || priority < 1 || priority > 100) {
        throw Object.assign(new Error('--priority must be between 1 and 100'), { code: 'USAGE' })
      }
    } else if (name === '--mode') {
      if (value !== 'reader' && value !== 'book') {
        throw Object.assign(new Error('--mode must be reader or book'), { code: 'USAGE' })
      }
      mode = value
    } else {
      throw Object.assign(new Error(`unsupported option: ${name}`), { code: 'USAGE' })
    }
  }
  if (!bookEditionIds.length) {
    throw Object.assign(
      new Error('usage: --edition UUID [--reader-offset N] [--priority N]'),
      { code: 'USAGE' }
    )
  }
  return { bookEditionIds: [...new Set(bookEditionIds)], readerTextOffset, priority, mode }
}

const { bookEditionIds, readerTextOffset, priority, mode } = parseArgs(process.argv.slice(2))
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookMarkupRepository(pool)
  for (const bookEditionId of bookEditionIds) {
    // Позиция берётся самая дальняя среди читателей книги: пачка общая, и
    // держать её по отстающему значит не показать картинки тем, кто ушёл вперёд.
    const reader = await pool.query(
      `SELECT COALESCE(MAX(text_offset), 0)::bigint AS text_offset,
              count(*)::int AS readers
         FROM reader_book_positions WHERE book_edition_id = $1`,
      [bookEditionId]
    )
    const offset = readerTextOffset ?? Number(reader.rows[0]?.text_offset ?? 0)
    const subject = await pool.query(
      `SELECT subject_id FROM reader_book_positions
        WHERE book_edition_id = $1 ORDER BY text_offset DESC LIMIT 1`,
      [bookEditionId]
    )
    // Режим задаётся явно: команда — это осознанная просьба оператора, и она
    // должна работать даже там, где фоновый подогрев выключен.
    const result = await repository.ensureBookScenesThrough({
      subjectId: subject.rows[0]?.subject_id ?? null,
      bookEditionId,
      readerTextOffset: offset,
      priority,
      mode
    })
    console.info('[book-scenes] пачка прогрета', {
      edition: bookEditionId,
      readers: Number(reader.rows[0]?.readers ?? 0),
      reader_text_offset: offset,
      priority,
      mode,
      ...result
    })
  }
} finally {
  await pool.end()
}
