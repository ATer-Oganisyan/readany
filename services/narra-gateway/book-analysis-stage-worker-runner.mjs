import { randomUUID } from 'node:crypto'
import { createPostgresBookAnalysisRepository } from './book-analysis-repository.mjs'
import { createBookAnalysisSynthesizeWorker } from './book-analysis-synthesize-worker.mjs'
import { createBookAnalysisValidateWorker } from './book-analysis-validate-worker.mjs'
import { createBookAnalysisPublishWorker } from './book-analysis-publish-worker.mjs'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import { parseEnvBool, parseEnvInt, parseEnvUuidList } from './env.mjs'
import { createOperationalLogger } from './operational-log.mjs'
import { createWorkerHeartbeat } from './worker-heartbeat.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const stage = process.argv[2]
if (!['synthesize', 'validate', 'publish'].includes(stage)) throw new Error('unsupported stage worker')

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
const pollMs = parseEnvInt(process.env, 'BOOK_ANALYSIS_STAGE_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(process.env, 'BOOK_ANALYSIS_STAGE_LEASE_SECONDS', 300, 3_600)
const leaseRenewMs = parseEnvInt(process.env, 'BOOK_ANALYSIS_STAGE_LEASE_RENEW_MS', 60_000, 1_800_000)
const idleLogMs = parseEnvInt(process.env, 'BOOK_ANALYSIS_STAGE_IDLE_LOG_MS', 300_000, 3_600_000)
const runIds = parseEnvUuidList(process.env, 'BOOK_ANALYSIS_RUN_IDS')
if (leaseSeconds < 30) throw new Error('BOOK_ANALYSIS_STAGE_LEASE_SECONDS must be at least 30')
if (leaseRenewMs >= leaseSeconds * 1_000) {
  throw new Error('BOOK_ANALYSIS_STAGE_LEASE_RENEW_MS must be shorter than the job lease')
}
const workerId = String(
  process.env[`BOOK_ANALYSIS_${stage.toUpperCase()}_WORKER_ID`] ||
  `book-analysis-${stage}-${randomUUID()}`
)
const log = createOperationalLogger({ component: `analysis-${stage}-worker` })
const pool = await createPostgresPoolFromEnv(process.env)
let heartbeat
try {
  await runBookMarkupMigrations(pool)
  heartbeat = createWorkerHeartbeat({
    pool,
    workerId,
    workerType: process.env.WORKER_TYPE || `book-analysis-${stage}`,
    logger: log
  })
  await heartbeat.start()
  const repository = createPostgresBookAnalysisRepository(pool, {
    mediaGenerationEnabled: parseEnvBool(
      process.env,
      'BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED',
      true
    )
  })
  const common = {
    repository,
    workerId,
    runIds,
    leaseSeconds,
    leaseRenewMs
  }
  let worker
  if (stage === 'synthesize') {
    worker = createBookAnalysisSynthesizeWorker({
      ...common,
      generator: createGenerationServiceClient({
        baseUrl: process.env.GENERATOR_BASE_URL,
        token: process.env.GENERATOR_SERVICE_TOKEN,
        timeoutMs: parseEnvInt(process.env, 'GENERATOR_TIMEOUT_MS', 300_000, 900_000)
      })
    })
  } else if (stage === 'validate') {
    const storage = createBookObjectStorageFromEnv(process.env)
    if (!storage) throw new Error('BOOK_STORAGE_BUCKET is required')
    worker = createBookAnalysisValidateWorker({ ...common, storage })
  } else {
    worker = createBookAnalysisPublishWorker(common)
  }
  log.info('worker.ready', `${stage}-воркер запущен`, {
    worker: workerId,
    stages: [stage],
    run_ids: runIds ?? null,
    poll_ms: pollMs,
    lease_seconds: leaseSeconds
  })
  let lastIdleLogAt = 0
  while (!shutdown.signal.aborted) {
    try {
      const result = await worker.runOnce()
      if (result.status === 'idle') {
        if (Date.now() - lastIdleLogAt >= idleLogMs) {
          log.info('worker.idle', `Очередь ${stage}-заданий пуста`, { worker: workerId })
          lastIdleLogAt = Date.now()
        }
        await delay(pollMs, shutdown.signal)
      }
    } catch (error) {
      log.error('worker.queue_unavailable', `Очередь ${stage}-заданий временно недоступна`, {
        worker: workerId,
        error_code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
      })
      await delay(pollMs, shutdown.signal)
    }
  }
} finally {
  heartbeat?.stop()
  await pool.end()
  log.info('worker.stopped', `${stage}-воркер остановлен`, { worker: workerId })
}
