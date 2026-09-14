/**
 * Приёмка P4 на живом PostgreSQL: портреты окна первых глав обгоняют фоновые.
 *
 * Проверять это на подставном пуле бессмысленно — утверждение целиком про то,
 * какое задание отдаст `claimGenerationJob`, то есть про индекс, сортировку и
 * гейты в самом SQL. Тест пропускается без `BOOK_MARKUP_TEST_DATABASE_URL`, как
 * и остальные интеграционные тесты набора.
 */

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../books/postgres-book-markup-repository.mjs'
import { createIsolatedPostgres } from './support/isolated-postgres.mjs'
import { CARD_MEDIA_PRIORITY } from '../analysis/book-character-card.mjs'
import { validateCharacterCard } from '../analysis/book-character-card-contract.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

const TEXT_LENGTH = 200_000

function cardDocument({
  characterKey,
  name,
  firstMentionTextOffset,
  windowEndOffset,
  appearancePrompt = null
}) {
  return validateCharacterCard({
    contractVersion: 'character-card-v1',
    characterKey,
    name,
    fullName: name,
    aliases: [],
    firstMentionTextOffset,
    cardWindow: { startOffset: 0, endOffset: windowEndOffset, chapterIndexes: [0, 1] },
    mentionCount: 100,
    mentionCountInWindow: 10,
    traits: [{ value: 'наблюдательный', fragmentIds: [`frag:${characterKey}:0`], confidence: 0.9 }],
    bio: { value: `${name} появляется в этой книге.`, fragmentIds: [`frag:${characterKey}:0`] },
    locations: [],
    appearancePrompt: appearancePrompt ?? `внешность ${name}`,
    gender: 'female',
    age: '',
    greeting: '',
    source: {
      normalizedTextHash: hash('normalized'),
      inventoryVersion: 'name-inventory-v1',
      fragmentSetHash: hash(characterKey),
      promptVersion: 'character-card-prompt-v1'
    },
    createdAt: '2026-09-10T10:00:00Z'
  })
}

/**
 * Книга и прогон анализа. `bookEditionId` можно передать, чтобы засеять второй
 * прогон той же книги: именно так возникают две включённые карточки одного
 * персонажа, и именно это должен различать выбор источника портрета.
 */
async function seed(pool, {
  bookEditionId: existingBookEditionId = null,
  runSequence = 1
} = {}) {
  const bookEditionId = existingBookEditionId ?? randomUUID()
  const runId = randomUUID()
  if (!existingBookEditionId) {
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status, language
       ) VALUES ($1, 'catalog', $2, $3, 'Карточки и портреты', 'Автор', 'epub', 'base_ready', 'ru')`,
      [bookEditionId, `cards-${bookEditionId}`, hash(`source:${bookEditionId}`)]
    )
  }
  await pool.query(
    `INSERT INTO book_analysis_runs (
       id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
       input_hash, normalized_text_object_key, normalized_text_hash, text_length,
       run_sequence, sections, stage, status, completed_at
     ) VALUES (
       $1, $2, $3, 'book-analysis-v51', 'book-scan-v17', $4, $5, $6, $7, $8,
       '[]'::jsonb, 'publish', 'ready', now()
     )`,
    [
      runId, `cards:${runId}`, bookEditionId, hash(`source:${bookEditionId}`),
      `analysis/${runId}/normalized-text-v2.txt`, hash('normalized'), TEXT_LENGTH,
      runSequence
    ]
  )
  // Окно 0 — первые главы, окно 5 — фоновое.
  for (const [windowIndex, endOffset, priorityClass, assignStartOffset, assignEndOffset] of [
    [0, 40_000, 'foreground', 0, 20_000],
    [5, 160_000, 'background', 120_000, 140_000]
  ]) {
    await pool.query(
      `INSERT INTO book_card_windows (
         run_id, window_index, start_offset, end_offset,
         assign_start_offset, assign_end_offset,
         chapter_indexes, priority_class, status
       ) VALUES ($1, $2, 0, $3, $4, $5, $6::integer[], $7, 'queued')`,
      // Барьер начинается с нуля у всех окон, состав — свой у каждого: окно N
      // отвечает за персонажей, впервые названных в его собственных главах.
      [
        runId, windowIndex, endOffset,
        assignStartOffset, assignEndOffset,
        [windowIndex, windowIndex + 1], priorityClass
      ]
    )
  }
  return { bookEditionId, runId }
}

async function seedCharacter(pool, { runId, characterKey, startOffset }) {
  await pool.query(
    `INSERT INTO book_character_fragments (
       run_id, character_key, fragment_id, paragraph_index, chapter_index,
       start_offset, end_offset, mention_count
     ) VALUES ($1, $2, $3, 0, 0, $4, $5, 1)`,
    [runId, characterKey, `frag:${characterKey}:0`, startOffset, startOffset + 100]
  )
}

async function insertCardJob(
  pool,
  // Ключ идемпотентности уникален на задание: один персонаж одного прогона
  // может переиздаваться несколько раз, из разных окон.
  { bookEditionId, runId, characterKey, windowIndex, suffix = '' }
) {
  const jobId = randomUUID()
  await pool.query(
    `INSERT INTO generation_jobs (
       id, idempotency_key, job_type, book_edition_id, character_key,
       target_version, status, priority, payload, analysis_run_id, card_window_index
     ) VALUES ($1, $2, 'character_card', $3, $4, 'character-card-v1', 'queued', 65,
       '{}'::jsonb, $5, $6)`,
    [jobId, `${runId}:card:${characterKey}${suffix}`, bookEditionId, characterKey, runId, windowIndex]
  )
  return jobId
}

async function claimJob(pool, jobId, workerId = 'test-worker') {
  const leaseToken = randomUUID()
  await pool.query(
    `UPDATE generation_jobs
     SET status = 'running', locked_at = now(), locked_by = $2, lease_token = $3
     WHERE id = $1`,
    [jobId, workerId, leaseToken]
  )
  const row = await pool.query(
    'SELECT book_edition_id, character_key FROM generation_jobs WHERE id = $1',
    [jobId]
  )
  return {
    id: jobId,
    bookEditionId: row.rows[0].book_edition_id,
    characterKey: row.rows[0].character_key,
    leaseToken
  }
}

test('migrations 027 and 028 apply and enforce the card invariants', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const { bookEditionId, runId } = await seed(pool)
    await seedCharacter(pool, { runId, characterKey: 'char:a', startOffset: 1_000 })

    const document = cardDocument({
      characterKey: 'char:a',
      name: 'Анна',
      firstMentionTextOffset: 1_000,
      windowEndOffset: 40_000
    })
    const insertCard = (revision, enabled) => pool.query(
      `INSERT INTO book_character_cards (
         id, run_id, book_edition_id, character_key, card_revision, window_index,
         enabled, first_mention_text_offset, window_start_offset, window_end_offset,
         document, document_hash, fragment_set_hash, normalized_text_hash, prompt_version
       ) VALUES ($1, $2, $3, 'char:a', $4, 0, $5, 1000, 0, 40000, $6::jsonb, $7, $8, $9, $10)`,
      [
        randomUUID(), runId, bookEditionId, revision, enabled,
        JSON.stringify(document), hash(`doc:${revision}`), hash('frags'),
        hash('normalized'), 'character-card-prompt-v1'
      ]
    )
    await insertCard(1, true)

    // Две включённые ревизии одного персонажа — состояние, которого ридер
    // видеть не должен, и уникальный индекс обязан это запретить.
    await assert.rejects(() => insertCard(2, true), /book_character_cards_enabled_revision/)
    await insertCard(2, false)

    // Задание карточки без окна не воспроизводимо, поэтому CHECK его отвергает.
    await assert.rejects(
      () => pool.query(
        `INSERT INTO generation_jobs (
           id, idempotency_key, job_type, book_edition_id, character_key,
           target_version, status, payload
         ) VALUES ($1, $2, 'character_card', $3, 'char:a', 'v1', 'queued', '{}'::jsonb)`,
        [randomUUID(), `no-window:${randomUUID()}`, bookEditionId]
      ),
      /generation_jobs_card_window_v1/
    )
  } finally {
    await isolated.release()
  }
})

test('published cards are listed for the manifest, newest revision only', {
  skip: !connectionString
}, async () => {
  // До последнего окна книга на pipeline=cards не публикует v3, и это
  // единственный источник персонажей для читателя.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seed(pool)
    for (const [characterKey, offset] of [['char:early', 1_000], ['char:late', 120_000]]) {
      await seedCharacter(pool, { runId, characterKey, startOffset: offset })
      const jobId = await insertCardJob(pool, {
        bookEditionId, runId, characterKey, windowIndex: offset > 100_000 ? 5 : 0
      })
      const job = await claimJob(pool, jobId)
      await repository.publishCharacterCard(job, {
        runId,
        bookEditionId,
        characterKey,
        windowIndex: offset > 100_000 ? 5 : 0,
        cardRevision: 1,
        fragmentSetHash: hash(`frags:${characterKey}`),
        normalizedTextHash: hash('normalized'),
        promptVersion: 'character-card-prompt-v1',
        mediaPriority: CARD_MEDIA_PRIORITY.foreground,
        card: cardDocument({
          characterKey,
          name: characterKey,
          firstMentionTextOffset: offset,
          windowEndOffset: offset > 100_000 ? 160_000 : 40_000
        })
      })
    }

    const cards = await repository.listPublishedCharacterCards(bookEditionId)
    assert.deepEqual(cards.map(({ characterKey }) => characterKey), ['char:early', 'char:late'])
    assert.equal(cards[0].firstAppearanceTextOffset, 1_000)
    assert.equal(cards[0].cardStatus, 'ready')
    assert.ok(cards[0].appearancePrompt, 'проекция карточки пуста')
    // Портрет доезжает вместе с карточкой, а не вторым запросом.
    assert.ok(cards[0].bundle, 'медиа-бандл не отдан')

    // Новая ревизия выключает прежнюю: персонаж остаётся один. Ревизия
    // приписана следующему окну не случайно — уникальный индекс держит «один
    // персонаж, одно окно, одна карточка», и переиздание после более полного
    // подтверждения приходит именно из того окна, где узнали больше.
    const jobId = randomUUID()
    await pool.query(
      `INSERT INTO generation_jobs (
         id, idempotency_key, job_type, book_edition_id, character_key,
         target_version, status, priority, payload, analysis_run_id, card_window_index
       ) VALUES ($1, $2, 'character_card', $3, 'char:early', 'character-card-v1', 'queued', 65,
         '{}'::jsonb, $4, 1)`,
      [jobId, `${runId}:card:char:early:revision-2`, bookEditionId, runId]
    )
    const job = await claimJob(pool, jobId)
    await repository.publishCharacterCard(job, {
      runId,
      bookEditionId,
      characterKey: 'char:early',
      windowIndex: 1,
      cardRevision: 2,
      fragmentSetHash: hash('frags:char:early:2'),
      normalizedTextHash: hash('normalized'),
      promptVersion: 'character-card-prompt-v1',
      mediaPriority: CARD_MEDIA_PRIORITY.foreground,
      card: cardDocument({
        characterKey: 'char:early',
        name: 'Ранний, вторая ревизия',
        firstMentionTextOffset: 1_000,
        windowEndOffset: 40_000
      })
    })

    const afterRevision = await repository.listPublishedCharacterCards(bookEditionId)
    assert.equal(afterRevision.filter(({ characterKey }) => characterKey === 'char:early').length, 1)
    assert.equal(
      afterRevision.find(({ characterKey }) => characterKey === 'char:early').name,
      'Ранний, вторая ревизия'
    )
  } finally {
    await isolated.release()
  }
})

test('the manifest sees one run of cards, not two', {
  skip: !connectionString
}, async () => {
  // Выключение прежней ревизии ограничено `run_id`, поэтому после повторного
  // анализа включёнными остаются и старые карточки. Без ограничения по прогону
  // читатель получал бы старую и новую карточку с одним и тем же
  // `characterKey` — то есть одного героя дважды.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const first = await seed(pool)
    const characterKey = 'char:hero'

    const publish = async ({ runId, name }) => {
      await seedCharacter(pool, { runId, characterKey, startOffset: 1_000 })
      const jobId = await insertCardJob(pool, {
        bookEditionId: first.bookEditionId, runId, characterKey, windowIndex: 0
      })
      const job = await claimJob(pool, jobId)
      await repository.publishCharacterCard(job, {
        runId,
        bookEditionId: first.bookEditionId,
        characterKey,
        windowIndex: 0,
        cardRevision: 1,
        fragmentSetHash: hash(`frags:${runId}`),
        normalizedTextHash: hash('normalized'),
        promptVersion: 'character-card-prompt-v1',
        mediaPriority: CARD_MEDIA_PRIORITY.foreground,
        card: cardDocument({
          characterKey,
          name,
          firstMentionTextOffset: 1_000,
          windowEndOffset: 40_000
        })
      })
    }

    await publish({ runId: first.runId, name: 'Из первого прогона' })
    const second = await seed(pool, { bookEditionId: first.bookEditionId, runSequence: 2 })
    await publish({ runId: second.runId, name: 'Из второго прогона' })

    // Обе карточки включены — иначе тест ничего не проверяет.
    const enabled = await pool.query(
      `SELECT run_id FROM book_character_cards
       WHERE book_edition_id = $1 AND character_key = $2 AND enabled`,
      [first.bookEditionId, characterKey]
    )
    assert.equal(enabled.rows.length, 2)

    const cards = await repository.listPublishedCharacterCards(first.bookEditionId)
    assert.equal(cards.length, 1, 'читателю отдали одного героя дважды')
    assert.equal(cards[0].name, 'Из второго прогона')

    // Прогон можно назвать явно — например, чтобы посмотреть прежний.
    const older = await repository.listPublishedCharacterCards(first.bookEditionId, {
      runId: first.runId
    })
    assert.equal(older.length, 1)
    assert.equal(older[0].name, 'Из первого прогона')
  } finally {
    await isolated.release()
  }
})

test('a portrait is drawn from the card of its own analysis run', {
  skip: !connectionString
}, async () => {
  // Третья ошибка ревью PR #91: уникальность карточки и выключение прежней
  // ревизии ограничены `run_id`, поэтому после повторного анализа одной книги
  // включённых карточек одного персонажа бывает несколько — по одной на прогон.
  // Выбор источника без фильтра брал любую через LIMIT 1: новая карточка
  // получала медиа предыдущего анализа, а смена её документа портрет не
  // обновляла.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const first = await seed(pool)
    const characterKey = 'char:raskolnikov'

    const publish = async ({ bookEditionId, runId, appearancePrompt }) => {
      await seedCharacter(pool, { runId, characterKey, startOffset: 1_000 })
      const jobId = await insertCardJob(pool, {
        bookEditionId, runId, characterKey, windowIndex: 0
      })
      const job = await claimJob(pool, jobId)
      return repository.publishCharacterCard(job, {
        runId,
        bookEditionId,
        characterKey,
        windowIndex: 0,
        cardRevision: 1,
        fragmentSetHash: hash(`frags:${runId}`),
        normalizedTextHash: hash('normalized'),
        promptVersion: 'character-card-prompt-v1',
        mediaPriority: CARD_MEDIA_PRIORITY.foreground,
        card: cardDocument({
          characterKey,
          name: 'Раскольников',
          firstMentionTextOffset: 1_000,
          windowEndOffset: 40_000,
          appearancePrompt
        })
      })
    }

    const firstPublished = await publish({
      bookEditionId: first.bookEditionId,
      runId: first.runId,
      appearancePrompt: 'потёртое пальто'
    })
    assert.equal(firstPublished.status, 'published')

    // Второй прогон той же книги: своя строка прогона, своё окно, своя карточка.
    const second = await seed(pool, {
      bookEditionId: first.bookEditionId,
      runSequence: 2
    })
    const secondPublished = await publish({
      bookEditionId: first.bookEditionId,
      runId: second.runId,
      appearancePrompt: 'новая шляпа'
    })
    assert.equal(secondPublished.status, 'published')

    // Обе карточки включены — иначе тест ничего не проверяет.
    const enabled = await pool.query(
      `SELECT run_id FROM book_character_cards
       WHERE book_edition_id = $1 AND character_key = $2 AND enabled
       ORDER BY run_id`,
      [first.bookEditionId, characterKey]
    )
    assert.equal(enabled.rows.length, 2)

    // Портрет обновился: внешность второго прогона другая. Сверяется ревизия,
    // а не хэш документа — источником медиа служат поля, из которых медиа
    // делается, а не вся карточка целиком.
    const bundle = await pool.query(
      `SELECT media_revision FROM character_media_bundles
       WHERE book_edition_id = $1 AND character_key = $2`,
      [first.bookEditionId, characterKey]
    )
    assert.equal(bundle.rows.length, 1)
    assert.equal(Number(bundle.rows[0].media_revision), 2)
    assert.equal(secondPublished.media.mediaRevision, 2)
  } finally {
    await isolated.release()
  }
})

test('a card publishes its media at the window priority and the portrait waits for the card', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seed(pool)

    // Фоновое окно публикуется первым по времени — приоритет всё равно должен
    // поставить портрет первых глав впереди.
    const rows = [
      { characterKey: 'char:late', windowIndex: 5, startOffset: 120_000, endOffset: 160_000 },
      { characterKey: 'char:early', windowIndex: 0, startOffset: 1_000, endOffset: 40_000 }
    ]
    for (const row of rows) {
      await seedCharacter(pool, { runId, characterKey: row.characterKey, startOffset: row.startOffset })
      const jobId = await insertCardJob(pool, {
        bookEditionId, runId, characterKey: row.characterKey, windowIndex: row.windowIndex
      })
      const job = await claimJob(pool, jobId)
      const input = await repository.getCharacterCardInput(job)
      assert.equal(input.window.endOffset, row.endOffset)
      assert.equal(
        input.priorityClass,
        row.windowIndex === 0 ? 'foreground' : 'background'
      )
      assert.equal(input.fragments.length, 1)
      const published = await repository.publishCharacterCard(job, {
        runId,
        bookEditionId,
        characterKey: row.characterKey,
        windowIndex: row.windowIndex,
        cardRevision: 1,
        fragmentSetHash: hash(`frags:${row.characterKey}`),
        normalizedTextHash: hash('normalized'),
        promptVersion: 'character-card-prompt-v1',
        mediaPriority: row.windowIndex === 0
          ? CARD_MEDIA_PRIORITY.foreground
          : CARD_MEDIA_PRIORITY.background,
        card: cardDocument({
          characterKey: row.characterKey,
          name: row.characterKey,
          firstMentionTextOffset: row.startOffset,
          windowEndOffset: row.endOffset
        })
      })
      assert.equal(published.status, 'published')
      assert.equal(published.media.status, 'queued')
    }

    const priorities = await pool.query(
      `SELECT character_key, job_type, priority
       FROM generation_jobs
       WHERE book_edition_id = $1 AND job_type = 'character_portrait'
       ORDER BY character_key`,
      [bookEditionId]
    )
    assert.deepEqual(
      priorities.rows.map(({ character_key: key, priority }) => [key, Number(priority)]),
      [['char:early', 65], ['char:late', 45]]
    )

    // Собственно приёмочный критерий: очередь отдаёт портрет первых глав
    // раньше фонового, хотя фоновая карточка была записана первой.
    const first = await repository.claimGenerationJob('worker-order', {
      jobTypes: ['character_portrait'],
      bookEditionIds: [bookEditionId]
    })
    assert.equal(first.characterKey, 'char:early')
    const second = await repository.claimGenerationJob('worker-order', {
      jobTypes: ['character_portrait'],
      bookEditionIds: [bookEditionId]
    })
    assert.equal(second.characterKey, 'char:late')

    // Портрет читает карточку, а не разметку: опубликованной разметки нет вовсе.
    const bundleInput = await repository.getCharacterBundleInput(first)
    assert.equal(bundleInput.character.appearancePrompt, 'внешность char:early')
    assert.equal(bundleInput.character.cardStatus, 'ready')

    // Выключенная карточка снимает своё медиа с выдачи.
    await pool.query(
      `UPDATE book_character_cards SET enabled = FALSE
       WHERE run_id = $1 AND character_key = 'char:late'`,
      [runId]
    )
    await pool.query(
      `UPDATE generation_jobs
       SET status = 'queued', locked_at = NULL, locked_by = NULL, lease_token = NULL
       WHERE book_edition_id = $1 AND job_type = 'character_portrait'`,
      [bookEditionId]
    )
    await pool.query(
      `UPDATE book_character_cards SET enabled = FALSE
       WHERE run_id = $1 AND character_key = 'char:early'`,
      [runId]
    )
    assert.equal(
      await repository.claimGenerationJob('worker-gate', {
        jobTypes: ['character_portrait'],
        bookEditionIds: [bookEditionId]
      }),
      null
    )
  } finally {
    await isolated.release()
  }
})

test('пересобранная карточка с той же внешностью не перерисовывает портрет', {
  skip: !connectionString
}, async () => {
  // Источником медиа был хэш всей карточки, а в него входят и `createdAt`, и
  // счётчик упоминаний, и границы окна. Любая пересборка — новый прогон, новое
  // окно — перерисовывала портрет и переозвучивала приветствие: у ван Тоха их
  // набралось тринадцать при одной-единственной ревизии карточки, у «Задачи
  // трёх тел» промпт внешности совпал побайтно, а портреты рисовались заново.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seed(pool)
    const characterKey = 'char:early'
    await seedCharacter(pool, { runId, characterKey, startOffset: 1_000 })

    const publish = async (revision, windowIndex, overrides) => {
      const jobId = await insertCardJob(pool, {
        bookEditionId, runId, characterKey, windowIndex, suffix: `:rev-${revision}`
      })
      const job = await claimJob(pool, jobId)
      return repository.publishCharacterCard(job, {
        runId,
        bookEditionId,
        characterKey,
        windowIndex,
        cardRevision: revision,
        fragmentSetHash: hash(`frags:char:early:${revision}`),
        normalizedTextHash: hash('normalized'),
        promptVersion: 'character-card-prompt-v1',
        mediaPriority: CARD_MEDIA_PRIORITY.foreground,
        card: cardDocument({
          characterKey,
          name: 'Ранний',
          firstMentionTextOffset: 1_000,
          windowEndOffset: 40_000,
          ...overrides
        })
      })
    }

    const first = await publish(1, 0, {})
    // Та же внешность, другое окно: карточка пересобрана, медиа — нет.
    const same = await publish(2, 1, {})
    assert.equal(same.media.mediaRevision, first.media.mediaRevision)

    // Внешность изменилась — вот теперь портрет обязан обновиться.
    const changed = await publish(3, 2, { appearancePrompt: 'совсем другая внешность' })
    assert.equal(changed.media.mediaRevision, first.media.mediaRevision + 1)
  } finally {
    await isolated.release()
  }
})
