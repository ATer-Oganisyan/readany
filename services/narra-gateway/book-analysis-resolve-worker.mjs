import { resolveBookAnalysisEntities } from './book-analysis-resolver.mjs'
import {
  BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION
} from './book-analysis-contracts.mjs'
import { bookAnalysisLogContext } from './book-analysis-observability.mjs'
import {
  BOOK_ANALYSIS_PIPELINE_NARRA,
  bookAnalysisPipelineForRun
} from './book-analysis-pipeline.mjs'
import { assessBookAnalysisCoverage } from './book-analysis-quality.mjs'
import { createOperationalLogger } from './operational-log.mjs'

function safeErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(candidate) ? candidate : 'UNKNOWN'
}

const NON_RETRYABLE_RESOLUTION_ERRORS = new Set([
  'ANALYSIS_TEXT_COVERAGE_INCOMPLETE',
  'ANALYSIS_CHARACTERS_MISSING',
  'ANALYSIS_METADATA_CHARACTER',
  'ANALYSIS_RELATIONSHIP_CHARACTERS_MISSING'
])

export function createBookAnalysisResolveWorker({
  repository,
  workerId,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  resolveEntities = resolveBookAnalysisEntities,
  generator = null,
  runIds,
  reconciliationVersion = BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
  logger = console
}) {
  if (!repository) throw new TypeError('repository is required')
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
    throw new RangeError('leaseSeconds must be between 30 and 3600')
  }
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1_000 || leaseRenewMs >= leaseSeconds * 1_000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }
  const log = createOperationalLogger({ component: 'analysis-resolve', logger })

  async function resolve(job) {
    const input = await repository.getResolveInput(job)
    const strategy = bookAnalysisPipelineForRun({
      ...input,
      pipelineId: input.pipelineId ?? BOOK_ANALYSIS_PIPELINE_NARRA
    })
    let entities = await resolveEntities({ observations: input.observations })
    const reconciled = await strategy.reconcileIdentities({
      input,
      entities,
      generator,
      reconciliationVersion,
      resolveEntities,
      log
    })
    entities = reconciled.entities
    const acceptedIdentityMerges = reconciled.acceptedIdentityMerges
    const quality = assessBookAnalysisCoverage({
      textLength: input.textLength,
      observations: input.observations,
      entities,
      author: input.author,
      ...strategy.quality
    })
    if (!quality.valid) {
      log.warn('resolve.quality_rejected', 'Разметка не прошла проверку полноты', {
        run: input.runId,
        error_codes: quality.errorCodes,
        covered_bands: quality.coveredBandCount,
        required_bands: quality.requiredBandCount,
        confirmed_characters: quality.confirmedCharacterCount,
        metadata_characters: quality.metadataCharacterCount,
        missing_relationship_characters: quality.missingRelationshipCharacters
      })
      throw Object.assign(new Error('book analysis coverage is incomplete'), {
        code: quality.errorCodes[0]
      })
    }
    const result = await repository.completeResolve(job, {
      observationSetHash: input.observationSetHash,
      observationCount: input.observations.length,
      entities
    })
    log.info('resolve.completed', 'Сущности книги сопоставлены по полному набору фактов', {
      run: input.runId,
      observation_count: input.observations.length,
      entity_count: entities.length,
      accepted_identity_merge_count: acceptedIdentityMerges.length,
      next_stage: result.stage
    })
    return result
  }

  async function withLeaseHeartbeat(job, operation) {
    const timer = setInterval(() => {
      void repository.renewAnalysisJobLease(job, { leaseSeconds }).catch((error) => {
        log.error('resolve.lease_failed', 'Не удалось продлить аренду resolve-задания', {
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
        stages: ['resolve'],
        runIds,
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      const startedAt = performance.now()
      try {
        const result = await withLeaseHeartbeat(job, () => resolve(job))
        log.info('resolve.attempt_completed', 'Resolve-задание завершено', {
          job: job.id,
          ...bookAnalysisLogContext(job, { startedAt, terminalStatus: 'completed' })
        })
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        const failure = await repository.failAnalysisJob(job, errorCode, {
          retryable: !NON_RETRYABLE_RESOLUTION_ERRORS.has(errorCode)
        })
        log.error('resolve.failed', 'Сопоставление сущностей завершилось ошибкой', {
          job: job.id,
          run: job.runId,
          error_code: errorCode,
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
