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
import { createOperationalLogger } from './operational-log.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}

const shutdown = new AbortController()
process.once('SIGTERM', () => shutdown.abort())
process.once('SIGINT', () => shutdown.abort())

const workerId = String(process.env.BOOK_SEARCH_WORKER_ID || `book-search-${randomUUID()}`)
const jobTypes = parseBookSearchJobTypes(process.env.BOOK_SEARCH_JOB_TYPES)
const bookScopes = parseBookSearchBookScopes(process.env.BOOK_SEARCH_BOOK_SCOPES)
const concurrency = parseEnvInt(process.env, 'BOOK_SEARCH_WORKER_CONCURRENCY', 2, 16)
const pollMs = parseEnvInt(process.env, 'BOOK_SEARCH_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(process.env, 'BOOK_SEARCH_LEASE_SECONDS', 300, 3_600)
const leaseRenewMs = parseEnvInt(
  process.env,
  'BOOK_SEARCH_LEASE_RENEW_MS',
  60_000,
  1_800_000
)
if (leaseRenewMs >= leaseSeconds * 1000) {
  throw new Error('BOOK_SEARCH_LEASE_RENEW_MS must be shorter than the job lease')
}

const readsText = jobTypes.some((type) => type === 'lexical' || type === 'embedding')
const storage = readsText ? createBookObjectStorageFromEnv(process.env) : null
if (readsText && !storage) {
  throw new Error('BOOK_STORAGE_BUCKET is required for lexical and embedding workers')
}
const embeddingClient = jobTypes.includes('embedding')
  ? createBookEmbeddingClientFromEnv(process.env)
  : null
if (jobTypes.includes('embedding') && !embeddingClient) {
  throw new Error('BOOK_EMBEDDING_BASE_URL is required for the embedding worker')
}
const pool = await createPostgresPoolFromEnv(process.env)
const log = createOperationalLogger({ component: 'book-search-worker' })

try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookSearchRepository(pool)
  const workers = Array.from({ length: concurrency }, (_, index) => {
    const slotWorkerId = concurrency === 1 ? workerId : `${workerId}:${index + 1}`
    return {
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
  await Promise.all(workers.map(async ({ worker, workerId: slotWorkerId }) => {
    while (!shutdown.signal.aborted) {
      try {
        const result = await worker.runOnce()
        if (result.status === 'idle') await delay(pollMs, shutdown.signal)
      } catch (error) {
        log.error('worker.queue_unavailable', 'Очередь поиска временно недоступна', {
          worker: slotWorkerId,
          error_code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
        })
        await delay(pollMs, shutdown.signal)
      }
    }
  }))
} finally {
  await pool.end()
  log.info('worker.stopped', 'Локальный search-воркер остановлен', { worker: workerId })
}
