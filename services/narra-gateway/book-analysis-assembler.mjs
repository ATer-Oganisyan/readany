import {
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION,
  normalizeBookMarkupV3
} from './book-analysis-contracts.mjs'
import { auditCharacterAppearanceDistribution } from './book-analysis-appearance-audit.mjs'
import { selectedBookCharacterEntities } from './book-character-selection.mjs'

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function description(observations, maxLength = 4_000) {
  const facts = [...new Set(observations.map(({ fact }) => fact.trim()).filter(Boolean))]
  let result = ''
  for (const fact of facts) {
    const candidate = result ? `${result} ${fact}` : fact
    if (candidate.length > maxLength) break
    result = candidate
  }
  return result || 'Подтверждённая сущность книги.'
}

function evidenceFor(entity, observationsById) {
  return entity.evidenceIds.map((id) => observationsById.get(id)).filter(Boolean)
}

function entityIndex(entities, kind) {
  const result = new Map()
  for (const entity of entities.filter((candidate) => candidate.entityKind === kind)) {
    for (const name of [entity.canonicalName, ...entity.aliases]) {
      const key = normalizedName(name)
      if (!key || result.has(key)) continue
      result.set(key, entity.entityKey)
    }
  }
  return result
}

function relatedKeys(observations, index) {
  const keys = []
  for (const observation of observations) {
    for (const candidate of observation.relatedEntityCandidates) {
      const key = index.get(normalizedName(candidate))
      if (key && !keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

function recoverClusteredCharacterAppearances({
  characters,
  characterEntities,
  observationsById,
  textLength
}) {
  const audit = auditCharacterAppearanceDistribution({ textLength, characters })
  if (audit.status !== 'suspicious') return characters
  const entitiesByKey = new Map(characterEntities.map((entity) => [entity.entityKey, entity]))
  const warmupDistance = Math.max(2_000, Math.round(textLength * 0.02))
  return characters.map((character) => {
    if (character.firstAppearanceTextOffset > audit.earlyBoundaryTextOffset) return character
    const entity = entitiesByKey.get(character.characterKey)
    const firstNarrativeEvidence = entity?.evidenceIds
      .map((id) => observationsById.get(id))
      .filter((observation) =>
        Number.isSafeInteger(observation?.evidence?.startOffset) &&
        observation.evidence.startOffset > audit.earlyBoundaryTextOffset
      )
      .sort((left, right) =>
        left.evidence.startOffset - right.evidence.startOffset || left.id.localeCompare(right.id)
      )[0]
    if (!firstNarrativeEvidence) return character
    const firstAppearanceTextOffset = firstNarrativeEvidence.evidence.startOffset
    return {
      ...character,
      firstAppearanceTextOffset,
      warmupTextOffset: Math.max(0, firstAppearanceTextOffset - warmupDistance)
    }
  })
}

export function assembleBookMarkupV3({
  snapshotId,
  textLength,
  entities,
  observations,
  characterProfiles,
  characterSelection = null
}) {
  const observationsById = new Map(observations.map((observation) => [observation.id, observation]))
  const profilesByKey = new Map(characterProfiles.map((profile) => [profile.characterKey, profile]))
  if (profilesByKey.size !== characterProfiles.length) {
    throw Object.assign(new Error('duplicate character profile'), { code: 'SYNTHESIS_INPUT_INVALID' })
  }
  const characterEntities = selectedBookCharacterEntities(entities, characterSelection)
  const missingProfile = characterEntities.find(({ entityKey }) => !profilesByKey.has(entityKey))
  if (missingProfile) {
    throw Object.assign(new Error(`missing character profile: ${missingProfile.entityKey}`), {
      code: 'SYNTHESIS_BARRIER_INCOMPLETE'
    })
  }
  const generatedCharacters = characterEntities
    .map(({ entityKey }) => profilesByKey.get(entityKey))
    .filter(Boolean)
  const characters = recoverClusteredCharacterAppearances({
    characters: generatedCharacters,
    characterEntities,
    observationsById,
    textLength
  })
  const includedCharacterKeys = new Set(characters.map(({ characterKey }) => characterKey))
  const characterIndex = entityIndex(
    characterEntities.filter(({ entityKey }) => includedCharacterKeys.has(entityKey)),
    'character'
  )
  const locationEntities = entities.filter((entity) =>
    entity.entityKind === 'location' && entity.resolutionStatus !== 'rejected'
  ).slice(0, 2_048)
  const locationIndex = entityIndex(locationEntities, 'location')
  const locations = locationEntities.map((entity) => {
    const evidence = evidenceFor(entity, observationsById)
    return {
      locationKey: entity.entityKey,
      name: entity.canonicalName,
      description: description(evidence),
      evidenceIds: evidence.slice(0, 128).map(({ id }) => id)
    }
  })
  const events = entities
    .filter((entity) => entity.entityKind === 'event' && entity.resolutionStatus !== 'rejected')
    .slice(0, 2_048)
    .map((entity) => {
      const evidence = evidenceFor(entity, observationsById)
      return {
        eventKey: entity.entityKey,
        title: entity.canonicalName,
        description: description(evidence),
        participantCharacterKeys: relatedKeys(evidence, characterIndex),
        locationKeys: relatedKeys(evidence, locationIndex),
        evidenceIds: evidence.slice(0, 128).map(({ id }) => id)
      }
    })
  const relationships = []
  for (const entity of entities.filter((candidate) =>
    candidate.entityKind === 'relationship' && candidate.resolutionStatus !== 'rejected'
  ).slice(0, 2_048)) {
    const evidence = evidenceFor(entity, observationsById)
    const characterKeys = relatedKeys(evidence, characterIndex)
    if (characterKeys.length < 2) continue
    relationships.push({
      relationshipKey: entity.entityKey,
      sourceCharacterKey: characterKeys[0],
      targetCharacterKey: characterKeys[1],
      description: description(evidence),
      evidenceIds: evidence.slice(0, 128).map(({ id }) => id)
    })
  }
  return normalizeBookMarkupV3({
    schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    snapshotId,
    textLength,
    characters,
    locations,
    events,
    relationships,
    storyArcs: []
  })
}
