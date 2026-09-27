/**
 * Отчёт прогона несёт длительности по стадиям.
 *
 * Мерятся два разных времени, и оба нужны продукту: сколько ждёт читатель,
 * открывший книгу, прежде чем увидит героев первых глав, и сколько идёт
 * подготовка всей книги. Первое складывается из инвентаря, фрагментов,
 * подтверждения roster и карточек **одного** окна; второе — из всего прогона.
 * Ни то, ни другое из отчёта без длительностей не достать, поэтому они часть
 * отчёта, а не строчка в логе. Часы подменяются, чтобы тест мерил структуру
 * отчёта, а не скорость машины.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { runCardPipeline } from '../evaluation/run-card-pipeline.mjs'

const CHAPTER = 'Эта глава ровная и длинная. '.repeat(120)

/**
 * Книга нарочно даёт пару кандидатов — «Мария Львовна» и «Маша» по лексикону
 * уменьшительных: без хотя бы одной пары подтверждение roster не собирается, и
 * мерить тогда нечего.
 */
function book() {
  const paragraphs = []
  for (let chapter = 0; chapter < 4; chapter += 1) {
    paragraphs.push(`Глава ${chapter + 1}`)
    paragraphs.push(`Иван Петров вошёл и заговорил в главе ${chapter + 1}.`)
    paragraphs.push(`Петров молчал, и Петрова не слушали в главе ${chapter + 1}.`)
    paragraphs.push(`Мария Львовна ответила Петрову в главе ${chapter + 1}.`)
    paragraphs.push(`Маша улыбнулась, и Маше стало легче в главе ${chapter + 1}.`)
    paragraphs.push(CHAPTER)
  }
  return paragraphs.join('\n\n')
}

/**
 * Полноценный ответ карточки: био и черта со ссылками на цитаты из запроса.
 * Карточку без био и без черт конвейер не выводит, поэтому пустой ответ здесь
 * мерил бы уже не длительности, а отказ.
 */
function fullCard(messages) {
  const user = messages.find(({ role }) => role === 'user')?.content ?? ''
  const line = user.split('\n').find((item) => item.startsWith('FRAGMENTS: ')) ?? 'FRAGMENTS: []'
  const ids = JSON.parse(line.slice('FRAGMENTS: '.length)).map(({ id }) => id)
  const name = JSON.parse(user.split('\n').find((item) => item.startsWith('CHARACTER: '))
    .slice('CHARACTER: '.length)).name
  return JSON.stringify({
    name,
    bio: { value: `${name} появляется в каждой главе.`, fragmentIds: ids.slice(0, 1), confidence: 0.9 },
    traits: [{ value: 'упрямый', fragmentIds: [ids[0], ids.at(-1)], confidence: 0.9 }],
    locations: [],
    gender: 'unknown'
  })
}

/** Часы, которые двигаются только когда их просят: тест мерит структуру. */
function clock() {
  let value = 1_000
  return {
    now: () => value,
    advance: (ms) => { value += ms }
  }
}

test('the report carries a duration for every stage and for every card', async () => {
  const time = clock()
  const report = await runCardPipeline({
    text: book(),
    title: 'Тестовая книга',
    author: 'Автор',
    now: time.now,
    complete: async (messages) => {
      // Подтверждение roster «думает» дольше карточки — как в жизни.
      const isRoster = messages.some(({ content }) => content.includes('CANDIDATE_PAIRS'))
      time.advance(isRoster ? 300_000 : 60_000)
      if (isRoster) {
        return JSON.stringify({ classifications: [], merges: [] })
      }
      return fullCard(messages)
    }
  })

  const byStage = new Map(report.timings.stages.map(({ stage, durationMs }) => [stage, durationMs]))
  assert.deepEqual(
    report.timings.stages.map(({ stage }) => stage),
    ['index', 'inventory', 'fragments', 'roster_confirm']
  )
  assert.equal(byStage.get('roster_confirm'), 300_000)
  // Детерминированные стадии не ходят в модель и потому стоят нисколько.
  assert.equal(byStage.get('inventory'), 0)
  assert.equal(byStage.get('fragments'), 0)

  assert.ok(report.cards.length > 0, 'ни одной карточки не построено')
  for (const entry of report.cards) {
    assert.equal(entry.durationMs, 60_000)
    assert.ok(Number.isInteger(entry.windowIndex), 'у карточки нет индекса окна')
  }
  assert.equal(
    report.timings.totalMs,
    300_000 + 60_000 * (report.cards.length + report.cardFailures.length)
  )
})

test('every card says which window it belongs to, so the first-window wait is computable', async () => {
  const time = clock()
  const report = await runCardPipeline({
    text: book(),
    title: 'Тестовая книга',
    now: time.now,
    complete: async (messages) => {
      time.advance(1_000)
      const isRoster = messages.some(({ content }) => content.includes('CANDIDATE_PAIRS'))
      return isRoster ? JSON.stringify({ classifications: [], merges: [] }) : fullCard(messages)
    }
  })

  const windows = new Set(report.cards.map(({ windowIndex }) => windowIndex))
  assert.ok(windows.size >= 1)
  for (const windowIndex of windows) {
    assert.ok(windowIndex >= 0 && windowIndex < report.cardWindowCount, `окно ${windowIndex}`)
  }
  // Время до первых героев — это стадии до карточек плюс карточки нулевого окна.
  const beforeCards = report.timings.stages
    .reduce((sum, { durationMs }) => sum + durationMs, 0)
  const firstWindow = report.cards
    .filter(({ windowIndex }) => windowIndex === 0)
    .reduce((sum, { durationMs }) => sum + durationMs, 0)
  assert.ok(beforeCards + firstWindow <= report.timings.totalMs)
})
