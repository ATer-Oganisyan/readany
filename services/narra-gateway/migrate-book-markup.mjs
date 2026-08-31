import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const pool = await createPostgresPoolFromEnv()
try {
  const result = await runBookMarkupMigrations(pool)
  console.info('[book-markup-migrations] complete', { appliedCount: result.applied.length })
} finally {
  await pool.end()
}
