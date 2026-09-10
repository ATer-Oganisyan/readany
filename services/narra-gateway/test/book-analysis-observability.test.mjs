/**
 * Сообщение неизвестной ошибки в логе стадии.
 *
 * `error_code="UNKNOWN"` без сообщения не говорит ничего: так триггер
 * PostgreSQL, отбивавший переход стадии конвейера карточек, стоил отдельного
 * диагностического прогона. Ошибка с собственным кодом сообщения не получает —
 * код и есть причина, а лишний текст в логе только шумит.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { unexpectedErrorMessage } from '../analysis/book-analysis-observability.mjs'

test('only an uncoded failure puts its message in the log', () => {
  const database = Object.assign(new Error('analysis stages must advance exactly one step'), {
    code: '23514'
  })
  assert.equal(
    unexpectedErrorMessage(database, 'UNKNOWN'),
    'analysis stages must advance exactly one step'
  )
  assert.equal(unexpectedErrorMessage(new Error('boom'), 'BOOK_INTEGRITY'), null)
  assert.equal(unexpectedErrorMessage(new Error('   '), 'UNKNOWN'), null)
  assert.equal(unexpectedErrorMessage(null, 'UNKNOWN'), null)
})

test('the logged message is bounded, so a failure cannot spill book text', () => {
  const long = new Error('я'.repeat(1000))
  assert.equal(unexpectedErrorMessage(long, 'UNKNOWN').length, 200)
})
