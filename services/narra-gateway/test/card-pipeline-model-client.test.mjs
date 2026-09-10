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
import {
  contentFromEventStream,
  createModelClient,
  isEventStream,
  parseEventStream
} from '../evaluation/run-card-pipeline.mjs'

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

test('a stream that stopped mid-answer is not reported as finished', () => {
  // Непустой content успехом не является. Обрыв после первых дельт даёт
  // обрезанный JSON вроде «{"classifications": [», а разбор идёт вне цикла
  // повторов — значит, прогон падает вместо повторного запроса.
  const truncated = [
    'data: {"choices":[{"delta":{"content":"{\\"classifications\\": ["}}]}'
  ].join('\n')
  const parsed = parseEventStream(truncated)
  assert.equal(parsed.content, '{"classifications": [')
  assert.equal(parsed.done, false)
  assert.equal(parsed.error, null)
})

test('a completion marker or a stop reason both count as finished', () => {
  const withDone = 'data: {"choices":[{"delta":{"content":"ок"}}]}\n\ndata: [DONE]\n'
  assert.deepEqual(
    { content: parseEventStream(withDone).content, done: parseEventStream(withDone).done },
    { content: 'ок', done: true }
  )
  const withFinishReason = 'data: {"choices":[{"delta":{"content":"ок"},"finish_reason":"stop"}]}\n'
  assert.equal(parseEventStream(withFinishReason).done, true)
})

test('hitting the token limit is not a finished answer, even with [DONE]', () => {
  // `length` приходит вместе с честным `[DONE]`, а JSON при этом обрезан ровно
  // так же, как при обрыве связи. Считать это успехом значит отдать
  // «{"classifications": [» вызывающему, где разбор идёт уже вне цикла повторов.
  for (const reason of ['length', 'content_filter']) {
    const text = [
      `data: {"choices":[{"delta":{"content":"{\\"classifications\\": ["},"finish_reason":"${reason}"}]}`,
      'data: [DONE]'
    ].join('\n')
    const parsed = parseEventStream(text)
    assert.equal(parsed.content, '{"classifications": [', reason)
    assert.equal(parsed.finishReason, reason)
    assert.equal(parsed.done, false, `${reason} не должен считаться завершением`)
  }
})

test('an error event after the first deltas is surfaced, not swallowed', () => {
  const text = [
    'data: {"choices":[{"delta":{"content":"нача"}}]}',
    'data: {"error":{"message":"upstream gone"}}'
  ].join('\n')
  const parsed = parseEventStream(text)
  assert.equal(parsed.content, 'нача')
  assert.equal(parsed.error, 'upstream gone')
  assert.equal(parsed.done, false)
})

const ENV = {
  JUDGE_BASE_URL: 'https://example.invalid/v1',
  JUDGE_API_KEY: 'k',
  JUDGE_MODEL: 'm',
  MODEL_MAX_ATTEMPTS: '2'
}

function stubbedClient(responses) {
  const calls = []
  const complete = createModelClient(ENV, {
    postJsonImpl: async (request) => {
      calls.push(request)
      return responses[Math.min(calls.length - 1, responses.length - 1)]
    }
  })
  return { complete, calls }
}

test('a truncated stream is retried instead of returned to the caller', async () => {
  // Ровно то, что воспроизводилось: клиент отдавал обрезанное
  // «{"classifications": [» после одной попытки при разрешённых двух, и разбор
  // JSON падал уже вне цикла повторов.
  const truncated = {
    status: 200,
    text: 'data: {"choices":[{"delta":{"content":"{\\"classifications\\": ["}}]}\n'
  }
  const complete2 = {
    status: 200,
    text: 'data: {"choices":[{"delta":{"content":"{\\"ok\\": true}"}}]}\n\ndata: [DONE]\n'
  }
  const { complete, calls } = stubbedClient([truncated, complete2])
  assert.equal(await complete([{ role: 'user', content: 'x' }]), '{"ok": true}')
  assert.equal(calls.length, 2)
})

test('a truncated stream on the last attempt fails loudly, naming the truncation', async () => {
  const truncated = {
    status: 200,
    text: 'data: {"choices":[{"delta":{"content":"{\\"classifications\\": ["}}]}\n'
  }
  const { complete, calls } = stubbedClient([truncated])
  await assert.rejects(
    complete([{ role: 'user', content: 'x' }]),
    (error) => error.code === 'MODEL_STREAM_TRUNCATED'
  )
  assert.equal(calls.length, 2)
})

test('an error event in the stream is retried and then named', async () => {
  const failed = {
    status: 200,
    text: 'data: {"choices":[{"delta":{"content":"на"}}]}\ndata: {"error":{"message":"upstream gone"}}\n'
  }
  const { complete } = stubbedClient([failed])
  await assert.rejects(
    complete([{ role: 'user', content: 'x' }]),
    (error) => error.code === 'MODEL_STREAM_ERROR' && /upstream gone/.test(error.message)
  )
})

test('a complete stream is returned on the first attempt', async () => {
  const ok = {
    status: 200,
    text: 'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n'
  }
  const { complete, calls } = stubbedClient([ok])
  assert.equal(await complete([{ role: 'user', content: 'x' }]), '{}')
  assert.equal(calls.length, 1)
})

test('a token-limit answer is retried and then named by its reason', async () => {
  const capped = {
    status: 200,
    text: [
      'data: {"choices":[{"delta":{"content":"{\\"classifications\\": ["},"finish_reason":"length"}]}',
      'data: [DONE]'
    ].join('\n')
  }
  const complete2 = {
    status: 200,
    text: 'data: {"choices":[{"delta":{"content":"{\\"ok\\": true}"},"finish_reason":"stop"}]}\n'
  }
  const retried = stubbedClient([capped, complete2])
  assert.equal(await retried.complete([{ role: 'user', content: 'x' }]), '{"ok": true}')
  assert.equal(retried.calls.length, 2)

  const exhausted = stubbedClient([capped])
  await assert.rejects(
    exhausted.complete([{ role: 'user', content: 'x' }]),
    (error) => error.code === 'MODEL_STREAM_TRUNCATED' && error.finishReason === 'length'
  )
})
