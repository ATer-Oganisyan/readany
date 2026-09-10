/**
 * Отдельная схема на файл интеграционного теста.
 *
 * Набор гоняет файлы параллельно на одной базе, а `claimGenerationJob` без
 * фильтра забирает задание с наибольшим приоритетом по всей очереди. Карточки и
 * портреты окна первых глав стоят с приоритетом 65 против дефолтных 50, поэтому
 * тест, который их создаёт, перехватывает задания у соседей — и падает соседний
 * тест, а не он. Уборка после себя тут не спасает: помешать успевает сам факт
 * существования задания в момент, когда сосед делает claim.
 *
 * Своя схема снимает вопрос целиком: `search_path` задаётся на пуле, миграции
 * применяются в эту схему, и никакие два файла не видят строк друг друга.
 */

import { randomUUID } from 'node:crypto'
import { runBookMarkupMigrations } from '../../db/postgres-runtime.mjs'

/**
 * @param {string} connectionString
 * @returns {Promise<{pool: object, schema: string, release: () => Promise<void>}>}
 */
export async function createIsolatedPostgres(connectionString) {
  const { default: pg } = await import('pg')
  const schema = `test_${randomUUID().replace(/-/g, '')}`
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 })
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
  } finally {
    await admin.end()
  }
  const pool = new pg.Pool({
    connectionString,
    ssl: false,
    max: 4,
    options: `-c search_path=${schema}`
  })
  await runBookMarkupMigrations(pool, { logger: { info() {} } })
  return {
    pool,
    schema,
    async release() {
      await pool.end()
      const cleanup = new pg.Pool({ connectionString, ssl: false, max: 1 })
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } finally {
        await cleanup.end()
      }
    }
  }
}
