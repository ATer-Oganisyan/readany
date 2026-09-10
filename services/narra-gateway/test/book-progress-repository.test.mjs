/**
 * Снимок прогресса для операторского дашборда.
 *
 * Два свойства, которые тест держит. Первое: пустая выборка книг не должна
 * порождать запросы с пустым массивом идентификаторов — это лишние обращения к
 * базе на каждом опросе, а опрашивают дашборд раз в пять секунд. Второе:
 * воркеры и занятые задания приходят разными ответами и не смешиваются —
 * `worker_heartbeats.worker_id` это имя контейнера, а `locked_by` задания —
 * идентификатор процесса, и join между ними был бы неверен.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookProgressRepository } from '../books/book-progress-repository.mjs'

const RUN = '33333333-3333-4333-8333-333333333333'
const EDITION = '11111111-1111-4111-8111-111111111111'

function pool(handlers) {
  const queries = []
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params })
      for (const [pattern, rows] of handlers) {
        if (pattern.test(sql)) return { rows }
      }
      return { rows: [] }
    }
  }
}

test('an empty book list skips the per-run queries entirely', async () => {
  const database = pool([[/FROM worker_heartbeats/, [
    {
      worker_type: 'book-card',
      build_version: 'abc123',
      state: 'ready',
      total: 2,
      alive: 2,
      last_seen_at: '2026-09-10T18:00:00.000Z'
    }
  ]]])
  const snapshot = await createBookProgressRepository(database).snapshot()
  assert.equal(snapshot.books.length, 0)
  assert.equal(snapshot.workers[0].workerType, 'book-card')
  assert.equal(snapshot.workers[0].alive, 2)
  assert.equal(database.queries.length, 3)
  assert.ok(!database.queries.some(({ sql }) => /book_character_roster/.test(sql)))
})

test('per-run counters are attached to their own book', async () => {
  const database = pool([
    [/FROM book_analysis_runs/, [{
      run_id: RUN,
      book_edition_id: EDITION,
      pipeline_id: 'cards',
      stage: 'synthesize',
      status: 'running',
      run_sequence: 2,
      created_at: '2026-09-10T18:00:00.000Z',
      updated_at: '2026-09-10T18:20:00.000Z',
      title: 'Обломов',
      author: 'Гончаров',
      scope: 'catalog'
    }]],
    [/FROM book_analysis_jobs\s+WHERE run_id/, [
      { run_id: RUN, name: 'prepare', status: 'ready', count: 1 }
    ]],
    [/WHERE analysis_run_id = ANY/, [
      { run_id: RUN, name: 'character_card', status: 'failed', count: 3 },
      { run_id: RUN, name: 'roster_confirm', status: 'ready', count: 2 }
    ]],
    [/AND analysis_run_id IS NULL/, [
      { book_edition_id: EDITION, name: 'scene_image', status: 'ready', count: 9 }
    ]],
    [/FROM book_character_roster/, [{ run_id: RUN, tier: 'significant', count: 4 }]],
    [/FROM book_character_cards/, [{ run_id: RUN, published: 2, last_window: 0 }]]
  ])
  const snapshot = await createBookProgressRepository(database).snapshot()
  const [book] = snapshot.books
  assert.equal(book.title, 'Обломов')
  assert.equal(book.pipelineId, 'cards')
  assert.deepEqual(book.stages, [{ name: 'prepare', status: 'ready', count: 1 }])
  assert.deepEqual(book.runJobs, [
    { name: 'character_card', status: 'failed', count: 3 },
    { name: 'roster_confirm', status: 'ready', count: 2 }
  ])
  assert.deepEqual(book.editionJobs, [{ name: 'scene_image', status: 'ready', count: 9 }])
  assert.deepEqual(book.roster, [{ tier: 'significant', count: 4 }])
  assert.deepEqual(book.cards, { published: 2, lastWindowIndex: 0 })
})

test('running jobs are read from job leases, not from worker heartbeats', async () => {
  // Контейнер и процесс — разные идентификаторы, поэтому «кто поднят» и «что
  // занято» это два ответа, а не один join.
  const database = pool([
    [/FROM worker_heartbeats/, [{
      worker_type: 'book-card', build_version: 'abc', state: 'ready',
      total: 2, alive: 1, last_seen_at: '2026-09-10T18:00:00.000Z'
    }]],
    [/AS busy/, [{
      kind: 'generation',
      job_id: 'job-1',
      worker_id: 'book-markup-uuid',
      label: 'character_card',
      character_key: 'char:oblomov',
      book_title: 'Обломов',
      lease_age_ms: 42_000
    }]]
  ])
  const snapshot = await createBookProgressRepository(database).snapshot()
  assert.deepEqual(snapshot.running, [{
    kind: 'generation',
    jobId: 'job-1',
    workerId: 'book-markup-uuid',
    label: 'character_card',
    characterKey: 'char:oblomov',
    bookTitle: 'Обломов',
    leaseAgeMs: 42_000
  }])
  assert.notEqual(snapshot.workers[0].alive, snapshot.workers[0].total)
})

test('the snapshot refuses selectors that would scan the whole installation', async () => {
  const repository = createBookProgressRepository(pool([]))
  await assert.rejects(() => repository.snapshot({ bookLimit: 0 }), RangeError)
  await assert.rejects(() => repository.snapshot({ bookLimit: 500 }), RangeError)
  await assert.rejects(() => repository.snapshot({ recentHours: 0 }), RangeError)
  await assert.rejects(() => repository.snapshot({ runningLimit: 5_000 }), RangeError)
  assert.throws(() => createBookProgressRepository(pool([]), { staleWorkerSeconds: 5 }), RangeError)
  assert.throws(() => createBookProgressRepository(null), TypeError)
})
