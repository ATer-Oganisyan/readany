import { validateBookMarkupV3 } from './book-analysis-validator.mjs'
import { bookAnalysisLogContext } from './book-analysis-observability.mjs'
import { createOperationalLogger } from './operational-log.mjs'

function errorCode(error) {
  const value = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(value) ? value : 'UNKNOWN'
}

export function createBookAnalysisValidateWorker({
  repository,
  storage,
  workerId,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  logger = console
}) {
  if (!repository || !storage) throw new TypeError('repository and storage are required')
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1_000 || leaseRenewMs >= leaseSeconds * 1_000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }
  const log = createOperationalLogger({ component: 'analysis-validate', logger })
  return {
    async runOnce() {
      const job = await repository.claimAnalysisJob(workerId, { stages: ['validate'], leaseSeconds })
      if (!job) return { status: 'idle' }
      const startedAt = performance.now()
      const timer = setInterval(() => {
        void repository.renewAnalysisJobLease(job, { leaseSeconds }).catch(() => {})
      }, leaseRenewMs)
      timer.unref?.()
      try {
        const input = await repository.getValidationInput(job)
        const stored = await storage.getBytes({
          objectKey: input.normalizedTextObjectKey,
          maxBytes: 128 * 1024 * 1024
        })
        const normalizedText = new TextDecoder('utf-8', { fatal: true }).decode(stored.bytes)
        const report = validateBookMarkupV3({
          markup: input.artifact.data,
          snapshot: input.snapshot,
          observations: input.observations,
          normalizedText,
          normalizedTextHash: input.normalizedTextHash
        })
        const result = await repository.completeValidation(job, {
          report: {
            ...report,
            bindings: {
              snapshotId: input.snapshot.id,
              snapshotContentHash: input.snapshot.contentHash,
              normalizedTextHash: input.normalizedTextHash,
              markupArtifactId: input.artifact.id,
              markupContentHash: input.artifact.contentHash
            }
          }
        })
        log.info('validation.completed', 'Независимая проверка разметки завершена', {
          run: job.runId, valid: report.valid, error_count: report.errors.length,
          ...bookAnalysisLogContext(job, {
            startedAt,
            terminalStatus: report.valid ? 'completed' : 'failed',
            errorCode: report.valid ? undefined : 'MARKUP_VALIDATION_FAILED'
          })
        })
        return {
          status: result.status === 'failed' ? 'failed' : 'completed',
          jobId: job.id,
          runId: job.runId,
          result
        }
      } catch (error) {
        const code = errorCode(error)
        const failure = await repository.failAnalysisJob(job, code)
        log.error('validation.failed', 'Проверка разметки завершилась ошибкой', {
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
