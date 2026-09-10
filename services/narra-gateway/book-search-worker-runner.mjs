import { randomUUID } from 'node:crypto'
import { createBookEmbeddingClientFromEnv } from './book-embedding-client.mjs'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { createPostgresBookSearchRepository } from './book-search-repository.mjs'
import {
  createBookSearchWorker,
  parseBookSearchBookScopes,
  parseBookSearchJobTypes
} from './book-search-worker.mjs'
import { parseEnvInt } from './env.mjs'
import { runWorkerLoop, withWorkerRuntime } from './worker-runtime.mjs'

const env = process.env
const workerId = String(env.BOOK_SEARCH_WORKER_ID || `book-search-${randomUUID()}`)
const jobTypes = parseBookSearchJobTypes(env.BOOK_SEARCH_JOB_TYPES)
const bookScopes = parseBookSearchBookScopes(env.BOOK_SEARCH_BOOK_SCOPES)
const concurrency = parseEnvInt(env, 'BOOK_SEARCH_WORKER_CONCURRENCY', 2, 16)
const pollMs = parseEnvInt(env, 'BOOK_SEARCH_POLL_MS', 1_000, 60_000)
const idleLogMs = parseEnvInt(env, 'BOOK_SEARCH_IDLE_LOG_MS', 300_000, 3_600_000)
const leaseSeconds = parseEnvInt(env, 'BOOK_SEARCH_LEASE_SECONDS', 300, 3_600)
const leaseRenewMs = parseEnvInt(env, 'BOOK_SEARCH_LEASE_RENEW_MS', 60_000, 1_800_000)
if (leaseRenewMs >= leaseSeconds * 1000) {
  throw new Error('BOOK_SEARCH_LEASE_RENEW_MS must be shorter than the job lease')
}

const readsText = jobTypes.some((type) => type === 'lexical' || type === 'embedding')
const storage = readsText ? createBookObjectStorageFromEnv(env) : null
if (readsText && !storage) {
  throw new Error('BOOK_STORAGE_BUCKET is required for lexical and embedding workers')
}
const embeddingClient = jobTypes.includes('embedding')
  ? createBookEmbeddingClientFromEnv(env)
  : null
if (jobTypes.includes('embedding') && !embeddingClient) {
  throw new Error('BOOK_EMBEDDING_BASE_URL is required for the embedding worker')
}

await withWorkerRuntime(
  { component: 'book-search-worker', workerType: 'book-search', workerId },
  async ({ pool, log, signal }) => {
    const repository = createPostgresBookSearchRepository(pool)
    // Каждый слот держит собственный workerId: аренда заданий выдаётся на него.
    const slots = Array.from({ length: concurrency }, (_, index) => {
      const slotWorkerId = concurrency === 1 ? workerId : `${workerId}:${index + 1}`
      return {
        name: `slot-${index + 1}`,
        workerId: slotWorkerId,
        worker: createBookSearchWorker({
          repository,
          storage,
          embeddingClient,
          workerId: slotWorkerId,
          jobTypes,
          bookScopes,
          leaseSeconds,
          leaseRenewMs
        })
      }
    })
    log.info('worker.ready', 'Локальный search-воркер запущен', {
      worker: workerId,
      concurrency,
      job_types: jobTypes,
      book_scopes: bookScopes,
      model: embeddingClient?.model,
      dimensions: embeddingClient?.dimensions
    })
    // Слоты работают параллельно: каждый опрашивает очередь независимо.
    await Promise.all(slots.map((slot) => runWorkerLoop({
      slots: [slot],
      pollMs,
      idleLogMs,
      log,
      signal,
      workerId: slot.workerId,
      queueLabel: 'поиска'
    })))
  }
)
