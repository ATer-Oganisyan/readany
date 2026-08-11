import { randomUUID } from 'node:crypto'
import { parseEnvInt } from './env.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import { createGenerationWorker } from './generation-worker.mjs'
import { createPostgresBookMarkupRepository } from './postgres-book-markup-repository.mjs'
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

const workerId = String(process.env.BOOK_MARKUP_WORKER_ID || `book-markup-${randomUUID()}`)
const pollMs = parseEnvInt(process.env, 'BOOK_MARKUP_WORKER_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(process.env, 'BOOK_MARKUP_JOB_LEASE_SECONDS', 300, 3_600)
const leaseRenewMs = parseEnvInt(process.env, 'BOOK_MARKUP_LEASE_RENEW_MS', 60_000, 1_800_000)
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
      return baseRepository.claimGenerationJob(id, { leaseSeconds })
    }
  }
  const generator = createGenerationServiceClient({
    baseUrl: process.env.GENERATOR_BASE_URL,
    token: process.env.GENERATOR_SERVICE_TOKEN,
    timeoutMs: parseEnvInt(process.env, 'GENERATOR_TIMEOUT_MS', 300_000, 900_000)
  })
  const worker = createGenerationWorker({ repository, generator, workerId, leaseRenewMs })
  console.info('[book-markup-worker] ready', { workerId })
  while (!shutdown.signal.aborted) {
    try {
      const result = await worker.runOnce()
      if (result.status === 'idle') await delay(pollMs, shutdown.signal)
    } catch (error) {
      console.error('[book-markup-worker] queue unavailable', {
        workerId,
        errorCode: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
      })
      await delay(pollMs, shutdown.signal)
    }
  }
} finally {
  await pool.end()
  console.info('[book-markup-worker] stopped', { workerId })
}
