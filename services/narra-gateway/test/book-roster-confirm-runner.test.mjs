/**
 * Книга без персонажей обязана дойти до конца, а не повиснуть.
 *
 * Три способа остановить её навсегда, и все три встречались на проде.
 * Инвентарь без имён считался ошибкой — задание исчерпывало попытки, окно
 * оставалось `queued` («文本», 208 байт без единого имени). Пустой состав не
 * открывал окно — цепочка не двигалась. А публикация висела только на
 * карточке, которой у такой книги не будет ни одной, — прогон «Мцыри» так и
 * остался на `synthesize`, а книга в «обрабатывается»: читателю неотличимо от
 * работающей.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createRosterConfirmRunner } from '../analysis/book-roster-confirm-runner.mjs'

const TEXT = 'Ровный текст без единого имени. '.repeat(8)
const TEXT_BYTES = Buffer.from(TEXT, 'utf8')
const TEXT_HASH = createHash('sha256').update(TEXT_BYTES).digest('hex')
const silentLogger = { info() {}, warn() {}, error() {} }
const JOB = { id: 'job-roster', bookEditionId: 'edition-1', leaseToken: 'lease-1' }

function harness({ candidates = [], closed = [0] } = {}) {
  const calls = { completed: [], advanced: [], published: [], model: [], finished: [] }
  const repository = {
    async getRosterConfirmationInput() {
      return {
        runId: 'run-1',
        bookEditionId: 'edition-1',
        title: 'Книга',
        author: '',
        language: 'ru',
        inventoryVersion: 'name-inventory-v1',
        normalizedTextObjectKey: 'analysis/run-1/normalized-text-v2.txt',
        normalizedTextHash: TEXT_HASH,
        windowIndex: null,
        window: null,
        candidates,
        fragments: { characters: [] },
        previousRoster: []
      }
    },
    async completeRosterConfirmation(_job, payload) {
      calls.completed.push(payload)
      return { cardJobsCreated: 0, nextConfirmation: 'none', characterCount: payload.roster.length }
    },
    async advanceCardWindows(request) {
      calls.advanced.push(request)
      return { closed, enqueued: null }
    },
    async getCardPublicationInput({ runId }) {
      calls.published.push(runId)
      // Прогон есть, карточек нет — ровно состояние книги без персонажей.
      return { bookEditionId: 'edition-1', cards: [], fragments: [], textLength: TEXT.length }
    },
    async publishCardsMarkup(payload) {
      calls.published.push(payload)
      return { published: true }
    },
    async finishCardsRunWithoutCharacters(request) {
      calls.finished.push(request)
      return { finished: true, bookEditionId: 'edition-1' }
    }
  }
  const storage = { async getBytes() { return { bytes: TEXT_BYTES, mimeType: 'text/plain' } } }
  const generator = {
    async confirmBookRoster(request) {
      calls.model.push(request)
      return { characters: [], merges: [], rejected: [] }
    }
  }
  const runner = createRosterConfirmRunner({
    repository,
    storage,
    generator,
    logger: silentLogger
  })
  return { runner, calls }
}

test('a book with no names still closes its windows and publishes', async () => {
  const { runner, calls } = harness({ candidates: [] })
  const result = await runner.run(JOB)
  assert.equal(result.characterCount, 0)
  // Модель не зовут: подтверждать нечего, и платить за это незачем.
  assert.deepEqual(calls.model, [])
  assert.equal(calls.completed.length, 1)
  assert.equal(calls.completed[0].skipped, true)
  assert.deepEqual(calls.completed[0].roster, [])
  // Цепочка окон двигается — иначе окно осталось бы `queued` навсегда.
  assert.deepEqual(calls.advanced, [{ runId: 'run-1', bookEditionId: 'edition-1' }])
  // И публикация вызывается: карточки не будет ни одной, и повода опубликовать
  // разметку больше нигде не возникнет.
  assert.ok(calls.published.length > 0, 'публикация вызвана')
  // Опубликовать нечего — прогон закрывается явно, иначе книга навсегда
  // осталась бы в «обрабатывается».
  assert.deepEqual(calls.finished, [{ runId: 'run-1' }])
})

test('the runner declares the job type it serves', () => {
  const { runner } = harness()
  assert.equal(runner.jobType, 'roster_confirm')
})

test('the runner refuses to be built without its dependencies', () => {
  assert.throws(() => createRosterConfirmRunner({ repository: {}, storage: {} }), TypeError)
})
