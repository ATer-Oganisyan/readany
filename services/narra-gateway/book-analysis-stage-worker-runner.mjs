import { randomUUID } from 'node:crypto'
import { createPostgresBookAnalysisRepository } from './book-analysis-repository.mjs'
import { createBookAnalysisSynthesizeWorker } from './book-analysis-synthesize-worker.mjs'
import { createBookAnalysisValidateWorker } from './book-analysis-validate-worker.mjs'
import { createBookAnalysisPublishWorker } from './book-analysis-publish-worker.mjs'
import { createBookObjectStorageFromEnv } from './book-object-storage.mjs'
import { createGenerationServiceClient } from './generation-service-client.mjs'
import { parseEnvInt } from './env.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const stage = process.argv[2]
if (!['synthesize', 'validate', 'publish'].includes(stage)) throw new Error('unsupported stage worker')
const shutdown = new AbortController()
process.once('SIGTERM', () => shutdown.abort())
process.once('SIGINT', () => shutdown.abort())
const pollMs = parseEnvInt(process.env, 'BOOK_ANALYSIS_STAGE_POLL_MS', 1_000, 60_000)
const leaseSeconds = parseEnvInt(process.env, 'BOOK_ANALYSIS_STAGE_LEASE_SECONDS', 300, 3_600)
const leaseRenewMs = parseEnvInt(process.env, 'BOOK_ANALYSIS_STAGE_LEASE_RENEW_MS', 60_000, 1_800_000)
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookAnalysisRepository(pool)
  const common = {
    repository,
    workerId: `book-analysis-${stage}-${randomUUID()}`,
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
  while (!shutdown.signal.aborted) {
    const result = await worker.runOnce()
    if (result.status === 'idle') {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }
} finally {
  await pool.end()
}
