import { createHash } from 'node:crypto'
import { normalizeBookAnalysisObservation } from './book-analysis-contracts.mjs'
import { bookAnalysisLogContext } from './book-analysis-observability.mjs'
import {
  BOOK_ANALYSIS_PIPELINE_EXTERNAL,
  EXTERNAL_ADAPTER_CONTRACT_VERSION,
  bookAnalysisPipelineForRun,
  getBookAnalysisPipeline
} from './book-analysis-pipeline.mjs'
import { createOperationalLogger } from './operational-log.mjs'

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const ALLOWED_OBSERVATION_TYPES = new Set(['character_dialogue', 'character_alias'])
const NON_RETRYABLE_ERRORS = new Set([
  'EXTERNAL_RESPONSE_INVALID',
  'EXTERNAL_SOURCE_MISMATCH'
])

function workerError(code, message) {
  return Object.assign(new Error(message), { code })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(candidate) ? candidate : 'UNKNOWN'
}

export function normalizeExternalBookObservations(rawObservations, sourceText) {
  if (!Array.isArray(rawObservations) || rawObservations.length > 100_000) {
    throw workerError('EXTERNAL_RESPONSE_INVALID', 'external observations are invalid')
  }
  const byKey = new Map()
  for (const raw of rawObservations) {
    if (
      !ALLOWED_OBSERVATION_TYPES.has(raw?.type) ||
      raw?.evidence?.offsetEncoding !== 'utf-16'
    ) {
      throw workerError(
        'EXTERNAL_RESPONSE_INVALID',
        'external evidence type or offset encoding is invalid'
      )
    }
    let observation
    try {
      observation = normalizeBookAnalysisObservation(raw)
    } catch (error) {
      throw workerError('EXTERNAL_RESPONSE_INVALID', error.message)
    }
    if (
      sourceText.slice(observation.evidence.startOffset, observation.evidence.endOffset) !==
      observation.evidence.quote
    ) {
      continue
    }
    if (!byKey.has(observation.observationKey)) {
      byKey.set(observation.observationKey, observation)
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.evidence.startOffset - right.evidence.startOffset ||
    left.evidence.endOffset - right.evidence.endOffset ||
    left.observationKey.localeCompare(right.observationKey)
  )
}

export function createBookAnalysisExternalWorker({
  repository,
  storage,
  adapter,
  workerId,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  maxBookBytes = 128 * 1024 * 1024,
  logger = console
}) {
  if (!repository || !storage || !adapter) {
    throw new TypeError('repository, storage and adapter are required')
  }
  if (typeof storage.getBytes !== 'function') throw new TypeError('storage.getBytes is required')
  if (typeof adapter.analyzeBook !== 'function') throw new TypeError('adapter.analyzeBook is required')
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1_000 || leaseRenewMs >= leaseSeconds * 1_000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }
  const strategy = getBookAnalysisPipeline(BOOK_ANALYSIS_PIPELINE_EXTERNAL)
  const log = createOperationalLogger({ component: 'analysis-external', logger })

  async function analyze(job) {
    const input = await repository.getExternalScanInput(job)
    const runStrategy = bookAnalysisPipelineForRun(input)
    if (
      runStrategy !== strategy ||
      input.extractorVersion !== EXTERNAL_ADAPTER_CONTRACT_VERSION
    ) {
      throw workerError('PIPELINE_MISMATCH', 'external worker received another pipeline')
    }
    const stored = await storage.getBytes({
      objectKey: input.normalizedTextObjectKey,
      maxBytes: maxBookBytes
    })
    let sourceText
    try {
      sourceText = UTF8_DECODER.decode(stored.bytes)
    } catch (error) {
      throw workerError('EXTERNAL_SOURCE_MISMATCH', `normalized text is not UTF-8: ${error.message}`)
    }
    if (
      sourceText.length !== input.textLength ||
      sha256(sourceText) !== input.normalizedTextHash
    ) {
      throw workerError('EXTERNAL_SOURCE_MISMATCH', 'stored normalized text failed integrity check')
    }
    const response = await adapter.analyzeBook({
      runId: input.runId,
      text: sourceText,
      sourceSha256: input.normalizedTextHash,
      normalizationVersion: input.normalizationVersion,
      outputSchemaVersion: input.outputSchemaVersion
    })
    if (
      response.sourceSha256 !== input.normalizedTextHash ||
      response.extractorVersion !== EXTERNAL_ADAPTER_CONTRACT_VERSION
    ) {
      throw workerError('EXTERNAL_SOURCE_MISMATCH', 'external adapter analyzed another source')
    }
    const observations = normalizeExternalBookObservations(response.observations, sourceText)
    const result = await repository.completeExternalScan(job, {
      extractorVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
      observations
    })
    log.info('external.completed', 'Книга обработана изолированным external-адаптером', {
      run: input.runId,
      observation_count: observations.length,
      next_stage: result.stage
    })
    return result
  }

  async function withLeaseHeartbeat(job, operation) {
    const timer = setInterval(() => {
      void repository.renewAnalysisJobLease(job, { leaseSeconds }).catch((error) => {
        log.error('external.lease_failed', 'Не удалось продлить аренду external-задания', {
          job: job.id,
          run: job.runId,
          error_code: safeErrorCode(error)
        })
      })
    }, leaseRenewMs)
    timer.unref?.()
    try {
      return await operation()
    } finally {
      clearInterval(timer)
    }
  }

  return {
    async runOnce() {
      const job = await repository.claimAnalysisJob(workerId, {
        stages: ['scan'],
        pipelineIds: [BOOK_ANALYSIS_PIPELINE_EXTERNAL],
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      const startedAt = performance.now()
      try {
        const result = await withLeaseHeartbeat(job, () => analyze(job))
        log.info('external.attempt_completed', 'External-задание завершено', {
          job: job.id,
          ...bookAnalysisLogContext(job, { startedAt, terminalStatus: 'completed' })
        })
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        const failure = await repository.failAnalysisJob(job, errorCode, {
          retryable: !NON_RETRYABLE_ERRORS.has(errorCode)
        })
        log.error('external.failed', 'External-разметка завершилась ошибкой', {
          job: job.id,
          run: job.runId,
          retry_status: failure.status,
          ...bookAnalysisLogContext(job, {
            startedAt,
            terminalStatus: failure.status,
            errorCode
          })
        })
        return { status: 'failed', jobId: job.id, runId: job.runId, errorCode }
      }
    }
  }
}
