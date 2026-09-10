/**
 * Разбор потокового ответа модели в скрипте прогона конвейера.
 *
 * Тест нужен потому, что ошибка здесь тихая: разборщик, который ничего не нашёл,
 * вернёт пустую строку, прогон уйдёт в разбор пустого JSON и потеряет час.
 * Поток же понадобился по измеренной причине: подтверждение roster — это ~35 000
 * токенов, рассуждающая модель молчит над ними минуты, и посредник провайдера
 * рвёт простаивающее соединение — прогон «Преступления и наказания» упал трижды
 * подряд тремя разными способами (HTTP 503 «connection termination»,
 * ECONNRESET, socket hang up).
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { contentFromEventStream, isEventStream } from '../evaluation/run-card-pipeline.mjs'

function sse(...events) {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`
}

function delta(content) {
  return { choices: [{ delta: { content } }] }
}

test('the answer is assembled from the content deltas in order', () => {
  assert.equal(
    contentFromEventStream(sse(delta('{"kind"'), delta(': "person"'), delta('}'))),
    '{"kind": "person"}'
  )
})

test('reasoning is not part of the answer', () => {
  // У рассуждающей модели мысль приходит в reasoning_content, ответ — в content.
  // Если собрать оба, в разбор JSON уйдут размышления.
  const text = sse(
    { choices: [{ delta: { reasoning_content: 'Сначала посмотрю на кандидатов…' } }] },
    delta('{"roster": []}'),
    { choices: [{ delta: { reasoning_content: '…и на запреты.' } }] }
  )
  assert.equal(contentFromEventStream(text), '{"roster": []}')
})

test('a full message in a stream event is read as well as a delta', () => {
  assert.equal(
    contentFromEventStream('data: {"choices":[{"message":{"content":"готово"}}]}\n\ndata: [DONE]\n'),
    'готово'
  )
})

test('keep-alive comments, blank lines and the terminator are ignored', () => {
  const text = [
    ': ping',
    '',
    'data: {"choices":[{"delta":{"content":"а"}}]}',
    '',
    ': ping',
    'data: {"choices":[{"delta":{"content":"б"}}]}',
    'data: [DONE]',
    ''
  ].join('\n')
  assert.equal(contentFromEventStream(text), 'аб')
})

test('a malformed event is skipped instead of losing the whole answer', () => {
  const text = [
    'data: {"choices":[{"delta":{"content":"начало"}}]}',
    'data: {not json',
    'data: {"choices":[{"delta":{"content":" и конец"}}]}',
    'data: [DONE]'
  ].join('\n')
  assert.equal(contentFromEventStream(text), 'начало и конец')
})

test('a truncated stream is told apart from a non-stream body', () => {
  // Различать обязательно, и это была настоящая ошибка. Обрыв потока до первого
  // куска ответа (шло рассуждение, ответ не начался) выглядел как «Unexpected
  // token 'd', "data: {"ch"… is not valid JSON»: в обоих случаях шёл JSON.parse
  // по тексту SSE. Обрыв — это повторяемый сбой, а не битый ответ.
  const truncated = 'data: {"choices":[{"delta":{"reasoning_content":"думаю…"}}]}\n\n'
  assert.ok(isEventStream(truncated))
  assert.equal(contentFromEventStream(truncated), '')

  const plain = JSON.stringify({ choices: [{ message: { content: '{"roster": []}' } }] })
  assert.equal(isEventStream(plain), false)

  // Комментарий keep-alive — тоже поток, даже если содержательных событий нет.
  assert.ok(isEventStream(': ping\n\n'))
  assert.equal(isEventStream(''), false)
})

test('a non-stream body yields nothing here, so the caller can fall back', () => {
  // Провайдер вправе ответить обычным JSON, даже когда его просили потоком.
  // Разборщик обязан честно вернуть пустую строку, а не выдумать содержимое:
  // на этом различии построен запасной путь в createModelClient.
  const body = JSON.stringify({ choices: [{ message: { content: '{"roster": []}' } }] })
  assert.equal(contentFromEventStream(body), '')
  assert.equal(JSON.parse(body).choices[0].message.content, '{"roster": []}')
})

test('an empty stream is an empty answer, not a crash', () => {
  assert.equal(contentFromEventStream(''), '')
  assert.equal(contentFromEventStream('data: [DONE]\n'), '')
})
