import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

/**
 * Продвинуть цепочку окон карточек вручную.
 *
 * В обычной жизни цепочку двигают воркеры: окно закрывает тот, кто закончил
 * его последнюю карточку, а полный заход по книге — тот, кого цепочка ждала.
 * Но книга может остаться стоять — например, её карточки упали, пока цепочки
 * не было вовсе, — и тогда сдвинуть её нечем: перезапуск прогона карточек не
 * помогает, он возвращает тот же прогон.
 *
 * Команда ничего не решает за цепочку: окно ставится по тем же правилам —
 * предыдущее закрыто, состав книги подтверждён, читатель не позади.
 *
 * Usage:
 *   node books/advance-card-windows.mjs --edition UUID [--edition UUID]...
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseArgs(argv) {
  const bookEditionIds = []
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]]
    if (name !== '--edition' || !value) {
      throw Object.assign(new Error('usage: --edition UUID [--edition UUID]...'), { code: 'USAGE' })
    }
    if (!UUID.test(value)) {
      throw Object.assign(new Error(`--edition: invalid UUID: ${value}`), { code: 'USAGE' })
    }
    bookEditionIds.push(value.toLowerCase())
  }
  if (!bookEditionIds.length) {
    throw Object.assign(new Error('usage: --edition UUID [--edition UUID]...'), { code: 'USAGE' })
  }
  return [...new Set(bookEditionIds)]
}

const editions = parseArgs(process.argv.slice(2))
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookMarkupRepository(pool)
  for (const bookEditionId of editions) {
    // Берётся последний прогон карточек книги: у книги может лежать и прогон
    // прежнего конвейера, и двигать его окна незачем — их у него нет.
    const run = await pool.query(
      `SELECT id FROM book_analysis_runs
        WHERE book_edition_id = $1 AND pipeline_id = 'cards'
        ORDER BY created_at DESC, run_sequence DESC
        LIMIT 1`,
      [bookEditionId]
    )
    const runId = run.rows[0]?.id
    if (!runId) {
      console.info('[card-windows] прогона карточек нет', { edition: bookEditionId })
      continue
    }
    const advanced = await repository.advanceCardWindows({ runId, bookEditionId })
    console.info('[card-windows] окна продвинуты', {
      edition: bookEditionId,
      run: runId,
      closed: advanced.closed,
      enqueued_window: advanced.enqueued?.windowIndex ?? null,
      enqueued_cards: advanced.enqueued?.created ?? 0,
      waiting_for_book_roster: advanced.waitingForBookRoster ?? false
    })
  }
} finally {
  await pool.end()
}
