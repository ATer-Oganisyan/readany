import { randomUUID } from 'node:crypto'
import { createBookAnalysisExternalWorker } from './book-analysis-external-worker.mjs'
import { createPostgresBookAnalysisRepository } from './book-analysis-repository.mjs'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { parseEnvInt } from './env.mjs'
import { createExternalBookAdapterClient } from './external-book-adapter-client.mjs'
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

function safeErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

const shutdown = new AbortController()
process.once('SIGTERM', () => shutdown.abort())
process.once('SIGINT', () => shutdown.abort())

const workerId = String(
  process.env.BOOK_ANALYSIS_EXTERNAL_WORKER_ID || `book-analysis-external-${randomUUID()}`
)
const pollMs = parseEnvInt(process.env, 'BOOK_ANALYSIS_EXTERNAL_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(
  process.env, 'BOOK_ANALYSIS_EXTERNAL_LEASE_SECONDS', 300, 3_600
)
const leaseRenewMs = parseEnvInt(
  process.env, 'BOOK_ANALYSIS_EXTERNAL_LEASE_RENEW_MS', 60_000, 1_800_000
)
const idleLogMs = parseEnvInt(
  process.env, 'BOOK_ANALYSIS_EXTERNAL_IDLE_LOG_MS', 300_000, 3_600_000
)
if (leaseSeconds < 30) throw new Error('BOOK_ANALYSIS_EXTERNAL_LEASE_SECONDS must be at least 30')
if (leaseRenewMs >= leaseSeconds * 1_000) {
  throw new Error('BOOK_ANALYSIS_EXTERNAL_LEASE_RENEW_MS must be shorter than the job lease')
}

const storage = createBookObjectStorageFromEnv(process.env)
if (!storage) throw new Error('BOOK_STORAGE_BUCKET is required for the external worker')
const adapter = createExternalBookAdapterClient({
  baseUrl: process.env.AUTIOBOOK_ADAPTER_BASE_URL,
  token: process.env.AUTIOBOOK_ADAPTER_TOKEN,
  timeoutMs: parseEnvInt(
    process.env, 'AUTIOBOOK_ADAPTER_TIMEOUT_MS', 3_600_000, 14_400_000
  )
})
const log = createOperationalLogger({ component: 'analysis-external-worker' })
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookAnalysisRepository(pool)
  const worker = createBookAnalysisExternalWorker({
    repository,
    storage,
    adapter,
    workerId,
    leaseSeconds,
    leaseRenewMs
  })
  log.info('worker.ready', 'External-воркер запущен', {
    worker: workerId,
    pipeline_id: 'external',
    poll_ms: pollMs,
    lease_seconds: leaseSeconds
  })
  let lastIdleLogAt = 0
  while (!shutdown.signal.aborted) {
    try {
      const result = await worker.runOnce()
      if (result.status === 'idle') {
        if (Date.now() - lastIdleLogAt >= idleLogMs) {
          log.info('worker.idle', 'Очередь external-заданий пуста', { worker: workerId })
          lastIdleLogAt = Date.now()
        }
        await delay(pollMs, shutdown.signal)
      }
    } catch (error) {
      log.error('worker.queue_unavailable', 'Очередь external временно недоступна', {
        worker: workerId,
        error_code: safeErrorCode(error)
      })
      await delay(pollMs, shutdown.signal)
    }
  }
} finally {
  await pool.end()
  log.info('worker.stopped', 'External-воркер остановлен', { worker: workerId })
}
