import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'
import express from 'express'
import { createBookOperatorRouter } from '../book-operator-api.mjs'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const PASSWORD = 'operator-password-with-32-characters'
const AUTH = `Basic ${Buffer.from(`narra:${PASSWORD}`).toString('base64')}`

function dependencies(overrides = {}) {
  const calls = []
  return {
    calls,
    dashboardRepository: {
      async listBooks() {
        return [{ id: BOOK_ID, title: 'Медный всадник', progress: { percent: 42 } }]
      },
      async getBookDetails(bookEditionId) {
        return bookEditionId === BOOK_ID
          ? { book: { id: BOOK_ID, title: 'Медный всадник' }, characters: [] }
          : null
      },
      async getBookJson(bookEditionId) {
        return bookEditionId === BOOK_ID
          ? { analysisVersion: 'book-markup-v3', markup: { characters: [] } }
          : null
      },
      async getBookOperations(bookEditionId) {
        return bookEditionId === BOOK_ID
          ? [{ kind: 'analysis_job', stage: 'scan', status: 'running' }]
          : null
      }
    },
    catalogService: {
      async begin(input) {
        calls.push(['begin', input])
        return { bookEditionId: BOOK_ID, uploadRequired: true }
      },
      async upload(bookEditionId, bytes, contentType) {
        calls.push(['upload', bookEditionId, bytes.toString(), contentType])
        return { bookEditionId, byteSize: bytes.byteLength }
      },
      async complete(bookEditionId) {
        calls.push(['complete', bookEditionId])
        return { bookEditionId, analysisRunId: '22222222-2222-4222-8222-222222222222' }
      },
      async beginCover() { throw new Error('not used') },
      async uploadCover() { throw new Error('not used') },
      async completeCover() { throw new Error('not used') }
    },
    analysisRepository: {
      async restartAnalysisRun(input) {
        calls.push(['restart-analysis', input])
        return {
          created: true,
          run: {
            id: '55555555-5555-4555-8555-555555555555',
            bookEditionId: BOOK_ID,
            runSequence: 2,
            stage: 'prepare',
            status: 'queued'
          },
          prepareJob: { id: '66666666-6666-4666-8666-666666666666', status: 'queued' }
        }
      }
    },
    ...overrides
  }
}

async function withServer(input, operation) {
  const app = express()
  app.use('/operator', createBookOperatorRouter({
    username: 'narra',
    password: PASSWORD,
    ...input
  }))
  const server = http.createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    await operation(`http://127.0.0.1:${address.port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('operator UI and every API endpoint require the configured browser password', async () => {
  const input = dependencies()
  await withServer(input, async (baseUrl) => {
    for (const path of ['/operator/', '/operator/review', '/operator/api/books']) {
      const missing = await fetch(`${baseUrl}${path}`)
      assert.equal(missing.status, 401)
      assert.match(missing.headers.get('www-authenticate'), /^Basic /)
      assert.equal(missing.headers.get('cache-control'), 'no-store')
    }
    const invalid = await fetch(`${baseUrl}/operator/api/books`, {
      headers: { authorization: `Basic ${Buffer.from('narra:wrong').toString('base64')}` }
    })
    assert.equal(invalid.status, 401)
  })
})

test('operator UI exposes live book summaries, details, operations and formatted JSON data', async () => {
  const input = dependencies()
  await withServer(input, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/operator/`, { headers: { authorization: AUTH } })
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /^text\/html/)
    const html = await page.text()
    assert.match(html, /Разметка книг/)
    assert.match(html, /<script defer src="\.\/assets\/app\.js"><\/script>/)
    assert.doesNotMatch(html, /type="module"/)
    assert.match(html, />Перезапустить v3</)
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)

    const review = await fetch(`${baseUrl}/operator/review`, {
      headers: { authorization: AUTH }
    })
    assert.equal(review.status, 200)
    const reviewHtml = await review.text()
    assert.match(reviewHtml, /Проверка разметки/)
    assert.match(reviewHtml, /\.\/assets\/review\.js/)

    const reviewScript = await fetch(`${baseUrl}/operator/assets/review.js`, {
      headers: { authorization: AUTH }
    })
    assert.equal(reviewScript.status, 200)
    assert.match(await reviewScript.text(), /Характер не заполнен/)

    const sample = await fetch(`${baseUrl}/operator/assets/sample-book-markup-v3.json`, {
      headers: { authorization: AUTH }
    })
    assert.equal(sample.status, 200)
    assert.equal((await sample.json()).publication.data.markup.analysisVersion, 'book-markup-v3')

    const styles = await fetch(`${baseUrl}/operator/assets/styles.css`, {
      headers: { authorization: AUTH }
    })
    assert.equal(styles.status, 200)
    const css = await styles.text()
    assert.match(css, /mishanaer\/deslop primitives/)
    assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/)
    assert.match(css, /\.book-row-title\s*\{[^}]*display:\s*block;/s)

    const script = await fetch(`${baseUrl}/operator/assets/app.js`, {
      headers: { authorization: AUTH }
    })
    assert.equal(script.status, 200)
    const scriptText = await script.text()
    assert.doesNotMatch(scriptText, /^await refresh\(\)$/m)
    assert.match(scriptText, /books\/\$\{state\.selectedId\}\/restart/)
    assert.match(scriptText, /characterAppearance/)
    assert.match(scriptText, /Подозрительно раннее открытие/)

    const books = await fetch(`${baseUrl}/operator/api/books`, {
      headers: { authorization: AUTH }
    })
    assert.deepEqual(await books.json(), {
      books: [{ id: BOOK_ID, title: 'Медный всадник', progress: { percent: 42 } }]
    })

    const detail = await fetch(`${baseUrl}/operator/api/books/${BOOK_ID}`, {
      headers: { authorization: AUTH }
    })
    assert.equal((await detail.json()).book.title, 'Медный всадник')

    const operations = await fetch(`${baseUrl}/operator/api/books/${BOOK_ID}/operations`, {
      headers: { authorization: AUTH }
    })
    assert.equal((await operations.json()).operations[0].stage, 'scan')

    const json = await fetch(`${baseUrl}/operator/api/books/${BOOK_ID}/json`, {
      headers: { authorization: AUTH }
    })
    assert.equal((await json.json()).analysisVersion, 'book-markup-v3')
  })
})

test('operator can safely start a new v3 run for one selected book', async () => {
  const input = dependencies()
  await withServer(input, async (baseUrl) => {
    const restarted = await fetch(`${baseUrl}/operator/api/books/${BOOK_ID}/restart`, {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: '{}'
    })
    assert.equal(restarted.status, 202)
    const body = await restarted.json()
    assert.equal(body.created, true)
    assert.equal(body.run.runSequence, 2)
    assert.deepEqual(input.calls, [[
      'restart-analysis',
      { bookEditionId: BOOK_ID, priority: 100 }
    ]])
  })
})

test('web upload calls the same catalog service sequence as the command endpoint', async () => {
  const input = dependencies()
  await withServer(input, async (baseUrl) => {
    const prepared = await fetch(`${baseUrl}/operator/api/uploads`, {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({
        catalog_key: 'copper-horseman',
        content_sha256: 'a'.repeat(64),
        title: 'Медный всадник',
        author: 'А. С. Пушкин',
        format: 'epub',
        byte_size: 10
      })
    })
    assert.equal(prepared.status, 201)

    const uploaded = await fetch(`${baseUrl}/operator/api/uploads/${BOOK_ID}/content`, {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/epub+zip' },
      body: '0123456789'
    })
    assert.equal(uploaded.status, 201)

    const completed = await fetch(`${baseUrl}/operator/api/uploads/${BOOK_ID}/complete`, {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: '{}'
    })
    assert.equal(completed.status, 202)
    assert.deepEqual(input.calls.map(([name]) => name), ['begin', 'upload', 'complete'])
    assert.equal(input.calls[0][1].catalogKey, 'copper-horseman')
    assert.equal(input.calls[1][3], 'application/epub+zip')
  })
})

test('operator API validates identifiers and reports missing books without leaking internals', async () => {
  const input = dependencies()
  await withServer(input, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/operator/api/books/not-a-uuid`, {
      headers: { authorization: AUTH }
    })
    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json()).code, 'VALIDATION')

    const missing = await fetch(
      `${baseUrl}/operator/api/books/33333333-3333-4333-8333-333333333333`,
      { headers: { authorization: AUTH } }
    )
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).code, 'NOT_FOUND')
  })
})
