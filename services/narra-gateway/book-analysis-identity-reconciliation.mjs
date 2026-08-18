const MAX_CHARACTER_ENTITIES = 128
const MAX_EVIDENCE_PER_ENTITY = 2
const MAX_REQUEST_BYTES = 96 * 1024
const MAX_CANDIDATE_PAIRS = 128
const IDENTITY_PREFIXES = new Set([
  'a', 'an', 'the', 'mr', 'mrs', 'ms', 'miss', 'mister', 'missus', 'sir', 'lady', 'lord',
  'господин', 'госпожа'
])
const HONORIFIC_GENDERS = new Map([
  ['mr', 'male'], ['mister', 'male'], ['sir', 'male'], ['lord', 'male'],
  ['mrs', 'female'], ['ms', 'female'], ['miss', 'female'], ['missus', 'female'],
  ['lady', 'female'],
  ['господин', 'male'], ['госпожа', 'female']
])
const MERGE_BASES = new Set([
  'name_variant',
  'nickname',
  'married_name',
  'explicit_alias',
  'persona'
])
const IDENTITY_EVIDENCE_RANK = new Map([
  ['character_alias', 0],
  ['character_mention', 1],
  ['character_role', 2],
  ['character_gender', 3],
  ['character_dialogue', 4],
  ['character_action', 5],
  ['character_trait', 6],
  ['character_age', 7],
  ['character_appearance', 8]
])

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function boundedText(value, length) {
  return String(value || '').trim().replace(/\s+/gu, ' ').slice(0, length)
}

function pairKey(left, right) {
  return [left, right].sort(compareText).join('\u0000')
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function identityTokens(value) {
  const tokens = normalizedName(value).split(' ').filter(Boolean)
  return tokens.length > 1 && IDENTITY_PREFIXES.has(tokens[0]) ? tokens.slice(1) : tokens
}

function orderedSubset(shorter, longer) {
  if (!shorter.length || shorter.length >= longer.length) return false
  let index = 0
  for (const token of longer) {
    if (token === shorter[index]) index += 1
    if (index === shorter.length) return true
  }
  return false
}

function nearSpellingToken(left, right) {
  if (left === right || Math.min(left.length, right.length) < 4) return false
  if (Math.abs(left.length - right.length) > 1) return false
  if (left.length === right.length) {
    const differences = []
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index)
    }
    if (differences.length === 1) return true
    return differences.length === 2 &&
      left[differences[0]] === right[differences[1]] &&
      left[differences[1]] === right[differences[0]]
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shortIndex = 0
  let longIndex = 0
  let skipped = false
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1
      longIndex += 1
      continue
    }
    if (skipped) return false
    skipped = true
    longIndex += 1
  }
  return true
}

class DisjointSet {
  constructor(values) {
    this.parents = new Map(values.map((value) => [value, value]))
  }

  find(value) {
    const parent = this.parents.get(value)
    if (parent === value) return value
    const root = this.find(parent)
    this.parents.set(value, root)
    return root
  }

  members(value) {
    const root = this.find(value)
    return [...this.parents.keys()].filter((candidate) => this.find(candidate) === root)
  }

  union(left, right) {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot === rightRoot) return false
    const [first, second] = [leftRoot, rightRoot].sort(compareText)
    this.parents.set(second, first)
    return true
  }
}

function otherRosterNameScore(observation, ownNames, rosterNames) {
  const source = normalizedName(`${observation.fact} ${observation.evidence.quote}`)
  let score = 0
  for (const name of rosterNames) {
    if (ownNames.has(name) || name.length < 3) continue
    const paddedSource = ` ${source} `
    if (paddedSource.includes(` ${name} `)) {
      score = Math.max(score, name.split(' ').length * 1_000 + name.length)
    }
  }
  return score
}

function representativeEvidence(entity, observationsById, limit, rosterNames) {
  const ownNames = new Set(
    [entity.canonicalName, ...entity.aliases].map(normalizedName).filter(Boolean)
  )
  const candidates = entity.evidenceIds
    .map((id) => observationsById.get(id))
    .filter(Boolean)
    .sort((left, right) =>
      otherRosterNameScore(right, ownNames, rosterNames) -
        otherRosterNameScore(left, ownNames, rosterNames) ||
      (IDENTITY_EVIDENCE_RANK.get(left.type) ?? 99) -
        (IDENTITY_EVIDENCE_RANK.get(right.type) ?? 99) ||
      left.evidence.startOffset - right.evidence.startOffset ||
      compareText(left.id, right.id)
    )
  if (candidates.length <= limit) return candidates
  const first = candidates[0]
  if (limit === 1) return [first]
  const second = [...candidates.slice(1)].sort((left, right) =>
    Math.abs(right.evidence.startOffset - first.evidence.startOffset) -
      Math.abs(left.evidence.startOffset - first.evidence.startOffset) ||
    (IDENTITY_EVIDENCE_RANK.get(left.type) ?? 99) -
      (IDENTITY_EVIDENCE_RANK.get(right.type) ?? 99) ||
    compareText(left.id, right.id)
  )[0]
  return [first, second].sort((left, right) =>
    left.evidence.startOffset - right.evidence.startOffset || compareText(left.id, right.id)
  )
}

function reconciliationRoster(characterEntities, observations, evidenceLimit) {
  const observationsById = new Map(observations.map((item) => [item.id, item]))
  const rosterNames = new Set(characterEntities.flatMap((entity) =>
    [entity.canonicalName, ...entity.aliases].map(normalizedName).filter(Boolean)
  ))
  return characterEntities.map((entity) => ({
    entityKey: entity.entityKey,
    names: [entity.canonicalName, ...entity.aliases].sort(compareText),
    resolutionStatus: entity.resolutionStatus,
    observationCount: entity.data.observationCount,
    evidence: representativeEvidence(
      entity,
      observationsById,
      evidenceLimit,
      rosterNames
    ).map((item) => ({
      id: item.id,
      type: item.type,
      fact: boundedText(item.fact, 160),
      quote: boundedText(item.evidence.quote, 240),
      startOffset: item.evidence.startOffset
    }))
  }))
}

function entityGenderSignals(entity, observationsById) {
  const values = new Set()
  for (const name of [entity.canonicalName, ...entity.aliases]) {
    const [prefix] = normalizedName(name).split(' ')
    const gender = HONORIFIC_GENDERS.get(prefix)
    if (gender) values.add(gender)
  }
  for (const evidenceId of entity.evidenceIds) {
    const fact = String(observationsById.get(evidenceId)?.fact || '').trim().toLocaleLowerCase('en-US')
    if (fact === 'male' || fact === 'female') values.add(fact)
  }
  return values
}

function forbiddenPairs(entities, observations) {
  const characterKeys = new Set(
    entities.filter(({ entityKind }) => entityKind === 'character').map(({ entityKey }) => entityKey)
  )
  const values = new Map()
  for (const entity of entities) {
    if (entity.entityKind !== 'relationship') continue
    const participants = (entity.data.relatedCharacterEntityKeys ?? [])
      .filter((key) => characterKeys.has(key))
      .sort(compareText)
    for (const [index, leftEntityKey] of participants.entries()) {
      for (const rightEntityKey of participants.slice(index + 1)) {
        const key = pairKey(leftEntityKey, rightEntityKey)
        values.set(key, { leftEntityKey, rightEntityKey, reason: 'relationship_participants' })
      }
    }
  }
  const observationsById = new Map(observations.map((item) => [item.id, item]))
  const characters = entities.filter(({ entityKind }) => entityKind === 'character')
  const aliasPairs = directAliasPairs(characters, observations)
  const genders = new Map(characters.map((entity) => [
    entity.entityKey,
    entityGenderSignals(entity, observationsById)
  ]))
  for (const [index, left] of characters.entries()) {
    const leftGender = genders.get(left.entityKey)
    if (leftGender.size !== 1) continue
    for (const right of characters.slice(index + 1)) {
      const key = pairKey(left.entityKey, right.entityKey)
      if (!namePairSignal(left, right) && !aliasPairs.has(key)) continue
      const rightGender = genders.get(right.entityKey)
      if (rightGender.size !== 1 || [...leftGender].some((value) => rightGender.has(value))) continue
      const [leftEntityKey, rightEntityKey] = [left.entityKey, right.entityKey].sort(compareText)
      values.set(key, { leftEntityKey, rightEntityKey, reason: 'gender_conflict' })
    }
  }
  return [...values.values()].sort((left, right) =>
    compareText(left.leftEntityKey, right.leftEntityKey) ||
    compareText(left.rightEntityKey, right.rightEntityKey)
  )
}

function namePairSignal(left, right) {
  for (const leftName of [left.canonicalName, ...left.aliases]) {
    const leftTokens = identityTokens(leftName)
    for (const rightName of [right.canonicalName, ...right.aliases]) {
      const rightTokens = identityTokens(rightName)
      if (!leftTokens.length || !rightTokens.length) continue
      if (leftTokens.join(' ') === rightTokens.join(' ')) return 'same_core_name'
      if (orderedSubset(leftTokens, rightTokens) || orderedSubset(rightTokens, leftTokens)) {
        return 'name_extension'
      }
      if (leftTokens[0] === rightTokens[0]) return 'shared_given_name'
      if (leftTokens.at(-1) === rightTokens.at(-1)) return 'shared_family_name'
      if (nearSpellingToken(leftTokens[0], rightTokens[0])) return 'near_spelling_given_name'
    }
  }
  return null
}

function directAliasPairs(characterEntities, observations) {
  const ownersByName = new Map()
  for (const entity of characterEntities) {
    const names = [entity.canonicalName, ...entity.aliases, ...(entity.data.candidateKeys ?? [])]
    for (const name of names) {
      const normalized = normalizedName(name)
      if (!normalized) continue
      const owners = ownersByName.get(normalized) ?? new Set()
      owners.add(entity.entityKey)
      ownersByName.set(normalized, owners)
    }
  }
  const pairs = new Set()
  for (const observation of observations) {
    if (observation.type !== 'character_alias') continue
    const primary = ownersByName.get(normalizedName(observation.entityCandidate)) ?? new Set()
    for (const alias of observation.relatedEntityCandidates) {
      const related = ownersByName.get(normalizedName(alias)) ?? new Set()
      for (const left of primary) {
        for (const right of related) {
          if (left !== right) pairs.add(pairKey(left, right))
        }
      }
    }
  }
  return pairs
}

function reconciliationCandidatePairs(characterEntities, observations, blockedPairs) {
  const aliasPairs = directAliasPairs(characterEntities, observations)
  const candidates = []
  for (const [index, left] of characterEntities.entries()) {
    for (const right of characterEntities.slice(index + 1)) {
      const key = pairKey(left.entityKey, right.entityKey)
      if (blockedPairs.has(key)) continue
      const nameSignal = namePairSignal(left, right)
      const aliasSignal = aliasPairs.has(key)
      if (!nameSignal && !aliasSignal) continue
      candidates.push({
        leftEntityKey: left.entityKey,
        rightEntityKey: right.entityKey,
        signals: [...new Set([
          ...(aliasSignal ? ['scan_alias_claim'] : []),
          ...(nameSignal ? [nameSignal] : [])
        ])]
      })
    }
  }
  return candidates.sort((left, right) =>
    Number(!left.signals.includes('scan_alias_claim')) -
      Number(!right.signals.includes('scan_alias_claim')) ||
    compareText(left.leftEntityKey, right.leftEntityKey) ||
    compareText(left.rightEntityKey, right.rightEntityKey)
  ).slice(0, MAX_CANDIDATE_PAIRS)
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value))
}

export function buildBookIdentityReconciliationRequest({
  runId,
  bookEditionId,
  pipelineVersion,
  reconciliationVersion,
  observationSetHash,
  title,
  author,
  entities,
  observations
}) {
  const characters = entities
    .filter(({ entityKind }) => entityKind === 'character')
    .sort((left, right) => compareText(left.entityKey, right.entityKey))
  if (characters.length < 2) return null
  const common = {
    runId,
    bookEditionId,
    pipelineVersion,
    reconciliationVersion,
    observationSetHash,
    bookTitle: title,
    bookAuthor: author || ''
  }
  const allForbidden = forbiddenPairs(entities, observations)
  const blockedPairs = new Set(allForbidden.map(({ leftEntityKey, rightEntityKey }) =>
    pairKey(leftEntityKey, rightEntityKey)
  ))
  let candidatePairs = reconciliationCandidatePairs(characters, observations, blockedPairs)
  if (!candidatePairs.length) return null
  let requestCharacters = characters
  if (characters.length > MAX_CHARACTER_ENTITIES) {
    const includedKeys = new Set()
    candidatePairs = candidatePairs.filter(({ leftEntityKey, rightEntityKey }) => {
      const additional = Number(!includedKeys.has(leftEntityKey)) +
        Number(!includedKeys.has(rightEntityKey))
      if (includedKeys.size + additional > MAX_CHARACTER_ENTITIES) return false
      includedKeys.add(leftEntityKey)
      includedKeys.add(rightEntityKey)
      return true
    })
    requestCharacters = characters.filter(({ entityKey }) => includedKeys.has(entityKey))
  }
  if (!candidatePairs.length) return null
  const requestKeys = new Set(requestCharacters.map(({ entityKey }) => entityKey))
  common.forbiddenPairs = allForbidden.filter(({ leftEntityKey, rightEntityKey }) =>
    requestKeys.has(leftEntityKey) && requestKeys.has(rightEntityKey)
  )
  common.candidatePairs = candidatePairs
  let request = {
    ...common,
    roster: reconciliationRoster(requestCharacters, observations, MAX_EVIDENCE_PER_ENTITY)
  }
  if (serializedBytes(request) > MAX_REQUEST_BYTES) {
    request = { ...common, roster: reconciliationRoster(requestCharacters, observations, 1) }
  }
  return serializedBytes(request) <= MAX_REQUEST_BYTES ? request : null
}

function crossesForbiddenComponents(sets, left, right, forbidden) {
  const leftMembers = sets.members(left)
  const rightMembers = sets.members(right)
  return leftMembers.some((one) => rightMembers.some((other) =>
    forbidden.has(pairKey(one, other))
  ))
}

export function validateBookIdentityMerges({ request, proposedMerges }) {
  if (!request || !Array.isArray(proposedMerges)) return []
  const roster = new Map(request.roster.map((item) => [item.entityKey, item]))
  const evidenceOwners = new Map()
  for (const entity of request.roster) {
    for (const evidence of entity.evidence) {
      const owners = evidenceOwners.get(evidence.id) ?? new Set()
      owners.add(entity.entityKey)
      evidenceOwners.set(evidence.id, owners)
    }
  }
  const forbidden = new Set(request.forbiddenPairs.map(({ leftEntityKey, rightEntityKey }) =>
    pairKey(leftEntityKey, rightEntityKey)
  ))
  const allowedPairs = new Set(request.candidatePairs.map(({ leftEntityKey, rightEntityKey }) =>
    pairKey(leftEntityKey, rightEntityKey)
  ))
  const sets = new DisjointSet([...roster.keys()])
  const accepted = []
  const seenEdges = new Set()
  for (const raw of proposedMerges.slice(0, 128)) {
    const leftEntityKey = typeof raw?.leftEntityKey === 'string' ? raw.leftEntityKey : ''
    const rightEntityKey = typeof raw?.rightEntityKey === 'string' ? raw.rightEntityKey : ''
    const basis = typeof raw?.basis === 'string' ? raw.basis : ''
    if (
      leftEntityKey === rightEntityKey || !roster.has(leftEntityKey) ||
      !roster.has(rightEntityKey) || !MERGE_BASES.has(basis)
    ) {
      continue
    }
    const edge = pairKey(leftEntityKey, rightEntityKey)
    if (seenEdges.has(edge) || forbidden.has(edge) || !allowedPairs.has(edge)) continue
    const evidenceIds = [...new Set(
      Array.isArray(raw.evidenceIds) ? raw.evidenceIds.filter((id) => evidenceOwners.has(id)) : []
    )].sort(compareText)
    const covers = (entityKey) => evidenceIds.some((id) => evidenceOwners.get(id).has(entityKey))
    if (!covers(leftEntityKey) || !covers(rightEntityKey)) continue
    if (crossesForbiddenComponents(sets, leftEntityKey, rightEntityKey, forbidden)) continue
    if (!sets.union(leftEntityKey, rightEntityKey)) continue
    seenEdges.add(edge)
    accepted.push({ leftEntityKey, rightEntityKey, basis, evidenceIds })
  }
  return accepted
}

export const BOOK_IDENTITY_RECONCILIATION_LIMITS = Object.freeze({
  maxCharacterEntities: MAX_CHARACTER_ENTITIES,
  maxEvidencePerEntity: MAX_EVIDENCE_PER_ENTITY,
  maxCandidatePairs: MAX_CANDIDATE_PAIRS,
  maxRequestBytes: MAX_REQUEST_BYTES
})
