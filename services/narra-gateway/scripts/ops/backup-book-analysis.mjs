/**
 * Снимок и восстановление всего, что анализ книги может перезаписать.
 *
 * Нужен перед переводом книги на другой конвейер. Карточки не трогают старые
 * строки, но публикация, разметка, персонажи и медиа у книги общие, и откат
 * «просто перезапустить прежний конвейер» не возвращает ни идентификаторы, ни
 * ревизии медиа, ни уже потраченные задания. Поэтому снимок делается до, а не
 * после того, как что-то пошло не так.
 *
 *   node scripts/ops/backup-book-analysis.mjs --book UUID[,UUID] --out DIR
 *   node scripts/ops/backup-book-analysis.mjs --restore DIR/book-UUID.json
 *
 * Снимок — обычный JSON: его можно прочитать глазами, положить рядом с тикетом
 * и восстановить на другой базе. Восстановление идёт одной транзакцией и по
 * умолчанию отказывается затирать строки, которых в снимке нет: `--replace`
 * говорит «да, удалить лишнее», и без него скрипт только сообщит о расхождении.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/** Таблицы, привязанные к изданию напрямую. */
const BY_EDITION = Object.freeze([
  'book_analysis_runs',
  'book_analysis_publications',
  'book_analysis_retry_requests',
  'book_markup_versions',
  'book_character_cards',
  'book_character_corrections',
  'book_scene_slots',
  'character_media_bundles',
  'generation_jobs',
  'generation_cost_events',
  'media_assets',
  'catalog_book_covers'
])

/** Таблицы, привязанные к прогону анализа. */
const BY_RUN = Object.freeze([
  'book_analysis_artifacts',
  'book_analysis_chunks',
  'book_analysis_entities',
  'book_analysis_entity_evidence',
  'book_analysis_jobs',
  'book_analysis_observations',
  'book_analysis_snapshots',
  'book_card_windows',
  'book_character_fragments',
  'book_name_inventory'
])

/** Таблицы, привязанные к версии разметки. */
const BY_MARKUP_VERSION = Object.freeze(['book_characters'])
/** Таблицы, привязанные к медиа-бандлу. */
const BY_BUNDLE = Object.freeze(['character_bundle_assets'])

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'BACKUP_INPUT_INVALID' })
}

function parseArguments(argv) {
  const result = { books: [], replace: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--book') result.books.push(...String(argv[++index]).split(',').filter(Boolean))
    else if (value === '--out') result.outDirectory = argv[++index]
    else if (value === '--restore') result.restorePath = argv[++index]
    else if (value === '--database-url') result.connectionString = argv[++index]
    else if (value === '--replace') result.replace = true
    else throw inputError(`unknown argument: ${value}`)
  }
  if (!result.restorePath && !result.books.length) {
    throw inputError('--book is required unless --restore is given')
  }
  if (!result.restorePath && !result.outDirectory) throw inputError('--out is required')
  return result
}

async function existingTables(client) {
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  )
  return new Set(result.rows.map(({ table_name: name }) => name))
}

async function rowsWhere(client, table, column, values) {
  if (!values.length) return []
  const result = await client.query(
    `SELECT * FROM ${table} WHERE ${column} = ANY($1::uuid[])`,
    [values]
  )
  return result.rows
}

/** Полный снимок одной книги. */
export async function backupBook(client, bookEditionId) {
  const present = await existingTables(client)
  const tables = {}
  for (const table of BY_EDITION) {
    if (!present.has(table)) continue
    tables[table] = await rowsWhere(client, table, 'book_edition_id', [bookEditionId])
  }
  const runIds = (tables.book_analysis_runs ?? []).map(({ id }) => id)
  for (const table of BY_RUN) {
    if (!present.has(table)) continue
    tables[table] = await rowsWhere(client, table, 'run_id', runIds)
  }
  const markupVersionIds = (tables.book_markup_versions ?? []).map(({ id }) => id)
  for (const table of BY_MARKUP_VERSION) {
    if (!present.has(table)) continue
    tables[table] = await rowsWhere(client, table, 'markup_version_id', markupVersionIds)
  }
  const bundleIds = (tables.character_media_bundles ?? []).map(({ id }) => id)
  for (const table of BY_BUNDLE) {
    if (!present.has(table)) continue
    tables[table] = await rowsWhere(client, table, 'bundle_id', bundleIds)
  }
  const edition = await client.query('SELECT * FROM book_editions WHERE id = $1', [bookEditionId])
  if (!edition.rows[0]) throw inputError(`book edition not found: ${bookEditionId}`)
  return {
    contractVersion: 'book-analysis-backup-v1',
    bookEditionId,
    takenAt: new Date().toISOString(),
    edition: edition.rows[0],
    counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
    tables
  }
}

function columnsOf(rows) {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))]
}

/**
 * Типы колонок таблицы.
 *
 * Без них восстановление тихо портит данные: драйвер отдаёт `jsonb` уже
 * разобранным, а на вставке сериализует массив JavaScript как *массив
 * PostgreSQL*, и `sections` из `[]` превращается в `{}`. Ловится это только
 * check-constraint'ом, да и то не везде, поэтому тип спрашивается у базы, а
 * не угадывается по значению.
 */
async function columnTypes(client, table) {
  const result = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )
  return new Map(result.rows.map(({ column_name: name, data_type: type }) => [name, type]))
}

function boundValue(value, dataType) {
  if (value === null || value === undefined) return null
  // json и jsonb уходят строкой с явным приведением; всё остальное — как есть,
  // включая настоящие массивы PostgreSQL.
  if (dataType === 'json' || dataType === 'jsonb') return JSON.stringify(value)
  return value
}

/**
 * Восстановление. Порядок таблиц обратный порядку снятия: сначала прогоны и
 * разметка, потом всё, что на них ссылается, — иначе внешние ключи не дадут
 * вставить.
 */
export async function restoreBook(client, snapshot, { replace = false } = {}) {
  if (snapshot?.contractVersion !== 'book-analysis-backup-v1') {
    throw inputError('snapshot contractVersion is not book-analysis-backup-v1')
  }
  const present = await existingTables(client)
  const order = [...BY_EDITION, ...BY_RUN, ...BY_MARKUP_VERSION, ...BY_BUNDLE]
  const report = { restored: {}, extra: {} }

  await client.query('BEGIN')
  try {
    for (const table of [...order].reverse()) {
      if (!present.has(table) || !(table in snapshot.tables)) continue
      const keep = snapshot.tables[table].map(({ id }) => id).filter(Boolean)
      if (!keep.length) continue
      const surplus = await client.query(
        `SELECT id FROM ${table} WHERE id <> ALL($1::uuid[])
           AND id IN (SELECT id FROM ${table})`,
        [keep]
      ).catch(() => ({ rows: [] }))
      if (surplus.rows.length) {
        report.extra[table] = surplus.rows.length
        if (replace) {
          await client.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`,
            [surplus.rows.map(({ id }) => id)])
        }
      }
    }
    for (const table of order) {
      if (!present.has(table)) continue
      const rows = snapshot.tables[table] ?? []
      if (!rows.length) continue
      const columns = columnsOf(rows)
      const types = await columnTypes(client, table)
      const placeholders = columns
        .map((column, index) => {
          const dataType = types.get(column)
          return dataType === 'json' || dataType === 'jsonb'
            ? `$${index + 1}::${dataType}`
            : `$${index + 1}`
        })
        .join(', ')
      for (const row of rows) {
        const values = columns.map((column) => boundValue(row[column], types.get(column)))
        await client.query(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          values
        )
      }
      report.restored[table] = rows.length
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2))
  const connectionString = options.connectionString ||
    process.env.BOOK_MARKUP_DATABASE_URL || process.env.DATABASE_URL
  if (!connectionString) throw inputError('DATABASE_URL is required')
  const pool = new pg.Pool({ connectionString })
  const client = await pool.connect()
  try {
    if (options.restorePath) {
      const snapshot = JSON.parse(await readFile(options.restorePath, 'utf8'))
      const report = await restoreBook(client, snapshot, { replace: options.replace })
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      if (Object.keys(report.extra).length && !options.replace) {
        process.stderr.write(
          'в базе есть строки, которых нет в снимке; --replace удалит их\n'
        )
      }
    } else {
      await mkdir(options.outDirectory, { recursive: true })
      for (const bookEditionId of options.books) {
        const snapshot = await backupBook(client, bookEditionId)
        const file = path.join(options.outDirectory, `book-${bookEditionId}.json`)
        await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`)
        process.stdout.write(`${file}\n${JSON.stringify(snapshot.counts, null, 2)}\n`)
      }
    }
  } finally {
    client.release()
    await pool.end()
  }
}
