import { createHash } from 'node:crypto'
import { createStableBookChunks } from './book-analysis-chunking.mjs'
import { bookAnalysisLogContext } from './book-analysis-observability.mjs'
import { extractStructuredBookText } from './book-source-text.mjs'
import { createOperationalLogger } from './operational-log.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(candidate) ? candidate : 'UNKNOWN'
}

export function createBookAnalysisPrepareWorker({
  repository,
  storage,
  workerId,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  maxBookBytes = 64 * 1024 * 1024,
  chunkOptions,
  extractStructuredText = extractStructuredBookText,
  logger = console
}) {
  if (!repository || !storage) throw new TypeError('repository and storage are required')
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
    throw new RangeError('leaseSeconds must be between 30 and 3600')
  }
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1_000 || leaseRenewMs >= leaseSeconds * 1_000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }
  const log = createOperationalLogger({ component: 'analysis-prepare', logger })

  async function prepare(job) {
    const input = await repository.getPrepareInput(job)
    const stored = await storage.getBytes({
      objectKey: input.objectKey,
      maxBytes: Math.min(maxBookBytes, 512 * 1024 * 1024)
    })
    if (stored.bytes.byteLength !== input.byteSize || sha256(stored.bytes) !== input.inputHash) {
      throw Object.assign(new Error('stored book does not match its immutable metadata'), {
        code: 'BOOK_INTEGRITY'
      })
    }
    const structured = await extractStructuredText({
      bytes: stored.bytes,
      format: input.format,
      mimeType: input.mimeType
    })
    const chunks = createStableBookChunks({
      runId: input.runId,
      text: structured.text,
      sections: structured.sections
    }, chunkOptions)
    const normalizedTextObjectKey = `analysis/${input.runId}/normalized-text-v1.txt`
    const normalizedTextHash = sha256(structured.text)
    const uploaded = await storage.putBytes({
      objectKey: normalizedTextObjectKey,
      bytes: Buffer.from(structured.text, 'utf8'),
      mimeType: 'text/plain'
    })
    if (uploaded.contentHash !== normalizedTextHash) {
      throw Object.assign(new Error('normalized text failed storage integrity check'), {
        code: 'BOOK_INTEGRITY'
      })
    }
    const result = await repository.completePrepare(job, {
      normalizedTextObjectKey,
      normalizedTextHash,
      textLength: structured.textLength,
      sections: structured.sections,
      contentNavigation: structured.navigation,
      chunks
    })
    log.info('prepare.completed', 'Книга подготовлена для параллельного анализа', {
      run: input.runId,
      book: input.title,
      text_chars: structured.textLength,
      chunk_count: chunks.length
    })
    return result
  }

  async function withLeaseHeartbeat(job, operation) {
    const timer = setInterval(() => {
      void repository.renewAnalysisJobLease(job, { leaseSeconds }).catch((error) => {
        log.error('prepare.lease_failed', 'Не удалось продлить аренду задания', {
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
        stages: ['prepare'],
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      const startedAt = performance.now()
      try {
        const result = await withLeaseHeartbeat(job, () => prepare(job))
        log.info('prepare.attempt_completed', 'Prepare-задание завершено', {
          job: job.id,
          ...bookAnalysisLogContext(job, { startedAt, terminalStatus: 'completed' })
        })
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        const failure = await repository.failAnalysisJob(job, errorCode)
        log.error('prepare.failed', 'Подготовка книги завершилась ошибкой', {
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
