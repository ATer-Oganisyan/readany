import { resolveBookAnalysisEntities } from './book-analysis-resolver.mjs'
import { createOperationalLogger } from './operational-log.mjs'

function safeErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(candidate) ? candidate : 'UNKNOWN'
}

export function createBookAnalysisResolveWorker({
  repository,
  workerId,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  resolveEntities = resolveBookAnalysisEntities,
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
    const entities = await resolveEntities({ observations: input.observations })
    const result = await repository.completeResolve(job, {
      observationSetHash: input.observationSetHash,
      observationCount: input.observations.length,
      entities
    })
    log.info('resolve.completed', 'Сущности книги сопоставлены по полному набору фактов', {
      run: input.runId,
      observation_count: input.observations.length,
      entity_count: entities.length,
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
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      try {
        const result = await withLeaseHeartbeat(job, () => resolve(job))
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        const failure = await repository.failAnalysisJob(job, errorCode)
        log.error('resolve.failed', 'Сопоставление сущностей завершилось ошибкой', {
          job: job.id,
          run: job.runId,
          error_code: errorCode,
          retry_status: failure.status
        })
        return { status: 'failed', jobId: job.id, runId: job.runId, errorCode }
      }
    }
  }
}
