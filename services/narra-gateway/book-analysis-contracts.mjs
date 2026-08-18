export const BOOK_ANALYSIS_PIPELINE_VERSION = 'book-analysis-v44'
export const BOOK_ANALYSIS_MARKUP_VERSION = 'book-markup-v3'
export const BOOK_ANALYSIS_CHARACTER_BUNDLE_VERSION = 'character-bundle-v3'
export const BOOK_ANALYSIS_SCHEMA_VERSION = 3
export const BOOK_ANALYSIS_PROMPT_VERSION = 'book-scan-v15'
export const BOOK_ANALYSIS_EXTRACTOR_VERSION = 'book-scan-v15'
export const BOOK_ANALYSIS_SYNTHESIS_VERSION = 'character-profile-v10'
export const BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION = 'character-identity-v20'

export const BOOK_ANALYSIS_STAGES = Object.freeze([
  'prepare',
  'scan',
  'resolve',
  'synthesize',
  'validate',
  'publish'
])

export const BOOK_ANALYSIS_RUN_STATUSES = Object.freeze([
  'queued',
  'running',
  'ready',
  'failed',
  'cancelled'
])

export const BOOK_ANALYSIS_JOB_STATUSES = Object.freeze([
  'queued',
  'running',
  'ready',
  'failed',
  'cancelled'
])

export const BOOK_ANALYSIS_ENTITY_KINDS = Object.freeze([
  'character',
  'event',
  'location',
  'relationship'
])

export const BOOK_ANALYSIS_RESOLUTION_STATUSES = Object.freeze([
  'candidate',
  'confirmed',
  'rejected'
])

export const BOOK_ANALYSIS_OBSERVATION_TYPES = Object.freeze([
  'character_mention',
  'character_alias',
  'character_action',
  'character_dialogue',
  'character_trait',
  'character_appearance',
  'character_role',
  'character_age',
  'character_gender',
  'event',
  'location',
  'relationship'
])

export const BOOK_ANALYSIS_GENDER_EVIDENCE_TYPES = Object.freeze([
  'character_gender',
  'character_mention',
  'character_action',
  'character_dialogue',
  'character_trait',
  'character_appearance',
  'character_role',
  'character_age'
])

export const BOOK_ANALYSIS_TRAIT_EVIDENCE_TYPES = Object.freeze([
  'character_trait',
  'character_action',
  'character_dialogue'
])

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const STAGE_INDEX = new Map(BOOK_ANALYSIS_STAGES.map((stage, index) => [stage, index]))
const RUN_STATUSES = new Set(BOOK_ANALYSIS_RUN_STATUSES)
const ENTITY_KINDS = new Set(BOOK_ANALYSIS_ENTITY_KINDS)
const RESOLUTION_STATUSES = new Set(BOOK_ANALYSIS_RESOLUTION_STATUSES)
const OBSERVATION_TYPES = new Set(BOOK_ANALYSIS_OBSERVATION_TYPES)
const CHARACTER_GENDERS = new Set(['male', 'female'])
const OBSERVATION_ENTITY_KIND = new Map([
  ['character_mention', 'character'],
  ['character_alias', 'character'],
  ['character_action', 'character'],
  ['character_dialogue', 'character'],
  ['character_trait', 'character'],
  ['character_appearance', 'character'],
  ['character_role', 'character'],
  ['character_age', 'character'],
  ['character_gender', 'character'],
  ['event', 'event'],
  ['location', 'location'],
  ['relationship', 'relationship']
])

function invalid(message) {
  const error = new Error(message)
  error.code = 'VALIDATION'
  error.status = 400
  throw error
}

function objectValue(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${name}: expected an object`)
  }
  return value
}

function stringValue(value, name, maxLength, { optional = false } = {}) {
  if (optional && (value == null || value === '')) return ''
  if (typeof value !== 'string' || !value.trim()) invalid(`${name}: expected text`)
  const normalized = value.trim()
  if (normalized.length > maxLength) invalid(`${name}: exceeds ${maxLength} characters`)
  return normalized
}

function verbatimStringValue(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim()) invalid(`${name}: expected text`)
  if (value.length > maxLength) invalid(`${name}: exceeds ${maxLength} characters`)
  return value
}

function identifier(value, name) {
  const normalized = stringValue(value, name, 256)
  if (!IDENTIFIER.test(normalized)) invalid(`${name}: invalid identifier`)
  return normalized
}

function enumValue(value, allowed, name) {
  if (!allowed.has(value)) invalid(`${name}: unsupported value`)
  return value
}

function textOffset(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalid(`${name}: expected a non-negative safe integer`)
  }
  return value
}

function confidenceValue(value, name = 'confidence') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid(`${name}: expected a number between 0 and 1`)
  }
  return value
}

function stringValues(value, name, { maxItems = 128, maxLength = 256 } = {}) {
  if (!Array.isArray(value)) invalid(`${name}: expected an array`)
  if (value.length > maxItems) invalid(`${name}: exceeds ${maxItems} items`)
  const normalized = value.map((item, index) =>
    stringValue(item, `${name}[${index}]`, maxLength)
  )
  return [...new Set(normalized)]
}

function identifierValues(value, name, options = {}) {
  return stringValues(value, name, options).map((item, index) =>
    identifier(item, `${name}[${index}]`)
  )
}

function boundedObjects(value, name, maxItems) {
  if (!Array.isArray(value)) invalid(`${name}: expected an array`)
  if (value.length > maxItems) invalid(`${name}: exceeds ${maxItems} items`)
  return value
}

function optionalClaim(value, name) {
  return value == null ? null : normalizeEvidenceClaim(value, name)
}

export function normalizeCharacterGenderCode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  const male = (
    /^(male|man|masculine)\b/.test(normalized) ||
    /(?:^|[\s,;:—-])(?:мужчин|мужск|мальчик|юнош|молодой человек)/u.test(normalized)
  )
  const female = (
    /^(female|woman|feminine)\b/.test(normalized) ||
    /(?:^|[\s,;:—-])(?:женщин|женск|девоч|девуш|девиц|мать|жена|старуха|шведка)/u.test(normalized)
  )
  if (male === female) return null
  return male ? 'male' : 'female'
}

function optionalGenderClaim(value, name) {
  const claim = optionalClaim(value, name)
  if (!claim) return null
  const gender = normalizeCharacterGenderCode(claim.value)
  if (!gender) return null
  return {
    ...claim,
    value: enumValue(gender, CHARACTER_GENDERS, `${name}.value`)
  }
}

function claimValues(value, name, maxItems = 32) {
  if (!Array.isArray(value)) invalid(`${name}: expected an array`)
  if (value.length > maxItems) invalid(`${name}: exceeds ${maxItems} items`)
  return value.map((claim, index) => normalizeEvidenceClaim(claim, `${name}[${index}]`))
}

function uniqueKeys(items, key, name) {
  const seen = new Set()
  for (const [index, item] of items.entries()) {
    if (seen.has(item[key])) invalid(`${name}[${index}]: duplicate ${key}`)
    seen.add(item[key])
  }
  return items
}

function assertKnownKeys(values, known, name) {
  for (const [index, value] of values.entries()) {
    if (!known.has(value)) invalid(`${name}[${index}]: unknown reference ${value}`)
  }
}

export function normalizeEvidenceClaim(input, name = 'claim') {
  const source = objectValue(input, name)
  const evidenceIds = identifierValues(source.evidenceIds, `${name}.evidenceIds`, {
    maxItems: 64,
    maxLength: 256
  })
  if (!evidenceIds.length) invalid(`${name}.evidenceIds: at least one evidence item is required`)
  return {
    value: stringValue(source.value, `${name}.value`, 4_000),
    evidenceIds,
    confidence: confidenceValue(source.confidence, `${name}.confidence`)
  }
}

/**
 * A scan result is deliberately an observation, not final markup. Every
 * observation is grounded in an exact quote from the normalized book text.
 */
export function normalizeBookAnalysisObservation(input) {
  const source = objectValue(input, 'observation')
  const evidence = objectValue(source.evidence, 'observation.evidence')
  const startOffset = textOffset(evidence.startOffset, 'observation.evidence.startOffset')
  const endOffset = textOffset(evidence.endOffset, 'observation.evidence.endOffset')
  if (endOffset <= startOffset) {
    invalid('observation.evidence.endOffset: must be after startOffset')
  }
  const type = enumValue(source.type, OBSERVATION_TYPES, 'observation.type')
  const entityKind = enumValue(
    source.entityKind,
    ENTITY_KINDS,
    'observation.entityKind'
  )
  if (OBSERVATION_ENTITY_KIND.get(type) !== entityKind) {
    invalid('observation.entityKind: does not match observation.type')
  }
  return {
    observationKey: identifier(source.observationKey, 'observation.observationKey'),
    type,
    entityKind,
    entityCandidate: stringValue(
      source.entityCandidate,
      'observation.entityCandidate',
      512
    ),
    relatedEntityCandidates: stringValues(
      source.relatedEntityCandidates ?? [],
      'observation.relatedEntityCandidates',
      { maxItems: 32, maxLength: 512 }
    ),
    fact: stringValue(source.fact, 'observation.fact', 4_000),
    evidence: {
      quote: verbatimStringValue(evidence.quote, 'observation.evidence.quote', 8_000),
      startOffset,
      endOffset,
      chapterKey: stringValue(
        evidence.chapterKey,
        'observation.evidence.chapterKey',
        256,
        { optional: true }
      )
    },
    confidence: confidenceValue(source.confidence, 'observation.confidence')
  }
}

/** A canonical entity produced from the complete immutable observation set. */
export function normalizeBookAnalysisResolvedEntity(input) {
  const source = objectValue(input, 'entity')
  const data = source.data == null ? {} : objectValue(source.data, 'entity.data')
  const canonicalName = stringValue(source.canonicalName, 'entity.canonicalName', 512)
  const aliases = stringValues(source.aliases ?? [], 'entity.aliases', {
    maxItems: 128,
    maxLength: 512
  }).filter((alias) => alias !== canonicalName)
  const evidenceIds = identifierValues(source.evidenceIds, 'entity.evidenceIds', {
    maxItems: 100_000,
    maxLength: 256
  })
  if (!evidenceIds.length) invalid('entity.evidenceIds: at least one evidence item is required')
  return {
    entityKey: identifier(source.entityKey, 'entity.entityKey'),
    entityKind: enumValue(source.entityKind, ENTITY_KINDS, 'entity.entityKind'),
    canonicalName,
    aliases,
    resolutionStatus: enumValue(
      source.resolutionStatus,
      RESOLUTION_STATUSES,
      'entity.resolutionStatus'
    ),
    confidence: confidenceValue(source.confidence, 'entity.confidence'),
    evidenceIds,
    data
  }
}

function normalizeCreativeCharacterData(input, name) {
  const source = input == null ? {} : objectValue(input, name)
  return {
    greeting: stringValue(source.greeting, `${name}.greeting`, 2_000, { optional: true }),
    appearancePrompt: stringValue(
      source.appearancePrompt,
      `${name}.appearancePrompt`,
      4_000,
      { optional: true }
    ),
    voice: stringValue(source.voice, `${name}.voice`, 64, { optional: true })
  }
}

function normalizeCharacter(input, index, textLength) {
  const name = `characters[${index}]`
  const source = objectValue(input, name)
  const firstAppearanceTextOffset = textOffset(
    source.firstAppearanceTextOffset,
    `${name}.firstAppearanceTextOffset`
  )
  const warmupTextOffset = textOffset(source.warmupTextOffset, `${name}.warmupTextOffset`)
  if (firstAppearanceTextOffset > textLength) {
    invalid(`${name}.firstAppearanceTextOffset: exceeds textLength`)
  }
  if (warmupTextOffset > firstAppearanceTextOffset) {
    invalid(`${name}.warmupTextOffset: must not be after firstAppearanceTextOffset`)
  }
  const identityEvidenceIds = identifierValues(
    source.identityEvidenceIds,
    `${name}.identityEvidenceIds`,
    { maxItems: 64, maxLength: 256 }
  )
  if (!identityEvidenceIds.length) {
    invalid(`${name}.identityEvidenceIds: at least one evidence item is required`)
  }
  return {
    characterKey: identifier(source.characterKey, `${name}.characterKey`),
    name: stringValue(source.name, `${name}.name`, 160),
    fullName: stringValue(source.fullName, `${name}.fullName`, 240),
    aliases: stringValues(source.aliases ?? [], `${name}.aliases`, {
      maxItems: 32,
      maxLength: 160
    }),
    identityEvidenceIds,
    firstAppearanceTextOffset,
    warmupTextOffset,
    role: optionalClaim(source.role, `${name}.role`),
    age: optionalClaim(source.age, `${name}.age`),
    gender: optionalGenderClaim(source.gender, `${name}.gender`),
    description: optionalClaim(source.description, `${name}.description`),
    traits: claimValues(source.traits ?? [], `${name}.traits`, 32),
    appearance: claimValues(source.appearance ?? [], `${name}.appearance`, 32),
    speechStyle: optionalClaim(source.speechStyle, `${name}.speechStyle`),
    speechExamples: claimValues(source.speechExamples ?? [], `${name}.speechExamples`, 32),
    creative: normalizeCreativeCharacterData(source.creative, `${name}.creative`)
  }
}

/** Binds a generated factual profile to an already resolved character identity. */
export function normalizeBookAnalysisCharacterProfile(input, { entity, textLength }) {
  const source = objectValue(input, 'profile')
  const resolved = normalizeBookAnalysisResolvedEntity(entity)
  if (resolved.entityKind !== 'character') invalid('entity.entityKind: expected character')
  const firstAppearanceTextOffset = textOffset(
    resolved.data.firstEvidenceStartOffset,
    'entity.data.firstEvidenceStartOffset'
  )
  return normalizeCharacter({
    ...source,
    characterKey: resolved.entityKey,
    name: resolved.canonicalName,
    fullName: resolved.canonicalName,
    aliases: resolved.aliases.slice(0, 32),
    identityEvidenceIds: resolved.evidenceIds.slice(0, 64),
    firstAppearanceTextOffset,
    warmupTextOffset: Math.max(
      0,
      firstAppearanceTextOffset - Math.max(2_000, Math.round(textLength * 0.02))
    )
  }, 0, textLength)
}

function normalizeLocation(input, index) {
  const name = `locations[${index}]`
  const source = objectValue(input, name)
  return {
    locationKey: identifier(source.locationKey, `${name}.locationKey`),
    name: stringValue(source.name, `${name}.name`, 240),
    description: stringValue(source.description, `${name}.description`, 4_000),
    evidenceIds: nonEmptyEvidenceIds(source.evidenceIds, `${name}.evidenceIds`)
  }
}

function normalizeEvent(input, index) {
  const name = `events[${index}]`
  const source = objectValue(input, name)
  return {
    eventKey: identifier(source.eventKey, `${name}.eventKey`),
    title: stringValue(source.title, `${name}.title`, 240),
    description: stringValue(source.description, `${name}.description`, 4_000),
    participantCharacterKeys: identifierValues(
      source.participantCharacterKeys ?? [],
      `${name}.participantCharacterKeys`
    ),
    locationKeys: identifierValues(source.locationKeys ?? [], `${name}.locationKeys`),
    evidenceIds: nonEmptyEvidenceIds(source.evidenceIds, `${name}.evidenceIds`)
  }
}

function normalizeRelationship(input, index) {
  const name = `relationships[${index}]`
  const source = objectValue(input, name)
  return {
    relationshipKey: identifier(source.relationshipKey, `${name}.relationshipKey`),
    sourceCharacterKey: identifier(source.sourceCharacterKey, `${name}.sourceCharacterKey`),
    targetCharacterKey: identifier(source.targetCharacterKey, `${name}.targetCharacterKey`),
    description: stringValue(source.description, `${name}.description`, 4_000),
    evidenceIds: nonEmptyEvidenceIds(source.evidenceIds, `${name}.evidenceIds`)
  }
}

function normalizeStoryArc(input, index) {
  const name = `storyArcs[${index}]`
  const source = objectValue(input, name)
  return {
    storyArcKey: identifier(source.storyArcKey, `${name}.storyArcKey`),
    title: stringValue(source.title, `${name}.title`, 240),
    description: stringValue(source.description, `${name}.description`, 8_000),
    characterKeys: identifierValues(source.characterKeys ?? [], `${name}.characterKeys`),
    eventKeys: identifierValues(source.eventKeys ?? [], `${name}.eventKeys`),
    evidenceIds: nonEmptyEvidenceIds(source.evidenceIds, `${name}.evidenceIds`)
  }
}

function nonEmptyEvidenceIds(value, name) {
  const evidenceIds = identifierValues(value, name, { maxItems: 128, maxLength: 256 })
  if (!evidenceIds.length) invalid(`${name}: at least one evidence item is required`)
  return evidenceIds
}

/** Final factual markup built from one frozen evidence snapshot. */
export function normalizeBookMarkupV3(input) {
  const source = objectValue(input, 'markup')
  if (source.schemaVersion !== BOOK_ANALYSIS_SCHEMA_VERSION) {
    invalid(`markup.schemaVersion: expected ${BOOK_ANALYSIS_SCHEMA_VERSION}`)
  }
  if (source.analysisVersion !== BOOK_ANALYSIS_MARKUP_VERSION) {
    invalid(`markup.analysisVersion: expected ${BOOK_ANALYSIS_MARKUP_VERSION}`)
  }
  const textLength = textOffset(source.textLength, 'markup.textLength')
  if (textLength < 1) invalid('markup.textLength: must be positive')
  if (!Array.isArray(source.characters)) invalid('markup.characters: expected an array')
  if (source.characters.length > 128) invalid('markup.characters: exceeds 128 items')
  const characters = uniqueKeys(
    source.characters.map((character, index) => normalizeCharacter(character, index, textLength)),
    'characterKey',
    'characters'
  )
  const locations = uniqueKeys(
    boundedObjects(source.locations ?? [], 'locations', 2_048).map(normalizeLocation),
    'locationKey',
    'locations'
  )
  const events = uniqueKeys(
    boundedObjects(source.events ?? [], 'events', 2_048).map(normalizeEvent),
    'eventKey',
    'events'
  )
  const relationships = uniqueKeys(
    boundedObjects(source.relationships ?? [], 'relationships', 2_048).map(normalizeRelationship),
    'relationshipKey',
    'relationships'
  )
  const storyArcs = uniqueKeys(
    boundedObjects(source.storyArcs ?? [], 'storyArcs', 2_048).map(normalizeStoryArc),
    'storyArcKey',
    'storyArcs'
  )
  const characterKeys = new Set(characters.map(({ characterKey }) => characterKey))
  const locationKeys = new Set(locations.map(({ locationKey }) => locationKey))
  const eventKeys = new Set(events.map(({ eventKey }) => eventKey))
  for (const [index, event] of events.entries()) {
    assertKnownKeys(
      event.participantCharacterKeys,
      characterKeys,
      `events[${index}].participantCharacterKeys`
    )
    assertKnownKeys(event.locationKeys, locationKeys, `events[${index}].locationKeys`)
  }
  for (const [index, relationship] of relationships.entries()) {
    assertKnownKeys(
      [relationship.sourceCharacterKey, relationship.targetCharacterKey],
      characterKeys,
      `relationships[${index}].characterKeys`
    )
  }
  for (const [index, storyArc] of storyArcs.entries()) {
    assertKnownKeys(storyArc.characterKeys, characterKeys, `storyArcs[${index}].characterKeys`)
    assertKnownKeys(storyArc.eventKeys, eventKeys, `storyArcs[${index}].eventKeys`)
  }
  return {
    schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    snapshotId: identifier(source.snapshotId, 'markup.snapshotId'),
    textLength,
    characters,
    locations,
    events,
    relationships,
    storyArcs
  }
}

function normalizeRunState(value, name) {
  const source = objectValue(value, name)
  return {
    stage: enumValue(source.stage, STAGE_INDEX, `${name}.stage`),
    status: enumValue(source.status, RUN_STATUSES, `${name}.status`)
  }
}

/**
 * Pure transition guard mirrored by the PostgreSQL trigger. Stage barriers are
 * checked by storage before this transition is persisted.
 */
export function assertBookAnalysisRunTransition(currentInput, nextInput) {
  const current = normalizeRunState(currentInput, 'current')
  const next = normalizeRunState(nextInput, 'next')
  if (current.status === 'ready' || current.status === 'cancelled') {
    invalid(`current.status: ${current.status} runs are immutable`)
  }
  if (current.stage !== next.stage) {
    if (current.status !== 'running' || next.status !== 'running') {
      invalid('transition: stage changes require a running run')
    }
    if (STAGE_INDEX.get(next.stage) !== STAGE_INDEX.get(current.stage) + 1) {
      invalid('transition: stages must advance exactly one step')
    }
    return next
  }
  const allowed = new Set({
    queued: ['queued', 'running', 'cancelled'],
    running: ['running', 'failed', 'cancelled'],
    failed: ['failed', 'queued', 'cancelled']
  }[current.status] ?? [])
  if (next.status === 'ready') {
    if (current.status !== 'running' || current.stage !== 'publish') {
      invalid('transition: only a running publish stage can become ready')
    }
    return next
  }
  if (!allowed.has(next.status)) invalid('transition: unsupported status change')
  return next
}
