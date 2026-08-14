import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { assembleBookMarkupV3 } from '../book-analysis-assembler.mjs'
import { validateBookMarkupV3 } from '../book-analysis-validator.mjs'

const mentionId = '11111111-1111-4111-8111-111111111111'
const roleId = '22222222-2222-4222-8222-222222222222'
const snapshotId = '33333333-3333-4333-8333-333333333333'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fixture() {
  const normalizedText = 'Анна — врач.'
  const observations = [
    {
      id: mentionId,
      type: 'character_mention',
      entityKind: 'character',
      entityCandidate: 'Анна',
      relatedEntityCandidates: [],
      fact: 'Анна упомянута в книге',
      evidence: { quote: 'Анна', startOffset: 0, endOffset: 4, chapterKey: 'chapter-1' },
      confidence: 0.99,
      data: {}
    },
    {
      id: roleId,
      type: 'character_role',
      entityKind: 'character',
      entityCandidate: 'Анна',
      relatedEntityCandidates: [],
      fact: 'Анна работает врачом',
      evidence: { quote: 'врач', startOffset: 7, endOffset: 11, chapterKey: 'chapter-1' },
      confidence: 0.95,
      data: {}
    }
  ]
  const entity = {
    id: '44444444-4444-4444-8444-444444444444',
    entityKey: 'character:anna',
    entityKind: 'character',
    canonicalName: 'Анна',
    aliases: ['Аня'],
    resolutionStatus: 'confirmed',
    confidence: 0.97,
    evidenceIds: [mentionId, roleId],
    data: { observationCount: 2, firstEvidenceStartOffset: 0, lastEvidenceEndOffset: 11 }
  }
  const entityForHash = { ...entity }
  delete entityForHash.id
  const snapshotData = {
    schemaVersion: 1,
    observationSetHash: hash(JSON.stringify(canonical(observations))),
    entitySetHash: hash(JSON.stringify(canonical([entityForHash]))),
    observationIds: [mentionId, roleId],
    entities: [entity]
  }
  const snapshot = {
    id: snapshotId,
    runId: '55555555-5555-4555-8555-555555555555',
    version: 1,
    contentHash: hash(JSON.stringify(canonical(snapshotData))),
    evidenceCount: 2,
    data: snapshotData
  }
  const profile = {
    characterKey: entity.entityKey,
    name: 'Анна',
    fullName: 'Анна',
    aliases: ['Аня'],
    identityEvidenceIds: [mentionId, roleId],
    firstAppearanceTextOffset: 0,
    warmupTextOffset: 0,
    role: { value: 'Врач', evidenceIds: [roleId], confidence: 0.95 },
    age: null,
    gender: null,
    description: null,
    traits: [],
    appearance: [],
    speechStyle: null,
    speechExamples: [],
    creative: { greeting: 'Здравствуйте.', appearancePrompt: 'Портрет Анны', voice: 'Che' }
  }
  return { normalizedText, observations, entity, snapshot, profile }
}

test('assembler deterministically joins full-book entities and grounded character profiles', () => {
  const { observations, entity, profile } = fixture()
  const markup = assembleBookMarkupV3({
    snapshotId,
    textLength: 12,
    entities: [entity],
    observations,
    characterProfiles: [profile]
  })
  assert.equal(markup.characters.length, 1)
  assert.equal(markup.characters[0].characterKey, 'character:anna')
  assert.equal(markup.characters[0].role.value, 'Врач')
  assert.deepEqual(markup.characters[0].role.evidenceIds, [roleId])
})

test('independent validator accepts exact evidence and rejects a claim backed by the wrong fact type', () => {
  const { normalizedText, observations, entity, snapshot, profile } = fixture()
  const markup = assembleBookMarkupV3({
    snapshotId,
    textLength: normalizedText.length,
    entities: [entity],
    observations,
    characterProfiles: [profile]
  })
  const valid = validateBookMarkupV3({
    markup,
    snapshot,
    observations,
    normalizedText,
    normalizedTextHash: hash(normalizedText)
  })
  assert.equal(valid.valid, true)
  const invalid = validateBookMarkupV3({
    markup: {
      ...markup,
      characters: [{
        ...markup.characters[0],
        role: { value: 'Врач', evidenceIds: [mentionId], confidence: 0.95 }
      }]
    },
    snapshot,
    observations,
    normalizedText,
    normalizedTextHash: hash(normalizedText)
  })
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some(({ code }) => code === 'EVIDENCE_TYPE_MISMATCH'))
})
