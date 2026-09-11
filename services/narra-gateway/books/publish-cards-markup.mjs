import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { createCardPublicationRunner } from '../analysis/book-card-publication-runner.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

/**
 * Опубликовать разметку книги по её готовым карточкам — сейчас, не дожидаясь
 * следующего окна.
 *
 * Обычно публикацию двигает закрытие окна: пока окно открыто, состав карточек
 * ещё меняется. Но у книги, все окна которой уже закрыты, закрывать больше
 * нечего — а у приватной книги следующее окно открывает читатель, который не
 * может её открыть, пока она не опубликована. Эта команда и разрывает круг.
 *
 * Usage:
 *   node books/publish-cards-markup.mjs --edition UUID [--edition UUID]...
 *   node books/publish-cards-markup.mjs --run UUID
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseArgs(argv) {
  const bookEditionIds = []
  const runIds = []
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]]
    if (value === undefined || !UUID.test(value)) {
      throw Object.assign(new Error(`${name} requires a UUID`), { code: 'USAGE' })
    }
    if (name === '--edition') bookEditionIds.push(value.toLowerCase())
    else if (name === '--run') runIds.push(value.toLowerCase())
    else throw Object.assign(new Error(`unsupported option: ${name}`), { code: 'USAGE' })
  }
  if (!bookEditionIds.length && !runIds.length) {
    throw Object.assign(new Error('usage: --edition UUID | --run UUID'), { code: 'USAGE' })
  }
  return { bookEditionIds, runIds }
}

const { bookEditionIds, runIds } = parseArgs(process.argv.slice(2))
const storage = createBookObjectStorageFromEnv(process.env)
if (!storage) throw new Error('BOOK_STORAGE_BUCKET is required: the publication re-reads the text')
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookMarkupRepository(pool)
  const runner = createCardPublicationRunner({ repository, storage })
  const targets = [...runIds]
  for (const bookEditionId of bookEditionIds) {
    // Последний карточный прогон книги: публикует тот, кто её сейчас разбирает.
    const found = await pool.query(
      `SELECT id FROM book_analysis_runs
        WHERE book_edition_id = $1 AND pipeline_id = 'cards'
        ORDER BY run_sequence DESC, created_at DESC LIMIT 1`,
      [bookEditionId]
    )
    if (!found.rows[0]) {
      console.warn('[cards] карточного прогона нет', { edition: bookEditionId })
      continue
    }
    targets.push(found.rows[0].id)
  }
  for (const runId of targets) {
    const result = await runner.publish({ runId })
    console.info('[cards] публикация', { run: runId, ...result })
  }
} finally {
  await pool.end()
}
