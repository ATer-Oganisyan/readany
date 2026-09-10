import { randomUUID } from 'node:crypto'
import { createPostgresBookAnalysisRepository } from './book-analysis-repository.mjs'
import { createBookAnalysisPrepareWorker } from './book-analysis-prepare-worker.mjs'
import { createBookAnalysisScanWorker } from './book-analysis-scan-worker.mjs'
import { createBookAnalysisResolveWorker } from './book-analysis-resolve-worker.mjs'
import { createBookAnalysisSynthesizeWorker } from './book-analysis-synthesize-worker.mjs'
import { createBookAnalysisValidateWorker } from './book-analysis-validate-worker.mjs'
import { createBookAnalysisPublishWorker } from './book-analysis-publish-worker.mjs'
import { createBookAnalysisExternalWorker } from './book-analysis-external-worker.mjs'
import { createBookAnalysisScanPolicyFromEnv } from './book-analysis-scan-policy.mjs'
import { createBookObjectStorageFromEnv } from '../books/book-object-storage.mjs'
import { createGenerationServiceClient } from '../providers/generation-service-client.mjs'
import { createExternalBookAdapterClient } from '../providers/external-book-adapter-client.mjs'
import { parseEnvBool, parseEnvInt, parseEnvUuidList } from '../platform/env.mjs'
import { runWorkerLoop, withWorkerRuntime } from '../platform/worker-runtime.mjs'

export const CANONICAL_STAGES = ['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish']
const EXTERNAL_STAGE = 'external'
const KNOWN_STAGES = [...CANONICAL_STAGES, EXTERNAL_STAGE]

// Прежние per-stage переменные заменены общими. Падаем на старте, а не молча
// игнорируем настройку, которую оператор считает действующей.
const REMOVED_ENV = [
  'BOOK_ANALYSIS_WORKER_POLL_MS',
  'BOOK_ANALYSIS_JOB_LEASE_SECONDS',
  ...['SCAN', 'RESOLVE', 'EXTERNAL', 'STAGE'].flatMap((stage) => [
    `BOOK_ANALYSIS_${stage}_POLL_MS`,
    `BOOK_ANALYSIS_${stage}_LEASE_SECONDS`,
    `BOOK_ANALYSIS_${stage}_LEASE_RENEW_MS`,
    `BOOK_ANALYSIS_${stage}_IDLE_LOG_MS`,
    `BOOK_ANALYSIS_${stage}_WORKER_ID`
  ])
]

export function parseAnalysisStages(raw) {
  const values = String(raw ?? '')
    .split(',')
    .flatMap((value) => value.split(/\s+/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  if (!values.length) return [...CANONICAL_STAGES]
  if (values.length === 1 && values[0] === 'all') return [...CANONICAL_STAGES]
  const unknown = values.filter((value) => !KNOWN_STAGES.includes(value))
  if (unknown.length) {
    throw new Error(`unsupported analysis stage: ${unknown.join(', ')}; expected ${KNOWN_STAGES.join(', ')}`)
  }
  // Порядок конвейера важнее порядка аргументов: publish не должен опрашиваться
  // раньше prepare внутри одного процесса.
  return KNOWN_STAGES.filter((stage) => values.includes(stage))
}

function assertRemovedEnvIsUnset(env) {
  const present = REMOVED_ENV.filter((name) => env[name] !== undefined && env[name] !== '')
  if (!present.length) return
  throw new Error(
    `${present.join(', ')} больше не поддерживается; используйте BOOK_ANALYSIS_POLL_MS, ` +
    'BOOK_ANALYSIS_LEASE_SECONDS, BOOK_ANALYSIS_LEASE_RENEW_MS, BOOK_ANALYSIS_IDLE_LOG_MS, ' +
    'BOOK_ANALYSIS_WORKER_ID и BOOK_ANALYSIS_STAGES'
  )
}

function buildStageWorkers({ stages, repository, workerId, runIds, leaseSeconds, leaseRenewMs, env }) {
  const common = { repository, workerId, runIds, leaseSeconds, leaseRenewMs }
  const needs = (...names) => names.some((name) => stages.includes(name))

  let storage = null
  if (needs('prepare', 'scan', 'validate', EXTERNAL_STAGE)) {
    storage = createBookObjectStorageFromEnv(env)
    if (!storage) throw new Error('BOOK_STORAGE_BUCKET is required for prepare, scan, validate and external stages')
  }

  let generator = null
  if (needs('scan', 'resolve', 'synthesize')) {
    generator = createGenerationServiceClient({
      baseUrl: env.GENERATOR_BASE_URL,
      token: env.GENERATOR_SERVICE_TOKEN,
      timeoutMs: parseEnvInt(env, 'GENERATOR_TIMEOUT_MS', 300_000, 900_000)
    })
  }

  const scanPolicy = needs('prepare', 'scan') ? createBookAnalysisScanPolicyFromEnv(env) : null

  const factories = {
    prepare: () => createBookAnalysisPrepareWorker({ ...common, storage, chunkOptions: scanPolicy.chunk }),
    scan: () => createBookAnalysisScanWorker({ ...common, storage, generator, scanPolicy }),
    resolve: () => createBookAnalysisResolveWorker({ ...common, generator }),
    synthesize: () => createBookAnalysisSynthesizeWorker({ ...common, generator }),
    validate: () => createBookAnalysisValidateWorker({ ...common, storage }),
    publish: () => createBookAnalysisPublishWorker(common),
    [EXTERNAL_STAGE]: () => createBookAnalysisExternalWorker({
      repository,
      storage,
      workerId,
      leaseSeconds,
      leaseRenewMs,
      adapter: createExternalBookAdapterClient({
        baseUrl: env.AUTIOBOOK_ADAPTER_BASE_URL,
        token: env.AUTIOBOOK_ADAPTER_TOKEN,
        timeoutMs: parseEnvInt(env, 'AUTIOBOOK_ADAPTER_TIMEOUT_MS', 3_600_000, 14_400_000)
      })
    })
  }

  return {
    scanPolicy,
    slots: stages.map((stage) => ({ name: stage, workerId, worker: factories[stage]() }))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  assertRemovedEnvIsUnset(env)

  const stages = parseAnalysisStages(process.argv.slice(2).join(',') || env.BOOK_ANALYSIS_STAGES)
  const workerId = String(env.BOOK_ANALYSIS_WORKER_ID || `book-analysis-${randomUUID()}`)
  const pollMs = parseEnvInt(env, 'BOOK_ANALYSIS_POLL_MS', 1_000, 60_000)
  const idleLogMs = parseEnvInt(env, 'BOOK_ANALYSIS_IDLE_LOG_MS', 300_000, 3_600_000)
  const leaseSeconds = parseEnvInt(env, 'BOOK_ANALYSIS_LEASE_SECONDS', 300, 3_600)
  const leaseRenewMs = parseEnvInt(env, 'BOOK_ANALYSIS_LEASE_RENEW_MS', 60_000, 1_800_000)
  const runIds = parseEnvUuidList(env, 'BOOK_ANALYSIS_RUN_IDS')
  if (leaseSeconds < 30) throw new Error('BOOK_ANALYSIS_LEASE_SECONDS must be at least 30')
  if (leaseRenewMs >= leaseSeconds * 1_000) {
    throw new Error('BOOK_ANALYSIS_LEASE_RENEW_MS must be shorter than the job lease')
  }

  await withWorkerRuntime(
    { component: 'analysis-worker', workerType: 'book-analysis', workerId },
    async ({ pool, log, signal }) => {
      const repository = createPostgresBookAnalysisRepository(pool, {
        mediaGenerationEnabled: parseEnvBool(env, 'BOOK_ANALYSIS_MEDIA_GENERATION_ENABLED', true)
      })
      const { slots, scanPolicy } = buildStageWorkers({
        stages,
        repository,
        workerId,
        runIds,
        leaseSeconds,
        leaseRenewMs,
        env
      })
      log.info('worker.ready', 'Воркер анализа книг запущен', {
        worker: workerId,
        stages,
        run_ids: runIds ?? null,
        scan_policy: scanPolicy?.profile ?? null,
        scan_chunk: scanPolicy?.chunk ?? null,
        poll_ms: pollMs,
        lease_seconds: leaseSeconds
      })
      await runWorkerLoop({
        slots,
        pollMs,
        idleLogMs,
        log,
        signal,
        workerId,
        queueLabel: 'анализа'
      })
    }
  )
}
