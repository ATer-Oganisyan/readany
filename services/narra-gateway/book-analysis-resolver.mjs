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
  'husband', 'widow', 'bride', 'groom', 'servant', 'policeman', 'policewoman',
  'статуя'
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
  'богатыри', 'старшины', 'наборщики', 'часовые', 'гайдуки', 'будочники',
  'писари', 'взводные', 'бронеавтомобили', 'девки', 'прислужницы',
  'племя', 'племена', 'вожди', 'потомки', 'сыны', 'жрецы', 'гиганты',
  'студенты',
  'army', 'troops', 'soldiers', 'people', 'children', 'brothers', 'sisters',
  'women', 'men', 'servants', 'musicians', 'tanks', 'crowd', 'voices'
])
const LEADING_CHARACTER_TITLES = new Set([
  'царь', 'царица', 'царевич', 'царевна', 'король', 'королева',
  'князь', 'княгиня', 'княжна',
  'граф', 'графиня', 'барон', 'баронесса', 'принц', 'принцесса',
  'майор', 'капитан', 'полковник', 'генерал', 'адмирал', 'профессор',
  'доктор', 'господин', 'госпожа', 'синьор', 'синьора', 'фон',
  'king', 'queen', 'prince', 'princess', 'count', 'countess', 'baron',
  'major', 'captain', 'colonel', 'general', 'admiral', 'professor', 'doctor',
  'mister', 'missus', 'sir', 'lady'
])
const LEADING_CHARACTER_DETERMINERS = new Set(['a', 'an', 'the'])
const IDENTITY_HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mister', 'missus', 'sir', 'lady', 'lord',
  'господин', 'госпожа'
])
const FAMILY_HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mister', 'missus'])
const MARRIED_HONORIFICS = new Set(['mrs', 'missus', 'госпожа'])
const NAMED_KINSHIP_TITLES = new Set(['aunt', 'uncle', 'тетя', 'тетушка', 'дядя'])
const HONORIFIC_GENDERS = new Map([
  ['mr', 'male'], ['mister', 'male'], ['sir', 'male'], ['lord', 'male'],
  ['mrs', 'female'], ['ms', 'female'], ['miss', 'female'], ['missus', 'female'],
  ['lady', 'female'], ['aunt', 'female'], ['uncle', 'male'],
  ['господин', 'male'], ['госпожа', 'female']
])
const GENERATIONAL_CHARACTER_TOKENS = new Set([
  'young', 'old', 'elder', 'younger', 'eldest', 'oldest', 'junior', 'senior',
  'son', 'daughter', 'mother', 'father', 'sister', 'brother',
  'молодой', 'молодая', 'юный', 'юная', 'старый', 'старая', 'старший',
  'старшая', 'младший', 'младшая', 'сын', 'дочь', 'мать', 'отец', 'сестра', 'брат'
])
const NAME_CONNECTOR_TOKENS = new Set(['of', 'de', 'del', 'della', 'di', 'du', 'van', 'von'])
const SIGNED_NAME_CUE = /\b(?:sign(?:s|ed|ing)?\s+(?:my|her|his|their|the)\s+name|sign(?:s|ed|ing)?\s+(?:myself|herself|himself|themself|themselves)\s+(?:as\s+)?)\b|\bподпис\p{L}*\s+(?:именем|как)\b/iu
const LETTER_SIGNATURE_CUE = /\b(?:signer|signature|signed)\b|\b(?:подпис\p{L}*|автор\p{L}*)\b/iu
const LETTER_REPLY_CUE = /\b(?:answer(?:ed|ing)?|repl(?:y|ied|ies|ying)|thank(?:ed|ing)?)\b|\b(?:ответ\p{L}*|отвеч\p{L}*|поблагодар\p{L}*|благодар\p{L}*)\b/iu
const LETTER_CUE = /\b(?:letter|note|epistle)\b|\b(?:письм\p{L}*|записк\p{L}*|послани\p{L}*)\b/iu
const FIRST_NAME_DECLARATION_CUE = /\bmy first name is\s+([\p{L}'’.-]+)/iu
const SPOUSE_CUE = /\b(?:wife|husband|spouse|marri(?:ed|age)|wedding|engaged\s+to\s+be\s+married)\b|\b(?:жен\p{L}*|муж\p{L}*|супруг\p{L}*|брак\p{L}*|свадьб\p{L}*|помолв\p{L}*)\b/iu
const DISTINCT_KINSHIP_CUE = /\b(?:mother|father|daughter|son|sister|brother|parent|child|aunt|uncle|niece|nephew|wife|husband|spouse)\b|\b(?:мать|отец|дочь|сын|сестра|брат|родител\p{L}*|ребен\p{L}*|тет\p{L}*|дяд\p{L}*|племян\p{L}*|жен\p{L}*|муж\p{L}*|супруг\p{L}*)\b/iu
const OWNED_KINSHIP_GENDERS = new Map([
  ['father', 'male'], ['son', 'male'],
  ['brother', 'male'],
  ['mother', 'female'], ['daughter', 'female'], ['sister', 'female']
])
const LEADING_HUMAN_ROLE_TOKENS = new Set([
  'коллежский', 'дядя', 'председатель', 'попадья', 'атаман', 'матушка',
  'хозяйка', 'механик', 'знакомый'
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

function stablePairKey(left, right) {
  return [left, right].sort(compareText).join('\u0001')
}

class DisjointSet {
  constructor() {
    this.parents = new Map()
    this.membersByRoot = new Map()
    this.forbiddenPairs = new Set()
    this.protectedMembers = new Set()
  }

  add(value) {
    if (!this.parents.has(value)) {
      this.parents.set(value, value)
      this.membersByRoot.set(value, new Set([value]))
    }
  }

  find(value) {
    const parent = this.parents.get(value)
    if (parent === value) return value
    const root = this.find(parent)
    this.parents.set(value, root)
    return root
  }

  forbid(left, right) {
    if (left === right) return
    this.add(left)
    this.add(right)
    this.forbiddenPairs.add(stablePairKey(left, right))
  }

  protect(value) {
    this.add(value)
    this.protectedMembers.add(value)
  }

  crossesForbidden(leftRoot, rightRoot) {
    if (!this.forbiddenPairs.size) return false
    const leftMembers = this.membersByRoot.get(leftRoot) ?? new Set([leftRoot])
    const rightMembers = this.membersByRoot.get(rightRoot) ?? new Set([rightRoot])
    return [...leftMembers].some((left) => [...rightMembers].some((right) =>
      this.forbiddenPairs.has(stablePairKey(left, right))
    ))
  }

  union(left, right) {
    this.add(left)
    this.add(right)
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot === rightRoot) return false
    const leftMembers = this.membersByRoot.get(leftRoot) ?? new Set([leftRoot])
    const rightMembers = this.membersByRoot.get(rightRoot) ?? new Set([rightRoot])
    if ([...leftMembers, ...rightMembers].some((member) =>
      this.protectedMembers.has(member)
    )) return false
    if (this.crossesForbidden(leftRoot, rightRoot)) return false
    const [first, second] = [leftRoot, rightRoot].sort(compareText)
    this.parents.set(second, first)
    const mergedMembers = this.membersByRoot.get(first) ?? new Set([first])
    const removedMembers = this.membersByRoot.get(second) ?? new Set([second])
    for (const member of removedMembers) mergedMembers.add(member)
    this.membersByRoot.set(first, mergedMembers)
    this.membersByRoot.delete(second)
    return true
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
      surfaceGroundedCount: 0,
      behaviourCount: 0,
      genderSignals: new Set(),
      identityLabelPriority: 0,
      identityAmbiguous: false,
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
  const honorificGender = HONORIFIC_GENDERS.get(nameTokens(node.normalized)[0])
  if (honorificGender) node.genderSignals.add(honorificGender)
  return node
}

function explicitObservationGender(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase('en-US')
  return normalized === 'male' || normalized === 'female' ? normalized : null
}

function attributedObservationGender(observation) {
  const explicit = explicitObservationGender(observation.fact)
  if (explicit) return explicit
  const candidate = normalizedCandidate(observation.entityCandidate)
  const fact = normalizedCandidate(observation.fact)
  if (!fact.startsWith(`${candidate} `)) return null
  const remainder = fact.slice(candidate.length + 1)
  const attribution = /^(?:is|was|является|был|была)\s+(?:(?:described|identified|introduced)\s+as\s+|(?:описан|описана|назван|названа)\s+)?(?:(?:a|an|the)\s+)?(?:young\s+)?/iu
  const value = remainder.match(attribution)?.[0]
  if (!value) return null
  const described = remainder.slice(value.length)
  if (/^(?:male|man|boy|son|мужчина|мальчик|сын)\b/iu.test(described)) return 'male'
  if (/^(?:female|woman|girl|daughter|женщина|девушка|девочка|дочь)\b/iu.test(described)) return 'female'
  return null
}

function surfaceRanges(value, surface) {
  const source = ` ${normalizedCandidate(value)} `
  const target = ` ${normalizedCandidate(surface)} `
  const ranges = []
  let offset = 0
  while (offset <= source.length - target.length) {
    const index = source.indexOf(target, offset)
    if (index < 0) break
    ranges.push([index + 1, index + target.length - 1])
    offset = index + 1
  }
  return ranges
}

function isSurfaceGrounded(surface, quote) {
  try {
    return surfaceRanges(quote, surface).length > 0
  } catch {
    return false
  }
}

function explicitOwnedKinshipLabels(value) {
  const source = String(value || '')
  const matches = source.matchAll(
    /\b((?:\p{Lu}[\p{L}\p{M}.'’\-]*)(?:\s+\p{Lu}[\p{L}\p{M}.'’\-]*){0,2})['’]s\s+(father|mother|son|daughter|brother|sister)\b/gu
  )
  const labels = []
  const seen = new Set()
  for (const match of matches) {
    const owner = displayCandidate(match[1])
    const kinship = match[2].toLocaleLowerCase('en-US')
    const label = `${owner}'s ${kinship}`
    const key = normalizedCandidate(label)
    if (seen.has(key)) continue
    seen.add(key)
    labels.push({ owner, kinship, label })
  }
  return labels
}

function quoteSupportsOwnedKinship({ owner, kinship }, quote) {
  if (!isSurfaceGrounded(owner, quote)) return false
  const normalized = normalizedCandidate(quote)
  const ownerKey = normalizedCandidate(owner)
  return normalized.includes(`${ownerKey} s ${kinship}`) ||
    ['his', 'her', 'their'].some((pronoun) => normalized.includes(`${pronoun} ${kinship}`))
}

function observationSupportsOwner(observation, owner) {
  const ownerKey = normalizedCandidate(owner)
  return isSurfaceGrounded(owner, observation.evidence.quote) ||
    isSurfaceGrounded(owner, observation.fact) ||
    observation.relatedEntityCandidates.some((candidate) => {
      const value = normalizedCandidate(candidate)
      return value === ownerKey || value.startsWith(`${ownerKey} `)
    })
}

function ownerSupportIsConsistent(primaryKey, owner, observationsByPrimaryKey) {
  const observations = observationsByPrimaryKey.get(primaryKey) ?? []
  if (!observations.length) return false
  const supporting = observations.filter((observation) =>
    observationSupportsOwner(observation, owner)
  ).length
  return supporting >= 1 && supporting / observations.length >= 0.5
}

function ownedKinshipPairIsConsistent(leftKey, rightKey, nodes, observationsByPrimaryKey) {
  for (const [labelKey, otherKey] of [[leftKey, rightKey], [rightKey, leftKey]]) {
    const labelNode = nodes.get(labelKey)
    if (!labelNode) continue
    const descriptors = explicitOwnedKinshipLabels(bestDisplay(labelNode))
    if (!descriptors.length) continue
    return descriptors.some(({ owner }) =>
      ownerSupportIsConsistent(otherKey, owner, observationsByPrimaryKey)
    )
  }
  return true
}

function genericKinshipNodeKeys(
  kinship,
  quote,
  owner,
  nodes,
  observationsByPrimaryKey
) {
  return [...nodes.values()]
    .filter((node) => {
      if (!node.key.startsWith('character\u0000')) return false
      const tokens = nameTokens(node.normalized)
      const observations = observationsByPrimaryKey.get(node.key) ?? []
      return tokens.at(-1) === kinship &&
        tokens.length <= 2 &&
        tokens.every((token) => token === kinship || ['his', 'her', 'their', 'the'].includes(token)) &&
        isSurfaceGrounded(bestDisplay(node), quote) &&
        (observations.length === 1 ||
          ownerSupportIsConsistent(node.key, owner, observationsByPrimaryKey))
    })
    .map(({ key }) => key)
}

/**
 * Reifies an owner-scoped kinship label only when the source quote contains the owner and
 * the corresponding possessive relation. The generic role remains unusable as a global alias;
 * it joins only the locally evidenced component from the same observation.
 */
function mergeExplicitOwnedKinshipLabels(
  sets,
  nodes,
  observations,
  primaryNodeByObservationId,
  observationsByPrimaryKey
) {
  for (const observation of observations) {
    if (observation.entityKind !== 'character') continue
    const labels = [
      ...observation.relatedEntityCandidates.flatMap(explicitOwnedKinshipLabels),
      ...explicitOwnedKinshipLabels(observation.fact)
    ]
    const seen = new Set()
    for (const descriptor of labels) {
      const labelKey = stableNodeKey('character', descriptor.label)
      if (seen.has(labelKey) || !quoteSupportsOwnedKinship(descriptor, observation.evidence.quote)) {
        continue
      }
      seen.add(labelKey)
      const ownerKey = stableNodeKey('character', descriptor.owner)
      if (!nodes.has(ownerKey)) continue
      const primaryKey = primaryNodeByObservationId.get(observation.id)
      if (!primaryKey) continue
      const primaryGrounded = isSurfaceGrounded(
        observation.entityCandidate,
        observation.evidence.quote
      )
      if ((!primaryGrounded && observation.type !== 'character_alias') ||
          !ownerSupportIsConsistent(primaryKey, descriptor.owner, observationsByPrimaryKey)) {
        continue
      }
      sets.add(labelKey)
      const labelNode = createNode(
        nodes,
        labelKey,
        descriptor.label,
        observation.evidence.startOffset
      )
      labelNode.identityLabelPriority = Math.max(labelNode.identityLabelPriority, 1)
      labelNode.anchorConfidence = Math.max(labelNode.anchorConfidence, observation.confidence)
      const gender = OWNED_KINSHIP_GENDERS.get(descriptor.kinship)
      if (gender) labelNode.genderSignals.add(gender)
      sets.union(primaryKey, labelKey)
      for (const genericKey of genericKinshipNodeKeys(
        descriptor.kinship,
        observation.evidence.quote,
        descriptor.owner,
        nodes,
        observationsByPrimaryKey
      )) {
        sets.union(labelKey, genericKey)
      }
    }
  }
}

function hasIndependentSurfaceEvidence(left, right, quote) {
  let leftRanges
  let rightRanges
  try {
    leftRanges = surfaceRanges(quote, left)
    rightRanges = surfaceRanges(quote, right)
  } catch {
    return false
  }
  return leftRanges.some(([leftStart, leftEnd]) => rightRanges.some(([rightStart, rightEnd]) =>
    leftEnd <= rightStart || rightEnd <= leftStart
  ))
}

function explicitRelationshipParticipants(observation) {
  if (observation.type !== 'relationship') return []
  const participants = displayCandidate(observation.entityCandidate)
    .split(/\s+(?:and|и|&)\s+/iu)
    .map(displayCandidate)
    .filter(Boolean)
  if (participants.length !== 2 || participants.some((value) =>
    !/^\p{Lu}/u.test(value) || value.length > 80 || !isSurfaceGrounded(value, observation.evidence.quote)
  )) return []
  if (!hasIndependentSurfaceEvidence(
    participants[0],
    participants[1],
    observation.evidence.quote
  )) return []
  return participants.filter((participant) => !observation.relatedEntityCandidates.some((related) => {
    const participantKey = normalizedCandidate(participant)
    const relatedKey = normalizedCandidate(related)
    return participantKey === relatedKey || isExplicitNameFragment(participantKey, relatedKey)
  }))
}

function groundedRelationshipCharacterCandidates(observation, nodes) {
  if (observation.type !== 'relationship') return []
  const compositeCandidates = displayCandidate(observation.entityCandidate)
    .split(/\s+(?:and|и|&)\s+/iu)
    .map(displayCandidate)
  const values = [
    ...observation.relatedEntityCandidates,
    ...(compositeCandidates.length === 2 ? compositeCandidates : [])
  ]
  const seen = new Set()
  return values.filter((value) => {
    let key
    try {
      key = stableNodeKey('character', value)
    } catch {
      return false
    }
    if (seen.has(key)) return false
    seen.add(key)
    const node = nodes.get(key)
    return Boolean(
      node && isIndividualProperNameNode(node) &&
      isSurfaceGrounded(value, observation.evidence.quote)
    )
  })
}

function identitySeparationVariants(candidate, nodes) {
  const normalized = normalizedCandidate(candidate)
  const exactKey = `character\u0000${normalized}`
  const variants = new Set([exactKey])
  for (const node of nodes.values()) {
    if (
      !node.key.startsWith('character\u0000') ||
      !isIndividualProperNameNode(node) ||
      node.key === exactKey
    ) continue
    const nodeTokenCount = semanticIdentityTokens(node.normalized).length
    const candidateTokenCount = semanticIdentityTokens(normalized).length
    const [shorter, longer] = nodeTokenCount < candidateTokenCount
      ? [node.normalized, normalized]
      : [normalized, node.normalized]
    if (
      nodeTokenCount !== candidateTokenCount &&
      isExplicitNameFragment(node.normalized, normalized) &&
      isSafePersonalNameExpansion(shorter, longer)
    ) variants.add(node.key)
  }
  return variants
}

function forbidIdentityFamilies(sets, nodes, left, right) {
  const leftExact = stableNodeKey('character', left)
  const rightExact = stableNodeKey('character', right)
  sets.forbid(leftExact, rightExact)
  const leftVariants = identitySeparationVariants(left, nodes)
  const rightVariants = identitySeparationVariants(right, nodes)
  const shared = new Set([...leftVariants].filter((key) => rightVariants.has(key)))
  for (const leftKey of leftVariants) {
    if (shared.has(leftKey) && leftKey !== leftExact) continue
    for (const rightKey of rightVariants) {
      if (shared.has(rightKey) && rightKey !== rightExact) continue
      if (leftKey !== rightKey) sets.forbid(leftKey, rightKey)
    }
  }
}

function registerHardIdentitySeparation(sets, nodes, observations) {
  for (const node of nodes.values()) {
    if (
      node.key.startsWith('character\u0000') &&
      WEAK_CHARACTER_CANDIDATES.has(node.normalized)
    ) sets.protect(node.key)
  }

  for (const observation of observations) {
    const participants = groundedRelationshipCharacterCandidates(observation, nodes)
    for (const [index, left] of participants.entries()) {
      for (const right of participants.slice(index + 1)) {
        if (!hasIndependentSurfaceEvidence(left, right, observation.evidence.quote)) continue
        forbidIdentityFamilies(sets, nodes, left, right)
      }
    }
  }

  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000')) continue
    for (const { display } of node.forms.values()) {
      const possessive = display.match(/^(.+?)['’]s\s+(\S+)/iu)
      if (!possessive) continue
      const ownerKey = stableNodeKey('character', possessive[1])
      if (nodes.has(ownerKey)) sets.forbid(node.key, ownerKey)
      const role = normalizedCandidate(possessive[2])
      const genericRoleKey = stableNodeKey('character', role)
      if (OWNED_KINSHIP_GENDERS.has(role) && nodes.has(genericRoleKey)) {
        sets.forbid(node.key, genericRoleKey)
      }
    }
  }
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
  if (shorter.length === 1) {
    return shorter[0] === longer.at(-1) ||
      (shorter[0] === longer[0] && NAME_CONNECTOR_TOKENS.has(longer[1]))
  }
  let shorterIndex = 0
  for (const token of longer) {
    if (token === shorter[shorterIndex]) shorterIndex += 1
    if (shorterIndex === shorter.length) return true
  }
  return false
}

function isSafePersonalNameExpansion(shorter, longer) {
  const shorterTokens = semanticIdentityTokens(shorter)
  const longerTokens = semanticIdentityTokens(longer)
  if (shorterTokens.length < 2 || longerTokens.length <= shorterTokens.length) return true
  return (
    shorterTokens[0] === longerTokens[0] &&
    shorterTokens.at(-1) === longerTokens.at(-1)
  ) || shorterTokens.every((token, index) => token === longerTokens[index])
}

function isExplicitNameFragment(left, right) {
  const leftTokens = nameTokens(left)
  const rightTokens = nameTokens(right)
  const [shorter, longer] = leftTokens.length < rightTokens.length
    ? [leftTokens, rightTokens]
    : [rightTokens, leftTokens]
  if (!shorter.length || shorter.length >= longer.length) return false
  const atStart = shorter.every((token, index) => token === longer[index])
  const atEnd = shorter.every((token, index) =>
    token === longer[longer.length - shorter.length + index]
  )
  return atStart || atEnd
}

function hasProperNameForm(node) {
  if (GENERIC_CHARACTER_CANDIDATES.has(node.normalized)) return false
  if (node.identityLabelPriority > 0) return true
  const tokens = nameTokens(node.normalized)
  const semanticTokens = leadingTitleBase(node.normalized) ? tokens.slice(1) : tokens
  if (semanticTokens.some((token) => DESCRIPTIVE_CHARACTER_TOKENS.has(token))) {
    return false
  }
  return [...node.forms.values()].some(({ display }) => {
    const words = display.match(/\p{L}[\p{L}'’.-]*/gu) ?? []
    if (words.length === 1) return /^\p{Lu}/u.test(words[0])
    if (!words.slice(1).some((word) => /^\p{Lu}/u.test(word))) return false
    return /^\p{Lu}/u.test(words[0]) ||
      Boolean(leadingTitleBase(node.normalized)) ||
      (Boolean(leadingDeterminerBase(node.normalized)) && /^\p{Lu}/u.test(words[1])) ||
      LEADING_HUMAN_ROLE_TOKENS.has(tokens[0])
  })
}

function leadingTitleBase(value) {
  const tokens = nameTokens(value)
  return tokens.length > 1 && LEADING_CHARACTER_TITLES.has(tokens[0])
    ? tokens.slice(1).join(' ')
    : null
}

function leadingDeterminerBase(value) {
  const tokens = nameTokens(value)
  return tokens.length > 1 && LEADING_CHARACTER_DETERMINERS.has(tokens[0])
    ? tokens.slice(1).join(' ')
    : null
}

function identityHonorificBase(value) {
  const tokens = nameTokens(value)
  return tokens.length > 1 && IDENTITY_HONORIFICS.has(tokens[0])
    ? tokens.slice(1).join(' ')
    : null
}

function hasGenerationalQualifier(value) {
  return nameTokens(value).some((token) => GENERATIONAL_CHARACTER_TOKENS.has(token))
}

function exactTitleOrDeterminerVariant(left, right) {
  return leadingTitleBase(left) === right || leadingTitleBase(right) === left ||
    leadingDeterminerBase(left) === right || leadingDeterminerBase(right) === left
}

function semanticIdentityTokens(value) {
  const tokens = nameTokens(value)
  return tokens.length > 1 && (
    LEADING_CHARACTER_TITLES.has(tokens[0]) ||
    LEADING_CHARACTER_DETERMINERS.has(tokens[0]) ||
    IDENTITY_HONORIFICS.has(tokens[0])
  )
    ? tokens.slice(1)
    : tokens
}

function identityFamilySignatures(base, nodes, sets = null) {
  const baseTokens = nameTokens(base)
  const signaturesByRoot = new Map()
  for (const candidate of nodes.values()) {
    if (
      !candidate.key.startsWith('character\u0000') ||
      !isIndividualProperNameNode(candidate) ||
      candidate.identityLabelPriority > 0
    ) {
      continue
    }
    const tokens = semanticIdentityTokens(candidate.normalized)
    if (tokens.length <= baseTokens.length) continue
    let baseIndex = 0
    const remainder = []
    for (const token of tokens) {
      if (baseIndex < baseTokens.length && token === baseTokens[baseIndex]) baseIndex += 1
      else remainder.push(token)
    }
    if (baseIndex === baseTokens.length && remainder.length) {
      const root = sets ? sets.find(candidate.key) : candidate.key
      const values = signaturesByRoot.get(root) ?? []
      values.push(remainder)
      signaturesByRoot.set(root, values)
    }
  }
  const values = [...signaturesByRoot.values()].map((rootValues) =>
    [...rootValues].sort((left, right) => right.length - left.length)[0]
  )
  return new Set(values.filter((tokens, index) => !values.some((other, otherIndex) =>
    index !== otherIndex && tokens.length < other.length &&
      tokens.every((token, tokenIndex) => token === other[tokenIndex])
  )).map((tokens) => tokens.join(' ')))
}

function isAmbiguousIdentityBase(value, nodes, sets = null) {
  const base = identityHonorificBase(value) || leadingTitleBase(value) || value
  const baseTokens = nameTokens(base)
  if (baseTokens.length !== 1) return false
  const signatures = identityFamilySignatures(base, nodes, sets)
  if (signatures.size > 1) return true
  const qualifiedExactRoots = new Set()
  for (const candidate of nodes.values()) {
    if (!candidate.key.startsWith('character\u0000') || !isIndividualProperNameNode(candidate)) {
      continue
    }
    if (
      candidate.normalized === base ||
      !leadingTitleBase(candidate.normalized) ||
      semanticIdentityTokens(candidate.normalized).join(' ') !== base
    ) {
      continue
    }
    qualifiedExactRoots.add(sets ? sets.find(candidate.key) : candidate.key)
  }
  return qualifiedExactRoots.size > 0 && [...signatures].some((signature) =>
    !signature.includes(' ')
  )
}

function isUnresolvedAmbiguousFragment(value, nodes, sets = null) {
  if (!isAmbiguousIdentityBase(value, nodes, sets)) return false
  const tokens = nameTokens(value)
  if (tokens.length === 1) return true
  if (new Set(['miss', 'ms']).has(tokens[0])) return true
  return Boolean(sets && hasMultipleCompatibleFamilyRoots(value, nodes, sets))
}

function hasMultipleCompatibleFamilyRoots(value, nodes, sets) {
  const tokens = nameTokens(value)
  if (tokens.length !== 2 || !FAMILY_HONORIFICS.has(tokens[0])) return false
  const sourceKey = `character\u0000${value}`
  if (!nodes.has(sourceKey)) return false
  const sourceRoot = sets.find(sourceKey)
  const supportByRoot = new Map()
  for (const candidate of nodes.values()) {
    if (!candidate.key.startsWith('character\u0000') || !isIndividualProperNameNode(candidate)) {
      continue
    }
    const candidateTokens = nameTokens(candidate.normalized)
    if (
      candidateTokens.length < 3 ||
      candidateTokens[0] !== tokens[0] ||
      candidateTokens.at(-1) !== tokens[1] ||
      candidateTokens[1].length <= 1
    ) continue
    const root = sets.find(candidate.key)
    if (root === sourceRoot || sets.crossesForbidden(sourceRoot, root)) continue
    const support = rootPrimarySupport(sets, nodes, root)
    if (support < 2) continue
    supportByRoot.set(root, support)
  }
  if (supportByRoot.size <= 1) return false
  const competingSupport = [...supportByRoot.values()].reduce((sum, value) => sum + value, 0)
  const sourceSupport = rootPrimarySupport(sets, nodes, sourceRoot)
  return sourceSupport < 20 || sourceSupport < competingSupport * 4
}

function isSafeTitleOrDeterminerVariant(left, right, nodes, sets = null) {
  if (!exactTitleOrDeterminerVariant(left, right)) return false
  const base = leadingTitleBase(left) === right || leadingDeterminerBase(left) === right
    ? right
    : left
  return !isAmbiguousIdentityBase(base, nodes, sets)
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

function hasStrongIdentitySupport(node) {
  return node.primaryCount >= 2 || node.surfaceGroundedCount >= 2 ||
    node.behaviourCount >= 2 || node.anchorConfidence >= ALIAS_CONFIDENCE
}

function rootPrimarySupport(sets, nodes, root) {
  return componentNodes(sets, nodes, root)
    .reduce((sum, candidate) => sum + candidate.primaryCount, 0)
}

function mergeLeadingTitles(sets, nodes) {
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000')) continue
    const base = leadingTitleBase(node.normalized)
    if (!base) continue
    const baseKey = `character\u0000${base}`
    const baseNode = nodes.get(baseKey)
    if (
      baseNode && isIndividualProperNameNode(baseNode) &&
      !isAmbiguousIdentityBase(base, nodes, sets)
    ) {
      sets.union(node.key, baseKey)
    }
  }
}

function mergeLeadingDeterminers(sets, nodes) {
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000')) continue
    const base = leadingDeterminerBase(node.normalized)
    if (!base) continue
    const baseKey = `character\u0000${base}`
    const baseNode = nodes.get(baseKey)
    if (baseNode && isIndividualProperNameNode(baseNode)) sets.union(node.key, baseKey)
  }
}

function mergeTwoPartCompositeBridges(sets, nodes) {
  for (const node of nodes.values()) {
    if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) continue
    const tokens = nameTokens(node.normalized)
    if (tokens.length !== 2) continue
    const firstNode = nodes.get(`character\u0000${tokens[0]}`)
    if (!firstNode || !isIndividualProperNameNode(firstNode)) continue
    const firstRoot = sets.find(firstNode.key)
    const hasLastNameBridge = [...nodes.values()].some((candidate) =>
      candidate.key.startsWith('character\u0000') &&
      sets.find(candidate.key) === firstRoot &&
      (candidate.normalized === tokens[1] || identityHonorificBase(candidate.normalized) === tokens[1])
    )
    if (hasLastNameBridge) sets.union(node.key, firstRoot)
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
      const ambiguousBase = isAmbiguousIdentityBase(node.normalized, nodes, sets)
      if (isUnresolvedAmbiguousFragment(node.normalized, nodes, sets)) {
        node.identityAmbiguous = true
      }
      const supersets = nameNodes.filter((candidate) =>
        sets.find(candidate.key) !== sourceRoot &&
        hasGenerationalQualifier(node.normalized) ===
          hasGenerationalQualifier(candidate.normalized) &&
        (!ambiguousBase || (
          tokens.every((token, index) => token === tokensByKey.get(candidate.key)[index]) &&
          NAME_CONNECTOR_TOKENS.has(tokensByKey.get(candidate.key)[tokens.length])
        )) &&
        isOrderedSubset(tokens, tokensByKey.get(candidate.key)) &&
        isSafePersonalNameExpansion(node.normalized, candidate.normalized)
      )
      const maximalSupersets = supersets.filter((candidate) =>
        !supersets.some((other) =>
          other !== candidate &&
          sets.find(other.key) !== sets.find(candidate.key) &&
          isOrderedSubset(tokensByKey.get(candidate.key), tokensByKey.get(other.key))
        )
      )
      const targetRoots = [...new Set(maximalSupersets.map(({ key }) => sets.find(key)))]
      if (targetRoots.length !== 1) {
        if (targetRoots.length > 1 && tokens.length === 1) node.identityAmbiguous = true
        continue
      }
      if (sets.union(node.key, targetRoots[0])) changed = true
    }
  }
}

function mergeStrongUniqueGivenNames(sets, nodes) {
  const nameNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && isIndividualProperNameNode(node)
  )
  for (const node of nameNodes) {
    const tokens = semanticIdentityTokens(node.normalized)
    if (
      tokens.length !== 1 || nameTokens(node.normalized).length !== 1 ||
      (node.surfaceGroundedCount < 1 && node.behaviourCount < 1)
    ) {
      continue
    }
    const ambiguousBase = isAmbiguousIdentityBase(node.normalized, nodes, sets)
    const sourceRoot = sets.find(node.key)
    const candidates = nameNodes.filter((candidate) => {
      const candidateTokens = semanticIdentityTokens(candidate.normalized)
      return sets.find(candidate.key) !== sourceRoot &&
        candidateTokens.length >= 2 && candidateTokens[0] === tokens[0] &&
        hasGenerationalQualifier(candidate.normalized) ===
          hasGenerationalQualifier(node.normalized) &&
        (candidate.surfaceGroundedCount >= 1 || hasStrongIdentitySupport(candidate))
    })
    let targetRoots = [...new Set(candidates.map(({ key }) => sets.find(key)))]
    if (targetRoots.length > 1 && ambiguousBase && node.primaryCount >= 2) {
      const ranked = targetRoots.map((root) => ({
        root,
        support: rootPrimarySupport(sets, nodes, root)
      })).sort((left, right) => right.support - left.support || compareText(left.root, right.root))
      if (ranked[0].support >= 5 && ranked[0].support >= ranked[1].support * 5) {
        targetRoots = [ranked[0].root]
      }
    }
    if (targetRoots.length !== 1) continue
    if (ambiguousBase && targetRoots.length === 1) {
      const competingRoots = new Set(candidates.map(({ key }) => sets.find(key)))
      if (competingRoots.size === 1 && identityFamilySignatures(
        node.normalized,
        nodes,
        sets
      ).size > 1) continue
    }
    const support = node.primaryCount + candidates.reduce((sum, candidate) =>
      sum + candidate.primaryCount, 0
    )
    if (support < 3) continue
    sets.union(node.key, targetRoots[0])
  }
}

function mergeTriangulatedFamilyNicknames(
  sets,
  nodes,
  observations,
  primaryNodeByObservationId
) {
  for (const observation of observations) {
    if (
      observation.entityKind !== 'character' ||
      observation.type !== 'character_mention' ||
      observation.confidence < ALIAS_CONFIDENCE
    ) continue
    const sourceKey = primaryNodeByObservationId.get(observation.id)
    if (!sourceKey) continue
    const sourceNode = nodes.get(sourceKey)
    const sourceTokens = semanticIdentityTokens(sourceNode.normalized)
    if (
      sourceTokens.length !== 2 ||
      isSurfaceGrounded(sourceNode.normalized, observation.evidence.quote)
    ) continue
    const [given, family] = sourceTokens
    const givenKey = `character\u0000${given}`
    if (
      !nodes.has(givenKey) ||
      !observation.relatedEntityCandidates.some((candidate) =>
        normalizedCandidate(candidate) === given
      ) ||
      !isSurfaceGrounded(given, observation.evidence.quote)
    ) continue
    const groundedKinship = observation.relatedEntityCandidates.some((candidate) => {
      const normalized = normalizedCandidate(candidate)
      return OWNED_KINSHIP_GENDERS.has(normalized) &&
        isSurfaceGrounded(candidate, observation.evidence.quote)
    })
    if (!groundedKinship) continue
    const titledKeys = observation.relatedEntityCandidates
      .map((candidate) => stableNodeKey('character', candidate))
      .filter((key) => nodes.has(key) && titledFamilyBase(nodes.get(key)) === family)
    const titledRoots = [...new Set(titledKeys.map((key) => sets.find(key)))]
    if (titledRoots.length !== 1) continue
    const titledRoot = titledRoots[0]
    const reciprocal = observations.some((candidate) => {
      const candidateKey = primaryNodeByObservationId.get(candidate.id)
      return candidate.id !== observation.id &&
        candidate.entityKind === 'character' &&
        candidate.confidence >= ALIAS_CONFIDENCE &&
        candidateKey && sets.find(candidateKey) === titledRoot &&
        candidate.relatedEntityCandidates.some((related) =>
          normalizedCandidate(related) === given
        ) && isSurfaceGrounded(candidate.entityCandidate, candidate.evidence.quote)
    })
    if (!reciprocal) continue
    const sourceRoot = sets.find(sourceKey)
    const sourceNodes = componentNodes(sets, nodes, sourceRoot)
    const titledNodes = componentNodes(sets, nodes, titledRoot)
    if (hasGenderCollision(sourceNodes, titledNodes)) continue
    sets.union(sourceRoot, givenKey)
    sets.union(sourceRoot, titledRoot)
  }
}

function mergeExplicitFirstNameDeclarations(
  sets,
  nodes,
  observations,
  primaryNodeByObservationId
) {
  const nameNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && isIndividualProperNameNode(node)
  )
  for (const observation of observations) {
    if (observation.entityKind !== 'character') continue
    const match = observation.evidence.quote.match(FIRST_NAME_DECLARATION_CUE)
    if (!match || !isSurfaceGrounded(observation.entityCandidate, observation.evidence.quote)) {
      continue
    }
    const declared = normalizedCandidate(match[1])
    const sourceKey = primaryNodeByObservationId.get(observation.id)
    if (!sourceKey) continue
    const sourceRoot = sets.find(sourceKey)
    const sourceNodes = componentNodes(sets, nodes, sourceRoot)
    const sourceFamilies = new Set(fullPersonalNames(sourceNodes).map((tokens) => tokens.at(-1)))
    if (!sourceFamilies.size || sourceFamilies.has(declared)) continue
    const targets = [...new Set(nameNodes.filter((candidate) => {
      const targetRoot = sets.find(candidate.key)
      if (targetRoot === sourceRoot || candidate.firstOffset <= observation.evidence.startOffset) {
        return false
      }
      const tokens = semanticIdentityTokens(candidate.normalized)
      if (tokens.length < 2 || tokens[0] !== declared || !sourceFamilies.has(tokens.at(-1))) {
        return false
      }
      const targetNodes = componentNodes(sets, nodes, targetRoot)
      return !hasGenderCollision(sourceNodes, targetNodes) &&
        !hasGenerationalCollision(sourceNodes, targetNodes)
    }).map(({ key }) => sets.find(key)))]
    if (targets.length === 1) sets.union(sourceRoot, targets[0])
  }
}

function mergeExplicitSpouseNameTransitions(
  sets,
  nodes,
  observations,
  primaryNodeByObservationId
) {
  const nameNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && isIndividualProperNameNode(node)
  )
  for (const observation of observations) {
    if (
      observation.entityKind !== 'character' ||
      !SPOUSE_CUE.test(`${observation.fact} ${observation.evidence.quote}`)
    ) continue
    const sourceKey = primaryNodeByObservationId.get(observation.id)
    if (!sourceKey) continue
    const sourceRoot = sets.find(sourceKey)
    const sourceNodes = componentNodes(sets, nodes, sourceRoot)
    const sourceNames = fullPersonalNames(sourceNodes)
    if (!sourceNames.length) continue
    const partnerRoots = [...new Set(observation.relatedEntityCandidates
      .map((candidate) => nodes.get(stableNodeKey('character', candidate)))
      .filter(Boolean)
      .map(({ key }) => sets.find(key))
      .filter((root) => root !== sourceRoot))]
    const targets = []
    for (const partnerRoot of partnerRoots) {
      const family = spouseFamily(componentNodes(sets, nodes, partnerRoot))
      if (!family) continue
      for (const sourceName of sourceNames) {
        if (sourceName.at(-1) === family) continue
        for (const candidate of nameNodes) {
          const targetRoot = sets.find(candidate.key)
          const targetTokens = semanticIdentityTokens(candidate.normalized)
          if (
            targetRoot === sourceRoot || targetRoot === partnerRoot ||
            candidate.firstOffset <= observation.evidence.startOffset ||
            targetTokens.length !== 2 || targetTokens[0] !== sourceName[0] ||
            targetTokens[1] !== family
          ) continue
          const targetNodes = componentNodes(sets, nodes, targetRoot)
          if (
            !hasGenderCollision(sourceNodes, targetNodes) &&
            !hasGenerationalCollision(sourceNodes, targetNodes)
          ) targets.push(targetRoot)
        }
      }
    }
    const uniqueTargets = [...new Set(targets)]
    if (uniqueTargets.length === 1) sets.union(sourceRoot, uniqueTargets[0])
  }
}

function genderSignalsForRoot(sets, nodes, root) {
  return new Set([...nodes.values()]
    .filter((node) => sets.find(node.key) === root)
    .flatMap(({ genderSignals }) => [...genderSignals]))
}

function sharedGivenNameAcrossFamilyChange(leftNodes, rightNodes) {
  const names = (groupNodes) => groupNodes
    .filter(isIndividualProperNameNode)
    .map(({ normalized }) => semanticIdentityTokens(normalized))
    .filter((tokens) => tokens.length >= 2)
  return names(leftNodes).some((left) => names(rightNodes).some((right) =>
    left[0] === right[0] && left.at(-1) !== right.at(-1)
  ))
}

function mergeExplicitSignedNameTransitions(sets, nodes, observations, primaryNodeByObservationId) {
  const nameNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && isIndividualProperNameNode(node)
  )
  for (const observation of observations) {
    if (observation.entityKind !== 'character') continue
    const context = `${observation.fact} ${observation.evidence.quote}`
    if (!SIGNED_NAME_CUE.test(context)) continue
    const sourceKey = primaryNodeByObservationId.get(observation.id)
    if (!sourceKey) continue
    const sourceRoot = sets.find(sourceKey)
    const sourceNodes = componentNodes(sets, nodes, sourceRoot)
    const targets = [...new Set(nameNodes
      .filter((candidate) => {
        const targetRoot = sets.find(candidate.key)
        if (targetRoot === sourceRoot || !isSurfaceGrounded(
          candidate.normalized,
          observation.evidence.quote
        )) return false
        const targetNodes = componentNodes(sets, nodes, targetRoot)
        return sharedGivenNameAcrossFamilyChange(sourceNodes, targetNodes) &&
          !hasGenderCollision(sourceNodes, targetNodes) &&
          !hasGenerationalCollision(sourceNodes, targetNodes)
      })
      .map(({ key }) => sets.find(key)))]
    if (targets.length === 1) sets.union(sourceRoot, targets[0])
  }
}

function spouseFamily(groupNodes) {
  const values = groupNodes
    .filter(isIndividualProperNameNode)
    .map(({ normalized }) => semanticIdentityTokens(normalized))
    .filter((tokens) => tokens.length)
    .map((tokens) => tokens.at(-1))
  return values.length ? values.sort(compareText)[0] : null
}

function fullPersonalNames(groupNodes) {
  return groupNodes
    .filter(isIndividualProperNameNode)
    .map(({ normalized }) => semanticIdentityTokens(normalized))
    .filter((tokens) => tokens.length >= 2 && tokens[0].length > 1)
}

function mergeExplicitSpouseTitles(sets, nodes, observations) {
  for (const observation of observations) {
    if (observation.type !== 'relationship' || !SPOUSE_CUE.test(
      `${observation.fact} ${observation.evidence.quote}`
    )) continue
    const participantRoots = [...new Set(observation.relatedEntityCandidates
      .map((candidate) => nodes.get(stableNodeKey('character', candidate)))
      .filter(Boolean)
      .map(({ key }) => sets.find(key)))]
    if (participantRoots.length !== 2) continue
    for (const sourceRoot of participantRoots) {
      const partnerRoot = participantRoots.find((root) => root !== sourceRoot)
      const sourceNodes = componentNodes(sets, nodes, sourceRoot)
      const partnerNodes = componentNodes(sets, nodes, partnerRoot)
      const sourceGenders = genderSignalsForRoot(sets, nodes, sourceRoot)
      const partnerGenders = genderSignalsForRoot(sets, nodes, partnerRoot)
      if (sourceGenders.size !== 1 || partnerGenders.size !== 1 ||
          [...sourceGenders].some((value) => partnerGenders.has(value))) continue
      const [sourceGender] = sourceGenders
      if (sourceGender !== 'female') continue
      const family = spouseFamily(partnerNodes)
      if (!family) continue
      const sourceNames = fullPersonalNames(sourceNodes)
      if (!sourceNames.length || sourceNames.some((tokens) => tokens.at(-1) === family)) continue
      const targetRoots = [...new Set([...nodes.values()]
        .filter((node) => titledFamilyBase(node) === family &&
          MARRIED_HONORIFICS.has(nameTokens(node.normalized)[0]) &&
          HONORIFIC_GENDERS.get(nameTokens(node.normalized)[0]) === sourceGender)
        .map(({ key }) => sets.find(key))
        .filter((root) => root !== sourceRoot && root !== partnerRoot))]
      if (targetRoots.length !== 1) continue
      const targetNodes = componentNodes(sets, nodes, targetRoots[0])
      if (!hasGenderCollision(sourceNodes, targetNodes)) sets.union(sourceRoot, targetRoots[0])
    }
  }
}

function mergeMarriedFullNameExpansions(sets, nodes) {
  const roots = new Set([...nodes.keys()].map((key) => sets.find(key)))
  for (const root of roots) {
    const groupNodes = componentNodes(sets, nodes, root)
    const names = fullPersonalNames(groupNodes)
    const marriedFamilies = new Set(groupNodes
      .filter((node) => MARRIED_HONORIFICS.has(nameTokens(node.normalized)[0]))
      .map(titledFamilyBase)
      .filter(Boolean))
    if (!names.length || marriedFamilies.size !== 1) continue
    const [family] = marriedFamilies
    const givenNames = new Set(names.map((tokens) => tokens[0]))
    const targets = [...new Set([...nodes.values()]
      .filter((candidate) => {
        if (!isIndividualProperNameNode(candidate) || sets.find(candidate.key) === root) return false
        const tokens = semanticIdentityTokens(candidate.normalized)
        return tokens.length === 2 && givenNames.has(tokens[0]) && tokens[1] === family
      })
      .map(({ key }) => sets.find(key)))]
    if (targets.length === 1) sets.union(root, targets[0])
  }
}

function mergeStrongUniqueTitledPrefixes(sets, nodes) {
  const nameNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && isIndividualProperNameNode(node)
  )
  for (const node of nameNodes) {
    const tokens = nameTokens(node.normalized)
    if (
      tokens.length !== 2 ||
      !LEADING_CHARACTER_TITLES.has(tokens[0]) ||
      node.surfaceGroundedCount < 1
    ) {
      continue
    }
    const sourceRoot = sets.find(node.key)
    const candidates = nameNodes.filter((candidate) => {
      const candidateTokens = nameTokens(candidate.normalized)
      return sets.find(candidate.key) !== sourceRoot &&
        candidateTokens.length > tokens.length &&
        tokens.every((token, index) => candidateTokens[index] === token) &&
        candidate.surfaceGroundedCount >= 1
    })
    const targetRoots = [...new Set(candidates.map(({ key }) => sets.find(key)))]
    if (targetRoots.length !== 1) continue
    const support = node.primaryCount + candidates.reduce((sum, candidate) =>
      sum + candidate.primaryCount, 0
    )
    if (support >= 3) sets.union(node.key, targetRoots[0])
  }
}

function rootGenderSignals(sets, nodes, root, observationsByPrimaryKey) {
  const values = new Set()
  for (const node of componentNodes(sets, nodes, root)) {
    for (const value of node.genderSignals) values.add(value)
    for (const observation of observationsByPrimaryKey.get(node.key) ?? []) {
      const value = attributedObservationGender(observation)
      if (value) values.add(value)
    }
  }
  return values
}

function groundedSubstitutionSpans(
  sets,
  nodes,
  sourceRoot,
  targetRoot,
  observationsByPrimaryKey
) {
  const sourceForms = componentNodes(sets, nodes, sourceRoot)
    .flatMap((node) => [...node.forms.values()].map(({ display }) => display))
  const targetForms = componentNodes(sets, nodes, targetRoot)
    .flatMap((node) => [...node.forms.values()].map(({ display }) => display))
  const spans = new Set()
  for (const node of componentNodes(sets, nodes, sourceRoot)) {
    for (const observation of observationsByPrimaryKey.get(node.key) ?? []) {
      // A substitution is useful only when the scan assigned one identity while the quote names
      // the other. Mere co-occurrence is negative evidence for identity, not an alias bridge.
      if (
        !sourceForms.some((display) => isSurfaceGrounded(display, observation.evidence.quote)) &&
        targetForms.some((display) => isSurfaceGrounded(display, observation.evidence.quote))
      ) {
        spans.add(`${observation.evidence.startOffset}:${observation.evidence.endOffset}`)
      }
    }
  }
  return spans
}

function relationshipSeparatesComponents(sets, nodes, leftRoot, rightRoot, observations) {
  return observations.some((observation) => {
    if (observation.type !== 'relationship' || !DISTINCT_KINSHIP_CUE.test(observation.fact)) {
      return false
    }
    const roots = new Set(observation.relatedEntityCandidates.map((candidate) => {
      let key
      try {
        key = stableNodeKey('character', candidate)
      } catch {
        return null
      }
      return nodes.has(key) ? sets.find(key) : null
    }).filter(Boolean))
    return roots.has(leftRoot) && roots.has(rightRoot)
  })
}

function explicitRoleAttributionTarget(observation, nodes) {
  if (observation.type !== 'character_role') return null
  const source = normalizedCandidate(observation.entityCandidate)
  if (!isSurfaceGrounded(observation.entityCandidate, observation.evidence.quote)) return null
  const fact = normalizedCandidate(observation.fact)
  const targets = [...nodes.values()].filter((node) => {
    if (!node.key.startsWith('character\u0000')) return false
    const role = leadingDeterminerBase(node.normalized)
    if (!role || GENERATIONAL_CHARACTER_TOKENS.has(role) ||
        OWNED_KINSHIP_GENDERS.has(role)) return false
    const display = [...node.forms.values()].find(({ display }) =>
      isSurfaceGrounded(display, observation.evidence.quote)
    )?.display
    if (!display || !hasIndependentSurfaceEvidence(
      observation.entityCandidate,
      display,
      observation.evidence.quote
    )) return false
    return fact === `${source} is the ${role}` || fact === `${source} was the ${role}` ||
      fact === `${source} является ${role}` || fact === `${source} был ${role}` ||
      fact === `${source} была ${role}`
  })
  return targets.length === 1 ? targets[0].key : null
}

/**
 * A role is not an alias by itself. It becomes one only when the same role observation explicitly
 * states the identity and its quote independently grounds both the personal name and descriptor.
 */
function mergeExplicitRoleAttributions(
  sets,
  nodes,
  observations,
  primaryNodeByObservationId
) {
  for (const observation of observations) {
    const targetKey = explicitRoleAttributionTarget(observation, nodes)
    const sourceKey = primaryNodeByObservationId.get(observation.id)
    if (!targetKey || !sourceKey) continue
    sets.union(sourceKey, targetKey)
  }
}

/**
 * Joins a titled family form only when frozen scan evidence itself substitutes that form for one
 * compatible full-name root. This is deliberately stricter than surname/gender inference: if
 * Edward and Robert both receive `Mr Ferrars` evidence, neither can absorb the shared title.
 */
function mergeEvidenceSubstitutedTitledNames(
  sets,
  nodes,
  observations,
  observationsByPrimaryKey
) {
  const titledNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000') && titledFamilyBase(node)
  )
  for (const titledNode of titledNodes) {
    const titleRoot = sets.find(titledNode.key)
    // A bare family title that is already attached to a full name has an owner. Reusing a
    // one-sided scan substitution to attach a second full name would collapse relatives such as
    // Charlotte Lucas and Maria Lucas through the shared `Miss Lucas` component.
    if (fullPersonalNames(componentNodes(sets, nodes, titleRoot)).length > 0) continue
    const family = titledFamilyBase(titledNode)
    const titleGender = HONORIFIC_GENDERS.get(nameTokens(titledNode.normalized)[0])
    if (!titleGender) continue
    const candidateRoots = [...new Set([...nodes.values()].filter((node) => {
      if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) return false
      const root = sets.find(node.key)
      const tokens = semanticIdentityTokens(node.normalized)
      if (root === titleRoot || tokens.length < 2 || tokens.at(-1) !== family) return false
      const genders = rootGenderSignals(sets, nodes, root, observationsByPrimaryKey)
      return genders.size <= 1 && (!genders.size || genders.has(titleGender))
    }).map(({ key }) => sets.find(key)))]
    const supported = candidateRoots.filter((root) =>
      groundedSubstitutionSpans(
        sets,
        nodes,
        root,
        titleRoot,
        observationsByPrimaryKey
      ).size > 0 || groundedSubstitutionSpans(
        sets,
        nodes,
        titleRoot,
        root,
        observationsByPrimaryKey
      ).size > 0
    )
    const supportedExtendsExactTitle = supported.length === 1 &&
      componentNodes(sets, nodes, supported[0]).some((node) => {
        const tokens = nameTokens(node.normalized)
        const titledTokens = nameTokens(titledNode.normalized)
        return tokens.length >= 3 && tokens[0] === titledTokens[0] &&
          tokens.at(-1) === family
      })
    if (
      supported.length === 1 &&
      (candidateRoots.length === 1 || supportedExtendsExactTitle) &&
      !relationshipSeparatesComponents(sets, nodes, titleRoot, supported[0], observations)
    ) sets.union(titleRoot, supported[0])
  }
}

function namedKinshipCore(node) {
  const tokens = nameTokens(node.normalized)
  return tokens.length >= 3 && NAMED_KINSHIP_TITLES.has(tokens[0])
    ? tokens.slice(1).join(' ')
    : null
}

function mergeNamedKinshipTitleVariants(sets, nodes) {
  const candidates = [...nodes.values()].filter((node) => namedKinshipCore(node))
  for (const node of candidates) {
    const sourceRoot = sets.find(node.key)
    const core = namedKinshipCore(node)
    const targets = [...new Set([...nodes.values()].filter((candidate) =>
      candidate.key.startsWith('character\u0000') &&
      sets.find(candidate.key) !== sourceRoot &&
      semanticIdentityTokens(candidate.normalized).join(' ') === core &&
      candidate.surfaceGroundedCount > 0
    ).map(({ key }) => sets.find(key)))].filter((root) =>
      // Do not bridge through a component that already contains a family-only title. That cluster
      // is ambiguous by construction (`Miss Barry` and `Mrs Barry` can be different people), even
      // if it also happens to contain the desired full name.
      componentNodes(sets, nodes, root)
        .filter((candidate) => candidate.key.startsWith('character\u0000'))
        .every((candidate) => {
          const tokens = semanticIdentityTokens(candidate.normalized)
          return tokens.length >= 2 && tokens.join(' ') === core
        })
    )
    if (targets.length === 1) sets.union(sourceRoot, targets[0])
  }
}

function componentEvidenceNodesWithUniqueGiven(sets, nodes, root) {
  const values = new Map(componentNodes(sets, nodes, root).map((node) => [node.key, node]))
  for (const tokens of fullPersonalNames([...values.values()])) {
    const given = tokens[0]
    const givenKey = stableNodeKey('character', given)
    const givenNode = nodes.get(givenKey)
    if (
      givenNode &&
      identityFamilySignatures(given, nodes, sets).size === 1
    ) values.set(givenKey, givenNode)
  }
  return [...values.values()]
}

function relatedReferenceSpans(
  sets,
  nodes,
  sourceRoot,
  targetRoot,
  observationsByPrimaryKey
) {
  const targetKeys = new Set(
    componentEvidenceNodesWithUniqueGiven(sets, nodes, targetRoot).map(({ key }) => key)
  )
  const spans = new Set()
  for (const node of componentNodes(sets, nodes, sourceRoot)) {
    for (const observation of observationsByPrimaryKey.get(node.key) ?? []) {
      const referencesTarget = observation.relatedEntityCandidates.some((candidate) => {
        let key
        try {
          key = stableNodeKey('character', candidate)
        } catch {
          return false
        }
        return targetKeys.has(key)
      })
      if (referencesTarget) {
        spans.add(`${observation.evidence.startOffset}:${observation.evidence.endOffset}`)
      }
    }
  }
  return spans
}

function spouseOwnershipSpans(
  sets,
  nodes,
  sourceRoot,
  titledNode,
  observationsByPrimaryKey
) {
  const titleTokens = nameTokens(titledNode.normalized)
  const partner = titleTokens.slice(1).join(' ')
  const sourceNodes = componentEvidenceNodesWithUniqueGiven(sets, nodes, sourceRoot)
  const sourceForms = sourceNodes
    .flatMap((node) => [...node.forms.values()].map(({ display }) => display))
  const spans = new Set()
  for (const node of sourceNodes) {
    for (const observation of observationsByPrimaryKey.get(node.key) ?? []) {
      const fact = observation.fact
      if (
        SPOUSE_CUE.test(fact) &&
        isSurfaceGrounded(partner, fact) &&
        sourceForms.some((display) => isSurfaceGrounded(display, fact))
      ) spans.add(`${observation.evidence.startOffset}:${observation.evidence.endOffset}`)
    }
  }
  return spans
}

/**
 * `Mrs John Dashwood` is a spouse-style title, not a woman named John. It may join a different
 * given name only when scan evidence repeatedly cross-references exactly one same-family woman.
 */
function mergeRepeatedMarriedTitleReferences(sets, nodes, observationsByPrimaryKey) {
  const titledNodes = [...nodes.values()].filter((node) => {
    const tokens = nameTokens(node.normalized)
    return tokens.length === 3 && MARRIED_HONORIFICS.has(tokens[0])
  })
  for (const titledNode of titledNodes) {
    const titleRoot = sets.find(titledNode.key)
    const family = nameTokens(titledNode.normalized).at(-1)
    const candidates = [...new Set([...nodes.values()].filter((node) => {
      if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) return false
      const root = sets.find(node.key)
      const tokens = semanticIdentityTokens(node.normalized)
      if (root === titleRoot || tokens.length !== 2 || tokens.at(-1) !== family) return false
      const genders = rootGenderSignals(sets, nodes, root, observationsByPrimaryKey)
      return genders.size === 1 && genders.has('female')
    }).map(({ key }) => sets.find(key)))]
    const supported = candidates.filter((root) =>
      relatedReferenceSpans(
        sets,
        nodes,
        titleRoot,
        root,
        observationsByPrimaryKey
      ).size >= 2 && spouseOwnershipSpans(
        sets,
        nodes,
        root,
        titledNode,
        observationsByPrimaryKey
      ).size >= 1
    )
    if (supported.length === 1) sets.union(titleRoot, supported[0])
  }
}

function initialSignatureFamily(node) {
  const tokens = semanticIdentityTokens(node.normalized)
  if (tokens.length !== 2 || tokens[0].length !== 1) return null
  return [...node.forms.values()].some(({ display }) =>
    /^\p{L}\.\s+\p{L}[\p{L}\p{M}'’.-]*$/u.test(display)
  ) ? tokens[1] : null
}

/**
 * Resolves a letter-signature initial only through a later, independently grounded reply to that
 * exact letter. `M. Gardiner` must never be expanded as the honorific `Mr. Gardiner`; the bridge
 * instead needs (a) explicit signer evidence, (b) a named correspondent in the signed letter and
 * (c) a same-family titled person named in an answer/reply/thanks reference to a letter.
 */
function mergeAnsweredLetterSignatures(sets, nodes, observationsByPrimaryKey) {
  const characterNodes = [...nodes.values()].filter((node) =>
    node.key.startsWith('character\u0000')
  )
  for (const signerNode of characterNodes) {
    const family = initialSignatureFamily(signerNode)
    if (!family) continue
    const signerObservations = observationsByPrimaryKey.get(signerNode.key) ?? []
    const hasSignature = signerObservations.some((observation) => {
      const context = `${observation.fact} ${observation.evidence.quote}`
      return LETTER_SIGNATURE_CUE.test(context) &&
        LETTER_CUE.test(context) &&
        isSurfaceGrounded(bestDisplay(signerNode), observation.evidence.quote)
    })
    if (!hasSignature) continue

    const correspondentNodes = characterNodes.filter((candidate) => {
      if (candidate.key === signerNode.key) return false
      const tokens = semanticIdentityTokens(candidate.normalized)
      if (tokens.at(-1) === family) return false
      return signerObservations.some((observation) =>
        [...candidate.forms.values()].some(({ display }) =>
          isSurfaceGrounded(display, observation.evidence.quote)
        )
      )
    })
    if (!correspondentNodes.length) continue

    const targetRoots = [...new Set(characterNodes.filter((candidate) => {
      const tokens = nameTokens(candidate.normalized)
      return tokens.length === 2 && FAMILY_HONORIFICS.has(tokens[0]) &&
        titledFamilyBase(candidate) === family
    }).filter((candidate) => {
      const targetRoot = sets.find(candidate.key)
      return componentNodes(sets, nodes, targetRoot).some((componentNode) =>
        (observationsByPrimaryKey.get(componentNode.key) ?? []).some((observation) => {
          const context = `${observation.fact} ${observation.evidence.quote}`
          return LETTER_REPLY_CUE.test(context) && LETTER_CUE.test(context) &&
            [...candidate.forms.values()].some(({ display }) =>
              isSurfaceGrounded(display, observation.evidence.quote)
            ) && correspondentNodes.some((correspondent) =>
              [...correspondent.forms.values()].some(({ display }) =>
                isSurfaceGrounded(display, observation.evidence.quote)
              )
            )
        })
      )
    }).map(({ key }) => sets.find(key)))]
    if (targetRoots.length === 1) sets.union(signerNode.key, targetRoots[0])
  }
}

function groundedPersonalNameNode(node) {
  return node.identityLabelPriority === 0 &&
    node.surfaceGroundedCount > 0 &&
    properNameScore(bestDisplay(node)) > 0 &&
    !leadingDeterminerBase(node.normalized) &&
    isIndividualProperNameNode(node)
}

function canonicalNode(groupNodes) {
  const preferGroundedPersonalName = groupNodes.some(groundedPersonalNameNode)
  return [...groupNodes].sort((left, right) =>
    (preferGroundedPersonalName
      ? Number(groundedPersonalNameNode(right)) - Number(groundedPersonalNameNode(left))
      : 0) ||
    right.identityLabelPriority - left.identityLabelPriority ||
    right.surfaceGroundedCount - left.surfaceGroundedCount ||
    Number(Boolean(leadingTitleBase(left.normalized) || identityHonorificBase(left.normalized))) -
      Number(Boolean(leadingTitleBase(right.normalized) || identityHonorificBase(right.normalized))) ||
    tokenCount(right.normalized) - tokenCount(left.normalized) ||
    right.anchorConfidence - left.anchorConfidence ||
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

function entityKeyForNodes(kind, groupNodes) {
  const candidateKeys = groupNodes.map(({ normalized }) => normalized).sort()
  return `${kind}:${sha256(`${kind}:${candidateKeys.join('|')}`).slice(0, 48)}`
}

function componentNodes(sets, nodes, memberKey) {
  const root = sets.find(memberKey)
  return [...nodes.values()].filter((node) => sets.find(node.key) === root)
}

function normalizedPersonalNames(groupNodes) {
  return groupNodes
    .filter((node) => node.key.startsWith('character\u0000') && isIndividualProperNameNode(node))
    .map((node) => semanticIdentityTokens(node.normalized))
    .filter((tokens) => tokens.length >= 2)
}

function hasGenerationalCollision(leftNodes, rightNodes) {
  const variants = (groupNodes) => groupNodes.map(({ normalized }) => {
    const tokens = semanticIdentityTokens(normalized)
    return {
      qualified: tokens.some((token) => GENERATIONAL_CHARACTER_TOKENS.has(token)),
      base: tokens.filter((token) => !GENERATIONAL_CHARACTER_TOKENS.has(token)).join(' ')
    }
  }).filter(({ base }) => base)
  const left = variants(leftNodes)
  const right = variants(rightNodes)
  return left.some((one) => right.some((other) =>
    one.base === other.base && one.qualified !== other.qualified
  ))
}

function hasFamilyCollision(leftNodes, rightNodes, basis) {
  for (const left of normalizedPersonalNames(leftNodes)) {
    for (const right of normalizedPersonalNames(rightNodes)) {
      const sameFamily = left.at(-1) === right.at(-1)
      if (sameFamily && left[0] !== right[0] && basis !== 'nickname') return true
      const sameGivenDifferentFamily = left[0] === right[0] && left.at(-1) !== right.at(-1)
      if (sameGivenDifferentFamily && basis !== 'married_name') return true
    }
  }
  return false
}

function hasInitialHonorificCollision(leftNodes, rightNodes) {
  const variants = (groupNodes) => groupNodes.map(({ normalized }) => nameTokens(normalized))
  return variants(leftNodes).some((left) => variants(rightNodes).some((right) => {
    const [initial, titled] = left[0]?.length === 1 ? [left, right] : [right, left]
    return initial.length === 2 && titled.length === 2 &&
      initial[0].length === 1 && FAMILY_HONORIFICS.has(titled[0]) &&
      initial[1] === titled[1]
  }))
}

function titledFamilyBase(node) {
  const tokens = nameTokens(node.normalized)
  return tokens.length === 2 && FAMILY_HONORIFICS.has(tokens[0]) ? tokens[1] : null
}

function markAmbiguousSingularFamilyTitles(sets, nodes, observations) {
  for (const observation of observations) {
    if (observation.entityKind !== 'character') continue
    const tokens = nameTokens(normalizedCandidate(observation.entityCandidate))
    const related = new Set(observation.relatedEntityCandidates
      .map(normalizedCandidate)
      .filter(Boolean))
    if (
      tokens.length !== 2 || !FAMILY_HONORIFICS.has(tokens[0]) ||
      related.size < 2 || !tokens[1].endsWith('s')
    ) continue
    const singularKey = stableNodeKey('character', `${tokens[0]} ${tokens[1].slice(0, -1)}`)
    const singular = nodes.get(singularKey)
    if (!singular) continue
    singular.identityAmbiguous = true
    sets.protect(singularKey)
  }
}

function hasCompetingTitledFamilyIdentity(leftNodes, rightNodes, nodes, sets) {
  const proposedNodes = [...leftNodes, ...rightNodes]
  const proposedRoots = new Set(proposedNodes.map(({ key }) => sets.find(key)))
  for (const [titledNodes, namedNodes] of [
    [leftNodes, rightNodes],
    [rightNodes, leftNodes]
  ]) {
    for (const titledNode of titledNodes) {
      const family = titledFamilyBase(titledNode)
      if (!family) continue
      const matchesNamed = normalizedPersonalNames(namedNodes).some((tokens) =>
        tokens.at(-1) === family
      )
      if (!matchesNamed) continue
      const competingRoots = new Set([...nodes.values()].filter((node) => {
        if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) {
          return false
        }
        const tokens = semanticIdentityTokens(node.normalized)
        return titledFamilyBase(node) === family ||
          (tokens.length >= 2 && tokens.at(-1) === family && tokens[0].length > 1)
      }).map(({ key }) => sets.find(key)).filter((root) => !proposedRoots.has(root)))
      for (const root of competingRoots) {
        const competingNodes = componentNodes(sets, nodes, root)
        if (
          !hasGenderCollision(proposedNodes, competingNodes) &&
          !hasGenerationalCollision(proposedNodes, competingNodes)
        ) return true
      }
    }
  }
  return false
}

function hasAmbiguousStructuralOverlap(leftNodes, rightNodes, nodes, sets) {
  const proposedRoots = new Set(
    [...leftNodes, ...rightNodes].map(({ key }) => sets.find(key))
  )
  const ambiguousGivenAsFamily = leftNodes.some((left) => rightNodes.some((right) => {
    const leftTokens = semanticIdentityTokens(left.normalized)
    const rightTokens = semanticIdentityTokens(right.normalized)
    const [shorter, longer] = leftTokens.length < rightTokens.length
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens]
    if (shorter.length !== 1 || longer.length < 2 || shorter[0] !== longer.at(-1)) return false
    return [...nodes.values()].some((candidate) => {
      if (!candidate.key.startsWith('character\u0000') || !isIndividualProperNameNode(candidate)) {
        return false
      }
      if (proposedRoots.has(sets.find(candidate.key))) return false
      const tokens = semanticIdentityTokens(candidate.normalized)
      return tokens.length >= 2 && tokens[0] === shorter[0]
    })
  }))
  if (ambiguousGivenAsFamily) return true
  const unsafeExpansion = leftNodes.some((left) => rightNodes.some((right) => {
    if (!isExplicitNameFragment(left.normalized, right.normalized)) return false
    const leftCount = semanticIdentityTokens(left.normalized).length
    const rightCount = semanticIdentityTokens(right.normalized).length
    const [shorter, longer] = leftCount < rightCount
      ? [left.normalized, right.normalized]
      : [right.normalized, left.normalized]
    return leftCount !== rightCount && !isSafePersonalNameExpansion(shorter, longer)
  }))
  if (unsafeExpansion) return true
  const ambiguousOverlap = leftNodes.some((left) => rightNodes.some((right) => {
    const overlaps = exactTitleOrDeterminerVariant(left.normalized, right.normalized) ||
      isExplicitNameFragment(left.normalized, right.normalized) ||
      isOrderedSubset(nameTokens(left.normalized), nameTokens(right.normalized)) ||
      isOrderedSubset(nameTokens(right.normalized), nameTokens(left.normalized))
    return overlaps && (
      isAmbiguousIdentityBase(left.normalized, nodes, sets) ||
      isAmbiguousIdentityBase(right.normalized, nodes, sets)
    )
  }))
  if (!ambiguousOverlap) return false
  const proposedNodes = [...leftNodes, ...rightNodes]
  const proposedComponentRoots = new Set(proposedNodes.map(({ key }) => sets.find(key)))
  const families = new Set(normalizedPersonalNames(proposedNodes).map((tokens) => tokens.at(-1)))
  if (families.size !== 1) return true
  const [family] = families
  const competingRoots = new Set([...nodes.values()].filter((node) => {
    if (!node.key.startsWith('character\u0000') || !isIndividualProperNameNode(node)) return false
    const tokens = semanticIdentityTokens(node.normalized)
    return tokens.length >= 2 && tokens.at(-1) === family && tokens[0].length > 1
  }).map(({ key }) => sets.find(key)).filter((root) => !proposedComponentRoots.has(root)))
  for (const root of competingRoots) {
    const competingNodes = componentNodes(sets, nodes, root)
    if (
      !hasGenderCollision(proposedNodes, competingNodes) &&
      !hasGenerationalCollision(proposedNodes, competingNodes)
    ) return true
  }
  return false
}

function hasGenderCollision(leftNodes, rightNodes) {
  const left = new Set(leftNodes.flatMap(({ genderSignals }) => [...genderSignals]))
  const right = new Set(rightNodes.flatMap(({ genderSignals }) => [...genderSignals]))
  return left.size === 1 && right.size === 1 && ![...left].some((value) => right.has(value))
}

function unsafeApprovedIdentityMerge(leftNodes, rightNodes, basis, nodes, sets) {
  const leftCollective = leftNodes.some(isCompositeOrCollectiveCharacter)
  const rightCollective = rightNodes.some(isCompositeOrCollectiveCharacter)
  return leftCollective !== rightCollective ||
    hasGenderCollision(leftNodes, rightNodes) ||
    hasInitialHonorificCollision(leftNodes, rightNodes) ||
    hasAmbiguousStructuralOverlap(leftNodes, rightNodes, nodes, sets) ||
    hasGenerationalCollision(leftNodes, rightNodes) ||
    hasFamilyCollision(leftNodes, rightNodes, basis) ||
    hasCompetingTitledFamilyIdentity(leftNodes, rightNodes, nodes, sets)
}

function applyApprovedIdentityMerges(sets, nodes, identityMerges) {
  if (!Array.isArray(identityMerges)) {
    throw resolutionError('RESOLUTION_INPUT_INVALID', 'identityMerges must be an array')
  }
  if (identityMerges.length > MAX_ENTITY_CANDIDATES) {
    throw resolutionError('RESOLUTION_INPUT_INVALID', 'identity merge limit exceeded')
  }
  const entityKeyToNodeKey = new Map()
  const roots = new Set([...nodes.keys()].map((key) => sets.find(key)))
  for (const root of roots) {
    const members = componentNodes(sets, nodes, root)
    const kind = root.slice(0, root.indexOf('\u0000'))
    entityKeyToNodeKey.set(entityKeyForNodes(kind, members), members[0].key)
  }
  for (const [index, merge] of identityMerges.entries()) {
    const leftEntityKey = typeof merge?.leftEntityKey === 'string' ? merge.leftEntityKey : ''
    const rightEntityKey = typeof merge?.rightEntityKey === 'string' ? merge.rightEntityKey : ''
    const basis = typeof merge?.basis === 'string' ? merge.basis : ''
    const leftNodeKey = entityKeyToNodeKey.get(leftEntityKey)
    const rightNodeKey = entityKeyToNodeKey.get(rightEntityKey)
    if (!leftNodeKey || !rightNodeKey) {
      throw resolutionError(
        'RESOLUTION_INPUT_INVALID',
        `identityMerges[${index}] references an unknown provisional entity`
      )
    }
    const leftRoot = sets.find(leftNodeKey)
    const rightRoot = sets.find(rightNodeKey)
    if (leftRoot === rightRoot) continue
    if (!leftRoot.startsWith('character\u0000') || !rightRoot.startsWith('character\u0000')) {
      throw resolutionError(
        'RESOLUTION_INPUT_INVALID',
        `identityMerges[${index}] must reference characters`
      )
    }
    const leftNodes = componentNodes(sets, nodes, leftNodeKey)
    const rightNodes = componentNodes(sets, nodes, rightNodeKey)
    if (unsafeApprovedIdentityMerge(leftNodes, rightNodes, basis, nodes, sets)) continue
    sets.union(leftRoot, rightRoot)
  }
}

function nameScript(value) {
  const source = String(value || '')
  const cyrillic = /\p{Script=Cyrillic}/u.test(source)
  const latin = /\p{Script=Latin}/u.test(source)
  if (cyrillic === latin) return null
  return cyrillic ? 'cyrillic' : 'latin'
}

function hasUnsafeCrossScriptAlias(left, right) {
  const leftScript = nameScript(bestDisplay(left))
  const rightScript = nameScript(bestDisplay(right))
  return Boolean(
    leftScript && rightScript && leftScript !== rightScript &&
    (!left.surfaceGroundedCount || !right.surfaceGroundedCount)
  )
}

function hasCrossScriptGroundingMismatch(canonical, groupNodes) {
  const value = String(canonical || '')
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(value)
  const hasLatin = /\p{Script=Latin}/u.test(value)
  if (hasCyrillic === hasLatin) return false
  const expected = hasCyrillic ? 'cyrillic' : 'latin'
  return !groupNodes.some((node) =>
    nameScript(bestDisplay(node)) === expected && node.surfaceGroundedCount > 0
  )
}

function isConfirmed(kind, canonical, observations, anchorConfidence, confidence, groupNodes) {
  if (kind === 'character') {
    if (WEAK_CHARACTER_CANDIDATES.has(normalizedCandidate(canonical))) return false
    if (hasCrossScriptGroundingMismatch(canonical, groupNodes)) return false
    if (!groupNodes.some(isIndividualProperNameNode)) return false
    if (groupNodes.every(({ identityAmbiguous }) => identityAmbiguous)) return false
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
export function resolveBookAnalysisEntities({ observations: rawObservations, identityMerges = [] }) {
  const observations = normalizeInputObservations(rawObservations)
  const sets = new DisjointSet()
  const nodes = new Map()
  const primaryNodeByObservationId = new Map()
  const observationsByPrimaryKey = new Map()
  const aliasClaims = []
  const mentionClaims = []

  for (const observation of observations) {
    const primaryKey = stableNodeKey(observation.entityKind, observation.entityCandidate)
    sets.add(primaryKey)
    primaryNodeByObservationId.set(observation.id, primaryKey)
    const primaryObservations = observationsByPrimaryKey.get(primaryKey) ?? []
    primaryObservations.push(observation)
    observationsByPrimaryKey.set(primaryKey, primaryObservations)
    const primaryNode = createNode(
      nodes,
      primaryKey,
      observation.entityCandidate,
      observation.evidence.startOffset,
      { primary: true, confidence: observation.confidence }
    )
    if (isSurfaceGrounded(observation.entityCandidate, observation.evidence.quote)) {
      primaryNode.surfaceGroundedCount += 1
    }
    if (CHARACTER_BEHAVIOUR_TYPES.has(observation.type)) primaryNode.behaviourCount += 1
    const observationGender = explicitObservationGender(observation.fact)
    if (observationGender) primaryNode.genderSignals.add(observationGender)
    for (const participant of explicitRelationshipParticipants(observation)) {
      const participantKey = stableNodeKey('character', participant)
      sets.add(participantKey)
      const participantNode = createNode(
        nodes,
        participantKey,
        participant,
        observation.evidence.startOffset
      )
      participantNode.surfaceGroundedCount += 1
      participantNode.anchorConfidence = Math.max(
        participantNode.anchorConfidence,
        observation.confidence
      )
      if (!hasProperNameForm(participantNode)) participantNode.identityLabelPriority = 1
    }
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
      aliasClaims.push({
        primaryKey,
        aliasKey,
        observationId: observation.id,
        confidence: observation.confidence,
        evidence: observation.evidence,
        grounded: hasIndependentSurfaceEvidence(
          observation.entityCandidate,
          alias,
          observation.evidence.quote
        )
      })
    }
  }

  // A spouse-style title contains the partner's name, so generic relationship separation can
  // otherwise mistake the title for that partner's family variant. Apply only the independently
  // proved wife/title identity first; all later unions remain subject to hard component guards.
  markAmbiguousSingularFamilyTitles(sets, nodes, observations)
  mergeRepeatedMarriedTitleReferences(sets, nodes, observationsByPrimaryKey)
  mergeAnsweredLetterSignatures(sets, nodes, observationsByPrimaryKey)
  registerHardIdentitySeparation(sets, nodes, observations)

  const claimsByPair = new Map()
  for (const claim of aliasClaims) {
    const pair = [claim.primaryKey, claim.aliasKey].sort(compareText).join('\u0001')
    const claims = claimsByPair.get(pair) ?? []
    claims.push(claim)
    claimsByPair.set(pair, claims)
  }
  const supportedAliasPairs = [...claimsByPair.entries()].map(([pair, claims]) => {
    const [left, right] = pair.split('\u0001')
    const directions = new Set(claims.map(({ primaryKey, aliasKey }) =>
      `${primaryKey}\u0001${aliasKey}`
    ))
    const evidenceSpans = new Set(claims.map(({ evidence }) =>
      `${evidence.startOffset}:${evidence.endOffset}`
    ))
    const structural = isSafeTitleOrDeterminerVariant(
      nodes.get(left).normalized,
      nodes.get(right).normalized,
      nodes,
      sets
    )
    const explicitFragment = !isAmbiguousIdentityBase(nodes.get(left).normalized, nodes, sets) &&
      !isAmbiguousIdentityBase(nodes.get(right).normalized, nodes, sets) && isExplicitNameFragment(
      nodes.get(left).normalized,
      nodes.get(right).normalized
      )
    const generational = hasGenerationalQualifier(nodes.get(left).normalized) !==
      hasGenerationalQualifier(nodes.get(right).normalized)
    const reciprocal = directions.has(`${left}\u0001${right}`) &&
      directions.has(`${right}\u0001${left}`)
    const ambiguousOverlap = (
      structural || isExplicitNameFragment(nodes.get(left).normalized, nodes.get(right).normalized)
    ) && (
      isAmbiguousIdentityBase(nodes.get(left).normalized, nodes, sets) ||
      isAmbiguousIdentityBase(nodes.get(right).normalized, nodes, sets)
    )
    const supported = ownedKinshipPairIsConsistent(
      left,
      right,
      nodes,
      observationsByPrimaryKey
    ) && !WEAK_CHARACTER_CANDIDATES.has(nodes.get(left).normalized) &&
      !WEAK_CHARACTER_CANDIDATES.has(nodes.get(right).normalized) &&
      !hasUnsafeCrossScriptAlias(nodes.get(left), nodes.get(right)) &&
      !hasGenderCollision([nodes.get(left)], [nodes.get(right)]) &&
      !hasCompetingTitledFamilyIdentity(
        [nodes.get(left)], [nodes.get(right)], nodes, sets
      ) && !ambiguousOverlap && (structural || (!generational && (explicitFragment ||
      claims.some(({ grounded }) => grounded) || reciprocal
    )))
    return {
      left,
      right,
      supported,
      supportCount: evidenceSpans.size,
      confidence: Math.max(...claims.map(({ confidence }) => confidence))
    }
  }).filter(({ supported }) => supported).sort((left, right) =>
    right.supportCount - left.supportCount ||
    right.confidence - left.confidence ||
    compareText(left.left, right.left) ||
    compareText(left.right, right.right)
  )
  for (const { left, right } of supportedAliasPairs) {
    sets.union(left, right)
  }
  mergeExplicitOwnedKinshipLabels(
    sets,
    nodes,
    observations,
    primaryNodeByObservationId,
    observationsByPrimaryKey
  )
  mergeLeadingDeterminers(sets, nodes)
  mergeLeadingTitles(sets, nodes)
  mergeTwoPartCompositeBridges(sets, nodes)
  mergePatronymicVariants(sets, nodes)
  mergeReorderedFullNames(sets, nodes)
  mergeUnambiguousNameFragments(sets, nodes)
  mergeNicknameComposites(sets, nodes)
  mergeDiminutiveNicknames(sets, nodes)
  mergeTriangulatedFamilyNicknames(sets, nodes, observations, primaryNodeByObservationId)
  mergeReciprocalMentionAliases(sets, nodes, mentionClaims)
  mergeResolvedCompositeNames(sets, nodes)
  mergeTwoPartCompositeBridges(sets, nodes)
  mergeUnambiguousNameFragments(sets, nodes)
  mergeStrongUniqueGivenNames(sets, nodes)
  mergeStrongUniqueTitledPrefixes(sets, nodes)
  mergeExplicitFirstNameDeclarations(sets, nodes, observations, primaryNodeByObservationId)
  mergeExplicitSignedNameTransitions(sets, nodes, observations, primaryNodeByObservationId)
  mergeExplicitSpouseTitles(sets, nodes, observations)
  mergeExplicitSpouseNameTransitions(sets, nodes, observations, primaryNodeByObservationId)
  mergeMarriedFullNameExpansions(sets, nodes)
  mergeNamedKinshipTitleVariants(sets, nodes)
  mergeExplicitRoleAttributions(sets, nodes, observations, primaryNodeByObservationId)
  mergeEvidenceSubstitutedTitledNames(sets, nodes, observations, observationsByPrimaryKey)
  mergeStrongUniqueGivenNames(sets, nodes)
  applyApprovedIdentityMerges(sets, nodes, identityMerges)

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
    const kind = root.slice(0, root.indexOf('\u0000'))
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
    const entityKey = entityKeyForNodes(kind, groupNodes)
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
      const candidates = [
        ...observation.relatedEntityCandidates,
        ...explicitRelationshipParticipants(observation)
      ]
      for (const candidate of candidates) {
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
