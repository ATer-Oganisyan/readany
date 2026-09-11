export const MAX_PUBLISHED_BOOK_CHARACTERS = 20
export const BOOK_CHARACTER_SELECTION_VERSION = 'character-frequency-v1'

function nonNegativeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function firstEvidenceOffset(entity) {
  return nonNegativeInteger(entity?.data?.firstEvidenceStartOffset, Number.MAX_SAFE_INTEGER)
}

function compareRank(left, right) {
  return right.mentionCount - left.mentionCount ||
    right.evidenceCount - left.evidenceCount ||
    left.firstEvidenceStartOffset - right.firstEvidenceStartOffset ||
    left.entityKey.localeCompare(right.entityKey)
}

function occurrenceKey(observation) {
  const startOffset = observation?.evidence?.startOffset
  const endOffset = observation?.evidence?.endOffset
  if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)) return null
  return `${startOffset}:${endOffset}`
}

function characterScore(entity, observationById) {
  const evidenceOccurrences = new Set()
  const mentionOccurrences = new Set()
  for (const evidenceId of entity.evidenceIds ?? []) {
    const observation = observationById.get(evidenceId)
    const key = occurrenceKey(observation)
    if (!key) continue
    evidenceOccurrences.add(key)
    if (observation.type === 'character_mention') mentionOccurrences.add(key)
  }
  return {
    entityKey: entity.entityKey,
    mentionCount: mentionOccurrences.size,
    evidenceCount: evidenceOccurrences.size,
    firstEvidenceStartOffset: firstEvidenceOffset(entity)
  }
}

function confirmedCharacters(entities) {
  return entities.filter((entity) =>
    entity?.entityKind === 'character' && entity.resolutionStatus === 'confirmed'
  )
}

export function rankBookCharacterEntities({
  entities,
  observations,
  limit = MAX_PUBLISHED_BOOK_CHARACTERS
}) {
  if (!Array.isArray(entities)) throw new TypeError('entities must be an array')
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PUBLISHED_BOOK_CHARACTERS) {
    throw new RangeError(`limit must be between 1 and ${MAX_PUBLISHED_BOOK_CHARACTERS}`)
  }
  const observationById = new Map(observations.map((observation) => [observation.id, observation]))
  const scores = confirmedCharacters(entities)
    .map((entity) => characterScore(entity, observationById))
    .sort(compareRank)
  const scoreByKey = new Map(scores.map((score, index) => [score.entityKey, {
    ...score,
    prominenceRank: index + 1,
    selectedForPublication: index < limit
  }]))
  const rankedEntities = entities.map((entity) => {
    const score = scoreByKey.get(entity.entityKey)
    if (!score) return entity
    return {
      ...entity,
      data: {
        ...entity.data,
        mentionCount: score.mentionCount,
        evidenceCount: score.evidenceCount,
        prominenceRank: score.prominenceRank,
        selectedForPublication: score.selectedForPublication
      }
    }
  })
  const entityByKey = new Map(rankedEntities.map((entity) => [entity.entityKey, entity]))
  const rankedCharacters = scores.map(({ entityKey }) => entityByKey.get(entityKey))
  const selectedCharacters = rankedCharacters.slice(0, limit)
  const selection = {
    version: BOOK_CHARACTER_SELECTION_VERSION,
    limit,
    characterKeys: selectedCharacters.map(({ entityKey }) => entityKey)
  }
  return { entities: rankedEntities, rankedCharacters, selectedCharacters, selection }
}

function legacyCharacterScore(entity) {
  return {
    entityKey: entity.entityKey,
    mentionCount: nonNegativeInteger(entity?.data?.mentionCount),
    evidenceCount: nonNegativeInteger(
      entity?.data?.evidenceCount,
      nonNegativeInteger(entity?.data?.observationCount, entity?.evidenceIds?.length ?? 0)
    ),
    firstEvidenceStartOffset: firstEvidenceOffset(entity)
  }
}

export function selectedBookCharacterEntities(
  entities,
  selection,
  { limit = MAX_PUBLISHED_BOOK_CHARACTERS } = {}
) {
  if (!Array.isArray(entities)) throw new TypeError('entities must be an array')
  const candidates = confirmedCharacters(entities)
  const byKey = new Map(candidates.map((entity) => [entity.entityKey, entity]))
  if (Array.isArray(selection?.characterKeys)) {
    return selection.characterKeys
      .slice(0, Math.min(limit, MAX_PUBLISHED_BOOK_CHARACTERS))
      .map((key) => byKey.get(key))
      .filter(Boolean)
  }
  return candidates
    .map((entity) => ({ entity, ...legacyCharacterScore(entity) }))
    .sort(compareRank)
    .slice(0, Math.min(limit, MAX_PUBLISHED_BOOK_CHARACTERS))
    .map(({ entity }) => entity)
}
