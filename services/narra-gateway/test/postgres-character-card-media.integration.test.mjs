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

function cardDocument({ characterKey, name, firstMentionTextOffset, windowEndOffset }) {
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
    appearancePrompt: `внешность ${name}`,
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

async function seed(pool) {
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  await pool.query(
    `INSERT INTO book_editions (
       id, scope, catalog_key, content_sha256, title, author, format, status, language
     ) VALUES ($1, 'catalog', $2, $3, 'Карточки и портреты', 'Автор', 'epub', 'base_ready', 'ru')`,
    [bookEditionId, `cards-${bookEditionId}`, hash(`source:${bookEditionId}`)]
  )
  await pool.query(
    `INSERT INTO book_analysis_runs (
       id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
       input_hash, normalized_text_object_key, normalized_text_hash, text_length,
       sections, stage, status, completed_at
     ) VALUES (
       $1, $2, $3, 'book-analysis-v51', 'book-scan-v17', $4, $5, $6, $7,
       '[]'::jsonb, 'publish', 'ready', now()
     )`,
    [
      runId, `cards:${runId}`, bookEditionId, hash(`source:${bookEditionId}`),
      `analysis/${runId}/normalized-text-v2.txt`, hash('normalized'), TEXT_LENGTH
    ]
  )
  // Окно 0 — первые главы, окно 5 — фоновое.
  for (const [windowIndex, endOffset, priorityClass] of [
    [0, 40_000, 'foreground'],
    [5, 160_000, 'background']
  ]) {
    await pool.query(
      `INSERT INTO book_card_windows (
         run_id, window_index, start_offset, end_offset,
         chapter_indexes, priority_class, status
       ) VALUES ($1, $2, 0, $3, $4::integer[], $5, 'queued')`,
      [runId, windowIndex, endOffset, [windowIndex, windowIndex + 1], priorityClass]
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

async function insertCardJob(pool, { bookEditionId, runId, characterKey, windowIndex }) {
  const jobId = randomUUID()
  await pool.query(
    `INSERT INTO generation_jobs (
       id, idempotency_key, job_type, book_edition_id, character_key,
       target_version, status, priority, payload, analysis_run_id, card_window_index
     ) VALUES ($1, $2, 'character_card', $3, $4, 'character-card-v1', 'queued', 65,
       '{}'::jsonb, $5, $6)`,
    [jobId, `${runId}:card:${characterKey}`, bookEditionId, characterKey, runId, windowIndex]
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
