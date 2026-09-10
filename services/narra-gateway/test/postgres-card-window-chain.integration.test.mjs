/**
 * P6 на живом PostgreSQL: цепочка окон и приоритеты между книгами.
 *
 * Оба утверждения — про то, что отдаёт очередь, а не про чистые функции:
 * следующее окно не встаёт в очередь, пока не закончилось предыдущее, и окно
 * первых глав любой книги обгоняет фоновые окна всех остальных. Тест
 * пропускается без `BOOK_MARKUP_TEST_DATABASE_URL`.
 */

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../books/postgres-book-markup-repository.mjs'
import { createIsolatedPostgres } from './support/isolated-postgres.mjs'
import { CARD_MEDIA_PRIORITY } from '../analysis/book-character-card.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

const CHAPTER = 10_000

/** Книга из `chapterCount` глав: окно 0 — первые две главы, дальше по одной. */
async function seedBook(pool, { chapterCount = 6, charactersPerWindow = 2 } = {}) {
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  const textLength = chapterCount * CHAPTER
  await pool.query(
    `INSERT INTO book_editions (
       id, scope, catalog_key, content_sha256, title, author, format, status, language
     ) VALUES ($1, 'catalog', $2, $3, 'Цепочка окон', 'Автор', 'epub', 'base_ready', 'ru')`,
    [bookEditionId, `chain-${bookEditionId}`, hash(bookEditionId)]
  )
  await pool.query(
    `INSERT INTO book_analysis_runs (
       id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
       input_hash, normalized_text_object_key, normalized_text_hash, text_length,
       sections, stage, status, completed_at
     ) VALUES ($1, $2, $3, 'book-analysis-v51', 'book-scan-v17', $4, $5, $6, $7,
       '[]'::jsonb, 'publish', 'ready', now())`,
    [
      runId, `chain:${runId}`, bookEditionId, hash(runId),
      `analysis/${runId}/normalized-text-v2.txt`, hash(`text:${runId}`), textLength
    ]
  )
  // Окно 0 закрывает две главы, каждое следующее — одну.
  const bounds = [[0, 2 * CHAPTER]]
  for (let chapter = 2; chapter < chapterCount; chapter += 1) {
    bounds.push([chapter * CHAPTER, (chapter + 1) * CHAPTER])
  }
  for (const [windowIndex, [start, end]] of bounds.entries()) {
    await pool.query(
      `INSERT INTO book_card_windows (
         run_id, window_index, start_offset, end_offset,
         chapter_indexes, priority_class, status
       ) VALUES ($1, $2, $3, $4, $5::integer[], $6, 'queued')`,
      [
        runId, windowIndex, start, end,
        // Окно 0 покрывает две первые главы, дальше по одной.
        windowIndex === 0 ? [0, 1] : [windowIndex + 1],
        windowIndex === 0 ? 'foreground' : 'background'
      ]
    )
    // Персонаж «принадлежит» окну по первому упоминанию внутри его границ.
    for (let index = 0; index < charactersPerWindow; index += 1) {
      const characterKey = `char:w${windowIndex}-${index}`
      const offset = start + 100 + index * 10
      await pool.query(
        `INSERT INTO book_character_fragments (
           run_id, character_key, fragment_id, paragraph_index, chapter_index,
           start_offset, end_offset, mention_count
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [runId, characterKey, `frag:${characterKey}:0`, index, windowIndex, offset, offset + 50]
      )
    }
  }
  return { bookEditionId, runId, windowCount: bounds.length, textLength }
}

async function windowStatuses(pool, runId) {
  const rows = await pool.query(
    'SELECT window_index, status FROM book_card_windows WHERE run_id = $1 ORDER BY window_index',
    [runId]
  )
  return rows.rows.map(({ status }) => status)
}

async function finishCardJobs(pool, runId, windowIndex) {
  await pool.query(
    `UPDATE generation_jobs SET status = 'ready'
     WHERE analysis_run_id = $1 AND card_window_index = $2 AND job_type = 'character_card'`,
    [runId, windowIndex]
  )
}

test('the window chain enqueues one window at a time and closes it before the next', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const book = await seedBook(pool, { chapterCount: 5 })

    const first = await repository.enqueueCardWindow({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      windowIndex: 0,
      priority: CARD_MEDIA_PRIORITY.foreground
    })
    assert.equal(first.created, 2)
    assert.equal(first.status, 'running')
    assert.deepEqual(await windowStatuses(pool, book.runId), [
      'running', 'queued', 'queued', 'queued'
    ])

    // Пока карточки окна 0 в работе, окно 1 в очередь не встаёт.
    const held = await repository.advanceCardWindows({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      scope: 'catalog'
    })
    assert.deepEqual(held.closed, [])
    assert.equal(held.enqueued, null)

    await finishCardJobs(pool, book.runId, 0)
    const advanced = await repository.advanceCardWindows({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      scope: 'catalog'
    })
    assert.deepEqual(advanced.closed, [0])
    assert.equal(advanced.enqueued.windowIndex, 1)
    assert.equal(advanced.enqueued.created, 2)
    assert.deepEqual(await windowStatuses(pool, book.runId), [
      'ready', 'running', 'queued', 'queued'
    ])

    // Фоновое окно ставится с фоновым приоритетом.
    const priorities = await pool.query(
      `SELECT DISTINCT priority FROM generation_jobs
       WHERE analysis_run_id = $1 AND card_window_index = 1`,
      [book.runId]
    )
    assert.deepEqual(priorities.rows.map(({ priority }) => Number(priority)), [
      CARD_MEDIA_PRIORITY.background
    ])

    // Повторная постановка того же окна ничего не дублирует.
    const again = await repository.enqueueCardWindow({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      windowIndex: 1,
      priority: CARD_MEDIA_PRIORITY.background
    })
    assert.equal(again.created, 0)
  } finally {
    await isolated.release()
  }
})

test('a private book stops at the reader chapter plus two', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const book = await seedBook(pool, { chapterCount: 8 })
    await pool.query(
      `UPDATE book_card_windows SET status = 'ready', finished_at = now()
       WHERE run_id = $1 AND window_index = 0`,
      [book.runId]
    )
    // Читатель в начале книги стоит на главе 1 (окно 0 покрывает главы 0–1),
    // фронт закрывает главы до 3-й. Окно 1 — это глава 2, оно внутрь попадает.
    const near = await repository.advanceCardWindows({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      scope: 'private',
      readerTextOffset: 0
    })
    assert.equal(near.enqueued.windowIndex, 1)

    await finishCardJobs(pool, book.runId, 1)
    const beyond = await repository.advanceCardWindows({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      scope: 'private',
      readerTextOffset: 0
    })
    // Окно 2 — это глава 3, ровно на границе фронта: оно ещё проходит.
    assert.deepEqual(beyond.closed, [1])
    assert.equal(beyond.enqueued.windowIndex, 2)

    await finishCardJobs(pool, book.runId, 2)
    const held = await repository.advanceCardWindows({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      scope: 'private',
      readerTextOffset: 0
    })
    // Окно 3 — это глава 4, уже за фронтом: оно ждёт читателя.
    assert.deepEqual(held.closed, [2])
    assert.equal(held.enqueued, null)

    const moved = await repository.advanceCardWindows({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      scope: 'private',
      readerTextOffset: 45_000
    })
    assert.equal(moved.enqueued.windowIndex, 3)
  } finally {
    await isolated.release()
  }
})

test('the first window of every book outranks the background windows of all others', {
  skip: !connectionString
}, async () => {
  // Приёмочный критерий P6: нагрузка из пяти книг не должна приводить к тому,
  // что фоновые окна первой книги задерживают первые главы пятой.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const books = []
    for (let index = 0; index < 5; index += 1) {
      const book = await seedBook(pool, { chapterCount: 4, charactersPerWindow: 1 })
        books.push(book)
    }
    // Первая книга уходит далеко в фон, остальные только начинают.
    const [leader, ...rest] = books
    await repository.enqueueCardWindow({
      runId: leader.runId,
      bookEditionId: leader.bookEditionId,
      windowIndex: 0,
      priority: CARD_MEDIA_PRIORITY.foreground
    })
    await finishCardJobs(pool, leader.runId, 0)
    for (const windowIndex of [1, 2]) {
      await repository.advanceCardWindows({
        runId: leader.runId,
        bookEditionId: leader.bookEditionId,
        scope: 'catalog'
      })
      await finishCardJobs(pool, leader.runId, windowIndex)
    }
    await repository.advanceCardWindows({
      runId: leader.runId,
      bookEditionId: leader.bookEditionId,
      scope: 'catalog'
    })
    for (const book of rest) {
      await repository.enqueueCardWindow({
        runId: book.runId,
        bookEditionId: book.bookEditionId,
        windowIndex: 0,
        priority: CARD_MEDIA_PRIORITY.foreground
      })
    }

    const editionIds = books.map(({ bookEditionId }) => bookEditionId)
    const claimed = []
    for (let index = 0; index < 4; index += 1) {
      const job = await repository.claimGenerationJob(`worker-${index}`, {
        jobTypes: ['character_card'],
        bookEditionIds: editionIds
      })
      if (!job) break
      // Приоритет читается из строки: `jobRow` его наружу не отдаёт, а
      // утверждение здесь именно про порядок выдачи по приоритету.
      const row = await pool.query(
        'SELECT priority, card_window_index FROM generation_jobs WHERE id = $1',
        [job.id]
      )
      claimed.push({
        priority: Number(row.rows[0].priority),
        windowIndex: Number(row.rows[0].card_window_index)
      })
    }
    assert.equal(claimed.length, 4, 'ожидались задания всех четырёх новых книг')
    for (const { priority, windowIndex } of claimed) {
      assert.equal(
        priority,
        CARD_MEDIA_PRIORITY.foreground,
        'фоновое окно первой книги обогнало первые главы другой'
      )
      assert.equal(windowIndex, 0, 'выдано не окно первых глав')
    }
  } finally {
    await isolated.release()
  }
})
