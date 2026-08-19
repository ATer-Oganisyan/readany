import { createHash } from 'node:crypto'
import {
  auditCharacterAppearanceDistribution,
  CHARACTER_APPEARANCE_CLUSTER_CODE
} from './book-analysis-appearance-audit.mjs'
import {
  BOOK_ANALYSIS_GENDER_EVIDENCE_TYPES,
  BOOK_ANALYSIS_TRAIT_EVIDENCE_TYPES,
  normalizeBookMarkupV3
} from './book-analysis-contracts.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function contentHash(value) {
  return sha256(JSON.stringify(canonical(value)))
}

function addClaims(target, values, expectedTypes, ownerEvidenceIds, maxEndOffset = null) {
  for (const claim of values.filter(Boolean)) {
    for (const evidenceId of claim.evidenceIds) {
      target.push({ evidenceId, expectedTypes, ownerEvidenceIds, maxEndOffset })
    }
  }
}

function addEntityEvidence(target, evidenceIds, expectedTypes, entity) {
  const ownerEvidenceIds = new Set(entity?.evidenceIds ?? [])
  for (const evidenceId of evidenceIds) {
    target.push({ evidenceId, expectedTypes, ownerEvidenceIds })
  }
}

export function validateBookMarkupV3({
  markup: rawMarkup,
  snapshot,
  observations,
  normalizedText,
  normalizedTextHash
}) {
  const errors = []
  let markup
  try {
    markup = normalizeBookMarkupV3(rawMarkup)
  } catch (error) {
    return {
      valid: false,
      errors: [{ code: 'SCHEMA_INVALID', message: error.message }],
      checks: {
        schema: false,
        sourceHash: false,
        evidence: false,
        references: false,
        characterAppearanceDistribution: false
      },
      quality: { characterAppearance: null }
    }
  }
  const characterAppearance = auditCharacterAppearanceDistribution(markup)
  if (characterAppearance.status === 'suspicious') {
    errors.push({
      code: CHARACTER_APPEARANCE_CLUSTER_CODE,
      message: 'too many characters first appear inside the initial cast-list-sized text range',
      details: characterAppearance
    })
  }
  if (markup.snapshotId !== snapshot.id) {
    errors.push({ code: 'SNAPSHOT_MISMATCH', message: 'markup references another snapshot' })
  }
  if (contentHash(snapshot.data) !== snapshot.contentHash) {
    errors.push({ code: 'SNAPSHOT_HASH_MISMATCH', message: 'frozen snapshot content hash is invalid' })
  }
  if (markup.textLength !== normalizedText.length || sha256(normalizedText) !== normalizedTextHash) {
    errors.push({ code: 'SOURCE_HASH_MISMATCH', message: 'normalized source does not match the run' })
  }
  const observationById = new Map(observations.map((observation) => [observation.id, observation]))
  const observationIds = new Set(observationById.keys())
  const snapshotObservationIds = new Set(snapshot.data.observationIds ?? [])
  if (
    observations.length !== snapshot.evidenceCount ||
    observationIds.size !== snapshotObservationIds.size ||
    [...observationIds].some((id) => !snapshotObservationIds.has(id))
  ) {
    errors.push({
      code: 'SNAPSHOT_EVIDENCE_MISMATCH',
      message: 'validation evidence does not match the frozen snapshot'
    })
  }
  if (contentHash(observations) !== snapshot.data.observationSetHash) {
    errors.push({
      code: 'SNAPSHOT_EVIDENCE_HASH_MISMATCH',
      message: 'frozen observation set hash is invalid'
    })
  }
  const snapshotEntities = snapshot.data.entities.map(({ id: _id, ...entity }) => entity)
  if (contentHash(snapshotEntities) !== snapshot.data.entitySetHash) {
    errors.push({
      code: 'SNAPSHOT_ENTITY_HASH_MISMATCH',
      message: 'frozen entity set hash is invalid'
    })
  }
  for (const observation of observations) {
    if (
      normalizedText.slice(
        observation.evidence.startOffset,
        observation.evidence.endOffset
      ) !== observation.evidence.quote
    ) {
      errors.push({
        code: 'EVIDENCE_TEXT_MISMATCH',
        message: `observation ${observation.id} does not match normalized text`
      })
    }
  }
  const snapshotEntityByKey = new Map(snapshot.data.entities.map((entity) => [entity.entityKey, entity]))
  const expectedCharacterKeys = snapshot.data.entities
    .filter((entity) => entity.entityKind === 'character' && entity.resolutionStatus === 'confirmed')
    .slice(0, 128)
    .map(({ entityKey }) => entityKey)
  if (
    markup.characters.length !== expectedCharacterKeys.length ||
    expectedCharacterKeys.some((key) => !markup.characters.some(({ characterKey }) => characterKey === key))
  ) {
    errors.push({
      code: 'ENTITY_COVERAGE_MISMATCH',
      message: 'markup does not contain every selected confirmed character'
    })
  }
  const usages = []
  for (const character of markup.characters) {
    const owner = snapshotEntityByKey.get(character.characterKey)
    if (!owner || owner.entityKind !== 'character' || owner.resolutionStatus !== 'confirmed') {
      errors.push({
        code: 'ENTITY_MISMATCH',
        message: `character ${character.characterKey} is not a confirmed snapshot entity`
      })
    } else if (
      character.name !== owner.canonicalName || character.fullName !== owner.canonicalName ||
      character.aliases.some((alias) => !owner.aliases.includes(alias))
    ) {
      errors.push({
        code: 'ENTITY_IDENTITY_MISMATCH',
        message: `character ${character.characterKey} identity differs from the snapshot`
      })
    }
    const ownerEvidenceIds = new Set(owner?.evidenceIds ?? [])
    for (const evidenceId of character.identityEvidenceIds) {
      usages.push({ evidenceId, expectedTypes: null, ownerEvidenceIds })
    }
    addClaims(usages, [character.role], new Set(['character_role']), ownerEvidenceIds)
    addClaims(usages, [character.age], new Set(['character_age']), ownerEvidenceIds)
    addClaims(
      usages,
      [character.gender],
      new Set(BOOK_ANALYSIS_GENDER_EVIDENCE_TYPES),
      ownerEvidenceIds
    )
    addClaims(usages, [character.description], null, ownerEvidenceIds)
    addClaims(
      usages,
      character.traits,
      new Set(BOOK_ANALYSIS_TRAIT_EVIDENCE_TYPES),
      ownerEvidenceIds
    )
    for (const personalitySnapshot of character.personalitySnapshots) {
      addClaims(
        usages,
        personalitySnapshot.traits,
        new Set(BOOK_ANALYSIS_TRAIT_EVIDENCE_TYPES),
        ownerEvidenceIds,
        personalitySnapshot.cutoffTextOffset
      )
    }
    addClaims(usages, character.appearance, new Set(['character_appearance']), ownerEvidenceIds)
    addClaims(
      usages,
      [character.speechStyle, ...character.speechExamples],
      new Set(['character_dialogue']),
      ownerEvidenceIds
    )
  }
  for (const location of markup.locations) {
    const owner = snapshotEntityByKey.get(location.locationKey)
    if (!owner || owner.entityKind !== 'location' || owner.resolutionStatus === 'rejected') {
      errors.push({ code: 'ENTITY_MISMATCH', message: `unknown location ${location.locationKey}` })
    } else if (location.name !== owner.canonicalName) {
      errors.push({ code: 'ENTITY_IDENTITY_MISMATCH', message: `location ${location.locationKey} identity differs from the snapshot` })
    }
    addEntityEvidence(usages, location.evidenceIds, new Set(['location']), owner)
  }
  for (const event of markup.events) {
    const owner = snapshotEntityByKey.get(event.eventKey)
    if (!owner || owner.entityKind !== 'event' || owner.resolutionStatus === 'rejected') {
      errors.push({ code: 'ENTITY_MISMATCH', message: `unknown event ${event.eventKey}` })
    } else if (event.title !== owner.canonicalName) {
      errors.push({ code: 'ENTITY_IDENTITY_MISMATCH', message: `event ${event.eventKey} identity differs from the snapshot` })
    }
    addEntityEvidence(usages, event.evidenceIds, new Set(['event']), owner)
  }
  for (const relationship of markup.relationships) {
    const owner = snapshotEntityByKey.get(relationship.relationshipKey)
    if (!owner || owner.entityKind !== 'relationship' || owner.resolutionStatus === 'rejected') {
      errors.push({ code: 'ENTITY_MISMATCH', message: `unknown relationship ${relationship.relationshipKey}` })
    }
    addEntityEvidence(usages, relationship.evidenceIds, new Set(['relationship']), owner)
  }
  for (const usage of usages) {
    const observation = observationById.get(usage.evidenceId)
    if (!observation) {
      errors.push({ code: 'EVIDENCE_UNKNOWN', message: `unknown evidence ${usage.evidenceId}` })
      continue
    }
    if (usage.ownerEvidenceIds && !usage.ownerEvidenceIds.has(usage.evidenceId)) {
      errors.push({ code: 'EVIDENCE_WRONG_ENTITY', message: `evidence ${usage.evidenceId} belongs to another entity` })
    }
    if (usage.expectedTypes && !usage.expectedTypes.has(observation.type)) {
      errors.push({ code: 'EVIDENCE_TYPE_MISMATCH', message: `evidence ${usage.evidenceId} has incompatible type` })
    }
    if (
      Number.isSafeInteger(usage.maxEndOffset) &&
      observation.evidence.endOffset > usage.maxEndOffset
    ) {
      errors.push({
        code: 'EVIDENCE_AFTER_CUTOFF',
        message: `evidence ${usage.evidenceId} is after personality cutoff`
      })
    }
  }
  return {
    valid: errors.length === 0,
    errors: errors.slice(0, 1_000),
    checks: {
      schema: true,
      sourceHash: !errors.some(({ code }) => code === 'SOURCE_HASH_MISMATCH'),
      evidence: !errors.some(({ code }) => code.startsWith('EVIDENCE_')),
      references: !errors.some(({ code }) =>
        [
          'SNAPSHOT_MISMATCH', 'SNAPSHOT_HASH_MISMATCH', 'SNAPSHOT_EVIDENCE_MISMATCH',
          'SNAPSHOT_EVIDENCE_HASH_MISMATCH', 'SNAPSHOT_ENTITY_HASH_MISMATCH',
          'ENTITY_COVERAGE_MISMATCH', 'ENTITY_MISMATCH', 'ENTITY_IDENTITY_MISMATCH'
        ].includes(code)
      ),
      characterAppearanceDistribution: characterAppearance.status !== 'suspicious'
    },
    quality: { characterAppearance },
    counts: {
      characters: markup.characters.length,
      locations: markup.locations.length,
      events: markup.events.length,
      relationships: markup.relationships.length,
      evidenceUsages: usages.length
    }
  }
}
