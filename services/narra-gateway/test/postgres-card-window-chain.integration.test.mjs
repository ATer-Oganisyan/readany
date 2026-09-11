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
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPostgresBookMarkupRepository } from '../books/postgres-book-markup-repository.mjs'
import { createIsolatedPostgres } from './support/isolated-postgres.mjs'
import { CARD_MEDIA_PRIORITY } from '../analysis/book-character-card.mjs'
import {
  buildBookCardWindows,
  cardWindowIndexForOffset
} from '../analysis/book-card-windows.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL
const directory = path.dirname(fileURLToPath(import.meta.url))

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

const CHAPTER = 10_000

/** Книга из `chapterCount` глав: окно 0 — первые две главы, дальше по одной. */
async function seedBook(pool, {
  chapterCount = 6,
  charactersPerWindow = 2,
  // Цепочка окон в проде трогается только после полного захода: до него roster
  // знает лишь героев первых глав. Фикстура повторяет это, иначе тест
  // проверял бы механику, которой в жизни не бывает.
  bookRosterConfirmed = true
} = {}) {
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
  // Окна строит та же функция, что в продакшене, а не ручные непересекающиеся
  // границы: у настоящих окон барьер начинается с нуля у всех, и фикстура,
  // которая этого не воспроизводит, скрывает ошибку назначения персонажей.
  const chapters = Array.from({ length: chapterCount }, (_, index) => ({
    index,
    key: `chapter:${index}`,
    title: '',
    startOffset: index * CHAPTER,
    endOffset: (index + 1) * CHAPTER
  }))
  const { windows } = buildBookCardWindows({ chapters })
  for (const window of windows) {
    await pool.query(
      `INSERT INTO book_card_windows (
         run_id, window_index, start_offset, end_offset,
         assign_start_offset, assign_end_offset,
         chapter_indexes, priority_class, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::integer[], $8, 'queued')`,
      [
        runId, window.windowIndex, window.startOffset, window.endOffset,
        window.assignStartOffset, window.assignEndOffset,
        window.chapterIndexes, window.priorityClass
      ]
    )
  }
  // Персонажи раскладываются по главам, а окно за них отвечает по правилу D1:
  // глава появления плюс одна. Ожидаемое окно считается тем же
  // `cardWindowIndexForOffset`, которым его считает продакшен.
  const expectedWindowByCharacter = new Map()
  for (const chapter of chapters) {
    for (let index = 0; index < charactersPerWindow; index += 1) {
      const characterKey = `char:c${chapter.index}-${index}`
      const offset = chapter.startOffset + 100 + index * 10
      expectedWindowByCharacter.set(
        characterKey,
        cardWindowIndexForOffset(windows, chapters, offset)
      )
      await pool.query(
        `INSERT INTO book_character_fragments (
           run_id, character_key, fragment_id, paragraph_index, chapter_index,
           start_offset, end_offset, mention_count
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [runId, characterKey, `frag:${characterKey}:0`, index, chapter.index, offset, offset + 50]
      )
      // Карточки ставятся по подтверждённому составу, а не по сырым кандидатам
      // инвентаря: иначе подтверждение оказалось бы выброшено — слитые
      // персонажи получили бы по карточке, а отсеянное место получило бы
      // карточку наравне с людьми. Поэтому фикстура пишет и roster.
      await pool.query(
        `INSERT INTO book_character_roster (
           run_id, character_key, canonical_name, names, candidate_keys,
           mention_count, first_mention_text_offset, tier, window_index
         ) VALUES ($1, $2, $3, ARRAY[$3]::text[], ARRAY[$2]::text[], 10, $4, 'significant', NULL)
         ON CONFLICT (run_id, character_key) DO NOTHING`,
        [runId, characterKey, `Герой ${chapter.index}-${index}`, offset]
      )
    }
  }
  if (bookRosterConfirmed) {
    await pool.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, target_version,
         status, priority, payload, analysis_run_id
       ) VALUES ($1, $2, 'roster_confirm', $3, 'roster-confirm-v1', 'ready', 45, '{}'::jsonb, $4)`,
      [randomUUID(), `${runId}:roster-confirm:book`, bookEditionId, runId]
    )
  }
  return {
    bookEditionId,
    runId,
    windowCount: windows.length,
    textLength,
    windows,
    chapters,
    expectedWindowByCharacter
  }
}

async function assignmentRanges(pool, runId) {
  const rows = await pool.query(
    `SELECT assign_start_offset AS start, assign_end_offset AS "end"
     FROM book_card_windows WHERE run_id = $1 ORDER BY window_index`,
    [runId]
  )
  return rows.rows.map(({ start, end }) => [Number(start), Number(end)])
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

test('every character is enqueued once, in the window D1 assigns to it', {
  skip: !connectionString
}, async () => {
  // Ошибка ревью PR #91: барьер всех окон начинается с нуля, и запрос состава
  // по барьеру выбирал каждого раннего персонажа заново в каждом следующем
  // окне, а персонажа второй главы — уже в первом, то есть строил его карточку
  // по первым двум главам вместо правила «глава появления + 1».
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const book = await seedBook(pool, { chapterCount: 6, charactersPerWindow: 1 })

    for (const window of book.windows) {
      await pool.query(
        `UPDATE book_card_windows SET status = 'queued' WHERE run_id = $1 AND window_index = $2`,
        [book.runId, window.windowIndex]
      )
      await repository.enqueueCardWindow({
        runId: book.runId,
        bookEditionId: book.bookEditionId,
        windowIndex: window.windowIndex,
        priority: CARD_MEDIA_PRIORITY.background
      })
    }

    const jobs = await pool.query(
      `SELECT character_key, card_window_index
       FROM generation_jobs
       WHERE analysis_run_id = $1 AND job_type = 'character_card'
       ORDER BY character_key, card_window_index`,
      [book.runId]
    )

    // Ни одного повторного задания: один персонаж — одно окно.
    const perCharacter = new Map()
    for (const row of jobs.rows) {
      const seen = perCharacter.get(row.character_key) ?? []
      seen.push(Number(row.card_window_index))
      perCharacter.set(row.character_key, seen)
    }
    for (const [characterKey, windowIndexes] of perCharacter) {
      assert.deepEqual(
        windowIndexes,
        [book.expectedWindowByCharacter.get(characterKey)],
        `${characterKey} назначен не тому окну`
      )
    }
    assert.equal(perCharacter.size, book.expectedWindowByCharacter.size)
    assert.equal(jobs.rows.length, book.expectedWindowByCharacter.size)
  } finally {
    await isolated.release()
  }
})

test('a card job carries the character name, its variants and its mention count', {
  skip: !connectionString
}, async () => {
  // Вторая ошибка ревью: генератор читает имя только из payload, и без него
  // получал технический ключ вместо имени, пустые варианты и нулевую
  // частотность — а на абзаце с несколькими героями по ключу целевого
  // персонажа не определить.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const book = await seedBook(pool, { chapterCount: 4, charactersPerWindow: 1 })
    const characterKey = 'char:c0-0'
    // Имя приходит из подтверждённого состава, а не из инвентаря: персонаж
    // собран из нескольких кандидатов, и связь между ними — строка roster, а не
    // совпадение по общей части ключа. Инвентарь здесь нарочно называет
    // кандидата иначе: если победит он, значит подтверждение выброшено.
    await pool.query(
      `UPDATE book_character_roster
       SET canonical_name = 'Раскольников',
           names = ARRAY['Раскольников', 'Родион Романович Раскольников', 'Родя']::text[],
           mention_count = 976
       WHERE run_id = $1 AND character_key = $2`,
      [book.runId, characterKey]
    )
    const candidates = [{
      candidateKey: 'name:c0-0',
      displayName: 'инвентарное имя, которое не должно победить',
      count: 1
    }]
    await pool.query(
      `INSERT INTO book_name_inventory (
         run_id, inventory_version, normalized_text_hash, text_length, chapter_count,
         total_mentions, roster_count, significant_count, document, document_hash
       ) VALUES ($1, 'name-inventory-v1', $2, $3, 4, 976, 1, 1, $4::jsonb, $5)`,
      [
        book.runId, hash(`text:${book.runId}`), book.textLength,
        JSON.stringify({ candidates }), hash('inventory')
      ]
    )

    await repository.enqueueCardWindow({
      runId: book.runId,
      bookEditionId: book.bookEditionId,
      windowIndex: 0,
      priority: CARD_MEDIA_PRIORITY.foreground
    })
    const payload = await pool.query(
      `SELECT payload FROM generation_jobs
       WHERE analysis_run_id = $1 AND character_key = $2 AND job_type = 'character_card'`,
      [book.runId, characterKey]
    )
    assert.equal(payload.rows.length, 1)
    assert.equal(payload.rows[0].payload.character_name, 'Раскольников')
    assert.equal(payload.rows[0].payload.mention_count, 976)
    assert.deepEqual(payload.rows[0].payload.character_names, [
      'Раскольников', 'Родион Романович Раскольников', 'Родя'
    ])
  } finally {
    await isolated.release()
  }
})

test('a job queued without names still reaches the model with a name', {
  skip: !connectionString
}, async () => {
  // Запасной путь чтения задания: payload пуст (так ставились задания до того,
  // как имена стали писаться в него), и имя обязано найтись в подтверждённом
  // составе — по строке roster, а не по совпадению префиксов ключа.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const book = await seedBook(pool, { chapterCount: 4, charactersPerWindow: 1 })
    const characterKey = 'char:c0-0'
    await pool.query(
      `INSERT INTO book_name_inventory (
         run_id, inventory_version, normalized_text_hash, text_length, chapter_count,
         total_mentions, roster_count, significant_count, document, document_hash
       ) VALUES ($1, 'name-inventory-v1', $2, $3, 4, 976, 1, 1, $4::jsonb, $5)`,
      [
        book.runId, hash(`text:${book.runId}`), book.textLength,
        JSON.stringify({
          candidates: [{
            candidateKey: 'name:c0-0',
            displayName: 'инвентарное имя, которое не должно победить',
            count: 1
          }]
        }),
        hash('inventory')
      ]
    )

    await pool.query(
      `UPDATE book_character_roster
       SET canonical_name = 'Раскольников',
           names = ARRAY['Раскольников', 'Родион Романович Раскольников', 'Родя']::text[],
           mention_count = 976
       WHERE run_id = $1 AND character_key = $2`,
      [book.runId, characterKey]
    )
    const jobId = randomUUID()
    await pool.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, character_key,
         target_version, status, priority, payload, analysis_run_id, card_window_index
       ) VALUES ($1, $2, 'character_card', $3, $4, 'character-card-v1', 'running', 65,
         '{}'::jsonb, $5, 0)`,
      [jobId, `${book.runId}:legacy:${characterKey}`, book.bookEditionId, characterKey, book.runId]
    )
    const leaseToken = randomUUID()
    await pool.query(
      `UPDATE generation_jobs SET locked_at = now(), locked_by = 'w', lease_token = $2
       WHERE id = $1`,
      [jobId, leaseToken]
    )

    const input = await repository.getCharacterCardInput({
      id: jobId,
      bookEditionId: book.bookEditionId,
      characterKey,
      leaseToken
    })
    assert.equal(input.character.canonicalName, 'Раскольников')
    assert.equal(input.character.mentionCount, 976)
    assert.ok(input.character.names.includes('Родион Романович Раскольников'))
    assert.notEqual(input.character.canonicalName, characterKey)
  } finally {
    await isolated.release()
  }
})

test('migration 031 repairs the ranges that 030 left degenerate', {
  skip: !connectionString
}, async () => {
  // Досчёт в 030 смещал диапазон на одно окно, и первое окно получало [0, 0]:
  // LAG отсутствует, а start_offset равен нулю. Окно не отвечало ни за кого, а
  // второе забирало обе первые главы и уводило ранних героев из
  // foreground-окна. Править саму 030 нельзя: runBookMarkupMigrations сверяет
  // контрольную сумму файла до выполнения SQL, и база, где 030 уже применена,
  // от такой правки перестала бы стартовать. Поэтому чинит отдельная миграция.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const broken = await seedBook(pool, { chapterCount: 4, charactersPerWindow: 0 })
    const exact = await seedBook(pool, { chapterCount: 4, charactersPerWindow: 0 })
    const exactBefore = await assignmentRanges(pool, exact.runId)

    // Состояние после 030: у первого окна [0, 0], у остальных пролёт предыдущего.
    await pool.query(
      `UPDATE book_card_windows AS target
       SET assign_start_offset = shifted.assign_start,
           assign_end_offset = GREATEST(shifted.assign_end, shifted.assign_start)
       FROM (
         SELECT run_id, window_index,
                COALESCE(LAG(end_offset, 2) OVER (PARTITION BY run_id ORDER BY window_index), 0)
                  AS assign_start,
                CASE
                  WHEN LEAD(window_index) OVER (PARTITION BY run_id ORDER BY window_index) IS NULL
                    THEN end_offset
                  ELSE COALESCE(LAG(end_offset) OVER (PARTITION BY run_id ORDER BY window_index),
                                start_offset)
                END AS assign_end
         FROM book_card_windows WHERE run_id = $1
       ) AS shifted
       WHERE target.run_id = shifted.run_id AND target.window_index = shifted.window_index`,
      [broken.runId]
    )
    assert.deepEqual((await assignmentRanges(pool, broken.runId))[0], [0, 0])

    await pool.query(await readFile(
      path.join(directory, '..', 'migrations', '031_card_window_assignment_repair.sql'),
      'utf8'
    ))

    const repaired = await assignmentRanges(pool, broken.runId)
    for (const [index, [rangeStart, rangeEnd]] of repaired.entries()) {
      assert.ok(rangeEnd > rangeStart, `окно ${index} осталось пустым: ${rangeStart}..${rangeEnd}`)
      if (index > 0) assert.equal(rangeStart, repaired[index - 1][1], `разрыв перед окном ${index}`)
    }
    assert.equal(repaired[0][0], 0)
    assert.equal(repaired.at(-1)[1], broken.textLength)

    // Прогон с точными диапазонами не трогается: у него нет подписи дефекта.
    assert.deepEqual(await assignmentRanges(pool, exact.runId), exactBefore)
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

test('the window chain waits for the whole-book roster before it moves on', {
  skip: !connectionString
}, async () => {
  // До полного захода roster знает только героев первых глав. Двинувшись
  // раньше, цепочка выбрала бы пустоту: каждое следующее окно вставало бы
  // `ready` без единой карточки, и она добежала бы до конца книги вхолостую —
  // а книга осталась бы с карточками одних первых глав.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seedBook(pool, {
      chapterCount: 4,
      charactersPerWindow: 1,
      bookRosterConfirmed: false
    })
    await repository.enqueueCardWindow({ runId, bookEditionId, windowIndex: 0, priority: 60 })
    await finishCardJobs(pool, runId, 0)

    const held = await repository.advanceCardWindows({ runId, bookEditionId })
    assert.equal(held.enqueued, null, 'цепочка ушла вперёд подтверждения состава')
    assert.equal(held.waitingForBookRoster, true)

    await pool.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, target_version,
         status, priority, payload, analysis_run_id
       ) VALUES ($1, $2, 'roster_confirm', $3, 'roster-confirm-v1', 'ready', 45, '{}'::jsonb, $4)`,
      [randomUUID(), `${runId}:roster-confirm:book`, bookEditionId, runId]
    )
    const moved = await repository.advanceCardWindows({ runId, bookEditionId })
    assert.notEqual(moved.enqueued, null, 'цепочка не пошла после полного захода')
    assert.equal(moved.waitingForBookRoster, undefined)
  } finally {
    await isolated.release()
  }
})

test('an empty window does not stop the chain', {
  skip: !connectionString
}, async () => {
  // Окно, в котором не оказалось ни одного персонажа, закрывается сразу и
  // карточек не даёт — а цепочку двигает именно завершённая карточка. На
  // «Герое» и «Дубровском» это останавливало книгу на третьем окне: второе
  // пустое, и дальше не шёл никто, хотя в следующем персонажи были.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seedBook(pool, { chapterCount: 6, charactersPerWindow: 1 })
    await repository.enqueueCardWindow({ runId, bookEditionId, windowIndex: 0, priority: 60 })
    await finishCardJobs(pool, runId, 0)

    // Второе окно остаётся без героев: их фрагменты убраны.
    const [, second] = await assignmentRanges(pool, runId)
    await pool.query(
      `DELETE FROM book_character_fragments
        WHERE run_id = $1 AND start_offset >= $2 AND start_offset < $3`,
      [runId, second[0], second[1]]
    )

    const advanced = await repository.advanceCardWindows({ runId, bookEditionId })
    // Пустое окно пройдено насквозь, карточки поставлены в следующее за ним.
    assert.ok(advanced.closed.includes(1), 'пустое окно не закрыто')
    assert.ok(advanced.enqueued, 'цепочка встала на пустом окне')
    assert.ok(advanced.enqueued.created > 0, 'следующее окно осталось без карточек')
    assert.ok(Number(advanced.enqueued.windowIndex) > 1)

    const statuses = await windowStatuses(pool, runId)
    assert.equal(statuses[1], 'ready')
  } finally {
    await isolated.release()
  }
})
