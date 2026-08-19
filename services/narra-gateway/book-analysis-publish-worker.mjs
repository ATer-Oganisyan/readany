import { createOperationalLogger } from './operational-log.mjs'
import { bookAnalysisLogContext } from './book-analysis-observability.mjs'

function errorCode(error) {
  const value = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(value) ? value : 'UNKNOWN'
}

export function createBookAnalysisPublishWorker({
  repository,
  workerId,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  logger = console
}) {
  if (!repository) throw new TypeError('repository is required')
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1_000 || leaseRenewMs >= leaseSeconds * 1_000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }
  const log = createOperationalLogger({ component: 'analysis-publish', logger })
  return {
    async runOnce() {
      const job = await repository.claimAnalysisJob(workerId, { stages: ['publish'], leaseSeconds })
      if (!job) return { status: 'idle' }
      const startedAt = performance.now()
      const timer = setInterval(() => {
        void repository.renewAnalysisJobLease(job, { leaseSeconds }).catch(() => {})
      }, leaseRenewMs)
      timer.unref?.()
      try {
        const input = await repository.getPublishInput(job)
        if (input.channel !== 'shadow' || input.validationReport?.valid !== true) {
          throw Object.assign(new Error('only independently validated shadow markup can be published'), {
            code: 'PUBLISH_INPUT_INVALID'
          })
        }
        const result = await repository.completeShadowPublish(job, {
          artifactId: input.artifact.id
        })
        log.info('publish.completed', 'V3-разметка опубликована в shadow-канал', {
          run: job.runId, publication: result.publicationId, channel: 'shadow',
          ...bookAnalysisLogContext(job, { startedAt, terminalStatus: 'ready' })
        })
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const code = errorCode(error)
        const failure = await repository.failAnalysisJob(job, code)
        log.error('publish.failed', 'Публикация разметки завершилась ошибкой', {
          job: job.id,
          ...bookAnalysisLogContext(job, {
            startedAt,
            terminalStatus: failure.status,
            errorCode: code
          })
        })
        return { status: 'failed', jobId: job.id, runId: job.runId, errorCode: code, failure }
      } finally {
        clearInterval(timer)
      }
    }
  }
}
