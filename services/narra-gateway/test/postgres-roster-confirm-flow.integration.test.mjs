/**
 * Сквозной поток конвейера карточек на живом PostgreSQL.
 *
 * Проверяется то, ради чего он и подводился: подтверждение окна первых глав
 * записывает состав, ставит карточки этого окна и ставит следом полный заход по
 * книге. Раньше эта цепочка не существовала — `book_character_fragments` никто
 * не заполнял, а `pipeline=cards` отказывал с `PIPELINE_STAGE_FLOW_UNWIRED`.
 */

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPostgresBookMarkupRepository } from '../books/postgres-book-markup-repository.mjs'
import { createRosterConfirmRunner } from '../analysis/book-roster-confirm-runner.mjs'
import { createIsolatedPostgres } from './support/isolated-postgres.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL
const silentLogger = { info() {}, warn() {}, error() {} }

const PARAGRAPHS = [
  'Аркадий Кирсанов вернулся домой из университета.',
  'Николай Петрович Кирсанов ждал сына у постоялого двора.',
  'Аркадий говорил о своём приятеле, а Кирсанов слушал молча.',
  `${'ровный текст. '.repeat(400)}`,
  'Базаров приехал позже и держался особняком.',
  'Базаров говорил мало, и Аркадий за него отвечал.'
]
const TEXT = PARAGRAPHS.join('\n\n')
const TEXT_BYTES = Buffer.from(TEXT, 'utf8')
const TEXT_HASH = createHash('sha256').update(TEXT_BYTES).digest('hex')

function offsetOf(index) {
  return TEXT.indexOf(PARAGRAPHS[index])
}

const CANDIDATES = [
  {
    candidateKey: 'name:arkadiy',
    displayName: 'Аркадий',
    aliases: [],
    fullName: '',
    honorific: null,
    honorificGender: null,
    count: 30,
    chapterCount: 2,
    firstMentionTextOffset: offsetOf(0),
    kindHint: 'person',
    tier: 'significant',
    speechAdjacencyRate: 0.4,
    dialogueDashRate: 0,
    honorificRate: 0,
    prepositionalRate: 0
  },
  {
    candidateKey: 'name:kirsanov',
    displayName: 'Кирсанов',
    aliases: [],
    fullName: '',
    honorific: null,
    honorificGender: null,
    count: 20,
    chapterCount: 2,
    firstMentionTextOffset: offsetOf(1),
    kindHint: 'person',
    tier: 'significant',
    speechAdjacencyRate: 0.3,
    dialogueDashRate: 0,
    honorificRate: 0,
    prepositionalRate: 0
  },
  {
    candidateKey: 'name:bazarov',
    displayName: 'Базаров',
    aliases: [],
    fullName: '',
    honorific: null,
    honorificGender: null,
    count: 25,
    chapterCount: 1,
    firstMentionTextOffset: offsetOf(4),
    kindHint: 'person',
    tier: 'significant',
    speechAdjacencyRate: 0.35,
    dialogueDashRate: 0,
    honorificRate: 0,
    prepositionalRate: 0
  }
]

async function seed(pool) {
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  await pool.query(
    `INSERT INTO book_editions (
       id, scope, catalog_key, content_sha256, title, author, format, status, language
     ) VALUES ($1, 'catalog', $2, $3, 'Отцы и дети', 'Иван Тургенев', 'epub', 'base_ready', 'ru')`,
    [bookEditionId, `cards-${bookEditionId}`, createHash('sha256').update(bookEditionId).digest('hex')]
  )
  await pool.query(
    `INSERT INTO book_analysis_runs (
       id, idempotency_key, book_edition_id, pipeline_id, pipeline_version, prompt_version,
       input_hash, normalized_text_object_key, normalized_text_hash, text_length,
       sections, stage, status
     ) VALUES ($1, $2, $3, 'cards', 'book-analysis-v51', 'book-scan-v17', $4, $5, $6, $7,
       '[]'::jsonb, 'synthesize', 'running')`,
    [
      runId, `cards:${runId}`, bookEditionId,
      createHash('sha256').update(runId).digest('hex'),
      `analysis/${runId}/normalized-text-v2.txt`, TEXT_HASH, TEXT.length
    ]
  )
  await pool.query(
    `INSERT INTO book_name_inventory (
       run_id, inventory_version, normalized_text_hash, text_length, chapter_count,
       total_mentions, roster_count, significant_count, document, document_hash
     ) VALUES ($1, 'name-inventory-v1', $2, $3, 2, 75, 3, 3, $4::jsonb, $5)`,
    [
      runId, TEXT_HASH, TEXT.length,
      JSON.stringify({ candidates: CANDIDATES }),
      createHash('sha256').update('inventory').digest('hex')
    ]
  )
  // Окно 0 отвечает за первые абзацы, окно 1 — за остальное.
  const boundary = offsetOf(4)
  await pool.query(
    `INSERT INTO book_card_windows (
       run_id, window_index, start_offset, end_offset,
       assign_start_offset, assign_end_offset, chapter_indexes, priority_class, status
     ) VALUES ($1, 0, 0, $2, 0, $2, ARRAY[0,1]::integer[], 'foreground', 'queued'),
              ($1, 1, 0, $3, $2, $3, ARRAY[2]::integer[], 'background', 'queued')`,
    [runId, boundary, TEXT.length]
  )
  for (const [index, candidate] of CANDIDATES.entries()) {
    const paragraph = index === 2 ? 4 : index
    const start = offsetOf(paragraph)
    await pool.query(
      `INSERT INTO book_character_fragments (
         run_id, character_key, fragment_id, paragraph_index, chapter_index,
         start_offset, end_offset, mention_count
       ) VALUES ($1, $2, $3, $4, 0, $5, $6, 1)`,
      [
        runId, candidate.candidateKey, `frag:${candidate.candidateKey}:0`,
        paragraph, start, start + PARAGRAPHS[paragraph].length
      ]
    )
  }
  return { bookEditionId, runId }
}

async function claimRosterJob(pool, { bookEditionId, runId, windowIndex }) {
  const id = randomUUID()
  const leaseToken = randomUUID()
  await pool.query(
    `INSERT INTO generation_jobs (
       id, idempotency_key, job_type, book_edition_id, target_version,
       status, priority, payload, analysis_run_id, card_window_index,
       locked_at, locked_by, lease_token
     ) VALUES ($1, $2, 'roster_confirm', $3, 'roster-confirm-v1', 'running', 65,
       '{}'::jsonb, $4, $5, now(), 'test', $6)`,
    [
      id,
      `${runId}:roster-confirm:${windowIndex === null ? 'book' : `window-${windowIndex}`}`,
      bookEditionId, runId, windowIndex, leaseToken
    ]
  )
  return { id, bookEditionId, leaseToken }
}

function runner(repository, { onRequest = () => {} } = {}) {
  return createRosterConfirmRunner({
    repository,
    storage: {
      async getBytes() {
        return { bytes: TEXT_BYTES, contentHash: TEXT_HASH }
      }
    },
    generator: {
      async confirmBookRoster(request) {
        onRequest(request)
        return {
          classifications: request.roster.map(({ candidateKey, names }) => ({
            candidateKey,
            kind: 'person',
            // Аркадий и Кирсанов — один человек: модель называет их одним именем.
            canonicalName: candidateKey === 'name:bazarov'
              ? 'Евгений Базаров'
              : 'Аркадий Кирсанов'
          })),
          merges: []
        }
      }
    },
    logger: silentLogger
  })
}

test('confirming the first window writes the roster, queues its cards and the book pass', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seed(pool)
    const job = await claimRosterJob(pool, { bookEditionId, runId, windowIndex: 0 })

    const requests = []
    const result = await runner(repository, { onRequest: (r) => requests.push(r) }).run(job)

    // Спрошено только про кандидатов окна: Базаров появляется позже.
    assert.equal(requests.length, 1)
    assert.deepEqual(
      requests[0].roster.map(({ candidateKey }) => candidateKey).sort(),
      ['name:arkadiy', 'name:kirsanov']
    )
    assert.equal(requests[0].windowIndex, 0)

    // Одно каноническое имя — один человек.
    assert.equal(result.characterCount, 1)
    const roster = await pool.query(
      'SELECT character_key, canonical_name, candidate_keys, window_index FROM book_character_roster WHERE run_id = $1',
      [runId]
    )
    assert.equal(roster.rows.length, 1)
    assert.equal(roster.rows[0].canonical_name, 'Аркадий Кирсанов')
    assert.deepEqual(roster.rows[0].candidate_keys.sort(), ['name:arkadiy', 'name:kirsanov'])
    assert.equal(Number(roster.rows[0].window_index), 0)

    // Карточки окна поставлены, и следом — полный заход по книге.
    assert.ok(result.cardJobsCreated > 0, 'карточки окна не поставлены')
    assert.equal(result.nextConfirmation, 'book')
    const jobs = await pool.query(
      `SELECT job_type, card_window_index, priority FROM generation_jobs
       WHERE analysis_run_id = $1 AND status = 'queued' ORDER BY job_type, priority DESC`,
      [runId]
    )
    const types = jobs.rows.map(({ job_type: type }) => type)
    assert.ok(types.includes('character_card'), 'нет заданий карточек')
    assert.ok(types.includes('roster_confirm'), 'нет полного захода')
    // Полный заход фоновый: держать за ним первые карточки незачем.
    const bookPass = jobs.rows.find(({ job_type: type, card_window_index: index }) =>
      type === 'roster_confirm' && index === null)
    assert.ok(bookPass, 'полный заход не поставлен')
    assert.equal(Number(bookPass.priority), 45)
  } finally {
    await isolated.release()
  }
})

test('the book pass sees the whole inventory and re-issues nothing it did not change', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seed(pool)

    await runner(repository).run(
      await claimRosterJob(pool, { bookEditionId, runId, windowIndex: 0 })
    )
    // Полный заход уже поставлен подтверждением окна — его и берём в работу, а
    // не ставим второй: ключ идемпотентности на то и есть.
    const queued = await pool.query(
      `SELECT id FROM generation_jobs
       WHERE analysis_run_id = $1 AND job_type = 'roster_confirm'
         AND card_window_index IS NULL AND status = 'queued'`,
      [runId]
    )
    assert.equal(queued.rows.length, 1)
    const leaseToken = randomUUID()
    await pool.query(
      `UPDATE generation_jobs
       SET status = 'running', locked_at = now(), locked_by = 'test', lease_token = $2
       WHERE id = $1`,
      [queued.rows[0].id, leaseToken]
    )
    const requests = []
    const result = await runner(repository, { onRequest: (r) => requests.push(r) }).run(
      { id: queued.rows[0].id, bookEditionId, leaseToken }
    )

    // Полный заход спрашивает про всех.
    assert.deepEqual(
      requests[0].roster.map(({ candidateKey }) => candidateKey).sort(),
      ['name:arkadiy', 'name:bazarov', 'name:kirsanov']
    )
    assert.equal(requests[0].windowIndex, null)
    assert.equal(result.characterCount, 2)
    // Аркадия он не тронул, значит переиздавать его карточку не за чем.
    assert.deepEqual(result.revisions, [])
    // И третьего захода не ставит: полный заход последний.
    assert.equal(result.nextConfirmation, 'none')

    const roster = await pool.query(
      'SELECT canonical_name FROM book_character_roster WHERE run_id = $1 ORDER BY canonical_name',
      [runId]
    )
    assert.deepEqual(
      roster.rows.map(({ canonical_name: name }) => name),
      ['Аркадий Кирсанов', 'Евгений Базаров']
    )

    // Полный заход ставит карточки остальных окон. Раньше их не ставил никто:
    // карточки появлялись только у персонажей первых глав, а подтверждённый
    // состав всей книги оставался строками в таблице без единой карточки.
    assert.ok(result.cardJobsCreated > 0, 'полный заход не поставил карточки')
    const cards = await pool.query(
      `SELECT character_key, card_window_index, priority FROM generation_jobs
        WHERE analysis_run_id = $1 AND job_type = 'character_card'
        ORDER BY card_window_index`,
      [runId]
    )
    const windows = cards.rows.map(({ card_window_index: index }) => Number(index))
    assert.deepEqual([...new Set(windows)], [0, 1], 'карточки поставлены не во все окна')
    // Персонаж принадлежит окну своего первого упоминания, а не окну захода.
    const bazarov = cards.rows.find(({ character_key: key }) => key.includes('bazarov'))
    assert.equal(Number(bazarov.card_window_index), 1)
    // Фоновые окна не обгоняют первые главы.
    const first = cards.rows.find(({ card_window_index: index }) => Number(index) === 0)
    assert.ok(Number(first.priority) > Number(bazarov.priority))

    // Второй полный заход ничего не дублирует: окно вышло из `queued`.
    const again = await pool.query(
      `SELECT count(*)::int AS n FROM generation_jobs
        WHERE analysis_run_id = $1 AND job_type = 'character_card'`,
      [runId]
    )
    assert.equal(again.rows[0].n, cards.rows.length)
  } finally {
    await isolated.release()
  }
})

test('a lone candidate is classified by the model and gets a card', {
  skip: !connectionString
}, async () => {
  // Отсутствие пар для слияния — не отсутствие персонажей: раньше такая ветка
  // писала пустой состав, и единственный герой окна оставался без карточки.
  // Спрашивать при этом всё равно надо модель: `kindHint` — эвристика, она даёт
  // `unknown` на «По дороге шла Анна. Корзину несла Анна.», и довериться ей
  // значило бы либо потерять героя, либо выдать карточку месту.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const repository = createPostgresBookMarkupRepository(pool)
    const { bookEditionId, runId } = await seed(pool)
    // Подсказка инвентаря нарочно неопределённая: решает классификация модели.
    await pool.query(
      `UPDATE book_name_inventory
       SET document = jsonb_set(document, '{candidates,2,kindHint}', '"unknown"')
       WHERE run_id = $1`,
      [runId]
    )
    const requests = []
    const result = await runner(repository, { onRequest: (r) => requests.push(r) }).run(
      await claimRosterJob(pool, { bookEditionId, runId, windowIndex: 1 })
    )

    assert.equal(requests.length, 1, 'единственного кандидата не спросили у модели')
    assert.deepEqual(
      requests[0].roster.map(({ candidateKey }) => candidateKey),
      ['name:bazarov']
    )
    assert.deepEqual(requests[0].candidatePairs, [], 'пар быть не может: кандидат один')
    assert.equal(result.characterCount, 1)
    const roster = await pool.query(
      'SELECT character_key, canonical_name FROM book_character_roster WHERE run_id = $1',
      [runId]
    )
    assert.deepEqual(
      roster.rows.map(({ canonical_name: name }) => name),
      ['Евгений Базаров']
    )
    // И карточка ему поставлена — ради этого всё и делается.
    assert.ok(result.cardJobsCreated > 0, 'карточка одинокому персонажу не поставлена')
    const jobs = await pool.query(
      `SELECT character_key FROM generation_jobs
       WHERE analysis_run_id = $1 AND job_type = 'character_card'`,
      [runId]
    )
    assert.deepEqual(jobs.rows.map(({ character_key: key }) => key), ['char:bazarov'])
  } finally {
    await isolated.release()
  }
})
