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
const DESCRIPTIVE_CHARACTER_TOKENS = new Set([
  'человек', 'мужчина', 'женщина', 'девушка', 'девочка', 'мальчик',
  'господин', 'госпожа', 'дама', 'старик', 'старуха', 'старушонка',
  'дочь', 'сын', 'мать', 'отец', 'брат', 'сестра', 'жена', 'муж',
  'вдова', 'невеста', 'жених', 'мещанин', 'городовой', 'письмоводитель',
  'артельщик', 'дворник', 'лакей', 'слуга', 'служанка', 'полицейский',
  'полицейская', 'man', 'woman', 'girl', 'boy', 'gentleman', 'lady',
  'daughter', 'son', 'mother', 'father', 'brother', 'sister', 'wife',
  'husband', 'widow', 'bride', 'groom', 'servant', 'policeman', 'policewoman'
])
const CHARACTER_BEHAVIOUR_TYPES = new Set([
  'character_action', 'character_dialogue', 'character_trait',
  'character_appearance', 'character_role', 'character_age', 'character_gender'
])
const COLLECTIVE_CHARACTER_TOKENS = new Set([
  'армия', 'армии', 'войско', 'войска', 'солдаты', 'люди', 'дети',
  'сыновья', 'дочери', 'братья', 'сестры', 'марсиане', 'атланты', 'аолы',
  'казаки', 'козаки', 'запорожцы', 'армейцы', 'женщины', 'мужчины',
  'слуги', 'музыканты', 'танки', 'подразделения', 'толпа', 'голоса',
  'богатыри', 'старшины', 'наборщики', 'часовые', 'гайдуки',
  'army', 'troops', 'soldiers', 'people', 'children', 'brothers', 'sisters',
  'women', 'men', 'servants', 'musicians', 'tanks', 'crowd', 'voices'
])
const LEADING_CHARACTER_TITLES = new Set([
  'царь', 'царица', 'король', 'королева', 'князь', 'княгиня', 'княжна',
  'граф', 'графиня', 'барон', 'баронесса', 'принц', 'принцесса',
  'майор', 'капитан', 'полковник', 'генерал', 'адмирал', 'профессор',
  'доктор', 'господин', 'госпожа', 'синьор', 'синьора',
  'king', 'queen', 'prince', 'princess', 'count', 'countess', 'baron',
  'major', 'captain', 'colonel', 'general', 'admiral', 'professor', 'doctor',
  'mister', 'missus', 'sir', 'lady'
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
  if (nameTokens(node.normalized).some((token) => DESCRIPTIVE_CHARACTER_TOKENS.has(token))) {
    return false
  }
  return [...node.forms.values()].some(({ display }) =>
    /^\p{Lu}[\p{L}'’.-]*(?:\s|$)/u.test(display)
  )
}

function leadingTitleBase(value) {
  const tokens = nameTokens(value)
  return tokens.length > 1 && LEADING_CHARACTER_TITLES.has(tokens[0])
    ? tokens.slice(1).join(' ')
    : null
}

function isCompositeOrCollectiveCharacter(node) {
  const tokens = nameTokens(node.normalized)
  return node.normalized.includes(' и ') ||
    node.normalized.includes(' and ') ||
    tokens.some((token) => COLLECTIVE_CHARACTER_TOKENS.has(token))
}

function isIndividualProperNameNode(node) {
  return hasProperNameForm(node) && !isCompositeOrCollectiveCharacter(node)
}

function mergeLeadingTitles(sets, nodes) {
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000')) continue
    const base = leadingTitleBase(node.normalized)
    if (!base) continue
    const baseKey = `character\u0000${base}`
    const baseNode = nodes.get(baseKey)
    if (baseNode && isIndividualProperNameNode(baseNode)) sets.union(node.key, baseKey)
  }
}

function compositeNameParts(node, nodes) {
  const tokens = nameTokens(node.normalized)
  if (tokens.length < 3) return null
  const prefixKey = `character\u0000${tokens.slice(0, -1).join(' ')}`
  const suffixKey = `character\u0000${tokens.at(-1)}`
  if (!nodes.has(prefixKey) || !nodes.has(suffixKey)) return null
  const competingSuffix = [...nodes.values()].some((candidate) => {
    if (candidate === node || !candidate.key.startsWith('character\u0000')) return false
    const candidateTokens = nameTokens(candidate.normalized)
    return candidateTokens.length >= 3 &&
      candidateTokens.slice(0, -1).join(' ') === tokens.slice(0, -1).join(' ') &&
      candidateTokens.at(-1) !== tokens.at(-1)
  })
  return competingSuffix ? { prefixKey, suffixKey } : null
}

function isRussianPatronymic(value) {
  return /(?:ович|евич|ич|овна|евна|ична|инична|оглы|кызы)$/u.test(value)
}

function isLikelyRussianSurname(value) {
  return /(?:ов|ев|ин|ын|ский|цкий|ской|ая|яя|ова|ева|ина|ына)$/u.test(value)
}

function isNicknameComposite(node, nodes) {
  const parts = compositeNameParts(node, nodes)
  if (!parts) return null
  const tokens = nameTokens(node.normalized)
  if (tokens.length !== 3) return null
  if (!isRussianPatronymic(tokens[1]) || isLikelyRussianSurname(tokens[2])) return null
  return parts
}

function mergeNicknameComposites(sets, nodes) {
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) continue
    const parts = isNicknameComposite(node, nodes)
    if (!parts) continue
    sets.union(node.key, parts.prefixKey)
    sets.union(node.key, parts.suffixKey)
  }
}

function diminutiveEchkaBase(tokens) {
  if (tokens.length !== 1 || tokens[0].length < 4) return null
  const [value] = tokens
  return value.endsWith('ечка') && value.length >= 6
    ? `${value.slice(0, -4)}я`
    : null
}

function mergeDiminutiveNicknames(sets, nodes) {
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) continue
    const base = diminutiveEchkaBase(nameTokens(node.normalized))
    if (!base) continue
    const baseKey = `character\u0000${base}`
    const baseNode = nodes.get(baseKey)
    if (baseNode && isIndividualProperNameNode(baseNode)) sets.union(node.key, baseKey)
  }
}

function mergeReorderedFullNames(sets, nodes) {
  const namesByTokenSet = new Map()
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) continue
    const tokens = nameTokens(node.normalized)
    if (tokens.length !== 3 || new Set(tokens).size !== 3) continue
    const tokenSet = [...tokens].sort(compareText).join('\u0000')
    const existing = namesByTokenSet.get(tokenSet)
    if (existing) sets.union(existing, node.key)
    else namesByTokenSet.set(tokenSet, node.key)
  }
}

function mergeResolvedCompositeNames(sets, nodes) {
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) continue
    const parts = compositeNameParts(node, nodes)
    if (!parts) continue
    const prefixRoot = sets.find(parts.prefixKey)
    const suffixRoot = sets.find(parts.suffixKey)
    if (prefixRoot === suffixRoot) sets.union(node.key, prefixRoot)
  }
}

function mergeReciprocalMentionAliases(sets, nodes, mentionClaims) {
  const edges = new Set()
  for (const { primaryKey, relatedKey } of mentionClaims) {
    if (!nodes.has(relatedKey)) continue
    if (!isIndividualProperNameNode(nodes.get(primaryKey)) ||
        !isIndividualProperNameNode(nodes.get(relatedKey))) {
      continue
    }
    const primaryRoot = sets.find(primaryKey)
    const relatedRoot = sets.find(relatedKey)
    if (primaryRoot !== relatedRoot) edges.add(`${primaryRoot}\u0000${relatedRoot}`)
  }
  const pairs = []
  for (const edge of edges) {
    const splitAt = edge.indexOf('\u0000character\u0000')
    if (splitAt < 0) continue
    const left = edge.slice(0, splitAt)
    const right = edge.slice(splitAt + 1)
    if (edges.has(`${right}\u0000${left}`)) pairs.push([left, right])
  }
  for (const [left, right] of pairs) {
    const bridged = [...nodes.values()].some((node) => {
      const parts = compositeNameParts(node, nodes)
      if (!parts) return false
      const roots = new Set([sets.find(parts.prefixKey), sets.find(parts.suffixKey)])
      return roots.size === 2 && roots.has(left) && roots.has(right)
    })
    if (bridged) sets.union(left, right)
  }
}

function commonPrefixLength(left, right) {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return index
}

function isPatronymicVariant(left, right) {
  if (left.length !== 3 || right.length !== 3) return false
  if (left[0] !== right[0] || left[2] !== right[2] || left[1] === right[1]) return false
  return Math.min(left[1].length, right[1].length) >= 6 &&
    Math.abs(left[1].length - right[1].length) <= 3 &&
    commonPrefixLength(left[1], right[1]) >= 5
}

function mergePatronymicVariants(sets, nodes) {
  const candidates = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && isIndividualProperNameNode(node)
  )
  for (const [index, node] of candidates.entries()) {
    const tokens = nameTokens(node.normalized)
    for (const other of candidates.slice(index + 1)) {
      if (isPatronymicVariant(tokens, nameTokens(other.normalized))) {
        sets.union(node.key, other.key)
      }
    }
  }
}

function mergeUnambiguousNameFragments(sets, nodes) {
  const nameNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') &&
    isIndividualProperNameNode(node) &&
    !isNicknameComposite(node, nodes)
  )
  const tokensByKey = new Map(nameNodes.map((node) => [node.key, nameTokens(node.normalized)]))
  let changed = true
  while (changed) {
    changed = false
    for (const node of nameNodes) {
      const sourceRoot = sets.find(node.key)
      const tokens = tokensByKey.get(node.key)
      const supersets = nameNodes.filter((candidate) =>
        sets.find(candidate.key) !== sourceRoot &&
        isOrderedSubset(tokens, tokensByKey.get(candidate.key))
      )
      const maximalSupersets = supersets.filter((candidate) =>
        !supersets.some((other) =>
          other !== candidate &&
          sets.find(other.key) !== sets.find(candidate.key) &&
          isOrderedSubset(tokensByKey.get(candidate.key), tokensByKey.get(other.key))
        )
      )
      const targetRoots = [...new Set(maximalSupersets.map(({ key }) => sets.find(key)))]
      if (targetRoots.length !== 1) continue
      sets.union(node.key, targetRoots[0])
      changed = true
    }
  }
}

function canonicalNode(groupNodes) {
  return [...groupNodes].sort((left, right) =>
    right.anchorConfidence - left.anchorConfidence ||
    Number(Boolean(leadingTitleBase(left.normalized))) -
      Number(Boolean(leadingTitleBase(right.normalized))) ||
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
  if (kind === 'character') {
    if (!groupNodes.some(isIndividualProperNameNode)) return false
    if (anchorConfidence >= ALIAS_CONFIDENCE || observations.length >= 2) return true
    if (confidence < ALIAS_CONFIDENCE) return false
    return observations.some(({ type }) => CHARACTER_BEHAVIOUR_TYPES.has(type)) &&
      !WEAK_CHARACTER_CANDIDATES.has(normalizedCandidate(canonical))
  }
  if (anchorConfidence >= ALIAS_CONFIDENCE || observations.length >= 2) return true
  if (confidence < ALIAS_CONFIDENCE) return false
  return true
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
  const mentionClaims = []

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
    if (observation.type === 'character_mention' && observation.confidence >= ALIAS_CONFIDENCE) {
      for (const related of observation.relatedEntityCandidates) {
        mentionClaims.push({
          primaryKey,
          relatedKey: stableNodeKey('character', related)
        })
      }
    }
    if (observation.type !== 'character_alias' || observation.confidence < ALIAS_CONFIDENCE) continue
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
  mergeLeadingTitles(sets, nodes)
  mergePatronymicVariants(sets, nodes)
  mergeReorderedFullNames(sets, nodes)
  mergeUnambiguousNameFragments(sets, nodes)
  mergeNicknameComposites(sets, nodes)
  mergeDiminutiveNicknames(sets, nodes)
  mergeReciprocalMentionAliases(sets, nodes, mentionClaims)
  mergeResolvedCompositeNames(sets, nodes)
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
  const entityByRoot = new Map()
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
    const entity = normalizeBookAnalysisResolvedEntity({
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
    })
    entities.push(entity)
    entityByRoot.set(root, entity)
  }

  for (const [root, entity] of entityByRoot) {
    if (entity.entityKind !== 'relationship') continue
    const relatedCharacterEntityKeys = new Set()
    const unresolvedRelatedEntityCandidates = new Set()
    for (const observation of observationsByRoot.get(root) ?? []) {
      for (const candidate of observation.relatedEntityCandidates) {
        const candidateNode = nodes.get(stableNodeKey('character', candidate))
        const characterEntity = candidateNode && entityByRoot.get(sets.find(candidateNode.key))
        if (characterEntity?.entityKind === 'character') {
          relatedCharacterEntityKeys.add(characterEntity.entityKey)
        } else {
          unresolvedRelatedEntityCandidates.add(displayCandidate(candidate))
        }
      }
    }
    entity.data.relatedCharacterEntityKeys = [...relatedCharacterEntityKeys].sort(compareText)
    entity.data.unresolvedRelatedEntityCandidates = [...unresolvedRelatedEntityCandidates]
      .sort(compareText)
    if (unresolvedRelatedEntityCandidates.size) entity.resolutionStatus = 'candidate'
  }

  entities.sort((left, right) =>
    KIND_ORDER.get(left.entityKind) - KIND_ORDER.get(right.entityKind) ||
    left.data.firstEvidenceStartOffset - right.data.firstEvidenceStartOffset ||
    compareText(left.entityKey, right.entityKey)
  )
  return entities
}

export const BOOK_ANALYSIS_ALIAS_CONFIDENCE = ALIAS_CONFIDENCE
