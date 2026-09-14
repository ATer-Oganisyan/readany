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
      alive: 2,
      stale: 8,
      builds: ['abc123'],
      states: ['ready'],
      last_seen_at: '2026-09-10T18:00:00.000Z'
    }
  ]]])
  const snapshot = await createBookProgressRepository(database).snapshot()
  assert.equal(snapshot.books.length, 0)
  assert.equal(snapshot.workers[0].workerType, 'book-card')
  assert.equal(snapshot.workers[0].alive, 2)
  assert.equal(snapshot.workers[0].stale, 8)
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
    [/FROM book_character_cards/, [{ run_id: RUN, published: 2, last_window: 0 }]],
    [/FROM book_card_windows/, [{ run_id: RUN, total: 9, ready: 3 }]],
    [/FROM book_analysis_publications/, [
      { run_id: RUN, count: 2, last_at: '2026-09-10T18:19:00.000Z' }
    ]]
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
  // Стадия у карточного прогона всегда одна и та же; различают книги окна и
  // факт публикации, поэтому дашборд читает именно их.
  assert.deepEqual(book.cards, {
    published: 2,
    lastWindowIndex: 0,
    windows: { total: 9, ready: 3 },
    publications: 2,
    lastPublishedAt: '2026-09-10T18:19:00.000Z'
  })
})

test('running jobs are read from job leases, not from worker heartbeats', async () => {
  // Контейнер и процесс — разные идентификаторы, поэтому «кто поднят» и «что
  // занято» это два ответа, а не один join.
  const database = pool([
    [/FROM worker_heartbeats/, [{
      worker_type: 'book-card', alive: 1, stale: 1,
      builds: ['abc'], states: ['ready'], last_seen_at: '2026-09-10T18:00:00.000Z'
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
  assert.equal(snapshot.workers[0].alive, 1)
  assert.equal(snapshot.workers[0].stale, 1)
})

test('heartbeats are grouped by worker type and old containers age out', async () => {
  // Строка heartbeat живёт по имени контейнера, а контейнер после каждого
  // деплоя новый. Разбивка по сборкам давала 136 групп, из которых 130 —
  // вчерашние контейнеры; список воркеров переставал читаться.
  let captured = null
  const database = {
    async query(sql, params) {
      if (/FROM worker_heartbeats/.test(sql)) captured = { sql, params }
      return { rows: [] }
    }
  }
  await createBookProgressRepository(database).snapshot({ workerRetentionHours: 6 })
  assert.match(captured.sql, /GROUP BY worker_type\b/)
  assert.doesNotMatch(captured.sql, /GROUP BY worker_type, build_version/)
  assert.match(captured.sql, /HAVING count\(\*\) FILTER \(WHERE kept\) > 0/)
  assert.deepEqual(captured.params, [60, 6])
})

test('the snapshot refuses selectors that would scan the whole installation', async () => {
  const repository = createBookProgressRepository(pool([]))
  await assert.rejects(() => repository.snapshot({ bookLimit: 0 }), RangeError)
  await assert.rejects(() => repository.snapshot({ bookLimit: 500 }), RangeError)
  await assert.rejects(() => repository.snapshot({ recentHours: 0 }), RangeError)
  await assert.rejects(() => repository.snapshot({ runningLimit: 5_000 }), RangeError)
  await assert.rejects(() => repository.snapshot({ workerRetentionHours: 0 }), RangeError)
  assert.throws(() => createBookProgressRepository(pool([]), { staleWorkerSeconds: 5 }), RangeError)
  assert.throws(() => createBookProgressRepository(null), TypeError)
})

/**
 * Полный список запусков карточками.
 *
 * Снимок дашборда держит два десятка книг и отвечает на «что происходит
 * сейчас». Перевод каталога спрашивает другое — «что мы уже запустили и где
 * оно стоит»; книга, вставшая три сотни запусков назад, в короткий снимок не
 * попадает вообще. Тест держит два свойства: одна строка на книгу (перезапуск
 * создаёт новый прогон, и без этого книга давала бы столько строк, сколько раз
 * её перезапускали) и порядок по времени запуска.
 */
test('the cards listing takes the latest run per book, newest launch first', async () => {
  const database = pool([
    [/FROM \(\s*SELECT DISTINCT ON/, [
      {
        run_id: RUN,
        book_edition_id: EDITION,
        stage: 'publish',
        status: 'running',
        run_sequence: 2,
        created_at: '2026-09-14T13:50:00.000Z',
        updated_at: '2026-09-14T14:10:00.000Z',
        pipeline_implementation_version: 'cards-v11',
        title: 'Война и мир',
        author: 'Лев Толстой',
        scope: 'catalog'
      }
    ]],
    [/FROM book_card_windows/, [{ run_id: RUN, total: 6, ready: 4 }]],
    [/FROM book_character_cards/, [{ run_id: RUN, published: 61 }]],
    [/FROM book_analysis_publications/, [
      { run_id: RUN, count: 3, last_at: '2026-09-14T14:09:00.000Z' }
    ]],
    [/FROM generation_jobs/, [
      { run_id: RUN, count: 2, codes: ['CARD_BIO_MISSING'] }
    ]]
  ])
  const listing = await createBookProgressRepository(database).cardsRuns()
  assert.equal(listing.runs.length, 1)
  const [run] = listing.runs
  assert.equal(run.title, 'Война и мир')
  assert.equal(run.startedAt, '2026-09-14T13:50:00.000Z')
  assert.deepEqual(run.windows, { total: 6, ready: 4 })
  assert.equal(run.cards, 61)
  assert.equal(run.publications, 3)
  assert.equal(run.failedJobs, 2)
  assert.deepEqual(run.failedCodes, ['CARD_BIO_MISSING'])
  const [{ sql }] = database.queries
  assert.match(sql, /DISTINCT ON \(run\.book_edition_id\)/)
  assert.match(sql, /run\.pipeline_id = 'cards'/)
  assert.match(sql, /ORDER BY latest\.created_at DESC/)
  // Счётчики собираются проходами по списку прогонов, а не подзапросом на
  // каждый: LATERAL здесь стоил 141 секунду, потому что под «все задания
  // прогона» индекса нет и каждый прогон приводил свой seq scan.
  assert.ok(database.queries.every(({ sql: value }) => !/LATERAL/.test(value)))
  assert.ok(database.queries.slice(1).every(({ params }) => Array.isArray(params?.[0])))
})

test('a listing with no runs skips the counter queries entirely', async () => {
  const database = pool([])
  const listing = await createBookProgressRepository(database).cardsRuns()
  assert.deepEqual(listing.runs, [])
  assert.equal(database.queries.length, 1)
})

test('the cards listing refuses an unbounded page instead of reading the whole table', async () => {
  const repository = createBookProgressRepository(pool([]))
  await assert.rejects(() => repository.cardsRuns({ limit: 0 }), RangeError)
  await assert.rejects(() => repository.cardsRuns({ limit: 5_000 }), RangeError)
})
