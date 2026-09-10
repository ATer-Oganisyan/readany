import { randomUUID } from 'node:crypto'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import { createPostgresBookTtsMarkupRepository } from './book-tts-markup-repository.mjs'
import { createBookTtsMarkupWorker } from './book-tts-markup-worker.mjs'
import { parseEnvInt } from './env.mjs'
import { runWorkerLoop, withWorkerRuntime } from './worker-runtime.mjs'

const env = process.env
const workerId = String(env.BOOK_TTS_MARKUP_WORKER_ID || `book-tts-${randomUUID()}`)
const pollMs = parseEnvInt(env, 'BOOK_TTS_MARKUP_WORKER_POLL_MS', 1_000, 60_000)
const idleLogMs = parseEnvInt(env, 'BOOK_TTS_MARKUP_IDLE_LOG_MS', 300_000, 3_600_000)
const leaseSeconds = parseEnvInt(env, 'BOOK_TTS_MARKUP_JOB_LEASE_SECONDS', 600, 3_600)
const leaseRenewMs = parseEnvInt(env, 'BOOK_TTS_MARKUP_LEASE_RENEW_MS', 60_000, 1_800_000)

await withWorkerRuntime(
  { component: 'book-tts-markup-worker', workerType: 'book-tts-markup', workerId },
  async ({ pool, log, signal }) => {
    const worker = createBookTtsMarkupWorker({
      repository: createPostgresBookTtsMarkupRepository(pool),
      storage: createBookObjectStorageFromEnv(env),
      generator: createGenerationServiceClient({
        baseUrl: env.GENERATOR_BASE_URL,
        token: env.GENERATOR_SERVICE_TOKEN,
        timeoutMs: parseEnvInt(env, 'GENERATOR_TIMEOUT_MS', 600_000, 900_000)
      }),
      workerId,
      leaseSeconds,
      leaseRenewMs
    })
    log.info('worker.ready', 'TTS-воркер разметки запущен', {
      worker: workerId,
      poll_ms: pollMs,
      lease_seconds: leaseSeconds
    })
    await runWorkerLoop({
      slots: [{ name: 'tts-markup', workerId, worker }],
      pollMs,
      idleLogMs,
      log,
      signal,
      workerId,
      queueLabel: 'TTS-разметки'
    })
  }
)
