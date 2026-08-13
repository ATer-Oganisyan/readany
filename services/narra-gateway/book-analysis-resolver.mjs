import { createHash } from 'node:crypto'
import {
  normalizeBookAnalysisObservation,
  normalizeBookAnalysisResolvedEntity
} from './book-analysis-contracts.mjs'

const ALIAS_CONFIDENCE = 0.8
const MAX_OBSERVATIONS = 100_000
const MAX_ENTITY_CANDIDATES = 200_000
const KIND_ORDER = new Map([
  ['character', 0],
  ['location', 1],
  ['event', 2],
  ['relationship', 3]
])
const WEAK_CHARACTER_CANDIDATES = new Set([
  'он', 'она', 'оно', 'они', 'его', 'ее', 'ему', 'ей', 'им',
  'мы', 'я', 'ты', 'вы', 'кто то', 'ктото', 'некто',
  'he', 'she', 'it', 'they', 'him', 'her', 'them', 'i', 'you', 'we', 'someone'
])
const GENERIC_CHARACTER_CANDIDATES = new Set([
  'молодой человек', 'неизвестный человек', 'неизвестная девушка',
  'мужчина', 'женщина', 'девушка', 'человек', 'старик', 'старуха',
  'мещанин', 'городовой', 'письмоводитель', 'артельщик', 'дворник',
  'лакей', 'слуга', 'служанка', 'полицейский', 'полицейская',
  'young man', 'unknown man', 'unknown woman', 'man', 'woman', 'girl',
  'servant', 'policeman', 'policewoman'
])

function resolutionError(code, message) {
  return Object.assign(new Error(message), { code })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizedCandidate(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  if (!normalized) {
    throw resolutionError('RESOLUTION_INPUT_INVALID', 'entity candidate has no letters or digits')
  }
  return normalized
}

function displayCandidate(value) {
  return String(value).trim().replace(/\s+/g, ' ')
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function properNameScore(value) {
  return /^\p{Lu}/u.test(value) ? 1 : 0
}

function stableNodeKey(kind, candidate) {
  return `${kind}\u0000${normalizedCandidate(candidate)}`
}

class DisjointSet {
  constructor() {
    this.parents = new Map()
  }

  add(value) {
    if (!this.parents.has(value)) this.parents.set(value, value)
  }

  find(value) {
    const parent = this.parents.get(value)
    if (parent === value) return value
    const root = this.find(parent)
    this.parents.set(value, root)
    return root
  }

  union(left, right) {
    this.add(left)
    this.add(right)
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot === rightRoot) return
    const [first, second] = [leftRoot, rightRoot].sort(compareText)
    this.parents.set(second, first)
  }
}

function normalizeInputObservations(rawObservations) {
  if (!Array.isArray(rawObservations)) {
    throw resolutionError('RESOLUTION_INPUT_INVALID', 'observations must be an array')
  }
  if (rawObservations.length > MAX_OBSERVATIONS) {
    throw resolutionError('RESOLUTION_INPUT_INVALID', 'observation limit exceeded')
  }
  const ids = new Set()
  return rawObservations.map((raw, index) => {
    if (typeof raw?.id !== 'string' || !raw.id.trim()) {
      throw resolutionError('RESOLUTION_INPUT_INVALID', `observations[${index}].id is required`)
    }
    const id = raw.id.trim()
    if (ids.has(id)) {
      throw resolutionError('RESOLUTION_INPUT_INVALID', `duplicate observation id: ${id}`)
    }
    ids.add(id)
    let observation
    try {
      observation = normalizeBookAnalysisObservation(raw)
    } catch (error) {
      throw resolutionError('RESOLUTION_INPUT_INVALID', error.message)
    }
    return { id, ...observation }
  })
}

function createNode(nodes, key, display, evidenceOffset, { primary = false, confidence = 0 } = {}) {
  let node = nodes.get(key)
  if (!node) {
    node = {
      key,
      normalized: key.slice(key.indexOf('\u0000') + 1),
      forms: new Map(),
      primaryCount: 0,
      confidenceSum: 0,
      anchorConfidence: 0,
      firstOffset: evidenceOffset
    }
    nodes.set(key, node)
  }
  const candidate = displayCandidate(display)
  const form = node.forms.get(candidate) ?? { display: candidate, count: 0, confidenceSum: 0 }
  if (primary) {
    form.count += 1
    form.confidenceSum += confidence
    node.primaryCount += 1
    node.confidenceSum += confidence
  }
  node.forms.set(candidate, form)
  node.firstOffset = Math.min(node.firstOffset, evidenceOffset)
  return node
}

function bestDisplay(node) {
  return [...node.forms.values()].sort((left, right) =>
    properNameScore(right.display) - properNameScore(left.display) ||
    right.count - left.count ||
    right.confidenceSum - left.confidenceSum ||
    right.display.length - left.display.length ||
    compareText(left.display, right.display)
  )[0].display
}

function tokenCount(value) {
  return value.split(' ').filter(Boolean).length
}

function nameTokens(value) {
  return value.split(' ').filter(Boolean)
}

function isOrderedSubset(shorter, longer) {
  if (shorter.length >= longer.length) return false
  if (shorter.length === 1) return shorter[0] === longer.at(-1)
  let shorterIndex = 0
  for (const token of longer) {
    if (token === shorter[shorterIndex]) shorterIndex += 1
    if (shorterIndex === shorter.length) return true
  }
  return false
}

function hasProperNameForm(node) {
  if (GENERIC_CHARACTER_CANDIDATES.has(node.normalized)) return false
  return [...node.forms.values()].some(({ display }) =>
    display.split(/\s+/u).some((token) => /^\p{Lu}[\p{L}'’.-]*$/u.test(token))
  )
}

function mergeUnambiguousNameFragments(sets, nodes) {
  const nameNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && hasProperNameForm(node)
  )
  const tokensByKey = new Map(nameNodes.map((node) => [node.key, nameTokens(node.normalized)]))
  for (const node of nameNodes) {
    const tokens = tokensByKey.get(node.key)
    const supersets = nameNodes.filter((candidate) =>
      candidate !== node && isOrderedSubset(tokens, tokensByKey.get(candidate.key))
    )
    const maximalSupersets = supersets.filter((candidate) =>
      !supersets.some((other) =>
        other !== candidate &&
        isOrderedSubset(tokensByKey.get(candidate.key), tokensByKey.get(other.key))
      )
    )
    if (maximalSupersets.length === 1) sets.union(node.key, maximalSupersets[0].key)
  }
}

function canonicalNode(groupNodes) {
  return [...groupNodes].sort((left, right) =>
    right.anchorConfidence - left.anchorConfidence ||
    tokenCount(right.normalized) - tokenCount(left.normalized) ||
    right.primaryCount - left.primaryCount ||
    right.confidenceSum - left.confidenceSum ||
    right.normalized.length - left.normalized.length ||
    left.firstOffset - right.firstOffset ||
    compareText(left.normalized, right.normalized)
  )[0]
}

function roundConfidence(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function isConfirmed(kind, canonical, observations, anchorConfidence, confidence, groupNodes) {
  if (
    kind === 'character' &&
    !groupNodes.some(hasProperNameForm)
  ) return false
  if (anchorConfidence >= ALIAS_CONFIDENCE || observations.length >= 2) return true
  if (confidence < ALIAS_CONFIDENCE) return false
  return kind !== 'character' || !WEAK_CHARACTER_CANDIDATES.has(normalizedCandidate(canonical))
}

/**
 * Conservatively resolves a complete run: exact normalized candidates merge,
 * and only high-confidence `character_alias` observations may join aliases.
 */
export function resolveBookAnalysisEntities({ observations: rawObservations }) {
  const observations = normalizeInputObservations(rawObservations)
  const sets = new DisjointSet()
  const nodes = new Map()
  const primaryNodeByObservationId = new Map()
  const aliasClaims = []

  for (const observation of observations) {
    const primaryKey = stableNodeKey(observation.entityKind, observation.entityCandidate)
    sets.add(primaryKey)
    primaryNodeByObservationId.set(observation.id, primaryKey)
    const primaryNode = createNode(
      nodes,
      primaryKey,
      observation.entityCandidate,
      observation.evidence.startOffset,
      { primary: true, confidence: observation.confidence }
    )
    if (observation.type !== 'character_alias' || observation.confidence < ALIAS_CONFIDENCE) {
      continue
    }
    primaryNode.anchorConfidence = Math.max(primaryNode.anchorConfidence, observation.confidence)
    for (const alias of observation.relatedEntityCandidates) {
      const aliasKey = stableNodeKey('character', alias)
      if (aliasKey === primaryKey) continue
      sets.add(aliasKey)
      createNode(nodes, aliasKey, alias, observation.evidence.startOffset)
      if (nodes.size > MAX_ENTITY_CANDIDATES) {
        throw resolutionError('RESOLUTION_INPUT_INVALID', 'entity candidate limit exceeded')
      }
      aliasClaims.push({ primaryKey, aliasKey })
    }
  }

  const anchorsByAlias = new Map()
  for (const { primaryKey, aliasKey } of aliasClaims) {
    const anchors = anchorsByAlias.get(aliasKey) ?? new Set()
    anchors.add(primaryKey)
    anchorsByAlias.set(aliasKey, anchors)
  }
  for (const [aliasKey, anchors] of anchorsByAlias) {
    if (anchors.size === 1) sets.union([...anchors][0], aliasKey)
  }
  mergeUnambiguousNameFragments(sets, nodes)

  const groupedNodes = new Map()
  for (const [key, node] of nodes) {
    const root = sets.find(key)
    const group = groupedNodes.get(root) ?? []
    group.push(node)
    groupedNodes.set(root, group)
  }
  const observationsByRoot = new Map()
  for (const observation of observations) {
    const root = sets.find(primaryNodeByObservationId.get(observation.id))
    const values = observationsByRoot.get(root) ?? []
    values.push(observation)
    observationsByRoot.set(root, values)
  }

  const entities = []
  for (const [root, groupNodes] of groupedNodes) {
    const groupObservations = observationsByRoot.get(root) ?? []
    if (!groupObservations.length) continue
    const kind = groupObservations[0].entityKind
    const canonical = canonicalNode(groupNodes)
    const canonicalName = bestDisplay(canonical)
    const aliases = groupNodes
      .filter((node) => node !== canonical)
      .map(bestDisplay)
      .sort(compareText)
    const evidenceIds = groupObservations
      .sort((left, right) =>
        left.evidence.startOffset - right.evidence.startOffset || compareText(left.id, right.id)
      )
      .map(({ id }) => id)
    const confidence = roundConfidence(
      groupObservations.reduce((sum, observation) => sum + observation.confidence, 0) /
      groupObservations.length
    )
    const candidateKeys = groupNodes.map(({ normalized }) => normalized).sort()
    const entityKey = `${kind}:${sha256(`${kind}:${candidateKeys.join('|')}`).slice(0, 48)}`
    const firstEvidenceStartOffset = Math.min(
      ...groupObservations.map(({ evidence }) => evidence.startOffset)
    )
    const lastEvidenceEndOffset = Math.max(
      ...groupObservations.map(({ evidence }) => evidence.endOffset)
    )
    entities.push(normalizeBookAnalysisResolvedEntity({
      entityKey,
      entityKind: kind,
      canonicalName,
      aliases,
      resolutionStatus: isConfirmed(
        kind,
        canonicalName,
        groupObservations,
        canonical.anchorConfidence,
        confidence,
        groupNodes
      ) ? 'confirmed' : 'candidate',
      confidence,
      evidenceIds,
      data: {
        observationCount: groupObservations.length,
        firstEvidenceStartOffset,
        lastEvidenceEndOffset,
        candidateKeys
      }
    }))
  }

  entities.sort((left, right) =>
    KIND_ORDER.get(left.entityKind) - KIND_ORDER.get(right.entityKind) ||
    left.data.firstEvidenceStartOffset - right.data.firstEvidenceStartOffset ||
    compareText(left.entityKey, right.entityKey)
  )
  return entities
}

export const BOOK_ANALYSIS_ALIAS_CONFIDENCE = ALIAS_CONFIDENCE
