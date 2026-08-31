import { BOOK_MARKUP_ANALYSIS_VERSION } from './book-markup.mjs'
import { parseEnvInt } from './env.mjs'
import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const batchSize = parseEnvInt(process.env, 'BOOK_MARKUP_BACKFILL_BATCH_SIZE', 100, 1_000)
const pool = await createPostgresPoolFromEnv(process.env)
let queued = 0
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookMarkupRepository(pool)
  while (true) {
    const jobs = await repository.enqueueBookMarkupBackfill({ limit: batchSize })
    queued += jobs.filter((job) => job.created).length
    if (jobs.length < batchSize) break
  }
  console.info('[book-markup-backfill] complete', {
    analysisVersion: BOOK_MARKUP_ANALYSIS_VERSION,
    queued
  })
} finally {
  await pool.end()
}
