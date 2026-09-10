/**
 * Снимок и восстановление данных книги на живом PostgreSQL.
 *
 * Смысл теста ровно один: снимок, который никто не восстанавливал, снимком не
 * является. Поэтому здесь полный оборот — снять, испортить, восстановить,
 * сверить, — а не проверка того, что файл записался.
 */

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { backupBook, restoreBook } from '../scripts/ops/backup-book-analysis.mjs'
import { createIsolatedPostgres } from './support/isolated-postgres.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function seedBook(pool) {
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  await pool.query(
    `INSERT INTO book_editions (
       id, scope, catalog_key, content_sha256, title, author, format, status, language
     ) VALUES ($1, 'catalog', $2, $3, 'Книга для снимка', 'Автор', 'epub', 'base_ready', 'ru')`,
    [bookEditionId, `backup-${bookEditionId}`, hash(bookEditionId)]
  )
  await pool.query(
    `INSERT INTO book_analysis_runs (
       id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
       input_hash, normalized_text_object_key, normalized_text_hash, text_length,
       sections, stage, status, completed_at
     ) VALUES ($1, $2, $3, 'book-analysis-v51', 'book-scan-v17', $4, $5, $6, 100000,
       '[]'::jsonb, 'publish', 'ready', now())`,
    [
      runId, `backup:${runId}`, bookEditionId, hash(runId),
      `analysis/${runId}/normalized-text-v2.txt`, hash(`text:${runId}`)
    ]
  )
  await pool.query(
    `INSERT INTO book_card_windows (
       run_id, window_index, start_offset, end_offset,
       assign_start_offset, assign_end_offset, chapter_indexes, priority_class, status
     ) VALUES ($1, 0, 0, 40000, 0, 20000, ARRAY[0,1]::integer[], 'foreground', 'queued')`,
    [runId]
  )
  await pool.query(
    `INSERT INTO book_character_fragments (
       run_id, character_key, fragment_id, paragraph_index, chapter_index,
       start_offset, end_offset, mention_count
     ) VALUES ($1, 'char:hero', 'frag:char:hero:0', 0, 0, 1000, 1100, 1)`,
    [runId]
  )
  return { bookEditionId, runId }
}

test('a book snapshot restores every table it captured', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const client = await pool.connect()
    try {
      const { bookEditionId, runId } = await seedBook(pool)
      const snapshot = await backupBook(client, bookEditionId)

      assert.equal(snapshot.contractVersion, 'book-analysis-backup-v1')
      assert.equal(snapshot.bookEditionId, bookEditionId)
      assert.equal(snapshot.counts.book_analysis_runs, 1)
      assert.equal(snapshot.counts.book_card_windows, 1)
      assert.equal(snapshot.counts.book_character_fragments, 1)

      // Портим то, что конвейер мог бы перезаписать.
      await pool.query('DELETE FROM book_character_fragments WHERE run_id = $1', [runId])
      await pool.query(
        `UPDATE book_card_windows SET status = 'ready', assign_end_offset = 1
         WHERE run_id = $1`,
        [runId]
      )
      assert.equal(
        (await pool.query('SELECT 1 FROM book_character_fragments WHERE run_id = $1', [runId]))
          .rowCount,
        0
      )

      const report = await restoreBook(client, snapshot)
      assert.equal(report.restored.book_character_fragments, 1)

      const fragments = await pool.query(
        'SELECT fragment_id FROM book_character_fragments WHERE run_id = $1', [runId]
      )
      assert.deepEqual(fragments.rows.map(({ fragment_id: id }) => id), ['frag:char:hero:0'])
      // ON CONFLICT DO NOTHING не воскрешает изменённую строку окна — и об этом
      // надо знать: восстановление возвращает удалённое, а не откатывает правки.
      const window = await pool.query(
        'SELECT status FROM book_card_windows WHERE run_id = $1', [runId]
      )
      assert.equal(window.rows[0].status, 'ready')
    } finally {
      client.release()
    }
  } finally {
    await isolated.release()
  }
})

test('a snapshot refuses a book that does not exist', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const client = await pool.connect()
    try {
      await assert.rejects(
        backupBook(client, randomUUID()),
        { code: 'BACKUP_INPUT_INVALID' }
      )
    } finally {
      client.release()
    }
  } finally {
    await isolated.release()
  }
})

test('restore refuses a snapshot of an unknown contract', {
  skip: !connectionString
}, async () => {
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const client = await pool.connect()
    try {
      await assert.rejects(
        restoreBook(client, { contractVersion: 'something-else', tables: {} }),
        { code: 'BACKUP_INPUT_INVALID' }
      )
    } finally {
      client.release()
    }
  } finally {
    await isolated.release()
  }
})

test('restore with --replace never touches another book', {
  skip: !connectionString
}, async () => {
  // P1 ревью: запрос лишних строк выбирал всё, чего нет в снимке, без
  // ограничения по книге, и `--replace` сносил прогоны, задания и медиа других
  // изданий. Область снимка — одна книга, и удалять он вправе только внутри неё.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const client = await pool.connect()
    try {
      const mine = await seedBook(pool)
      const stranger = await seedBook(pool)
      const snapshot = await backupBook(client, mine.bookEditionId)

      // В снимке чужой книги нет вовсе — значит все её строки «лишние».
      assert.equal(
        Object.keys(snapshot.tables).some((table) =>
          (snapshot.tables[table] ?? []).some((row) => row.run_id === stranger.runId)),
        false
      )

      const report = await restoreBook(client, snapshot, { replace: true })
      assert.ok(report, 'восстановление не отработало')

      const strangerRun = await pool.query(
        'SELECT id FROM book_analysis_runs WHERE id = $1', [stranger.runId]
      )
      assert.equal(strangerRun.rowCount, 1, 'прогон чужой книги удалён')
      const strangerWindows = await pool.query(
        'SELECT run_id FROM book_card_windows WHERE run_id = $1', [stranger.runId]
      )
      assert.equal(strangerWindows.rowCount, 1, 'окна чужой книги удалены')
      const strangerFragments = await pool.query(
        'SELECT run_id FROM book_character_fragments WHERE run_id = $1', [stranger.runId]
      )
      assert.equal(strangerFragments.rowCount, 1, 'фрагменты чужой книги удалены')
    } finally {
      client.release()
    }
  } finally {
    await isolated.release()
  }
})

test('restore with --replace removes a surplus row of the snapshot own book', {
  skip: !connectionString
}, async () => {
  // Обратная сторона: внутри своей книги `--replace` обязан работать, иначе
  // ограничение области превратило бы его в пустую опцию.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const client = await pool.connect()
    try {
      const { bookEditionId, runId } = await seedBook(pool)
      const snapshot = await backupBook(client, bookEditionId)
      const strayRunId = randomUUID()
      await pool.query(
        `INSERT INTO book_analysis_runs (
           id, idempotency_key, book_edition_id, pipeline_version, prompt_version,
           input_hash, normalized_text_object_key, normalized_text_hash, text_length,
           sections, stage, status
         ) VALUES ($1, $2, $3, 'book-analysis-v51', 'book-scan-v17', $4, $5, $6, 100000,
           '[]'::jsonb, 'prepare', 'running')`,
        [
          strayRunId, `stray:${strayRunId}`, bookEditionId, hash(strayRunId),
          `analysis/${strayRunId}/normalized-text-v2.txt`, hash(`text:${strayRunId}`)
        ]
      )

      const report = await restoreBook(client, snapshot, { replace: true })
      assert.equal(report.extra.book_analysis_runs, 1)
      const runs = await pool.query(
        'SELECT id FROM book_analysis_runs WHERE book_edition_id = $1', [bookEditionId]
      )
      assert.deepEqual(runs.rows.map(({ id }) => id), [runId])
    } finally {
      client.release()
    }
  } finally {
    await isolated.release()
  }
})

test('tables keyed without an id are restored but never pruned', {
  skip: !connectionString
}, async () => {
  // Граница, которую честнее назвать, чем спрятать: лишнее ищется по `id`, а у
  // `book_card_windows` и `book_character_fragments` ключ составной. Такие
  // таблицы восстановление пополняет, но не чистит, и `--replace` их не
  // касается. Раньше запрос по несуществующей колонке падал, ошибку глотал
  // `.catch`, и обрывалась вся транзакция восстановления — без слова о причине.
  const isolated = await createIsolatedPostgres(connectionString)
  const { pool } = isolated
  try {
    const client = await pool.connect()
    try {
      const { bookEditionId, runId } = await seedBook(pool)
      const snapshot = await backupBook(client, bookEditionId)
      await pool.query(
        `INSERT INTO book_character_fragments (
           run_id, character_key, fragment_id, paragraph_index, chapter_index,
           start_offset, end_offset, mention_count
         ) VALUES ($1, 'char:extra', 'frag:char:extra:0', 1, 0, 2000, 2100, 1)`,
        [runId]
      )

      const report = await restoreBook(client, snapshot, { replace: true })
      assert.equal(report.extra.book_character_fragments, undefined)
      const fragments = await pool.query(
        'SELECT fragment_id FROM book_character_fragments WHERE run_id = $1 ORDER BY fragment_id',
        [runId]
      )
      assert.deepEqual(
        fragments.rows.map(({ fragment_id: id }) => id),
        ['frag:char:extra:0', 'frag:char:hero:0']
      )
    } finally {
      client.release()
    }
  } finally {
    await isolated.release()
  }
})
