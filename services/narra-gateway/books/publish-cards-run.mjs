/**
 * Публикация разметки готового карточного прогона по требованию.
 *
 * Публикация висит на закрытии окна: её вызывает тот, кто окно закрыл —
 * карточка или полный заход подтверждения состава. Если оба задания уже
 * `ready`, а публикации нет, закрыть окно больше некому, и прогон остаётся на
 * `synthesize` навсегда — книга при этом висит в «обрабатывается», и читателю
 * это неотличимо от работающей.
 *
 * Так осталась «Мцыри»: единственное окно закрылось на первом заходе, а
 * публиковать тогда было нечего — персонажей у поэмы не нашлось. Причину
 * правка закрыла, но прогоны, застрявшие до неё, нужно чем-то дотолкнуть.
 *
 * Usage:
 *   node books/publish-cards-run.mjs --run-id <uuid> [--run-id <uuid>]...
 */
import { createHash } from 'node:crypto'
import { createCardPublicationRunner } from '../analysis/book-card-publication-runner.mjs'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_TEXT_BYTES = 64 * 1024 * 1024

function parseArgs(argv) {
  const runIds = []
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] !== '--run-id' || !UUID.test(String(argv[index + 1] ?? ''))) {
      throw Object.assign(new Error('usage: --run-id <uuid> [--run-id <uuid>]...'), { code: 'USAGE' })
    }
    runIds.push(argv[index + 1])
  }
  if (!runIds.length) {
    throw Object.assign(new Error('at least one --run-id is required'), { code: 'USAGE' })
  }
  return [...new Set(runIds)]
}

let pool
try {
  const runIds = parseArgs(process.argv.slice(2))
  pool = await createPostgresPoolFromEnv(process.env)
  await runBookMarkupMigrations(pool)
  const storage = createBookObjectStorageFromEnv(process.env)
  if (!storage) throw Object.assign(new Error('BOOK_STORAGE_BUCKET is required'), { code: 'USAGE' })
  const repository = createPostgresBookMarkupRepository(pool)
  const runner = createCardPublicationRunner({ repository, storage, maxTextBytes: MAX_TEXT_BYTES })
  const published = []
  for (const runId of runIds) {
    const input = await repository.getCardPublicationInput({ runId })
    if (!input) {
      published.push({ runId, published: false, reason: 'RUN_NOT_PUBLISHABLE' })
      continue
    }
    const stored = await storage.getBytes({
      objectKey: input.normalizedTextObjectKey,
      maxBytes: MAX_TEXT_BYTES
    })
    if (createHash('sha256').update(stored.bytes).digest('hex') !== input.normalizedTextHash) {
      published.push({ runId, published: false, reason: 'TEXT_INTEGRITY' })
      continue
    }
    const result = await runner.publish({ runId, normalizedText: stored.bytes.toString('utf8') })
    if (result?.published === false && result.reason === 'no_cards') {
      // Публиковать нечего, но и висеть на `synthesize` прогон не должен: это
      // ровно тот случай, ради которого команда и нужна.
      const finished = await repository.finishCardsRunWithoutCharacters({ runId })
      published.push({ runId, published: false, reason: 'no_cards', ...finished })
      continue
    }
    published.push({ runId, ...result })
  }
  console.log(JSON.stringify({ ok: true, published }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: { code: typeof error?.code === 'string' ? error.code : 'PUBLISH_CARDS_RUN_FAILED' }
  }, null, 2))
  process.exitCode = 1
} finally {
  await pool?.end().catch(() => {})
}
