import { assembleBookMarkupV3 } from './book-analysis-assembler.mjs'
import { BOOK_ANALYSIS_SYNTHESIS_VERSION } from './book-analysis-contracts.mjs'
import { bookAnalysisLogContext } from './book-analysis-observability.mjs'
import {
  BOOK_ANALYSIS_PIPELINE_NARRA,
  bookAnalysisPipelineForRun
} from './book-analysis-pipeline.mjs'
import { createOperationalLogger } from './operational-log.mjs'

function safeErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(candidate) ? candidate : 'UNKNOWN'
}

export function createBookAnalysisSynthesizeWorker({
  repository,
  generator,
  workerId,
  synthesisVersion = BOOK_ANALYSIS_SYNTHESIS_VERSION,
  runIds,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  logger = console
}) {
  if (!repository || !generator) throw new TypeError('repository and generator are required')
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1_000 || leaseRenewMs >= leaseSeconds * 1_000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }
  const log = createOperationalLogger({ component: 'analysis-synthesize', logger })

  async function synthesize(job, signal) {
    const input = await repository.getSynthesizeInput(job)
    signal.throwIfAborted()
    const strategy = bookAnalysisPipelineForRun({
      ...input,
      pipelineId: input.pipelineId ?? BOOK_ANALYSIS_PIPELINE_NARRA
    })
    if (input.mode === 'character_profile') {
      const synthesized = await strategy.synthesizeCharacter({
        input,
        generator,
        synthesisVersion,
        signal
      })
      signal.throwIfAborted()
      return repository.completeCharacterSynthesis(job, {
        snapshotId: input.snapshot.id,
        ...synthesized
      })
    }
    if (input.mode === 'assemble_book') {
      const markup = assembleBookMarkupV3({
        snapshotId: input.snapshot.id,
        textLength: input.textLength,
        entities: input.snapshot.data.entities,
        observations: input.observations,
        characterProfiles: input.characterProfiles,
        characterSelection: input.snapshot.data.characterSelection
      })
      return repository.completeBookSynthesis(job, {
        snapshotId: input.snapshot.id,
        markup
      })
    }
    throw Object.assign(new Error(`unsupported synthesize mode: ${input.mode}`), {
      code: 'SYNTHESIS_MODE_INVALID'
    })
  }

  async function withLeaseHeartbeat(job, operation) {
    const controller = new AbortController()
    let renewing = false
    const timer = setInterval(() => {
      if (renewing || controller.signal.aborted) return
      renewing = true
      void Promise.resolve().then(() => repository.renewAnalysisJobLease(job, { leaseSeconds }))
        .catch((error) => {
          // A transient database failure is not proof that another worker owns the job.
          if (error?.code === 'LEASE_LOST') controller.abort(error)
        }).finally(() => { renewing = false })
    }, leaseRenewMs)
    timer.unref?.()
    try {
      return await operation(controller.signal)
    } catch (error) {
      // Fetch may report AbortError while reading a body instead of our lease reason.
      controller.signal.throwIfAborted()
      throw error
    } finally { clearInterval(timer) }
  }

  return {
    async runOnce() {
      const job = await repository.claimAnalysisJob(workerId, {
        stages: ['synthesize'],
        runIds,
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      const startedAt = performance.now()
      try {
        const result = await withLeaseHeartbeat(job, (signal) => synthesize(job, signal))
        log.info('synthesis.completed', 'Задание синтеза завершено', {
          job: job.id, run: job.runId, shard: job.shardKey, next_stage: result.stage,
          ...bookAnalysisLogContext(job, { startedAt, terminalStatus: 'completed' })
        })
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        if (errorCode === 'LEASE_LOST') {
          log.error('synthesis.lease_lost', 'Синтез остановлен после потери задания', {
            job: job.id, run: job.runId, error_code: errorCode
          })
          // The new owner alone may complete, fail or retry this job.
          return { status: 'failed', jobId: job.id, runId: job.runId, errorCode }
        }
        const failure = await repository.failAnalysisJob(job, errorCode)
        log.error('synthesis.failed', 'Задание синтеза завершилось ошибкой', {
          job: job.id, run: job.runId, error_code: errorCode, retry_status: failure.status,
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
