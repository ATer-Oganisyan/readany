import { parseEnvInt } from '../platform/env.mjs'
import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

/**
 * Повтор провалившихся заданий генерации.
 *
 * Без аргументов берёт самые старые провалы очереди — так он и работал всегда.
 * Аргументы сужают выборку: на установке с десятками тысяч старых провалов
 * «повторить три задания этой книги» иначе не выразить, и остаётся ручной
 * UPDATE по продовой базе.
 *
 * Usage:
 *   node books/retry-failed-book-generation.mjs [--job-type TYPE]... [--edition UUID]... [--limit N]
 */
function parseArgs(argv) {
  const jobTypes = []
  const bookEditionIds = []
  let limit = null
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (value === undefined) throw Object.assign(new Error(`${name} requires a value`), { code: 'USAGE' })
    if (name === '--job-type') jobTypes.push(value)
    else if (name === '--edition') bookEditionIds.push(value)
    else if (name === '--limit') limit = Number(value)
    else throw Object.assign(new Error(`unsupported option: ${name}`), { code: 'USAGE' })
  }
  return {
    jobTypes: jobTypes.length ? jobTypes : null,
    bookEditionIds: bookEditionIds.length ? bookEditionIds : null,
    limit
  }
}

const selector = parseArgs(process.argv.slice(2))
const limit = selector.limit ?? parseEnvInt(process.env, 'BOOK_GENERATION_RETRY_BATCH_SIZE', 100, 1_000)
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookMarkupRepository(pool)
  const jobs = await repository.retryFailedGenerationJobs({
    limit,
    jobTypes: selector.jobTypes,
    bookEditionIds: selector.bookEditionIds
  })
  console.info('[book-generation-retry] complete', {
    retried: jobs.length,
    job_types: selector.jobTypes,
    editions: selector.bookEditionIds
  })
} finally {
  await pool.end()
}
