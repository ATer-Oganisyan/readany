import { createHash } from 'node:crypto'

const DEFAULTS = Object.freeze({
  targetChars: 4_000,
  minChars: 2_500,
  maxChars: 5_000,
  overlapChars: 500
})

function invalid(message) {
  const error = new Error(message)
  error.code = 'VALIDATION'
  throw error
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stableUuid(value) {
  const bytes = Buffer.from(sha256(value).slice(0, 32), 'hex')
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${name}: expected a positive integer`)
  return value
}

function normalizeOptions(options) {
  const values = { ...DEFAULTS, ...options }
  for (const key of Object.keys(DEFAULTS)) positiveInteger(values[key], key)
  if (values.minChars > values.targetChars || values.targetChars > values.maxChars) {
    invalid('chunk sizes must satisfy minChars <= targetChars <= maxChars')
  }
  if (values.overlapChars >= values.minChars) {
    invalid('overlapChars must be shorter than minChars')
  }
  return values
}

function normalizeSections(sections, textLength) {
  if (!Array.isArray(sections) || !sections.length) {
    return [{ key: 'document', title: '', startOffset: 0, endOffset: textLength }]
  }
  let expectedStart = 0
  const normalized = sections.map((section, index) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      invalid(`sections[${index}]: expected an object`)
    }
    const { startOffset, endOffset } = section
    if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)) {
      invalid(`sections[${index}]: offsets must be safe integers`)
    }
    if (startOffset !== expectedStart || endOffset <= startOffset || endOffset > textLength) {
      invalid(`sections[${index}]: sections must cover the text contiguously`)
    }
    if (typeof section.key !== 'string' || !section.key.trim()) {
      invalid(`sections[${index}].key: expected text`)
    }
    expectedStart = endOffset
    return {
      key: section.key.trim().slice(0, 500),
      title: typeof section.title === 'string' ? section.title.trim().slice(0, 500) : '',
      startOffset,
      endOffset
    }
  })
  if (expectedStart !== textLength) invalid('sections: final section must end at textLength')
  return normalized
}

function boundaryCandidates(text, start, minimum, maximum, sections) {
  const candidates = []
  for (const section of sections) {
    if (section.endOffset >= minimum && section.endOffset <= maximum) {
      candidates.push({ offset: section.endOffset, priority: 0 })
    }
  }
  const window = text.slice(minimum, maximum)
  for (const match of window.matchAll(/\n{2,}/g)) {
    candidates.push({ offset: minimum + match.index + match[0].length, priority: 1 })
  }
  for (const match of window.matchAll(/[.!?…][\]})"'»”]*\s+/g)) {
    candidates.push({ offset: minimum + match.index + match[0].length, priority: 2 })
  }
  for (const match of window.matchAll(/\n/g)) {
    candidates.push({ offset: minimum + match.index + 1, priority: 3 })
  }
  return candidates.filter(({ offset }) => offset > start)
}

function chooseCoreEnd(text, start, sections, options) {
  const maximum = Math.min(text.length, start + options.maxChars)
  if (maximum === text.length) return maximum
  const minimum = Math.min(maximum, start + options.minChars)
  const target = Math.min(maximum, start + options.targetChars)
  const candidates = boundaryCandidates(text, start, minimum, maximum, sections)
  if (!candidates.length) return safeStartBoundary(text, maximum)
  candidates.sort((left, right) =>
    Math.abs(left.offset - target) - Math.abs(right.offset - target) ||
    left.priority - right.priority ||
    left.offset - right.offset
  )
  return candidates[0].offset
}

function overlappingSections(sections, start, end) {
  return sections.filter((section) => section.startOffset < end && section.endOffset > start)
}

function safeStartBoundary(text, offset) {
  if (
    offset > 0 && offset < text.length &&
    /[\uDC00-\uDFFF]/.test(text[offset]) &&
    /[\uD800-\uDBFF]/.test(text[offset - 1])
  ) return offset - 1
  return offset
}

function safeEndBoundary(text, offset) {
  if (
    offset > 0 && offset < text.length &&
    /[\uDC00-\uDFFF]/.test(text[offset]) &&
    /[\uD800-\uDBFF]/.test(text[offset - 1])
  ) return offset + 1
  return offset
}

function utf8ByteOffsets(text, offsets) {
  const targets = [...new Set(offsets)].sort((left, right) => left - right)
  const result = new Map()
  let codeUnitOffset = 0
  let byteOffset = 0
  let targetIndex = 0
  while (targets[targetIndex] === 0) {
    result.set(0, 0)
    targetIndex += 1
  }
  for (const symbol of text) {
    const nextCodeUnitOffset = codeUnitOffset + symbol.length
    while (targetIndex < targets.length && targets[targetIndex] < nextCodeUnitOffset) {
      invalid(`offset ${targets[targetIndex]} splits a Unicode code point`)
    }
    byteOffset += Buffer.byteLength(symbol, 'utf8')
    codeUnitOffset = nextCodeUnitOffset
    while (targets[targetIndex] === codeUnitOffset) {
      result.set(codeUnitOffset, byteOffset)
      targetIndex += 1
    }
  }
  if (targetIndex !== targets.length) invalid('offset exceeds text length')
  return result
}

/**
 * Produces deterministic chunks whose non-overlapping core ranges cover the
 * normalized text exactly once. Context ranges may overlap for model quality.
 */
export function createStableBookChunks({ runId, text, sections }, rawOptions = {}) {
  if (typeof runId !== 'string' || !runId.trim()) invalid('runId: expected text')
  if (typeof text !== 'string' || !text.length) invalid('text: expected non-empty text')
  const options = normalizeOptions(rawOptions)
  const normalizedSections = normalizeSections(sections, text.length)
  const chunks = []
  let coreStartOffset = 0
  while (coreStartOffset < text.length) {
    const coreEndOffset = chooseCoreEnd(
      text,
      coreStartOffset,
      normalizedSections,
      options
    )
    const contextStartOffset = safeStartBoundary(
      text,
      Math.max(0, coreStartOffset - options.overlapChars)
    )
    const contextEndOffset = safeEndBoundary(
      text,
      Math.min(text.length, coreEndOffset + options.overlapChars)
    )
    const contextText = text.slice(contextStartOffset, contextEndOffset)
    const contentHash = sha256(contextText)
    const ordinal = chunks.length
    const coveredSections = overlappingSections(
      normalizedSections,
      coreStartOffset,
      coreEndOffset
    )
    chunks.push({
      id: stableUuid([
        runId,
        ordinal,
        coreStartOffset,
        coreEndOffset,
        contextStartOffset,
        contextEndOffset,
        contentHash
      ].join(':')),
      ordinal,
      chapterKey: coveredSections.length === 1 ? coveredSections[0].key : null,
      coreStartOffset,
      coreEndOffset,
      contextStartOffset,
      contextEndOffset,
      contentHash,
      metadata: {
        sectionKeys: coveredSections.map(({ key }) => key),
        sectionTitles: coveredSections.map(({ title }) => title).filter(Boolean)
      }
    })
    coreStartOffset = coreEndOffset
  }
  const byteOffsets = utf8ByteOffsets(
    text,
    chunks.flatMap(({ contextStartOffset, contextEndOffset }) => [
      contextStartOffset,
      contextEndOffset
    ])
  )
  for (const chunk of chunks) {
    chunk.metadata.contextByteStart = byteOffsets.get(chunk.contextStartOffset)
    chunk.metadata.contextByteEnd = byteOffsets.get(chunk.contextEndOffset)
  }
  return chunks
}

export const BOOK_ANALYSIS_CHUNK_DEFAULTS = DEFAULTS
