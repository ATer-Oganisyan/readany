import { createHash } from 'node:crypto'
import {
  BOOK_ANALYSIS_EXTRACTOR_VERSION,
  normalizeBookAnalysisObservation
} from './book-analysis-contracts.mjs'
import { createOperationalLogger } from './operational-log.mjs'

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const PARATEXT_SECTION = /^(?:preface|foreword|introduction|contents?|table of contents|предисловие|введение|оглавление|содержание)\s*[.:\]]?$/iu
const NARRATIVE_SECTION = /^(?:chapter|part|book|prologue|epilogue|глава|часть|книга|пролог|эпилог)\b/iu
const FINAL_EMPTY_SCAN_ERRORS = new Set(['EVIDENCE_MISMATCH', 'GENERATOR_HTTP_422'])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function safeErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(candidate) ? candidate : 'UNKNOWN'
}

function scanError(code, message) {
  return Object.assign(new Error(message), { code })
}

function isPureParatextChunk(sectionTitles) {
  const titles = Array.isArray(sectionTitles)
    ? sectionTitles.filter((title) => typeof title === 'string').map((title) => title.trim())
    : []
  return titles.some((title) => PARATEXT_SECTION.test(title)) &&
    !titles.some((title) => NARRATIVE_SECTION.test(title))
}

function localOffset(value, name, textLength) {
  if (!Number.isSafeInteger(value) || value < 0 || value > textLength) {
    throw scanError('GENERATION_RESULT_INVALID', `${name}: invalid local offset`)
  }
  return value
}

function normalizeRawObservation(raw, index, input, contextText) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw scanError('GENERATION_RESULT_INVALID', `observations[${index}]: expected object`)
  }
  const evidence = raw.evidence && typeof raw.evidence === 'object' && !Array.isArray(raw.evidence)
    ? raw.evidence
    : {}
  const localStart = localOffset(
    evidence.startOffset,
    `observations[${index}].evidence.startOffset`,
    contextText.length
  )
  const localEnd = localOffset(
    evidence.endOffset,
    `observations[${index}].evidence.endOffset`,
    contextText.length
  )
  if (localEnd <= localStart) {
    throw scanError(
      'GENERATION_RESULT_INVALID',
      `observations[${index}].evidence: endOffset must be after startOffset`
    )
  }
  if (typeof evidence.quote !== 'string' || contextText.slice(localStart, localEnd) !== evidence.quote) {
    throw scanError(
      'EVIDENCE_MISMATCH',
      `observations[${index}].evidence.quote does not match the normalized text`
    )
  }
  const coreLocalStart = input.chunk.coreStartOffset - input.chunk.contextStartOffset
  const coreLocalEnd = input.chunk.coreEndOffset - input.chunk.contextStartOffset
  if (localStart < coreLocalStart || localStart >= coreLocalEnd) return null
  const absoluteStart = input.chunk.contextStartOffset + localStart
  const absoluteEnd = input.chunk.contextStartOffset + localEnd
  const normalized = normalizeBookAnalysisObservation({
    observationKey: 'candidate',
    type: raw.type,
    entityKind: raw.entityKind,
    entityCandidate: raw.entityCandidate,
    relatedEntityCandidates: raw.relatedEntityCandidates ?? [],
    fact: raw.fact,
    evidence: {
      quote: evidence.quote,
      startOffset: absoluteStart,
      endOffset: absoluteEnd,
      chapterKey: input.chunk.chapterKey
    },
    confidence: raw.confidence
  })
  const keySource = {
    type: normalized.type,
    entityKind: normalized.entityKind,
    entityCandidate: normalized.entityCandidate,
    relatedEntityCandidates: [...normalized.relatedEntityCandidates].sort((left, right) =>
      left.localeCompare(right, 'ru')
    ),
    fact: normalized.fact,
    quote: normalized.evidence.quote,
    startOffset: normalized.evidence.startOffset,
    endOffset: normalized.evidence.endOffset
  }
  return {
    ...normalized,
    observationKey: `obs:${sha256(JSON.stringify(canonical(keySource))).slice(0, 48)}`
  }
}

export function normalizeScanObservations(rawResult, input, contextText) {
  if (!rawResult || typeof rawResult !== 'object' || !Array.isArray(rawResult.observations)) {
    throw scanError('GENERATION_RESULT_INVALID', 'scan result must contain observations')
  }
  if (rawResult.observations.length > 160) {
    throw scanError('GENERATION_RESULT_INVALID', 'scan result contains too many observations')
  }
  const byKey = new Map()
  for (const [index, raw] of rawResult.observations.entries()) {
    const observation = normalizeRawObservation(raw, index, input, contextText)
    if (observation && !byKey.has(observation.observationKey)) {
      byKey.set(observation.observationKey, observation)
    }
  }
  return [...byKey.values()]
}

export function createBookAnalysisScanWorker({
  repository,
  storage,
  generator,
  workerId,
  extractorVersion = BOOK_ANALYSIS_EXTRACTOR_VERSION,
  leaseSeconds = 300,
  leaseRenewMs = 60_000,
  logger = console
}) {
  if (!repository || !storage || !generator) {
    throw new TypeError('repository, storage and generator are required')
  }
  if (typeof storage.getBytesRange !== 'function') {
    throw new TypeError('storage.getBytesRange is required')
  }
  if (typeof generator.scanBookChunk !== 'function') {
    throw new TypeError('generator.scanBookChunk is required')
  }
  if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required')
  if (!Number.isSafeInteger(leaseRenewMs) || leaseRenewMs < 1_000 || leaseRenewMs >= leaseSeconds * 1_000) {
    throw new RangeError('leaseRenewMs must be shorter than the job lease')
  }
  const log = createOperationalLogger({ component: 'analysis-scan', logger })

  async function scan(job) {
    const input = await repository.getScanInput(job)
    if (input.extractorVersion !== extractorVersion) {
      throw scanError(
        'EXTRACTOR_VERSION_MISMATCH',
        `scan job requires ${input.extractorVersion}, worker provides ${extractorVersion}`
      )
    }
    const byteStart = input.chunk.metadata.contextByteStart
    const byteEnd = input.chunk.metadata.contextByteEnd
    if (
      !Number.isSafeInteger(byteStart) || byteStart < 0 ||
      !Number.isSafeInteger(byteEnd) || byteEnd <= byteStart
    ) {
      throw scanError('CHUNK_BYTE_RANGE_INVALID', 'chunk has no valid UTF-8 byte range')
    }
    const stored = await storage.getBytesRange({
      objectKey: input.normalizedTextObjectKey,
      startByte: byteStart,
      endByteExclusive: byteEnd,
      maxBytes: 128 * 1024
    })
    let contextText
    try {
      contextText = UTF8_DECODER.decode(stored.bytes)
    } catch (error) {
      throw scanError('CHUNK_UTF8_INVALID', `chunk is not valid UTF-8: ${error.message}`)
    }
    if (
      contextText.length !== input.chunk.contextEndOffset - input.chunk.contextStartOffset ||
      sha256(contextText) !== input.chunk.contentHash
    ) {
      throw scanError('CHUNK_INTEGRITY', 'chunk does not match its immutable boundaries')
    }
    const sectionTitles = input.chunk.metadata.sectionTitles ?? []
    if (isPureParatextChunk(sectionTitles)) {
      const result = await repository.completeScan(job, { extractorVersion, observations: [] })
      log.info('scan.paratext_skipped', 'Служебный фрагмент книги пропущен', {
        run: input.runId,
        chunk: input.chunk.ordinal,
        next_stage: result.stage
      })
      return result
    }
    const rawResult = await generator.scanBookChunk({
      runId: input.runId,
      chunkId: input.chunk.id,
      extractorVersion,
      bookTitle: input.title,
      bookAuthor: input.author,
      sectionTitles,
      contextText,
      coreLocalStartOffset: input.chunk.coreStartOffset - input.chunk.contextStartOffset,
      coreLocalEndOffset: input.chunk.coreEndOffset - input.chunk.contextStartOffset
    })
    const observations = normalizeScanObservations(rawResult, input, contextText)
    const result = await repository.completeScan(job, { extractorVersion, observations })
    log.info('scan.completed', 'Фрагмент книги обработан', {
      run: input.runId,
      chunk: input.chunk.ordinal,
      observation_count: observations.length,
      next_stage: result.stage
    })
    return result
  }

  async function withLeaseHeartbeat(job, operation) {
    const timer = setInterval(() => {
      void repository.renewAnalysisJobLease(job, { leaseSeconds }).catch((error) => {
        log.error('scan.lease_failed', 'Не удалось продлить аренду scan-задания', {
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
        leaseSeconds
      })
      if (!job) return { status: 'idle' }
      try {
        const result = await withLeaseHeartbeat(job, () => scan(job))
        return { status: 'completed', jobId: job.id, runId: job.runId, result }
      } catch (error) {
        const errorCode = safeErrorCode(error)
        if (
          FINAL_EMPTY_SCAN_ERRORS.has(errorCode) &&
          Number.isSafeInteger(job.attempts) &&
          Number.isSafeInteger(job.maxAttempts) &&
          job.attempts >= job.maxAttempts
        ) {
          const result = await repository.completeScan(job, {
            extractorVersion,
            observations: []
          })
          log.warn('scan.empty_completed', 'Фрагмент завершён без доказанных наблюдений', {
            job: job.id,
            run: job.runId,
            attempts: job.attempts,
            error_code: errorCode,
            next_stage: result.stage
          })
          return { status: 'completed', jobId: job.id, runId: job.runId, result }
        }
        const failure = await repository.failAnalysisJob(job, errorCode)
        log.error('scan.failed', 'Анализ фрагмента завершился ошибкой', {
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
