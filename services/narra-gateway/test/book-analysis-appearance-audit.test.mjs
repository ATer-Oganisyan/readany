import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  auditCharacterAppearanceDistribution,
  CHARACTER_APPEARANCE_CLUSTER_CODE
} from '../book-analysis-appearance-audit.mjs'
import { assembleBookMarkupV3 } from '../book-analysis-assembler.mjs'
import { validateBookMarkupV3 } from '../book-analysis-validator.mjs'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function markup({ textLength = 100_000, characters = 10, early = 0 }) {
  return {
    textLength,
    characters: Array.from({ length: characters }, (_, index) => ({
      characterKey: `character:${index}`,
      firstAppearanceTextOffset: index < early ? 100 + index * 40 : 5_000 + index * 2_000
    }))
  }
}

test('appearance audit flags a cast list clustered at the start of a book', () => {
  const audit = auditCharacterAppearanceDistribution(markup({ characters: 10, early: 6 }))

  assert.deepEqual(audit, {
    status: 'suspicious',
    code: CHARACTER_APPEARANCE_CLUSTER_CODE,
    textLength: 100_000,
    characterCount: 10,
    earlyCharacterCount: 6,
    earlyCharacterFraction: 0.6,
    earlyBoundaryTextOffset: 1_000,
    thresholds: {
      minimumEarlyCharacters: 5,
      minimumEarlyFraction: 0.4,
      initialTextFraction: 0.01,
      maximumInitialTextOffset: 1_000
    }
  })
})

test('appearance audit keeps a crowded but distributed prose opening clear', () => {
  const audit = auditCharacterAppearanceDistribution(markup({
    textLength: 150_000,
    characters: 34,
    early: 8
  }))

  assert.equal(audit.status, 'clear')
  assert.equal(audit.earlyCharacterCount, 8)
  assert.equal(audit.earlyCharacterFraction, 8 / 34)
})

test('appearance audit requires both a mass share and a meaningful absolute count', () => {
  const audit = auditCharacterAppearanceDistribution(markup({ characters: 3, early: 2 }))

  assert.equal(audit.status, 'clear')
  assert.equal(audit.earlyCharacterFraction, 2 / 3)
})

test('independent v3 validator blocks a publication with a cast-list appearance cluster', () => {
  const text = Array.from({ length: 100_000 }, () => ' ')
  const observations = []
  const entities = []
  const profiles = []
  for (let index = 0; index < 5; index += 1) {
    const name = `Герой${index}`
    const startOffset = 100 + index * 100
    text.splice(startOffset, name.length, ...name)
    const observationId = `00000000-0000-4000-8000-00000000000${index}`
    const entityId = `10000000-0000-4000-8000-00000000000${index}`
    const characterKey = `character:hero-${index}`
    observations.push({
      id: observationId,
      type: 'character_mention',
      entityKind: 'character',
      entityCandidate: name,
      relatedEntityCandidates: [],
      fact: `${name} упомянут`,
      evidence: {
        quote: name,
        startOffset,
        endOffset: startOffset + name.length,
        chapterKey: 'front-matter'
      },
      confidence: 0.99,
      data: {}
    })
    entities.push({
      id: entityId,
      entityKey: characterKey,
      entityKind: 'character',
      canonicalName: name,
      aliases: [],
      resolutionStatus: 'confirmed',
      confidence: 0.99,
      evidenceIds: [observationId],
      data: {
        observationCount: 1,
        firstEvidenceStartOffset: startOffset,
        lastEvidenceEndOffset: startOffset + name.length
      }
    })
    profiles.push({
      characterKey,
      name,
      fullName: name,
      aliases: [],
      identityEvidenceIds: [observationId],
      firstAppearanceTextOffset: startOffset,
      warmupTextOffset: 0,
      role: null,
      age: null,
      gender: null,
      description: null,
      traits: [],
      appearance: [],
      speechStyle: null,
      speechExamples: [],
      creative: { greeting: '', appearancePrompt: '', voice: '' }
    })
  }
  const normalizedText = text.join('')
  const entitiesForHash = entities.map(({ id: _id, ...entity }) => entity)
  const snapshotData = {
    schemaVersion: 1,
    observationSetHash: hash(JSON.stringify(canonical(observations))),
    entitySetHash: hash(JSON.stringify(canonical(entitiesForHash))),
    observationIds: observations.map(({ id }) => id),
    entities
  }
  const snapshot = {
    id: '20000000-0000-4000-8000-000000000000',
    runId: '30000000-0000-4000-8000-000000000000',
    version: 1,
    contentHash: hash(JSON.stringify(canonical(snapshotData))),
    evidenceCount: observations.length,
    data: snapshotData
  }
  const markup = assembleBookMarkupV3({
    snapshotId: snapshot.id,
    textLength: normalizedText.length,
    entities,
    observations,
    characterProfiles: profiles
  })

  const report = validateBookMarkupV3({
    markup,
    snapshot,
    observations,
    normalizedText,
    normalizedTextHash: hash(normalizedText)
  })

  assert.equal(report.valid, false)
  assert.equal(report.checks.characterAppearanceDistribution, false)
  assert.equal(report.quality.characterAppearance.status, 'suspicious')
  assert.ok(report.errors.some(({ code }) => code === CHARACTER_APPEARANCE_CLUSTER_CODE))
})

test('assembler moves cast-list offsets to the first later evidence when it exists', () => {
  const textLength = 100_000
  const observations = []
  const entities = []
  const profiles = []
  for (let index = 0; index < 5; index += 1) {
    const characterKey = `character:hero-${index}`
    const earlyId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    const laterId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    const earlyOffset = 100 + index * 100
    const laterOffset = 5_000 + index * 2_000
    observations.push(
      {
        id: earlyId,
        type: 'character_mention',
        entityKind: 'character',
        entityCandidate: `Герой${index}`,
        relatedEntityCandidates: [],
        fact: 'Персонаж перечислен в списке действующих лиц',
        evidence: {
          quote: `Герой${index}`,
          startOffset: earlyOffset,
          endOffset: earlyOffset + 6,
          chapterKey: 'front-matter'
        },
        confidence: 0.99,
        data: {}
      },
      {
        id: laterId,
        type: 'character_dialogue',
        entityKind: 'character',
        entityCandidate: `Герой${index}`,
        relatedEntityCandidates: [],
        fact: 'Персонаж говорит в сцене',
        evidence: {
          quote: `Герой${index}`,
          startOffset: laterOffset,
          endOffset: laterOffset + 6,
          chapterKey: 'act-1'
        },
        confidence: 0.99,
        data: {}
      }
    )
    entities.push({
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      entityKey: characterKey,
      entityKind: 'character',
      canonicalName: `Герой${index}`,
      aliases: [],
      resolutionStatus: 'confirmed',
      confidence: 0.99,
      evidenceIds: [earlyId, laterId],
      data: {
        observationCount: 2,
        firstEvidenceStartOffset: earlyOffset,
        lastEvidenceEndOffset: laterOffset + 6
      }
    })
    profiles.push({
      characterKey,
      name: `Герой${index}`,
      fullName: `Герой${index}`,
      aliases: [],
      identityEvidenceIds: [earlyId, laterId],
      firstAppearanceTextOffset: earlyOffset,
      warmupTextOffset: 0,
      role: null,
      age: null,
      gender: null,
      description: null,
      traits: [],
      personalitySnapshots: [],
      appearance: [],
      speechStyle: null,
      speechExamples: [],
      creative: { greeting: '', appearancePrompt: '', voice: '' }
    })
  }

  const result = assembleBookMarkupV3({
    snapshotId: '30000000-0000-4000-8000-000000000000',
    textLength,
    entities,
    observations,
    characterProfiles: profiles
  })

  assert.equal(auditCharacterAppearanceDistribution(result).status, 'clear')
  assert.deepEqual(
    result.characters.map(({ firstAppearanceTextOffset }) => firstAppearanceTextOffset),
    [5_000, 7_000, 9_000, 11_000, 13_000]
  )
  assert.deepEqual(
    result.characters.map(({ warmupTextOffset }) => warmupTextOffset),
    [3_000, 5_000, 7_000, 9_000, 11_000]
  )
})
