import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

/**
 * Дозаказать недостающее медиа персонажам, чей бандл так и не собрался.
 *
 * Раньше это делал сам шлюз на каждом старте. Бандл, который однажды не
 * досчитался артефакта, остаётся незавершённым навсегда, поэтому подогрев брал
 * его снова и снова: три деплоя подряд вылились в тысячу заказанных портретов
 * по книгам, которых никто не читал. Теперь это осознанная просьба оператора —
 * с видимым числом и лимитом, а не тихая работа по факту перезапуска.
 *
 * Usage:
 *   node books/backfill-character-media.mjs [--limit N] [--priority N] [--dry-run]
 */
function parseArgs(argv) {
  let limit = 100
  let priority = 40
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--dry-run') {
      dryRun = true
      continue
    }
    const value = argv[index + 1]
    index += 1
    if (value === undefined) {
      throw Object.assign(new Error(`${name} requires a value`), { code: 'USAGE' })
    }
    if (name === '--limit') {
      limit = Number(value)
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw Object.assign(new Error('--limit must be between 1 and 10000'), { code: 'USAGE' })
      }
    } else if (name === '--priority') {
      priority = Number(value)
      if (!Number.isSafeInteger(priority) || priority < 1 || priority > 100) {
        throw Object.assign(new Error('--priority must be between 1 and 100'), { code: 'USAGE' })
      }
    } else {
      throw Object.assign(new Error(`unsupported option: ${name}`), { code: 'USAGE' })
    }
  }
  return { limit, priority, dryRun }
}

const { limit, priority, dryRun } = parseArgs(process.argv.slice(2))
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  if (dryRun) {
    // Сухой прогон считает кандидатов тем же условием, что и сам подогрев:
    // бандл отсутствует или не готов. Он ничего не ставит в очередь.
    const pending = await pool.query(
      `SELECT count(*)::int AS candidates
         FROM book_markup_versions AS markup
         JOIN book_characters AS character ON character.markup_version_id = markup.id
         LEFT JOIN character_media_bundles AS bundle
           ON bundle.book_edition_id = markup.book_edition_id
          AND bundle.character_key = character.character_key
        WHERE markup.status = 'published'
          AND (bundle.id IS NULL OR bundle.status <> 'ready')`
    )
    console.info('[character-media] сухой прогон', {
      candidates: Number(pending.rows[0]?.candidates ?? 0),
      limit,
      priority
    })
  } else {
    const repository = createPostgresBookMarkupRepository(pool)
    const jobs = await repository.enqueueCharacterMediaBackfill({ limit, priority })
    console.info('[character-media] подогрев выполнен', {
      jobs: jobs.length,
      created: jobs.filter((job) => job.created).length,
      limit,
      priority
    })
  }
} finally {
  await pool.end()
}
