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

test('a coded failure still puts its message in the log', () => {
  // Сначала сообщение писалось только у ошибок без кода: считалось, что код и
  // есть причина. `CHARACTER_CARD_INVALID` это опровергает — под одним кодом
  // восемь разных причин, и по коду не сказать, какая.
  const database = Object.assign(new Error('analysis stages must advance exactly one step'), {
    code: '23514'
  })
  assert.equal(
    unexpectedErrorMessage(database),
    'analysis stages must advance exactly one step'
  )
  assert.equal(
    unexpectedErrorMessage(Object.assign(new Error('quote falls outside the card window'), {
      code: 'CHARACTER_CARD_INVALID'
    })),
    'quote falls outside the card window'
  )
  assert.equal(unexpectedErrorMessage(new Error('   ')), null)
  assert.equal(unexpectedErrorMessage(null), null)
})

test('the logged message is bounded, so a failure cannot spill book text', () => {
  const long = new Error('я'.repeat(1000))
  assert.equal(unexpectedErrorMessage(long).length, 200)
})
