import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

function migrationPool() {
  const migrations = new Map()
  const queries = []
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params })
      if (sql.startsWith('SELECT checksum FROM')) {
        const value = migrations.get(params[0])
        return { rows: value ? [{ checksum: value }] : [] }
      }
      if (sql.startsWith('INSERT INTO book_markup_schema_migrations')) {
        migrations.set(params[0], params[1])
      }
      return { rows: [] }
    },
    release() {}
  }
  return {
    queries,
    migrations,
    async connect() { return client }
  }
}

test('migration runner applies each SQL file once under an advisory lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'readany-migrations-'))
  await writeFile(join(directory, '001_first.sql'), 'CREATE TABLE first_table (id int);\n')
  await writeFile(join(directory, '002_second.sql'), 'CREATE TABLE second_table (id int);\n')
  await writeFile(join(directory, 'README.md'), 'ignored')
  const migrationsUrl = new URL('./', pathToFileURL(join(directory, 'placeholder')))
  const pool = migrationPool()
  const logger = { info() {} }

  assert.deepEqual(await runBookMarkupMigrations(pool, { migrationsUrl, logger }), {
    applied: ['001_first.sql', '002_second.sql']
  })
  assert.deepEqual(await runBookMarkupMigrations(pool, { migrationsUrl, logger }), {
    applied: []
  })
  assert.equal(pool.migrations.size, 2)
  assert.match(pool.queries[0].sql, /pg_advisory_lock/)
  assert.ok(pool.queries.some(({ sql }) => sql === 'BEGIN'))
  assert.ok(pool.queries.some(({ sql }) => /pg_advisory_unlock/.test(sql)))
})

test('migration runner stops when an applied file was edited', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'readany-migrations-'))
  const filename = join(directory, '001_first.sql')
  await writeFile(filename, 'SELECT 1;\n')
  const migrationsUrl = new URL('./', pathToFileURL(join(directory, 'placeholder')))
  const pool = migrationPool()
  await runBookMarkupMigrations(pool, { migrationsUrl, logger: { info() {} } })
  await writeFile(filename, 'SELECT 2;\n')
  await assert.rejects(
    () => runBookMarkupMigrations(pool, { migrationsUrl, logger: { info() {} } }),
    /checksum changed/
  )
})

test('migration check reports pending files without applying them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'readany-migrations-check-'))
  await writeFile(join(directory, '001_first.sql'), 'CREATE TABLE first_table (id int);\n')
  const migrationsUrl = new URL('./', pathToFileURL(join(directory, 'placeholder')))
  const pool = migrationPool()

  await assert.rejects(
    () => runBookMarkupMigrations(pool, {
      migrationsUrl,
      logger: { info() {} },
      applyPending: false
    }),
    /pending database migrations: 001_first\.sql/
  )
  assert.equal(pool.migrations.size, 0)
  assert.ok(!pool.queries.some(({ sql }) => sql === 'BEGIN'))
})
