import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IMPORT_SOURCE_HOSTS,
  fetchImportSource,
  importSourceFailure
} from '../import-source.mjs'

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

test('fanfic import source allowlist covers AO3, Ficbook and Ficbook covers', () => {
  assert.equal(IMPORT_SOURCE_HOSTS.has('archiveofourown.org'), true)
  assert.equal(IMPORT_SOURCE_HOSTS.has('download.archiveofourown.org'), true)
  assert.equal(IMPORT_SOURCE_HOSTS.has('ficbook.net'), true)
  assert.equal(IMPORT_SOURCE_HOSTS.has('assets.teinon.net'), true)
})

test('AO3 homepage is fetched server-side with browser headers', async () => {
  let request
  const response = await fetchImportSource('https://archiveofourown.org/?ref=website-popularity', {
    lookupImpl: publicLookup,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init }
      return new Response('<title>Home | Archive of Our Own</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    },
    delayImpl: async () => {}
  })

  assert.equal(response.status, 200)
  assert.equal(request.url, 'https://archiveofourown.org/?ref=website-popularity')
  assert.match(request.init.headers['User-Agent'], /Mozilla/)
  assert.equal(request.init.headers.Referer, 'https://archiveofourown.org/')
})

test('temporary source failures retry and eventual success is returned', async () => {
  const statuses = [429, 500, 200]
  const delays = []
  const response = await fetchImportSource('https://ficbook.net/readfic/123', {
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response('body', { status: statuses.shift() }),
    delayImpl: async (ms) => delays.push(ms)
  })

  assert.equal(response.status, 200)
  assert.deepEqual(delays, [4_000, 8_000])
})

test('source failures preserve actionable HTTP semantics', () => {
  assert.deepEqual(importSourceFailure(403), { status: 429, code: 'RATE' })
  assert.deepEqual(importSourceFailure(429), { status: 429, code: 'RATE' })
  assert.deepEqual(importSourceFailure(404), { status: 404, code: 'NOT_FOUND' })
  assert.deepEqual(importSourceFailure(500), { status: 502, code: 'NETWORK' })
})

test('invalid source URL is a client validation error', async () => {
  await assert.rejects(
    () => fetchImportSource('not a url'),
    (error) => error.status === 400 && error.code === 'VALIDATION'
  )
})
