import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../books/postgres-book-markup-repository.mjs'
import { runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL
const silentLogger = { info() {} }

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function explicitInput({ subjectId, contentSha256, requestId = randomUUID(), suffix = '' }) {
  return {
    subjectId,
    proposedBookEditionId: randomUUID(),
    contentSha256,
    title: `Private book${suffix}`,
    author: 'ReadAny',
    format: 'epub',
    language: 'en',
    intent: 'explicit_import',
    requestId,
    requestFingerprint: hash(`fingerprint:${contentSha256}:${suffix}`)
  }
}

async function withDatabase(fn, { max = 12 } = {}) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max })
  try {
    await runBookMarkupMigrations(pool, { logger: silentLogger })
    return await fn(pool)
  } finally {
    await pool.end()
  }
}

async function cleanupSubject(pool, subjectId) {
  await pool.query('DELETE FROM book_import_requests WHERE owner_subject_id = $1', [subjectId])
  await pool.query('DELETE FROM book_editions WHERE owner_subject_id = $1', [subjectId])
}

test('explicit import uses the canonical pipeline anchor and replaces at the boundary', {
  skip: !connectionString
}, async () => withDatabase(async (pool) => {
  const subjectId = randomUUID()
  const contentSha256 = hash(`canonical-anchor:${subjectId}`)
  const repository = createPostgresBookMarkupRepository(pool, {
    privateBookReimportReuseWindowSeconds: 60,
    analysisPipelineForEdition: () => 'cards'
  })
  try {
    const initial = await repository.registerLocalBook({
      subjectId,
      proposedBookEditionId: randomUUID(),
      contentSha256,
      title: 'Private book',
      author: 'ReadAny',
      format: 'epub'
    })
    await pool.query(
      `UPDATE book_editions
       SET created_at = clock_timestamp() - interval '2 hours',
           updated_at = clock_timestamp(),
           expires_at = clock_timestamp() + interval '7 days'
       WHERE id = $1`,
      [initial.id]
    )
    await pool.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
         input_hash, pipeline_id, pipeline_implementation_version, run_sequence,
         started_at, created_at
       ) VALUES
       ($1, $2, $3, 'cards-v1', 'cards-prompt-v1', $4,
        'cards', 'cards-impl-v1', 1,
        clock_timestamp() - interval '59 seconds', clock_timestamp() - interval '1 minute'),
       ($5, $6, $3, 'narra-v1', 'narra-prompt-v1', $4,
        'narra', 'narra-impl-v1', 99,
        clock_timestamp() - interval '2 hours', clock_timestamp())`,
      [randomUUID(), `cards:${initial.id}`, initial.id, contentSha256,
        randomUUID(), `shadow:${initial.id}`]
    )

    const beforeBoundary = await repository.registerLocalBook(explicitInput({
      subjectId,
      contentSha256,
      suffix: ':before'
    }))
    assert.equal(beforeBoundary.id, initial.id)
    assert.equal(beforeBoundary.importOutcome, 'window_reuse')

    await pool.query(
      `UPDATE book_analysis_runs
       SET started_at = clock_timestamp() - interval '60 seconds'
       WHERE book_edition_id = $1 AND pipeline_id = 'cards'`,
      [initial.id]
    )
    const atBoundary = await repository.registerLocalBook(explicitInput({
      subjectId,
      contentSha256,
      suffix: ':boundary'
    }))
    assert.notEqual(atBoundary.id, initial.id)
    assert.equal(atBoundary.importOutcome, 'replaced')
    assert.equal((await pool.query(
      `SELECT count(*)::int AS count FROM book_editions
       WHERE owner_subject_id = $1 AND content_sha256 = $2`,
      [subjectId, contentSha256]
    )).rows[0].count, 1)
  } finally {
    await cleanupSubject(pool, subjectId)
  }
}))

test('decision time and the replacement creation anchor follow advisory-lock wait', {
  skip: !connectionString
}, async () => withDatabase(async (pool) => {
  const subjectId = randomUUID()
  const contentSha256 = hash(`lock-wait:${subjectId}`)
  const repository = createPostgresBookMarkupRepository(pool, {
    privateBookReimportReuseWindowSeconds: 2,
    analysisPipelineForEdition: () => 'cards'
  })
  const blocker = await pool.connect()
  try {
    const initial = await repository.registerLocalBook({
      subjectId,
      proposedBookEditionId: randomUUID(),
      contentSha256,
      title: 'Lock wait book',
      author: 'ReadAny',
      format: 'epub'
    })
    await pool.query(
      `UPDATE book_editions
       SET created_at = clock_timestamp() - interval '1 second'
       WHERE id = $1`,
      [initial.id]
    )
    const lockName = `private-book:${subjectId}:${contentSha256}`
    await blocker.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName])
    const pending = repository.registerLocalBook(explicitInput({ subjectId, contentSha256 }))
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const releasedAt = Date.now()
    await blocker.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName])

    const replacement = await pending
    assert.notEqual(replacement.id, initial.id)
    const createdAt = new Date((await pool.query(
      'SELECT created_at FROM book_editions WHERE id = $1',
      [replacement.id]
    )).rows[0].created_at).getTime()
    assert.ok(
      createdAt >= releasedAt - 100,
      `replacement created_at ${createdAt} must follow lock release ${releasedAt}`
    )
  } finally {
    await blocker.query('SELECT pg_advisory_unlock_all()').catch(() => {})
    blocker.release()
    await cleanupSubject(pool, subjectId)
  }
}))

test('parallel explicit requests preserve one edition and owner-scoped idempotency', {
  skip: !connectionString
}, async () => withDatabase(async (pool) => {
  const subjectId = randomUUID()
  const otherSubjectId = randomUUID()
  const contentSha256 = hash(`parallel:${subjectId}`)
  const repository = createPostgresBookMarkupRepository(pool, {
    privateBookReimportReuseWindowSeconds: 120,
    analysisPipelineForEdition: () => 'cards'
  })
  try {
    const old = await repository.registerLocalBook({
      subjectId,
      proposedBookEditionId: randomUUID(),
      contentSha256,
      title: 'Old', author: '', format: 'epub'
    })
    await pool.query(
      `UPDATE book_editions SET created_at = clock_timestamp() - interval '10 minutes'
       WHERE id = $1`,
      [old.id]
    )
    const requestId = randomUUID()
    const sameRequest = explicitInput({ subjectId, contentSha256, requestId })
    const [first, replay] = await Promise.all([
      repository.registerLocalBook({ ...sameRequest, proposedBookEditionId: randomUUID() }),
      repository.registerLocalBook({ ...sameRequest, proposedBookEditionId: randomUUID() })
    ])
    assert.equal(first.id, replay.id)
    assert.notEqual(first.id, old.id)
    assert.deepEqual(
      new Set([first.importOutcome, replay.importOutcome]),
      new Set(['replaced', 'idempotent_replay'])
    )

    const [nextA, nextB] = await Promise.all([
      repository.registerLocalBook(explicitInput({ subjectId, contentSha256, suffix: ':a' })),
      repository.registerLocalBook(explicitInput({ subjectId, contentSha256, suffix: ':b' }))
    ])
    assert.equal(nextA.id, first.id)
    assert.equal(nextB.id, first.id)
    assert.equal((await pool.query(
      `SELECT count(*)::int AS count FROM book_editions
       WHERE owner_subject_id = $1 AND content_sha256 = $2`,
      [subjectId, contentSha256]
    )).rows[0].count, 1)

    await assert.rejects(
      repository.registerLocalBook({ ...sameRequest, requestFingerprint: hash('changed') }),
      { code: 'IMPORT_IDEMPOTENCY_CONFLICT', status: 409 }
    )
    const otherOwner = await repository.registerLocalBook(explicitInput({
      subjectId: otherSubjectId,
      contentSha256,
      requestId
    }))
    assert.notEqual(otherOwner.id, first.id)
  } finally {
    await cleanupSubject(pool, subjectId)
    await cleanupSubject(pool, otherSubjectId)
  }
}))

test('replay keeps its private result when catalog appears and expires after target deletion', {
  skip: !connectionString
}, async () => withDatabase(async (pool) => {
  const subjectId = randomUUID()
  const contentSha256 = hash(`catalog-after-private:${subjectId}`)
  const catalogId = randomUUID()
  const repository = createPostgresBookMarkupRepository(pool, {
    privateBookReimportReuseWindowSeconds: 120,
    analysisPipelineForEdition: () => 'cards'
  })
  const request = explicitInput({ subjectId, contentSha256 })
  try {
    const privateResult = await repository.registerLocalBook(request)
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Catalog book', 'ReadAny', 'epub', 'base_ready')`,
      [catalogId, `integration-${catalogId}`, contentSha256]
    )
    const replay = await repository.registerLocalBook({
      ...request,
      proposedBookEditionId: randomUUID()
    })
    assert.equal(replay.id, privateResult.id)
    assert.equal(replay.importOutcome, 'idempotent_replay')

    const newRequest = await repository.registerLocalBook(explicitInput({
      subjectId,
      contentSha256,
      suffix: ':catalog'
    }))
    assert.equal(newRequest.id, catalogId)
    assert.equal(newRequest.scope, 'catalog')
    await pool.query('DELETE FROM book_editions WHERE id = $1', [privateResult.id])
    await assert.rejects(
      repository.registerLocalBook({ ...request, proposedBookEditionId: randomUUID() }),
      { code: 'IMPORT_OPERATION_EXPIRED', status: 410 }
    )
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM book_editions WHERE id = $1',
      [catalogId]
    )).rows[0].count, 1)
  } finally {
    await cleanupSubject(pool, subjectId)
    await pool.query('DELETE FROM book_editions WHERE id = $1', [catalogId])
  }
}))

test('replacement rollback preserves the old edition, source and cleanup visibility', {
  skip: !connectionString
}, async () => withDatabase(async (pool) => {
  const subjectId = randomUUID()
  const contentSha256 = hash(`rollback:${subjectId}`)
  const objectKey = `integration/private-reimport/${subjectId}/source`
  const setup = createPostgresBookMarkupRepository(pool)
  try {
    const old = await setup.registerLocalBook({
      subjectId,
      proposedBookEditionId: randomUUID(),
      contentSha256,
      title: 'Rollback book', author: '', format: 'epub'
    })
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 10, $3, 'ready')`,
      [old.id, objectKey, contentSha256]
    )
    await pool.query(
      `UPDATE book_editions
       SET created_at = clock_timestamp() - interval '10 minutes',
           source_storage = 'temporary'
       WHERE id = $1`,
      [old.id]
    )
    const repository = createPostgresBookMarkupRepository(pool, {
      privateBookReimportReuseWindowSeconds: 1,
      analysisPipelineForEdition: () => 'cards',
      afterPrivateBookReplacement: async () => {
        throw Object.assign(new Error('injected rollback'), { code: 'INJECTED_ROLLBACK' })
      }
    })
    const request = explicitInput({ subjectId, contentSha256 })
    await assert.rejects(repository.registerLocalBook(request), { code: 'INJECTED_ROLLBACK' })
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM book_editions WHERE id = $1',
      [old.id]
    )).rows[0].count, 1)
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM book_files WHERE object_key = $1',
      [objectKey]
    )).rows[0].count, 1)
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM book_object_deletions WHERE object_key = $1',
      [objectKey]
    )).rows[0].count, 0)
    assert.equal((await pool.query(
      `SELECT count(*)::int AS count FROM book_import_requests
       WHERE owner_subject_id = $1 AND request_id = $2`,
      [subjectId, request.requestId]
    )).rows[0].count, 0)
  } finally {
    await cleanupSubject(pool, subjectId)
  }
}))

test('migration upgrades the previous schema with data and is rerunnable', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const admin = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const schema = `reimport_${randomUUID().replaceAll('-', '')}`
  const temporaryMigrations = await mkdtemp(join(tmpdir(), 'narra-reimport-migrations-'))
  let pool
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new pg.Pool({
      connectionString,
      ssl: false,
      max: 2,
      options: `-c search_path=${schema}`
    })
    const migrationsUrl = new URL('../migrations/', import.meta.url)
    const filenames = (await readdir(migrationsUrl))
      .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/.test(filename) && filename < '038_')
      .sort()
    for (const filename of filenames) {
      await copyFile(new URL(filename, migrationsUrl), join(temporaryMigrations, filename))
    }
    await runBookMarkupMigrations(pool, {
      migrationsUrl: pathToFileURL(`${temporaryMigrations}/`),
      logger: silentLogger
    })
    const subjectId = randomUUID()
    const privateId = randomUUID()
    const catalogId = randomUUID()
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, owner_subject_id, catalog_key, content_sha256,
         title, author, format, status, source_storage, expires_at
       ) VALUES
       ($1, 'private', $2, NULL, $3, 'Private', '', 'epub',
        'base_ready', 'temporary', clock_timestamp() + interval '1 day'),
       ($4, 'catalog', NULL, $5, $6, 'Catalog', '', 'epub',
        'base_ready', 'stored', NULL)`,
      [privateId, subjectId, hash('upgrade-private'), catalogId,
        `upgrade-${catalogId}`, hash('upgrade-catalog')]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 10, $3, 'ready')`,
      [privateId, `upgrade/${privateId}/source`, hash('upgrade-private')]
    )

    const upgraded = await runBookMarkupMigrations(pool, { logger: silentLogger })
    assert.deepEqual(upgraded.applied, ['038_private_book_import_requests.sql'])
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM book_editions')).rows[0].count, 2)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM book_files')).rows[0].count, 1)
    assert.deepEqual(
      (await runBookMarkupMigrations(pool, { logger: silentLogger })).applied,
      []
    )
  } finally {
    await pool?.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    await admin.end()
    await rm(temporaryMigrations, { recursive: true, force: true })
  }
})
