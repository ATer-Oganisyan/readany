import { assembleBookMarkupV3 } from './book-analysis-assembler.mjs'
import { BOOK_ANALYSIS_SYNTHESIS_VERSION } from './book-analysis-contracts.mjs'
import { selectCharacterSynthesisEvidence } from './book-analysis-synthesis.mjs'
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

  async function synthesize(job) {
    const input = await repository.getSynthesizeInput(job)
    if (input.mode === 'character_profile') {
      const selectedEvidence = selectCharacterSynthesisEvidence(input.observations).map((observation) => ({
        id: observation.id,
        type: observation.type,
        fact: observation.fact,
        quote: observation.evidence.quote,
        startOffset: observation.evidence.startOffset,
        endOffset: observation.evidence.endOffset,
        confidence: observation.confidence
      }))
      const modelEntity = {
        entityKey: input.entity.entityKey,
        entityKind: input.entity.entityKind,
        canonicalName: input.entity.canonicalName,
        aliases: input.entity.aliases.slice(0, 16),
        resolutionStatus: input.entity.resolutionStatus,
        confidence: input.entity.confidence,
        evidenceIds: selectedEvidence.map(({ id }) => id),
        data: {
          observationCount: input.entity.data.observationCount,
          firstEvidenceStartOffset: input.entity.data.firstEvidenceStartOffset,
          lastEvidenceEndOffset: input.entity.data.lastEvidenceEndOffset
        }
      }
      const generated = await generator.synthesizeCharacterProfile({
        runId: input.runId,
        snapshotId: input.snapshot.id,
        synthesisVersion,
        bookTitle: input.title,
        bookAuthor: input.author,
        textLength: input.textLength,
        entity: modelEntity,
        evidence: selectedEvidence
      })
      return repository.completeCharacterSynthesis(job, {
        snapshotId: input.snapshot.id,
        synthesisVersion,
        selectedEvidenceIds: selectedEvidence.map(({ id }) => id),
        profile: generated.profile
      })
    }
    if (input.mode === 'assemble_book') {
      const markup = assembleBookMarkupV3({
        snapshotId: input.snapshot.id,
        textLength: input.textLength,
        entities: input.snapshot.data.entities,
        observations: input.observations,
        characterProfiles: input.characterProfiles
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
    const timer = setInterval(() => {
      void repository.renewAnalysisJobLease(job, { leaseSeconds }).catch(() => {})
    }, leaseRenewMs)
    timer.unref?.()
    try { return await operation() } finally { clearInterval(timer) }
  }

  return {
    async runOnce() {
      const job = await repository.claimAnalysisJob(workerId, {
        stages: ['synthesize'],
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      try {
        const result = await withLeaseHeartbeat(job, () => synthesize(job))
        log.info('synthesis.completed', 'Задание синтеза завершено', {
          job: job.id, run: job.runId, shard: job.shardKey, next_stage: result.stage
        })
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        const failure = await repository.failAnalysisJob(job, errorCode)
        log.error('synthesis.failed', 'Задание синтеза завершилось ошибкой', {
          job: job.id, run: job.runId, error_code: errorCode, retry_status: failure.status
        })
        return { status: 'failed', jobId: job.id, runId: job.runId, errorCode }
      }
    }
  }
}
