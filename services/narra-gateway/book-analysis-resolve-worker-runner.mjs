import { randomUUID } from 'node:crypto'
import { createPostgresBookAnalysisRepository } from './book-analysis-repository.mjs'
import { createBookAnalysisResolveWorker } from './book-analysis-resolve-worker.mjs'
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

const workerId = String(
  process.env.BOOK_ANALYSIS_RESOLVE_WORKER_ID || `book-analysis-resolve-${randomUUID()}`
)
const pollMs = parseEnvInt(process.env, 'BOOK_ANALYSIS_RESOLVE_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(
  process.env,
  'BOOK_ANALYSIS_RESOLVE_LEASE_SECONDS',
  300,
  3_600
)
const leaseRenewMs = parseEnvInt(
  process.env,
  'BOOK_ANALYSIS_RESOLVE_LEASE_RENEW_MS',
  60_000,
  1_800_000
)
const idleLogMs = parseEnvInt(
  process.env,
  'BOOK_ANALYSIS_RESOLVE_IDLE_LOG_MS',
  300_000,
  3_600_000
)
if (leaseSeconds < 30) throw new Error('BOOK_ANALYSIS_RESOLVE_LEASE_SECONDS must be at least 30')
if (leaseRenewMs >= leaseSeconds * 1_000) {
  throw new Error('BOOK_ANALYSIS_RESOLVE_LEASE_RENEW_MS must be shorter than the job lease')
}

const log = createOperationalLogger({ component: 'analysis-resolve-worker' })
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookAnalysisRepository(pool)
  const worker = createBookAnalysisResolveWorker({
    repository,
    workerId,
    leaseSeconds,
    leaseRenewMs
  })
  log.info('worker.ready', 'Resolve-воркер запущен', {
    worker: workerId,
    stages: ['resolve'],
    poll_ms: pollMs,
    lease_seconds: leaseSeconds
  })
  let lastIdleLogAt = 0
  while (!shutdown.signal.aborted) {
    try {
      const result = await worker.runOnce()
      if (result.status === 'idle') {
        if (Date.now() - lastIdleLogAt >= idleLogMs) {
          log.info('worker.idle', 'Очередь resolve-заданий пуста', { worker: workerId })
          lastIdleLogAt = Date.now()
        }
        await delay(pollMs, shutdown.signal)
      }
    } catch (error) {
      log.error('worker.queue_unavailable', 'Очередь resolve-заданий временно недоступна', {
        worker: workerId,
        error_code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
      })
      await delay(pollMs, shutdown.signal)
    }
  }
} finally {
  await pool.end()
  log.info('worker.stopped', 'Resolve-воркер остановлен', { worker: workerId })
}
