import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'

const baseUrl = String(process.env.BOOK_REIMPORT_E2E_BASE_URL || '').replace(/\/$/, '')
const databaseUrl = process.env.BOOK_REIMPORT_E2E_DATABASE_URL
const enabled = baseUrl && databaseUrl

async function json(response) {
  const body = await response.json()
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`), {
      status: response.status,
      body
    })
  }
  return body
}

test('running gateway applies explicit intent, real window and durable replay', {
  skip: !enabled
}, async () => {
  const installationId = randomUUID()
  const installationSecret = randomBytes(48).toString('base64url')
  const source = Buffer.from('Local gateway explicit reimport API fixture.')
  const contentSha256 = createHash('sha256').update(source).digest('hex')
  const payload = {
    content_sha256: contentSha256,
    title: 'Gateway reimport E2E',
    author: 'ReadAny',
    format: 'txt',
    language: 'en',
    intent: 'explicit_import'
  }
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 2 })
  try {
    const registration = await json(await fetch(`${baseUrl}/v2/installations/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        installation_secret: installationSecret,
        app_version: 'private-reimport-e2e',
        platform: 'test',
        arch: process.arch
      })
    }))
    const headers = {
      authorization: `Bearer ${registration.token}`,
      'content-type': 'application/json'
    }
    const postLocal = (requestId, body = payload) => fetch(`${baseUrl}/v2/books/local`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': requestId },
      body: JSON.stringify(body)
    })

    const firstKey = randomUUID()
    const first = await json(await postLocal(firstKey))
    assert.equal(first.resolution, 'private')
    assert.equal(Object.hasOwn(first, 'source_uploaded'), false)
    const upload = await fetch(`${baseUrl}/v2/books/${first.book_edition_id}/source`, {
      method: 'PUT',
      headers: {
        authorization: headers.authorization,
        'content-type': 'text/plain'
      },
      body: source
    })
    assert.equal(upload.status, 202)
    const repeatUpload = await fetch(`${baseUrl}/v2/books/${first.book_edition_id}/source`, {
      method: 'PUT',
      headers: {
        authorization: headers.authorization,
        'content-type': 'text/plain'
      },
      body: source
    })
    assert.equal(repeatUpload.status, 202)
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM book_analysis_runs WHERE book_edition_id = $1',
      [first.book_edition_id]
    )).rows[0].count, 1)

    const withinWindow = await json(await postLocal(randomUUID()))
    assert.equal(withinWindow.book_edition_id, first.book_edition_id)
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    const replacementKey = randomUUID()
    const replacement = await json(await postLocal(replacementKey))
    assert.notEqual(replacement.book_edition_id, first.book_edition_id)

    const replay = await json(await postLocal(replacementKey))
    assert.equal(replay.book_edition_id, replacement.book_edition_id)
    const expired = await postLocal(firstKey)
    assert.equal(expired.status, 410)
    assert.equal((await expired.json()).code, 'IMPORT_OPERATION_EXPIRED')

    const conflict = await postLocal(replacementKey, { ...payload, title: 'Changed payload' })
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).code, 'IMPORT_IDEMPOTENCY_CONFLICT')

    const legacy = await json(await fetch(`${baseUrl}/v2/books/local`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content_sha256: contentSha256,
        title: payload.title,
        author: payload.author,
        format: payload.format,
        language: payload.language
      })
    }))
    assert.equal(legacy.book_edition_id, replacement.book_edition_id)
    assert.equal((await pool.query(
      `SELECT count(*)::int AS count FROM book_editions
       WHERE owner_subject_id = $1 AND content_sha256 = $2`,
      [installationId, contentSha256]
    )).rows[0].count, 1)
  } finally {
    await pool.query('DELETE FROM book_import_requests WHERE owner_subject_id = $1', [installationId])
      .catch(() => {})
    await pool.query('DELETE FROM book_editions WHERE owner_subject_id = $1', [installationId])
      .catch(() => {})
    await pool.end()
  }
})
