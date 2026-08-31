import { createHash } from 'node:crypto'
import { buildNarrativeGraph, buildStoryArcs } from './book-narrative-graph.mjs'

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const FINAL_ERRORS = new Set([
  'CHUNK_BYTE_RANGE_INVALID', 'CHUNK_UTF8_INVALID', 'CHUNK_INTEGRITY',
  'EMBEDDING_INPUT_INVALID', 'EMBEDDING_RESULT_INVALID',
  'EMBEDDING_RESULT_TOO_LARGE', 'EMBEDDING_CONTRACT'
])
const JOB_TYPES = new Set(['lexical', 'embedding', 'graph', 'story_arc'])
const BOOK_SCOPES = new Set(['catalog', 'private'])

function normalizedSelection(value, allowed, name, fallback) {
  const values = value === undefined
    ? fallback
    : (Array.isArray(value) ? value : String(value).split(','))
  const normalized = [...new Set(values.map((item) => String(item).trim()).filter(Boolean))]
  if (!normalized.length || normalized.some((item) => !allowed.has(item))) {
    throw new TypeError(`${name} contains unsupported values`)
  }
  return normalized
}

export function parseBookSearchJobTypes(value) {
  return normalizedSelection(value, JOB_TYPES, 'BOOK_SEARCH_JOB_TYPES', ['lexical', 'embedding'])
}

export function parseBookSearchBookScopes(value) {
  return normalizedSelection(value, BOOK_SCOPES, 'BOOK_SEARCH_BOOK_SCOPES', ['catalog', 'private'])
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function workerError(code, message) {
  return Object.assign(new Error(message), { code })
}

function safeErrorCode(error) {
  const candidate = String(error?.code || 'UNKNOWN')
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate) ? candidate : 'UNKNOWN'
}

export async function readSearchChunk(input, storage) {
  const byteStart = input.chunk.metadata.contextByteStart
  const byteEnd = input.chunk.metadata.contextByteEnd
  if (
    !Number.isSafeInteger(byteStart) || byteStart < 0 ||
    !Number.isSafeInteger(byteEnd) || byteEnd <= byteStart
  ) throw workerError('CHUNK_BYTE_RANGE_INVALID', 'chunk has no valid UTF-8 byte range')
  const stored = await storage.getBytesRange({
    objectKey: input.normalizedTextObjectKey,
    startByte: byteStart,
    endByteExclusive: byteEnd,
    maxBytes: 256 * 1024
  })
  let contextText
  try {
    contextText = UTF8_DECODER.decode(stored.bytes)
  } catch {
    throw workerError('CHUNK_UTF8_INVALID', 'chunk is not valid UTF-8')
  }
  if (
    contextText.length !== input.chunk.contextEndOffset - input.chunk.contextStartOffset ||
    sha256(contextText) !== input.chunk.contentHash
  ) throw workerError('CHUNK_INTEGRITY', 'chunk does not match immutable boundaries')
  const localStart = input.chunk.coreStartOffset - input.chunk.contextStartOffset
  const localEnd = input.chunk.coreEndOffset - input.chunk.contextStartOffset
  const coreText = contextText.slice(localStart, localEnd)
  if (coreText.length !== input.chunk.coreEndOffset - input.chunk.coreStartOffset) {
    throw workerError('CHUNK_INTEGRITY', 'chunk core does not match immutable boundaries')
  }
  return { contextText, coreText }
}

export function createBookSearchWorker({
  repository,
  storage = null,
  embeddingClient = null,
  workerId,
  jobTypes = ['lexical', 'embedding'],
  bookScopes = ['catalog', 'private'],
  leaseSeconds = 300,
  leaseRenewMs = 60_000
}) {
  if (!repository) throw new TypeError('repository is required')
  const allowedJobTypes = parseBookSearchJobTypes(jobTypes)
  const allowedBookScopes = parseBookSearchBookScopes(bookScopes)
  const readsText = allowedJobTypes.some((type) => type === 'lexical' || type === 'embedding')
  if (readsText && typeof storage?.getBytesRange !== 'function') {
    throw new TypeError('storage.getBytesRange is required for lexical and embedding jobs')
  }
  if (allowedJobTypes.includes('embedding') && typeof embeddingClient?.embedText !== 'function') {
    throw new TypeError('embeddingClient is required for embedding jobs')
  }
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1000 || leaseRenewMs >= leaseSeconds * 1000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }

  return {
    async runOnce() {
      const job = await repository.claimJob(workerId, {
        types: allowedJobTypes,
        scopes: allowedBookScopes,
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      let renewalError = null
      const renew = setInterval(() => {
        void repository.renewJobLease(job, { leaseSeconds }).catch((error) => {
          renewalError = error
        })
      }, leaseRenewMs)
      renew.unref?.()
      try {
        if (job.type === 'graph' || job.type === 'story_arc') {
          const input = await repository.getGraphInput(job)
          const result = job.type === 'graph'
            ? buildNarrativeGraph(input)
            : { storyArcs: buildStoryArcs(input) }
          if (renewalError) throw renewalError
          const index = job.type === 'graph'
            ? await repository.completeGraph(job, result)
            : await repository.completeStoryArcs(job, result)
          return { status: 'completed', jobType: job.type, index }
        }
        const input = await repository.getJobInput(job)
        const text = await readSearchChunk(input, storage)
        if (renewalError) throw renewalError
        const index = job.type === 'lexical'
          ? await repository.completeLexical(job, { coreText: text.coreText })
          : await embeddingClient.embedText(text.contextText).then((embedded) =>
              repository.completeEmbedding(job, embedded)
            )
        return { status: 'completed', jobType: job.type, index }
      } catch (error) {
        const code = safeErrorCode(error)
        await repository.failJob(job, code, {
          retryable: error?.retryable === true || !FINAL_ERRORS.has(code),
          retryDelaySeconds: Math.min(300, 2 ** Math.min(job.attempts, 8))
        })
        return { status: 'failed', jobType: job.type, errorCode: code }
      } finally {
        clearInterval(renew)
      }
    }
  }
}
