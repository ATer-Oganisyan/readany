import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { parseEnvInt } from './env.mjs'

const MIGRATION_LOCK_NAME = 'readany_book_markup_migrations'

function databaseSsl(env, connectionString) {
  const mode = String(
    env.DATABASE_SSL_MODE || (env.NODE_ENV === 'production' ? 'verify-full' : 'disable')
  ).trim().toLowerCase()
  if (!['disable', 'require', 'verify-full'].includes(mode)) {
    throw new Error('DATABASE_SSL_MODE must be disable, require or verify-full')
  }
  if (mode === 'verify-full') return { rejectUnauthorized: true }
  if (mode === 'require') return { rejectUnauthorized: false }

  const hostname = new URL(connectionString).hostname
  const privateDatabase = hostname === 'localhost' || hostname === '127.0.0.1' ||
    hostname.endsWith('.railway.internal')
  if (env.NODE_ENV === 'production' && !privateDatabase) {
    throw new Error('DATABASE_SSL_MODE=disable is only allowed for private production hosts')
  }
  return false
}

export async function createPostgresPoolFromEnv(env = process.env) {
  const connectionString = String(env.DATABASE_URL || '').trim()
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const url = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://')
  }
  const { default: pg } = await import('pg')
  return new pg.Pool({
    connectionString,
    ssl: databaseSsl(env, connectionString),
    max: parseEnvInt(env, 'DATABASE_POOL_MAX', 10, 100),
    connectionTimeoutMillis: parseEnvInt(
      env,
      'DATABASE_CONNECT_TIMEOUT_MS',
      10_000,
      120_000
    ),
    application_name: env.BOOK_IDENTITY_WORKER_ID || env.BOOK_MARKUP_WORKER_ID ||
      'readany-book-markup'
  })
}

function checksum(value) {
  return createHash('sha256').update(value).digest('hex')
}

export async function runBookMarkupMigrations(
  pool,
  {
    migrationsUrl = new URL('./migrations/', import.meta.url),
    logger = console,
    applyPending = process.env.DATABASE_AUTO_MIGRATE !== 'false'
  } = {}
) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [MIGRATION_LOCK_NAME])
    await client.query(
      `CREATE TABLE IF NOT EXISTS book_markup_schema_migrations (
         filename TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    )
    const filenames = (await readdir(migrationsUrl, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d+_[a-z0-9_]+\.sql$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()

    const applied = []
    const pending = []
    for (const filename of filenames) {
      const sql = await readFile(new URL(filename, migrationsUrl), 'utf8')
      const sqlChecksum = checksum(sql)
      const existing = await client.query(
        'SELECT checksum FROM book_markup_schema_migrations WHERE filename = $1',
        [filename]
      )
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== sqlChecksum) {
          throw new Error(`applied migration checksum changed: ${filename}`)
        }
        continue
      }
      if (!applyPending) {
        pending.push(filename)
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          `INSERT INTO book_markup_schema_migrations (filename, checksum)
           VALUES ($1, $2)`,
          [filename, sqlChecksum]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }
      logger.info?.('[book-markup-migrations] applied', { filename })
      applied.push(filename)
    }
    if (pending.length) {
      throw new Error(
        `pending database migrations: ${pending.join(', ')}; run migrate.sh before deploy`
      )
    }
    return { applied }
  } finally {
    await client.query(
      'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
      [MIGRATION_LOCK_NAME]
    ).catch(() => {})
    client.release()
  }
}
