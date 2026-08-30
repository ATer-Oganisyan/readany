import { randomUUID } from 'node:crypto'
import { parseEnvInt, parseEnvUuidList } from './env.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import {
  createGenerationWorker,
  parseBookMarkupWorkerJobTypes
} from './generation-worker.mjs'
import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'
import { createOperationalLogger } from './operational-log.mjs'

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

const workerId = String(process.env.BOOK_MARKUP_WORKER_ID || `book-markup-${randomUUID()}`)
const pollMs = parseEnvInt(process.env, 'BOOK_MARKUP_WORKER_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(process.env, 'BOOK_MARKUP_JOB_LEASE_SECONDS', 300, 3_600)
const leaseRenewMs = parseEnvInt(process.env, 'BOOK_MARKUP_LEASE_RENEW_MS', 60_000, 1_800_000)
const idleLogMs = parseEnvInt(process.env, 'BOOK_MARKUP_IDLE_LOG_MS', 300_000, 3_600_000)
const jobTypes = parseBookMarkupWorkerJobTypes(process.env.BOOK_MARKUP_WORKER_JOB_TYPES)
const bookEditionIds = parseEnvUuidList(process.env, 'BOOK_MARKUP_WORKER_EDITION_IDS')
const log = createOperationalLogger({ component: 'book-worker' })
if (leaseRenewMs >= leaseSeconds * 1_000) {
  throw new Error('BOOK_MARKUP_LEASE_RENEW_MS must be shorter than the job lease')
}

const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const baseRepository = createPostgresBookMarkupRepository(pool)
  const repository = {
    ...baseRepository,
    claimGenerationJob(id) {
      return baseRepository.claimGenerationJob(id, {
        leaseSeconds,
        jobTypes,
        bookEditionIds
      })
    }
  }
  const generator = createGenerationServiceClient({
    baseUrl: process.env.GENERATOR_BASE_URL,
    token: process.env.GENERATOR_SERVICE_TOKEN,
    timeoutMs: parseEnvInt(process.env, 'GENERATOR_TIMEOUT_MS', 300_000, 900_000)
  })
  const worker = createGenerationWorker({ repository, generator, workerId, leaseRenewMs })
  log.info('worker.ready', 'Воркер запущен и готов принимать задания', {
    worker: workerId,
    poll_ms: pollMs,
    lease_seconds: leaseSeconds,
    job_types: jobTypes,
    book_edition_ids: bookEditionIds ?? null
  })
  let lastIdleLogAt = 0
  while (!shutdown.signal.aborted) {
    try {
      const result = await worker.runOnce()
      if (result.status === 'idle') {
        if (Date.now() - lastIdleLogAt >= idleLogMs) {
          log.info('worker.idle', 'Очередь пуста, воркер ждёт новые книги', { worker: workerId })
          lastIdleLogAt = Date.now()
        }
        await delay(pollMs, shutdown.signal)
      }
    } catch (error) {
      log.error('worker.queue_unavailable', 'Очередь временно недоступна, повторю попытку', {
        worker: workerId,
        error_code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
      })
      await delay(pollMs, shutdown.signal)
    }
  }
} finally {
  await pool.end()
  log.info('worker.stopped', 'Воркер остановлен', { worker: workerId })
}
