import { createHash } from 'node:crypto'
import {
  assembleBookTtsScript,
  createBookTtsMarkupRequests,
  createBookTtsSectionDrafts,
  normalizeBookTtsAssignments,
  normalizeBookTtsScript
} from './book-tts-markup.mjs'

const UTF8 = new TextDecoder('utf-8', { fatal: true })

function safeCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

function sectionsFromNavigation(text, navigation) {
  const segments = Array.isArray(navigation?.segments) ? navigation.segments : []
  if (!segments.length) {
    return [{ key: 'document', title: '', index: 0, startOffset: 0, endOffset: text.length }]
  }
  const bytes = Buffer.from(text, 'utf8')
  const charOffset = (byteOffset) => {
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset > bytes.length) {
      throw Object.assign(new Error('navigation byte offset is invalid'), { code: 'SOURCE_MISMATCH' })
    }
    return bytes.subarray(0, byteOffset).toString('utf8').length
  }
  return segments.map((segment, index) => ({
    key: String(segment.key || `section-${index}`),
    title: String(segment.title || ''),
    index: Number.isSafeInteger(segment.index) ? segment.index : index,
    startOffset: Number.isSafeInteger(segment.startOffset)
      ? segment.startOffset
      : charOffset(segment.startByte),
    endOffset: Number.isSafeInteger(segment.endOffset)
      ? segment.endOffset
      : charOffset(segment.endByte)
  }))
}

export function createBookTtsMarkupWorker({
  repository,
  storage,
  generator,
  workerId,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  maxBookBytes = 128 * 1024 * 1024,
  logger = console
}) {
  if (!repository || !storage || !generator) throw new TypeError('repository, storage and generator are required')
  if (!workerId) throw new TypeError('workerId is required')
  if (leaseRenewMs >= leaseSeconds * 1_000) throw new RangeError('leaseRenewMs must be shorter than lease')

  async function process(job) {
    const input = await repository.getJobInput(job)
    const stored = await storage.getBytes({
      objectKey: input.normalizedTextObjectKey,
      maxBytes: maxBookBytes
    })
    const text = UTF8.decode(stored.bytes)
    if (
      text.length !== input.textLength ||
      createHash('sha256').update(text).digest('hex') !== input.normalizedTextHash
    ) {
      throw Object.assign(new Error('normalized source failed integrity verification'), {
        code: 'SOURCE_MISMATCH'
      })
    }
    const drafts = createBookTtsSectionDrafts({
      text,
      sections: sectionsFromNavigation(text, input.navigation)
    })
    const requests = createBookTtsMarkupRequests({
      bookEditionId: job.bookEditionId,
      sourcePublicationId: job.sourcePublicationId,
      normalizedTextHash: input.normalizedTextHash,
      drafts,
      characters: input.characters
    })
    const assignments = []
    for (const request of requests) {
      const result = await generator.generateBookTtsMarkup({
        ...request,
        bookTitle: input.title,
        bookAuthor: input.author
      })
      assignments.push(...normalizeBookTtsAssignments(result, {
        coreAtoms: request.coreAtoms,
        characters: request.characters
      }))
    }
    const script = normalizeBookTtsScript(assembleBookTtsScript({
      sourceText: text,
      sourcePublicationId: job.sourcePublicationId,
      sourceMarkupContentHash: input.sourceMarkupContentHash,
      normalizedTextHash: input.normalizedTextHash,
      drafts,
      assignments
    }), text)
    await repository.completeJob(job, script)
    logger.info?.('[book-tts-markup] completed', {
      job: job.id,
      edition: job.bookEditionId,
      sections: script.sections.length,
      requests: requests.length
    })
    return { sectionCount: script.sections.length, requestCount: requests.length }
  }

  async function withLease(job, operation) {
    const timer = setInterval(() => {
      void repository.renewJobLease(job, { leaseSeconds }).catch(() => {})
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
      const job = await repository.claimJob(workerId, { leaseSeconds })
      if (!job) return { status: 'idle' }
      try {
        const result = await withLease(job, () => process(job))
        return { status: 'completed', jobId: job.id, result }
      } catch (error) {
        const code = safeCode(error)
        await repository.failJob(job, code)
        logger.error?.('[book-tts-markup] failed', { job: job.id, error_code: code })
        return { status: 'failed', jobId: job.id, errorCode: code }
      }
    }
  }
}
