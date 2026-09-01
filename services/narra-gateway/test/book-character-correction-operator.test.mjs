import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  parseBookCharacterCorrectionCommand,
  runBookCharacterCorrectionCommand
} from '../book-character-correction-operator.mjs'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const HASH = 'a'.repeat(64)

test('operator CLI keeps preview, draft staging and activation as separate commands', () => {
  assert.deepEqual(parseBookCharacterCorrectionCommand(['inspect', '--book', BOOK_ID]), {
    command: 'inspect', bookEditionId: BOOK_ID, file: null, documentHash: null
  })
  assert.deepEqual(parseBookCharacterCorrectionCommand([
    'stage', '--book', BOOK_ID, '--file', 'book.json'
  ]), {
    command: 'stage', bookEditionId: BOOK_ID, file: 'book.json', documentHash: null
  })
  assert.deepEqual(parseBookCharacterCorrectionCommand([
    'enable', '--book', BOOK_ID, '--hash', HASH
  ]), {
    command: 'enable', bookEditionId: BOOK_ID, file: null, documentHash: HASH
  })
  assert.throws(
    () => parseBookCharacterCorrectionCommand([
      'stage', '--book', BOOK_ID, '--file', 'book.json', '--hash', HASH
    ]),
    /--hash is not allowed/
  )
  assert.throws(
    () => parseBookCharacterCorrectionCommand(['enable', '--book', BOOK_ID, '--hash', 'force']),
    /invalid SHA-256/
  )
})

test('operator CLI sends a draft without exposing credentials in URL or body', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'narra-correction-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'correction.json')
  const document = { contractVersion: 'book-character-correction-v1' }
  await writeFile(file, JSON.stringify(document))
  let request = null
  const result = await runBookCharacterCorrectionCommand(
    parseBookCharacterCorrectionCommand(['stage', '--book', BOOK_ID, '--file', file]),
    {
      env: {
        BOOK_OPERATOR_URL: 'https://api.example.test/operator',
        BOOK_OPERATOR_USERNAME: 'operator',
        BOOK_OPERATOR_PASSWORD: 'secret'
      },
      fetchImpl: async (url, options) => {
        request = { url: url.toString(), options }
        return new Response(JSON.stringify({ correction: { status: 'draft' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
    }
  )
  assert.equal(result.correction.status, 'draft')
  assert.equal(request.url, `https://api.example.test/operator/api/books/${BOOK_ID}/correction`)
  assert.equal(request.options.method, 'PUT')
  assert.deepEqual(JSON.parse(request.options.body), document)
  assert.equal(request.url.includes('secret'), false)
  assert.equal(request.options.body.includes('secret'), false)
  assert.match(request.options.headers.authorization, /^Basic /)
})

test('operator CLI refuses cleartext remote credentials', async () => {
  await assert.rejects(
    runBookCharacterCorrectionCommand(
      parseBookCharacterCorrectionCommand(['inspect', '--book', BOOK_ID]),
      {
        env: {
          BOOK_OPERATOR_URL: 'http://api.example.test/operator',
          BOOK_OPERATOR_PASSWORD: 'secret'
        }
      }
    ),
    /must use HTTPS/
  )
})
