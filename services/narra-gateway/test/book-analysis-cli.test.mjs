import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_ANALYSIS_CLI_USAGE,
  executeBookAnalysisCommand,
  parseBookAnalysisCommand
} from '../book-analysis-cli.mjs'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const HASH = 'a'.repeat(64)

function operatorRepository(overrides = {}) {
  return {
    async getReadyAnalysisSource() {
      return {
        id: BOOK_ID,
        scope: 'catalog',
        catalogKey: 'test-book',
        contentSha256: HASH,
        title: 'Тестовая книга',
        author: 'Автор'
      }
    },
    async ensureAnalysisRun() {
      return {
        created: true,
        run: { id: RUN_ID, stage: 'prepare', status: 'queued' },
        prepareJob: { id: '33333333-3333-4333-8333-333333333333' }
      }
    },
    async getAnalysisRunDetails() {
      return {
        run: { id: RUN_ID, stage: 'scan', status: 'running' },
        book: { id: BOOK_ID, title: 'Тестовая книга', author: 'Автор' },
        jobs: { scan: { total: 3, queued: 2, running: 1, ready: 0, failed: 0, cancelled: 0 } },
        publication: null
      }
    },
    async getShadowAnalysisPublication() { return null },
    ...overrides
  }
}

test('operator CLI parses only explicit UUID commands', () => {
  assert.deepEqual(parseBookAnalysisCommand([
    'start', '--book-edition-id', BOOK_ID, '--priority', '75'
  ]), {
    command: 'start', bookEditionId: BOOK_ID, priority: 75
  })
  assert.deepEqual(parseBookAnalysisCommand(['status', '--run-id', RUN_ID]), {
    command: 'status', runId: RUN_ID
  })
  assert.throws(
    () => parseBookAnalysisCommand(['result', '--run-id', 'not-a-uuid']),
    (error) => error.code === 'INVALID_ARGUMENT'
  )
  assert.throws(
    () => parseBookAnalysisCommand([]),
    (error) => error.code === 'USAGE' && error.message === BOOK_ANALYSIS_CLI_USAGE
  )
})

test('start uses the verified stored source hash and remains idempotent', async () => {
  let ensureInput
  const result = await executeBookAnalysisCommand({
    argv: ['start', '--book-edition-id', BOOK_ID],
    repository: operatorRepository({
      async ensureAnalysisRun(input) {
        ensureInput = input
        return {
          created: false,
          run: { id: RUN_ID, stage: 'scan', status: 'running' },
          prepareJob: { id: '33333333-3333-4333-8333-333333333333' }
        }
      }
    })
  })
  assert.deepEqual(ensureInput, {
    bookEditionId: BOOK_ID,
    inputHash: HASH,
    priority: 50
  })
  assert.equal(result.created, false)
  assert.equal(result.run.id, RUN_ID)
  assert.equal(result.book.contentSha256, HASH)
})

test('status returns per-stage progress without the large publication payload', async () => {
  const result = await executeBookAnalysisCommand({
    argv: ['status', '--run-id', RUN_ID],
    repository: operatorRepository()
  })
  assert.equal(result.command, 'status')
  assert.equal(result.run.stage, 'scan')
  assert.equal(result.jobs.scan.total, 3)
  assert.equal(result.publication, null)
})

test('result is available only after shadow publication', async () => {
  await assert.rejects(
    executeBookAnalysisCommand({
      argv: ['result', '--run-id', RUN_ID],
      repository: operatorRepository()
    }),
    (error) => error.code === 'BOOK_ANALYSIS_RESULT_NOT_READY'
  )
  const publication = {
    id: '44444444-4444-4444-8444-444444444444',
    runId: RUN_ID,
    channel: 'shadow',
    data: { markup: { characters: [] } }
  }
  const result = await executeBookAnalysisCommand({
    argv: ['result', '--run-id', RUN_ID],
    repository: operatorRepository({
      async getShadowAnalysisPublication() { return publication }
    })
  })
  assert.equal(result.command, 'result')
  assert.equal(result.publication, publication)
})
