import { randomUUID } from 'node:crypto'
import { parseEnvInt } from './env.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import { createGenerationWorker } from './generation-worker.mjs'
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

const workerId = String(process.env.BOOK_IDENTITY_WORKER_ID || `book-identity-${randomUUID()}`)
const pollMs = parseEnvInt(process.env, 'BOOK_IDENTITY_WORKER_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(process.env, 'BOOK_IDENTITY_JOB_LEASE_SECONDS', 300, 3_600)
const log = createOperationalLogger({ component: 'book-identity-worker' })

const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const baseRepository = createPostgresBookMarkupRepository(pool)
  const repository = {
    ...baseRepository,
    claimGenerationJob(id) {
      return baseRepository.claimGenerationJob(id, {
        leaseSeconds,
        jobTypes: ['book_identity']
      })
    }
  }
  const generator = createGenerationServiceClient({
    baseUrl: process.env.GENERATOR_BASE_URL,
    token: process.env.GENERATOR_SERVICE_TOKEN,
    timeoutMs: parseEnvInt(process.env, 'GENERATOR_TIMEOUT_MS', 300_000, 900_000)
  })
  const worker = createGenerationWorker({ repository, generator, workerId })
  log.info('worker.ready', 'Воркер названий запущен', { worker: workerId, poll_ms: pollMs })
  while (!shutdown.signal.aborted) {
    try {
      const result = await worker.runOnce()
      if (result.status === 'idle') await delay(pollMs, shutdown.signal)
    } catch (error) {
      log.error('worker.queue_unavailable', 'Очередь названий временно недоступна', {
        worker: workerId,
        error_code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
      })
      await delay(pollMs, shutdown.signal)
    }
  }
} finally {
  await pool.end()
}
