const DEFAULT_MAX_ITEMS = 240
const DEFAULT_MAX_BYTES = 48_000

function itemSize(item) {
  return Buffer.byteLength(JSON.stringify(item), 'utf8')
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Selects book-spanning, type-diverse evidence while keeping the model request bounded. */
export function selectCharacterSynthesisEvidence(
  observations,
  { maxItems = DEFAULT_MAX_ITEMS, maxBytes = DEFAULT_MAX_BYTES } = {}
) {
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array')
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) throw new RangeError('maxItems must be positive')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1_000) throw new RangeError('maxBytes must be at least 1000')
  const ordered = [...observations].sort((left, right) =>
    left.evidence.startOffset - right.evidence.startOffset || compareText(left.id, right.id)
  )
  if (!ordered.length) return []
  const buckets = new Map()
  for (const observation of ordered) {
    const values = buckets.get(observation.type) ?? []
    values.push(observation)
    buckets.set(observation.type, values)
  }
  const candidates = []
  const seen = new Set()
  const add = (item) => {
    if (item && !seen.has(item.id)) {
      seen.add(item.id)
      candidates.push(item)
    }
  }
  for (const values of buckets.values()) {
    add(values[0])
    add(values.at(-1))
  }
  const remaining = Math.max(0, maxItems - candidates.length)
  if (remaining > 0) {
    const step = ordered.length / remaining
    for (let index = 0; index < remaining; index += 1) {
      add(ordered[Math.min(ordered.length - 1, Math.floor((index + 0.5) * step))])
    }
  }
  for (const observation of ordered) add(observation)
  const selected = []
  let bytes = 2
  for (const observation of candidates) {
    if (selected.length >= maxItems) break
    const size = itemSize(observation) + (selected.length ? 1 : 0)
    if (bytes + size > maxBytes) continue
    selected.push(observation)
    bytes += size
  }
  return selected.sort((left, right) =>
    left.evidence.startOffset - right.evidence.startOffset || compareText(left.id, right.id)
  )
}

export const BOOK_ANALYSIS_SYNTHESIS_EVIDENCE_LIMITS = Object.freeze({
  maxItems: DEFAULT_MAX_ITEMS,
  maxBytes: DEFAULT_MAX_BYTES
})
