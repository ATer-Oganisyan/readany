import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('PostgreSQL upload preflight is tenant-scoped, private-only, expiry-aware and read-only', {
  skip: !connectionString, timeout: 30_000
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  const subjectId = randomUUID()
  const ids = [randomUUID(), randomUUID(), randomUUID()]
  const hash = (id) => createHash('sha256').update(id).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    for (const [index, id] of ids.entries()) {
      await pool.query(`INSERT INTO book_editions (
        id, scope, catalog_key, owner_subject_id, content_sha256, title, author, format,
        status, source_storage, expires_at
      ) VALUES ($1, $2, $3, $4, $5, 'Upload preflight fixture', '', 'txt', 'marking_up', $6, $7)`,
      [id, index === 2 ? 'catalog' : 'private', index === 2 ? `upload-${id}` : null,
        index === 2 ? null : subjectId, hash(id), index === 2 ? 'stored' : 'temporary',
        index === 2 ? null : new Date(Date.now() + (index === 1 ? -86_400_000 : 86_400_000))])
    }
    const repository = createPostgresBookMarkupRepository(pool)
    const snapshot = async () => (await pool.query(
      'SELECT to_jsonb(edition) AS data FROM book_editions edition WHERE id = ANY($1::uuid[]) ORDER BY id', [ids]
    )).rows
    const before = await snapshot()
    assert.equal(await repository.canUploadPrivateBookSource({ subjectId, bookEditionId: ids[0] }), true)
    assert.equal(await repository.canUploadPrivateBookSource({ subjectId: randomUUID(), bookEditionId: ids[0] }), false)
    assert.equal(await repository.canUploadPrivateBookSource({ subjectId, bookEditionId: ids[1] }), false)
    assert.equal(await repository.canUploadPrivateBookSource({ subjectId, bookEditionId: ids[2] }), false)
    assert.equal(await repository.canUploadPrivateBookSource({ subjectId, bookEditionId: randomUUID() }), false)
    assert.deepEqual(await snapshot(), before, 'preflight must not renew TTL or mutate metadata')

    // Authorization is checked again under the actual upload transaction.
    await pool.query("UPDATE book_editions SET expires_at = now() - interval '1 second' WHERE id = $1", [ids[0]])
    assert.equal(await repository.beginPrivateBookUpload({ subjectId, bookEditionId: ids[0],
      contentSha256: hash(ids[0]), objectKey: `upload-test/${ids[0]}`, mimeType: 'text/plain', byteSize: 4
    }), null)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM book_files WHERE book_edition_id = ANY($1::uuid[])', [ids])).rows[0].count, 0)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = ANY($1::uuid[])', [ids])
    await pool.end()
  }
})
