import { parseEnvInt } from './env.mjs'
import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const limit = parseEnvInt(process.env, 'BOOK_GENERATION_RETRY_BATCH_SIZE', 100, 1_000)
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookMarkupRepository(pool)
  const jobs = await repository.retryFailedGenerationJobs({ limit })
  console.info('[book-generation-retry] complete', { retried: jobs.length })
} finally {
  await pool.end()
}
