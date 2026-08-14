import assert from 'node:assert/strict'
import test from 'node:test'
import { createOperationalLogger, formatOperationalLog } from '../operational-log.mjs'

test('operational log is readable, single-line and safely escapes user-controlled fields', () => {
  const line = formatOperationalLog('book-worker', 'markup.started', 'Начинаю разметку книги', {
    job: 'job-1',
    book: 'Книга\nс новой строкой',
    characters: ['Анна', 'Борис'],
    duration_ms: 1250
  })
  assert.equal(line.includes('\n'), false)
  assert.match(line, /^\[book-worker\] Начинаю разметку книги \| event="markup\.started"/)
  assert.match(line, /book="Книга с новой строкой"/)
  assert.match(line, /characters="Анна, Борис"/)
  assert.match(line, /duration_ms=1250/)
})

test('operational logger emits one formatted argument instead of opaque objects', () => {
  const lines = []
  const log = createOperationalLogger({
    component: 'book-generator',
    logger: { info(line) { lines.push(line) } }
  })
  log.info('markup.chunk_selected', 'Фрагмент подготовлен', {
    edition: 'book-1', chunk: '2/3', range: '500-750', chars: 250
  })
  assert.deepEqual(lines, [
    '[book-generator] Фрагмент подготовлен | event="markup.chunk_selected" | edition="book-1" | chunk="2/3" | range="500-750" | chars=250'
  ])
})
