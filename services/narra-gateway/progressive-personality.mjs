const PERSONALITY_EVIDENCE_TYPES = new Set([
  'character_trait',
  'character_action',
  'character_dialogue'
])
const CHECKPOINT_COUNTS = Object.freeze([1, 3, 6, 12, 24, 48, 96, 192])
const MAX_SNAPSHOTS = 12
const MAX_TRAITS = 5
const LEVEL_CONFIDENCE_CAP = Object.freeze({
  single_scene: 0.65,
  repeated: 0.82,
  direct: 0.95
})

export const PERSONALITY_TIMELINE_VERSION = 'progressive-personality-v1'

function invalid(message) {
  throw Object.assign(new Error(message), { code: 'GENERATION_RESULT_INVALID' })
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function compareEvidence(left, right) {
  return left.endOffset - right.endOffset ||
    left.startOffset - right.startOffset ||
    left.id.localeCompare(right.id)
}

function meaningfulEvidence(evidence) {
  return [...evidence]
    .filter((item) => PERSONALITY_EVIDENCE_TYPES.has(item?.type))
    .sort(compareEvidence)
}

/**
 * Checkpoints are evidence-count based. Book size and elapsed wall time never
 * make a short story wait longer or make workers wake up on a timer.
 */
export function buildPersonalityCheckpoints(evidence) {
  if (!Array.isArray(evidence)) throw new TypeError('evidence must be an array')
  const ordered = meaningfulEvidence(evidence)
  if (!ordered.length) return []
  const counts = CHECKPOINT_COUNTS.filter((count) => count <= ordered.length)
  if (counts.at(-1) !== ordered.length) counts.push(ordered.length)
  const checkpoints = []
  for (const count of counts.slice(0, MAX_SNAPSHOTS)) {
    const included = ordered.slice(0, count)
    const cutoffTextOffset = included.at(-1).endOffset
    const previous = checkpoints.at(-1)
    if (previous?.cutoffTextOffset === cutoffTextOffset) {
      previous.evidenceIds = ordered
        .filter((item) => item.endOffset <= cutoffTextOffset)
        .map(({ id }) => id)
      continue
    }
    checkpoints.push({
      cutoffTextOffset,
      evidenceIds: ordered
        .filter((item) => item.endOffset <= cutoffTextOffset)
        .map(({ id }) => id)
    })
  }
  return checkpoints
}

function normalizedTraitValue(value, name) {
  if (typeof value !== 'string') invalid(`${name}.value is invalid`)
  const trimmed = value.trim().replace(/\s+/gu, ' ')
  const words = normalizedText(trimmed).split(' ').filter(Boolean)
  if (!trimmed || trimmed.length > 120 || words.length > 5 ||
      /\b(?:and|or|и|или)\b/iu.test(trimmed)) {
    invalid(`${name}.value is invalid`)
  }
  return trimmed
}

function quoteSupportsValue(value, quote) {
  const valueTokens = normalizedText(value).split(' ').filter((token) => token.length >= 4)
  const quoteTokens = normalizedText(quote).split(' ').filter((token) => token.length >= 4)
  return valueTokens.some((valueToken) => quoteTokens.some((quoteToken) => {
    const prefixLength = Math.min(5, valueToken.length, quoteToken.length)
    return prefixLength >= 4 && valueToken.slice(0, prefixLength) === quoteToken.slice(0, prefixLength)
  }))
}

function evidenceLevel(value, supporting) {
  if (supporting.some((item) =>
    item.type === 'character_trait' && quoteSupportsValue(value, `${item.fact} ${item.quote}`)
  )) return 'direct'
  return supporting.length >= 2 ? 'repeated' : 'single_scene'
}

function normalizeTrait(raw, { allowedIds, evidenceById, name, stable = false }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(`${name} is invalid`)
  const value = normalizedTraitValue(raw.value, name)
  if (!Array.isArray(raw.evidenceIds) || !raw.evidenceIds.length || raw.evidenceIds.length > 16) {
    invalid(`${name}.evidenceIds is invalid`)
  }
  const evidenceIds = [...new Set(raw.evidenceIds.map(String))]
  if (evidenceIds.length !== raw.evidenceIds.length ||
      evidenceIds.some((id) => !allowedIds.has(id) || !evidenceById.has(id))) {
    invalid(`${name} uses future or unknown evidence`)
  }
  const confidence = Number(raw.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    invalid(`${name}.confidence is invalid`)
  }
  const supporting = evidenceIds.map((id) => evidenceById.get(id))
  const level = evidenceLevel(value, supporting)
  const evidenceConfidence = Math.min(...supporting.map((item) => Number(item.confidence) || 0))
  return {
    value,
    evidenceIds,
    confidence: Math.min(
      confidence,
      evidenceConfidence,
      stable ? LEVEL_CONFIDENCE_CAP.direct : LEVEL_CONFIDENCE_CAP[level]
    ),
    evidenceLevel: level
  }
}

function rawSnapshots(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.snapshots)) {
    return value.snapshots
  }
  invalid('personality timeline result is invalid')
}

/** Validates the one-call primary (variant B) response against every cutoff. */
export function normalizePersonalityTimeline(value, { checkpoints, evidence }) {
  if (!Array.isArray(checkpoints) || !Array.isArray(evidence)) {
    throw new TypeError('checkpoints and evidence must be arrays')
  }
  if (!checkpoints.length) return []
  const snapshots = rawSnapshots(value)
  if (snapshots.length !== checkpoints.length) {
    invalid('personality checkpoint sequence is incomplete')
  }
  const evidenceById = new Map(meaningfulEvidence(evidence).map((item) => [item.id, item]))
  return checkpoints.map((checkpoint, snapshotIndex) => {
    const source = snapshots[snapshotIndex]
    if (!source || typeof source !== 'object' || Array.isArray(source) ||
        source.cutoffTextOffset !== checkpoint.cutoffTextOffset) {
      invalid('personality checkpoint sequence is invalid')
    }
    if (!Array.isArray(source.traits) || source.traits.length > MAX_TRAITS) {
      invalid(`personality snapshot ${snapshotIndex}.traits is invalid`)
    }
    const allowedIds = new Set(checkpoint.evidenceIds)
    const traits = []
    const concepts = new Set()
    for (const [traitIndex, raw] of source.traits.entries()) {
      const trait = normalizeTrait(raw, {
        allowedIds,
        evidenceById,
        name: `personality snapshot ${snapshotIndex}.traits[${traitIndex}]`
      })
      const concept = normalizedText(trait.value)
      if (concepts.has(concept)) continue
      concepts.add(concept)
      traits.push(trait)
    }
    return {
      cutoffTextOffset: checkpoint.cutoffTextOffset,
      status: traits.length ? 'preliminary' : 'insufficient_evidence',
      traits
    }
  })
}

/** Promotes existing strict canonical traits without exposing future evidence. */
export function overlayStablePersonalityTraits(timeline, stableTraits, evidence) {
  if (!Array.isArray(timeline) || !Array.isArray(stableTraits) || !Array.isArray(evidence)) {
    throw new TypeError('timeline, stableTraits and evidence must be arrays')
  }
  const evidenceById = new Map(meaningfulEvidence(evidence).map((item) => [item.id, item]))
  return timeline.map((snapshot) => {
    const allowedIds = new Set([...evidenceById.values()]
      .filter((item) => item.endOffset <= snapshot.cutoffTextOffset)
      .map(({ id }) => id))
    const stable = stableTraits.flatMap((raw, index) => {
      try {
        return [normalizeTrait(raw, {
          allowedIds,
          evidenceById,
          name: `stableTraits[${index}]`,
          stable: true
        })]
      } catch (error) {
        if (error?.code === 'GENERATION_RESULT_INVALID') return []
        throw error
      }
    })
    if (!stable.length) return snapshot
    const stableByConcept = new Map(stable.map((trait) => [normalizedText(trait.value), trait]))
    const traits = snapshot.traits
      .filter((trait) => !stableByConcept.has(normalizedText(trait.value)))
      .concat(stable)
      .slice(0, MAX_TRAITS)
    return {
      cutoffTextOffset: snapshot.cutoffTextOffset,
      status: 'supported',
      traits
    }
  })
}

export function emptyPersonalityTimeline(checkpoints) {
  return checkpoints.map(({ cutoffTextOffset }) => ({
    cutoffTextOffset,
    status: 'insufficient_evidence',
    traits: []
  }))
}

export const PERSONALITY_TIMELINE_PRIMARY_MAX_BYTES = 36_000
