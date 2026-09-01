import { randomUUID } from 'node:crypto'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import { createPostgresBookTtsMarkupRepository } from './book-tts-markup-repository.mjs'
import { createBookTtsMarkupWorker } from './book-tts-markup-worker.mjs'
import { parseEnvInt } from './env.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'
import { createWorkerHeartbeat } from './worker-heartbeat.mjs'

const shutdown = new AbortController()
process.once('SIGTERM', () => shutdown.abort())
process.once('SIGINT', () => shutdown.abort())

function delay(milliseconds) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      shutdown.signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    shutdown.signal.addEventListener('abort', finish, { once: true })
  })
}

const workerId = String(process.env.BOOK_TTS_MARKUP_WORKER_ID || `book-tts-${randomUUID()}`)
const pollMs = parseEnvInt(process.env, 'BOOK_TTS_MARKUP_WORKER_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(process.env, 'BOOK_TTS_MARKUP_JOB_LEASE_SECONDS', 600, 3_600)
const leaseRenewMs = parseEnvInt(process.env, 'BOOK_TTS_MARKUP_LEASE_RENEW_MS', 60_000, 1_800_000)
const pool = await createPostgresPoolFromEnv(process.env)
let heartbeat

try {
  await runBookMarkupMigrations(pool)
  heartbeat = createWorkerHeartbeat({
    pool,
    workerId,
    workerType: process.env.WORKER_TYPE || 'book-tts-markup'
  })
  await heartbeat.start()
  const worker = createBookTtsMarkupWorker({
    repository: createPostgresBookTtsMarkupRepository(pool),
    storage: createBookObjectStorageFromEnv(process.env),
    generator: createGenerationServiceClient({
      baseUrl: process.env.GENERATOR_BASE_URL,
      token: process.env.GENERATOR_SERVICE_TOKEN,
      timeoutMs: parseEnvInt(process.env, 'GENERATOR_TIMEOUT_MS', 600_000, 900_000)
    }),
    workerId,
    leaseSeconds,
    leaseRenewMs
  })
  while (!shutdown.signal.aborted) {
    const result = await worker.runOnce().catch((error) => {
      console.error('[book-tts-markup] worker loop failed', error)
      return { status: 'idle' }
    })
    if (result.status === 'idle') await delay(pollMs)
  }
} finally {
  heartbeat?.stop()
  await pool.end()
}
