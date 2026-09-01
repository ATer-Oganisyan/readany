import { createHash } from 'node:crypto'
import { normalizeBookMarkupV3 } from './book-analysis-contracts.mjs'

export const BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION = 'book-character-correction-v1'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const CHARACTER_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const PROFILE_FIELDS = Object.freeze(['role', 'description'])

function invalid(message, code = 'CHARACTER_CORRECTION_INVALID', status = 400) {
  throw Object.assign(new Error(message), { code, status })
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${name}: expected object`)
  }
  return value
}

function exactKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${name}.${key}: unsupported field`)
  }
}

function text(value, name, maxLength, minLength = 1) {
  if (typeof value !== 'string') invalid(`${name}: expected text`)
  const normalized = value.normalize('NFKC').trim()
  if (normalized.length < minLength) invalid(`${name}: must contain at least ${minLength} characters`)
  if (normalized.length > maxLength) invalid(`${name}: exceeds ${maxLength} characters`)
  if (/\p{Cc}/u.test(normalized)) invalid(`${name}: contains control characters`)
  return normalized
}

function uuid(value, name) {
  const normalized = text(value, name, 36).toLowerCase()
  if (!UUID.test(normalized)) invalid(`${name}: invalid UUID`)
  return normalized
}

function sha256(value, name) {
  const normalized = text(value, name, 64).toLowerCase()
  if (!SHA256.test(normalized)) invalid(`${name}: invalid SHA-256`)
  return normalized
}

function characterKey(value, name) {
  const normalized = text(value, name, 256)
  if (!CHARACTER_KEY.test(normalized)) invalid(`${name}: invalid character key`)
  return normalized
}

function evidenceId(value, name) {
  return characterKey(value, name)
}

function uniqueStrings(values, name, { maxItems, maxLength, normalize = text } = {}) {
  if (!Array.isArray(values)) invalid(`${name}: expected array`)
  if (values.length > maxItems) invalid(`${name}: exceeds ${maxItems} items`)
  const seen = new Set()
  return values.map((value, index) => {
    const normalized = normalize(value, `${name}[${index}]`, maxLength)
    const identity = normalized.normalize('NFKC').toLocaleLowerCase('ru-RU')
    if (seen.has(identity)) invalid(`${name}[${index}]: duplicate value`)
    seen.add(identity)
    return normalized
  })
}

function normalizeClaim(value, name, field) {
  if (value === null) return null
  const source = object(value, name)
  exactKeys(source, ['value', 'evidenceIds', 'confidence'], name)
  const minValueLength = field === 'description' ? 40 : 2
  const maxValueLength = field === 'description' ? 2_000 : 240
  const claimValue = text(source.value, `${name}.value`, maxValueLength, minValueLength)
  if (field === 'role' && /[\r\n]/u.test(claimValue)) {
    invalid(`${name}.value: role must be one line`)
  }
  const evidenceIds = uniqueStrings(source.evidenceIds, `${name}.evidenceIds`, {
    maxItems: 32,
    maxLength: 256,
    normalize: evidenceId
  })
  const minimumEvidence = field === 'description' ? 2 : 1
  if (evidenceIds.length < minimumEvidence) {
    invalid(`${name}.evidenceIds: ${field} requires at least ${minimumEvidence} evidence items`)
  }
  if (
    typeof source.confidence !== 'number' || !Number.isFinite(source.confidence) ||
    source.confidence < 0 || source.confidence > 1
  ) {
    invalid(`${name}.confidence: expected number between 0 and 1`)
  }
  return { value: claimValue, evidenceIds, confidence: source.confidence }
}

function normalizeSet(value, name) {
  const source = object(value, name)
  exactKeys(source, PROFILE_FIELDS, name)
  const result = {}
  for (const field of PROFILE_FIELDS) {
    if (Object.hasOwn(source, field)) result[field] = normalizeClaim(source[field], `${name}.${field}`, field)
  }
  if (!Object.keys(result).length) invalid(`${name}: at least one profile field is required`)
  return result
}

function normalizeCopy(value, name) {
  const source = object(value, name)
  exactKeys(source, ['roleFrom', 'descriptionFrom'], name)
  const result = {}
  if (Object.hasOwn(source, 'roleFrom')) {
    result.roleFrom = characterKey(source.roleFrom, `${name}.roleFrom`)
  }
  if (Object.hasOwn(source, 'descriptionFrom')) {
    result.descriptionFrom = characterKey(source.descriptionFrom, `${name}.descriptionFrom`)
  }
  if (!Object.keys(result).length) invalid(`${name}: at least one source is required`)
  return result
}

function normalizeChange(value, index) {
  const name = `changes[${index}]`
  const source = object(value, name)
  exactKeys(source, ['characterKey', 'reason', 'set', 'copy', 'addAliases', 'redirectTo', 'suppress'], name)
  const result = {
    characterKey: characterKey(source.characterKey, `${name}.characterKey`),
    reason: text(source.reason, `${name}.reason`, 1_000, 8)
  }
  if (Object.hasOwn(source, 'set')) result.set = normalizeSet(source.set, `${name}.set`)
  if (Object.hasOwn(source, 'copy')) result.copy = normalizeCopy(source.copy, `${name}.copy`)
  if (Object.hasOwn(source, 'addAliases')) {
    result.addAliases = uniqueStrings(source.addAliases, `${name}.addAliases`, {
      maxItems: 32,
      maxLength: 160
    })
    if (!result.addAliases.length) invalid(`${name}.addAliases: must not be empty`)
  }
  if (Object.hasOwn(source, 'redirectTo')) {
    result.redirectTo = characterKey(source.redirectTo, `${name}.redirectTo`)
  }
  if (Object.hasOwn(source, 'suppress')) {
    if (source.suppress !== true) invalid(`${name}.suppress: expected true`)
    result.suppress = true
  }
  const actions = ['set', 'copy', 'addAliases', 'redirectTo', 'suppress']
    .filter((key) => Object.hasOwn(result, key))
  if (!actions.length) invalid(`${name}: at least one correction action is required`)
  if (result.redirectTo && actions.length !== 1) {
    invalid(`${name}: redirect cannot contain profile or alias changes`)
  }
  if (result.suppress && actions.length !== 1) {
    invalid(`${name}: suppress cannot contain profile, alias or redirect changes`)
  }
  if (result.set && result.copy) {
    for (const field of PROFILE_FIELDS) {
      const copyKey = `${field}From`
      if (Object.hasOwn(result.set, field) && Object.hasOwn(result.copy, copyKey)) {
        invalid(`${name}: ${field} cannot be set and copied together`)
      }
    }
  }
  return result
}

export function normalizeBookCharacterCorrection(value) {
  const source = object(value, 'correction')
  exactKeys(source, ['contractVersion', 'base', 'reason', 'changes'], 'correction')
  if (source.contractVersion !== BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION) {
    invalid(`correction.contractVersion: expected ${BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION}`)
  }
  const base = object(source.base, 'correction.base')
  exactKeys(base, ['markupVersionId', 'publicationId', 'contentHash'], 'correction.base')
  if (!Array.isArray(source.changes) || source.changes.length < 1 || source.changes.length > 128) {
    invalid('correction.changes: expected 1–128 items')
  }
  const changes = source.changes.map(normalizeChange).sort((left, right) =>
    left.characterKey.localeCompare(right.characterKey))
  const seen = new Set()
  for (const change of changes) {
    if (seen.has(change.characterKey)) {
      invalid(`correction.changes: duplicate character ${change.characterKey}`)
    }
    seen.add(change.characterKey)
  }
  return {
    contractVersion: BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION,
    base: {
      markupVersionId: uuid(base.markupVersionId, 'correction.base.markupVersionId'),
      publicationId: uuid(base.publicationId, 'correction.base.publicationId'),
      contentHash: sha256(base.contentHash, 'correction.base.contentHash')
    },
    reason: text(source.reason, 'correction.reason', 2_000, 12),
    changes
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function bookCharacterCorrectionHash(value) {
  const normalized = normalizeBookCharacterCorrection(value)
  return createHash('sha256').update(canonicalJson(normalized)).digest('hex')
}

function addClaimEvidence(result, claim) {
  for (const evidenceId of claim?.evidenceIds ?? []) result.add(evidenceId)
}

function characterEvidenceIds(character) {
  const result = new Set(character.identityEvidenceIds ?? [])
  for (const field of ['role', 'age', 'gender', 'description', 'speechStyle']) {
    addClaimEvidence(result, character[field])
  }
  for (const field of ['traits', 'appearance', 'speechExamples']) {
    for (const claim of character[field] ?? []) addClaimEvidence(result, claim)
  }
  for (const snapshot of character.personalitySnapshots ?? []) {
    for (const claim of snapshot.traits ?? []) addClaimEvidence(result, claim)
  }
  return result
}

function normalizedAlias(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ru-RU')
}

function uniqueAliases(values) {
  const result = []
  const seen = new Set()
  for (const value of values) {
    const normalized = String(value || '').normalize('NFKC').trim()
    const identity = normalizedAlias(normalized)
    if (!normalized || seen.has(identity)) continue
    seen.add(identity)
    result.push(normalized)
  }
  return result.slice(0, 32)
}

function mapKeys(values, redirects, suppressed) {
  return [...new Set((values ?? [])
    .map((value) => redirects.get(value) ?? value)
    .filter((value) => !suppressed.has(value)))]
}

function assertCorrectionBase(document, base) {
  if (!base || typeof base !== 'object') invalid('base: expected current publication metadata')
  const expected = document.base
  if (
    expected.markupVersionId !== String(base.markupVersionId || '').toLowerCase() ||
    expected.publicationId !== String(base.publicationId || '').toLowerCase() ||
    expected.contentHash !== String(base.contentHash || '').toLowerCase()
  ) {
    invalid(
      'correction base no longer matches the published markup',
      'CHARACTER_CORRECTION_STALE',
      409
    )
  }
}

function correctionPlan(document, markup) {
  const characters = new Map(markup.characters.map((character) => [character.characterKey, character]))
  const redirects = new Map()
  const suppressed = new Set()
  for (const change of document.changes) {
    if (!characters.has(change.characterKey)) {
      invalid(`changes.${change.characterKey}: character does not exist in base markup`)
    }
    if (change.suppress) {
      suppressed.add(change.characterKey)
      continue
    }
    if (!change.redirectTo) continue
    if (change.redirectTo === change.characterKey) {
      invalid(`changes.${change.characterKey}: redirect cannot target itself`)
    }
    if (!characters.has(change.redirectTo)) {
      invalid(`changes.${change.characterKey}.redirectTo: target does not exist`)
    }
    redirects.set(change.characterKey, change.redirectTo)
  }
  for (const [source, target] of redirects) {
    if (redirects.has(target)) {
      invalid(`changes.${source}.redirectTo: redirect chains are not allowed`)
    }
    if (suppressed.has(target)) {
      invalid(`changes.${source}.redirectTo: target cannot be suppressed`)
    }
  }
  for (const change of document.changes) {
    if (!change.copy) continue
    for (const [field, sourceKey] of Object.entries(change.copy)) {
      if (!characters.has(sourceKey)) invalid(`changes.${change.characterKey}.${field}: source is missing`)
      if (redirects.get(sourceKey) !== change.characterKey) {
        invalid(`changes.${change.characterKey}.${field}: source must redirect to this character`)
      }
      const profileField = field === 'roleFrom' ? 'role' : 'description'
      if (!characters.get(sourceKey)?.[profileField]) {
        invalid(`changes.${change.characterKey}.${field}: source field is empty`)
      }
    }
  }
  return { characters, redirects, suppressed }
}

function assertClaimEvidence(document, plan) {
  const evidenceByKey = new Map([...plan.characters].map(([key, character]) =>
    [key, characterEvidenceIds(character)]))
  for (const [source, target] of plan.redirects) {
    const targetEvidence = evidenceByKey.get(target)
    for (const evidenceId of evidenceByKey.get(source)) targetEvidence.add(evidenceId)
  }
  for (const change of document.changes) {
    if (!change.set) continue
    const allowedEvidence = evidenceByKey.get(change.characterKey)
    for (const [field, claim] of Object.entries(change.set)) {
      if (claim === null) continue
      for (const evidenceId of claim.evidenceIds) {
        if (!allowedEvidence.has(evidenceId)) {
          invalid(`changes.${change.characterKey}.set.${field}: evidence ${evidenceId} is not owned by the corrected identity`)
        }
      }
    }
  }
}

function assertAddedAliases(document, plan) {
  const visibleOwners = new Map()
  for (const character of plan.characters.values()) {
    if (plan.redirects.has(character.characterKey) || plan.suppressed.has(character.characterKey)) continue
    for (const alias of [character.name, character.fullName, ...(character.aliases ?? [])]) {
      const identity = normalizedAlias(alias)
      if (identity && !visibleOwners.has(identity)) visibleOwners.set(identity, character.characterKey)
    }
  }
  for (const change of document.changes) {
    for (const alias of change.addAliases ?? []) {
      const owner = visibleOwners.get(normalizedAlias(alias))
      if (owner && owner !== change.characterKey && plan.redirects.get(owner) !== change.characterKey) {
        invalid(`changes.${change.characterKey}.addAliases: alias ${alias} belongs to ${owner}`)
      }
    }
  }
}

export function validateBookCharacterCorrection(value, { markup, base }) {
  const document = normalizeBookCharacterCorrection(value)
  assertCorrectionBase(document, base)
  const normalizedMarkup = normalizeBookMarkupV3(markup)
  const plan = correctionPlan(document, normalizedMarkup)
  assertClaimEvidence(document, plan)
  assertAddedAliases(document, plan)
  return { document, markup: normalizedMarkup, plan }
}

function claimValue(claim) {
  return typeof claim?.value === 'string' ? claim.value : null
}

export function applyBookCharacterCorrection(value, { markup, base }) {
  const validated = validateBookCharacterCorrection(value, { markup, base })
  const { document, plan } = validated
  const projected = structuredClone(validated.markup)
  const characters = new Map(projected.characters.map((character) => [character.characterKey, character]))
  const original = new Map(validated.markup.characters.map((character) => [character.characterKey, character]))

  for (const change of document.changes) {
    if (change.redirectTo || change.suppress) continue
    const target = characters.get(change.characterKey)
    for (const [field, claim] of Object.entries(change.set ?? {})) target[field] = structuredClone(claim)
    if (change.copy?.roleFrom) {
      target.role = structuredClone(original.get(change.copy.roleFrom).role)
    }
    if (change.copy?.descriptionFrom) {
      target.description = structuredClone(original.get(change.copy.descriptionFrom).description)
    }
    target.aliases = uniqueAliases([...(target.aliases ?? []), ...(change.addAliases ?? [])])
  }

  for (const [sourceKey, targetKey] of plan.redirects) {
    const source = characters.get(sourceKey)
    const target = characters.get(targetKey)
    target.aliases = uniqueAliases([
      ...(target.aliases ?? []),
      source.name,
      source.fullName,
      ...(source.aliases ?? [])
    ])
    target.identityEvidenceIds = [...new Set([
      ...(target.identityEvidenceIds ?? []),
      ...(source.identityEvidenceIds ?? [])
    ])]
    target.firstAppearanceTextOffset = Math.min(
      target.firstAppearanceTextOffset,
      source.firstAppearanceTextOffset
    )
    target.warmupTextOffset = Math.min(target.warmupTextOffset, source.warmupTextOffset)
    characters.delete(sourceKey)
  }

  for (const characterKey of plan.suppressed) characters.delete(characterKey)

  projected.characters = projected.characters
    .map((character) => characters.get(character.characterKey))
    .filter(Boolean)
  projected.events = projected.events.map((event) => ({
    ...event,
    participantCharacterKeys: mapKeys(
      event.participantCharacterKeys,
      plan.redirects,
      plan.suppressed
    )
  }))
  projected.relationships = projected.relationships
    .map((relationship) => ({
      ...relationship,
      sourceCharacterKey: plan.redirects.get(relationship.sourceCharacterKey) ?? relationship.sourceCharacterKey,
      targetCharacterKey: plan.redirects.get(relationship.targetCharacterKey) ?? relationship.targetCharacterKey
    }))
    .filter((relationship) => (
      !plan.suppressed.has(relationship.sourceCharacterKey) &&
      !plan.suppressed.has(relationship.targetCharacterKey)
    ))
  projected.storyArcs = projected.storyArcs.map((arc) => ({
    ...arc,
    characterKeys: mapKeys(arc.characterKeys, plan.redirects, plan.suppressed)
  }))
  const normalizedProjection = normalizeBookMarkupV3(projected)
  const changedKeys = new Set([
    ...document.changes.filter((change) => !change.redirectTo).map((change) => change.characterKey),
    ...plan.redirects.values()
  ])
  const diff = {
    beforeCharacterCount: validated.markup.characters.length,
    afterCharacterCount: normalizedProjection.characters.length,
    redirects: Object.fromEntries(plan.redirects),
    suppressed: [...plan.suppressed].sort(),
    characters: [...changedKeys].sort().map((key) => {
      const before = original.get(key)
      const after = normalizedProjection.characters.find((character) => character.characterKey === key)
      return {
        characterKey: key,
        name: after?.name ?? before?.name,
        before: before && {
          role: claimValue(before.role),
          description: claimValue(before.description),
          aliases: before.aliases ?? []
        },
        after: after && {
          role: claimValue(after.role),
          description: claimValue(after.description),
          aliases: after.aliases ?? []
        }
      }
    })
  }
  return {
    document,
    documentHash: bookCharacterCorrectionHash(document),
    markup: normalizedProjection,
    redirects: plan.redirects,
    diff
  }
}

export function resolveCorrectedCharacterKey(characterKeyValue, correction) {
  const key = String(characterKeyValue || '')
  if (!correction) return key
  const document = correction.document ?? correction
  const normalized = normalizeBookCharacterCorrection(document)
  const change = normalized.changes.find((candidate) => candidate.characterKey === key)
  if (change?.suppress) return null
  return change?.redirectTo ?? key
}
