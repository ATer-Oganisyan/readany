/**
 * Подтверждение roster в два захода: сначала окно первых глав, потом книга.
 *
 * Измерено, почему так: подтверждение по всей книге — самый долгий шаг быстрого
 * пути. У «Отцов и детей» это ~40 000 токенов запроса и 36 пар, у
 * «Преступления и наказания» тот же вызов шёл около пяти минут, и всё это время
 * читатель не видит ни одного героя. Окну первых глав из 112 кандидатов нужны
 * 13 — 19 % запроса и 3 пары.
 *
 * Цена решения тоже измеряется здесь: ранний заход видит не всю книгу, поэтому
 * второй может слить уже выпущенного персонажа с кандидатом из поздней главы.
 * Карточка неизменяема, значит это повод для новой ревизии, и он должен быть
 * виден вызывающему, а не растворяться.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRosterConfirmation,
  buildRosterConfirmationRequest,
  rosterCandidatesForWindow,
  rosterConfirmationIdempotencyKey,
  rosterConfirmationScope,
  rosterRevisionsAfterConfirmation,
  validateRosterConfirmation
} from '../analysis/book-roster-confirmation.mjs'
import { normalizeRosterConfirmationRequest } from '../generation/internal-generation-contracts.mjs'
import { buildBookCardWindows } from '../analysis/book-card-windows.mjs'

function candidate(overrides) {
  return {
    candidateKey: 'name:x',
    displayName: 'Имя',
    aliases: [],
    fullName: '',
    honorific: null,
    honorificGender: null,
    count: 10,
    chapterCount: 2,
    firstMentionTextOffset: 100,
    kindHint: 'person',
    tier: 'significant',
    speechAdjacencyRate: 0.3,
    dialogueDashRate: 0,
    honorificRate: 0,
    prepositionalRate: 0,
    ...overrides
  }
}

function chapters(...lengths) {
  let offset = 0
  return lengths.map((length, index) => {
    const chapter = { index, key: `c${index}`, title: '', startOffset: offset, endOffset: offset + length }
    offset += length
    return chapter
  })
}

test('the first window asks about its own candidates only', () => {
  const list = chapters(10_000, 10_000, 10_000, 10_000, 10_000)
  const { windows } = buildBookCardWindows({ chapters: list })
  const candidates = [
    candidate({ candidateKey: 'name:arkadiy', displayName: 'Аркадий', firstMentionTextOffset: 500 }),
    candidate({ candidateKey: 'name:kirsanov', displayName: 'Кирсанов', firstMentionTextOffset: 900 }),
    candidate({ candidateKey: 'name:bazarov', displayName: 'Базаров', firstMentionTextOffset: 25_000 }),
    candidate({ candidateKey: 'name:odintsova', displayName: 'Одинцова', firstMentionTextOffset: 41_000 })
  ]

  const first = rosterCandidatesForWindow(candidates, windows[0])
  assert.deepEqual(first.map(({ displayName }) => displayName), ['Аркадий', 'Кирсанов'])
  // Состав считается по диапазону назначения, а не по барьеру: барьер у всех
  // окон начинается с нуля и состава не задаёт.
  assert.equal(windows[0].startOffset, 0)
  assert.ok(windows[0].assignEndOffset < windows[0].endOffset)

  const later = rosterCandidatesForWindow(candidates, windows[2])
  assert.deepEqual(later.map(({ displayName }) => displayName), ['Базаров'])
})

test('a window with no candidates of its own asks nothing', () => {
  const list = chapters(10_000, 10_000)
  const { windows } = buildBookCardWindows({ chapters: list })
  assert.deepEqual(rosterCandidatesForWindow([], windows[0]), [])
  assert.deepEqual(
    rosterCandidatesForWindow(
      [candidate({ firstMentionTextOffset: 19_000 })],
      { assignStartOffset: 5_000, assignEndOffset: 5_000 }
    ),
    []
  )
})

function confirm(candidates, canonicalNames) {
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Отцы и дети',
    author: 'Иван Тургенев',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    candidates
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: candidates.map(({ candidateKey }) => ({
        candidateKey,
        kind: 'person',
        canonicalName: canonicalNames[candidateKey] ?? candidateKey
      })),
      merges: []
    }
  })
  return applyRosterConfirmation({ request, candidates, confirmation })
}

test('a later confirmation that absorbs a candidate asks for a new card revision', () => {
  // Ранний заход видел «Аркадий» и «Кирсанов» по отдельности; полный заход
  // называет их одним именем вместе с «Аркадий Николаевич», которого в первом
  // окне не было.
  const early = [
    candidate({ candidateKey: 'name:arkadiy', displayName: 'Аркадий', count: 200 }),
    candidate({ candidateKey: 'name:petrovich', displayName: 'Петрович', count: 90 })
  ]
  const whole = [
    ...early,
    candidate({ candidateKey: 'name:arkadiy-nikolaevich', displayName: 'Аркадий Николаевич', count: 40 })
  ]
  const earlyRoster = confirm(early, {
    'name:arkadiy': 'Аркадий Кирсанов',
    'name:petrovich': 'Николай Петрович Кирсанов'
  })
  const wholeRoster = confirm(whole, {
    'name:arkadiy': 'Аркадий Кирсанов',
    'name:arkadiy-nikolaevich': 'Аркадий Кирсанов',
    'name:petrovich': 'Николай Петрович Кирсанов'
  })

  const revisions = rosterRevisionsAfterConfirmation(earlyRoster, wholeRoster)
  assert.equal(revisions.length, 1)
  assert.equal(revisions[0].reason, 'absorbed_more_candidates')
  assert.deepEqual(revisions[0].addedCandidateKeys, ['name:arkadiy-nikolaevich'])
  assert.equal(revisions[0].canonicalName, 'Аркадий Кирсанов')
})

test('a character the later confirmation did not touch needs no revision', () => {
  // Лишняя ревизия стоит вызова модели и нового портрета, поэтому «изменилось
  // хоть что-то в книге» поводом не является.
  const early = [candidate({ candidateKey: 'name:bazarov', displayName: 'Базаров', count: 300 })]
  const whole = [
    ...early,
    candidate({ candidateKey: 'name:odintsova', displayName: 'Одинцова', count: 120 })
  ]
  const revisions = rosterRevisionsAfterConfirmation(
    confirm(early, { 'name:bazarov': 'Евгений Базаров' }),
    confirm(whole, { 'name:bazarov': 'Евгений Базаров', 'name:odintsova': 'Анна Одинцова' })
  )
  assert.deepEqual(revisions, [])
})

test('a character whose candidates scatter is reported, not silently re-issued', () => {
  const early = [
    candidate({ candidateKey: 'name:pavel', displayName: 'Павел', count: 80 }),
    candidate({ candidateKey: 'name:petrovich', displayName: 'Петрович', count: 70 })
  ]
  // Ранний заход счёл их одним человеком; полный — разными.
  const earlyRoster = confirm(early, {
    'name:pavel': 'Павел Петрович',
    'name:petrovich': 'Павел Петрович'
  })
  assert.equal(earlyRoster.length, 1)
  const wholeRoster = confirm(early, {
    'name:pavel': 'Павел Петрович Кирсанов',
    'name:petrovich': 'Николай Петрович Кирсанов'
  })
  assert.equal(wholeRoster.length, 2)

  const revisions = rosterRevisionsAfterConfirmation(earlyRoster, wholeRoster)
  assert.equal(revisions.length, 1)
  assert.equal(revisions[0].reason, 'split_across_characters')
  assert.equal(revisions[0].nextCharacterKeys.length, 2)
})

test('the two passes do not share an idempotency key', () => {
  // Иначе второй заход молча получил бы из кэша ответ первого, и полный roster
  // подменился бы roster'ом одного окна. Ошибка была бы тихой: ответ валиден,
  // просто не тот.
  const common = { runId: 'run-1', inventoryVersion: 'name-inventory-v1', promptVersion: 'p-v1' }
  const first = rosterConfirmationIdempotencyKey({ ...common, windowIndex: 0 })
  const whole = rosterConfirmationIdempotencyKey({ ...common, windowIndex: null })
  assert.notEqual(first, whole)
  assert.match(first, /:window-0:/)
  assert.match(whole, /:book:/)
  // Повтор того же захода ключ не меняет: кэш обязан срабатывать внутри области.
  assert.equal(first, rosterConfirmationIdempotencyKey({ ...common, windowIndex: 0 }))
  assert.equal(rosterConfirmationScope(3), 'window-3')
  assert.equal(rosterConfirmationScope(null), 'book')
  assert.equal(rosterConfirmationScope(-1), 'book')
})

test('the normalizer refuses a key that does not name its own scope', () => {
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Отцы и дети',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    windowIndex: 0,
    candidates: [
      candidate({ candidateKey: 'name:arkadiy', displayName: 'Аркадий', count: 200 }),
      candidate({ candidateKey: 'name:kirsanov', displayName: 'Кирсанов', count: 90 })
    ]
  })
  assert.equal(request.windowIndex, 0)
  assert.throws(
    () => normalizeRosterConfirmationRequest({
      idempotencyKey: `run-1:roster-confirm:book:${request.inventoryVersion}:${request.promptVersion}`,
      ...request
    }),
    /idempotencyKey/
  )
})
