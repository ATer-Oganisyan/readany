import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const unknown = args.filter((arg) => arg !== '--check')

if (unknown.length) {
  throw new Error(`unknown migration option: ${unknown.join(', ')}`)
}

const pool = await createPostgresPoolFromEnv(process.env)
try {
  const result = await runBookMarkupMigrations(pool, { applyPending: !checkOnly })
  if (checkOnly) {
    console.log('Database migrations are current')
  } else if (result.applied.length) {
    console.log(`Applied database migrations: ${result.applied.join(', ')}`)
  } else {
    console.log('No pending database migrations')
  }
} finally {
  await pool.end()
}
