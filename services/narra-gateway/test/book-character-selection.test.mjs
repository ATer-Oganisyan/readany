import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleBookMarkupV3 } from '../book-analysis-assembler.mjs'
import {
  BOOK_CHARACTER_SELECTION_VERSION,
  MAX_PUBLISHED_BOOK_CHARACTERS,
  rankBookCharacterEntities,
  selectedBookCharacterEntities
} from '../book-character-selection.mjs'

function observation(id, type, startOffset) {
  return {
    id,
    type,
    evidence: {
      startOffset,
      endOffset: startOffset + 5
    }
  }
}

function character(index, evidenceIds) {
  return {
    entityKey: `character:${String(index).padStart(2, '0')}`,
    entityKind: 'character',
    canonicalName: `Character ${index}`,
    aliases: [],
    resolutionStatus: 'confirmed',
    confidence: 0.9,
    evidenceIds,
    data: {
      observationCount: evidenceIds.length,
      firstEvidenceStartOffset: index * 1_000,
      lastEvidenceEndOffset: index * 1_000 + 5
    }
  }
}

test('character selection publishes only the 20 most frequently mentioned characters', () => {
  const observations = []
  const entities = []
  for (let index = 1; index <= 23; index += 1) {
    const mentionId = `mention-${index}`
    observations.push(observation(mentionId, 'character_mention', index * 1_000))
    entities.push(character(index, [mentionId]))
  }
  observations.push(
    observation('mention-23-b', 'character_mention', 23_100),
    observation('mention-23-duplicate', 'character_mention', 23_100),
    observation('action-23', 'character_action', 23_200),
    observation('mention-22-b', 'character_mention', 22_100)
  )
  entities[22].evidenceIds.push('mention-23-b', 'mention-23-duplicate', 'action-23')
  entities[21].evidenceIds.push('mention-22-b')

  const ranked = rankBookCharacterEntities({ entities, observations })

  assert.equal(ranked.selection.version, BOOK_CHARACTER_SELECTION_VERSION)
  assert.equal(ranked.selection.limit, MAX_PUBLISHED_BOOK_CHARACTERS)
  assert.equal(ranked.selectedCharacters.length, 20)
  assert.deepEqual(ranked.selection.characterKeys.slice(0, 2), [
    'character:23',
    'character:22'
  ])
  assert.equal(ranked.selectedCharacters[0].data.mentionCount, 2)
  assert.equal(ranked.selectedCharacters[0].data.evidenceCount, 3)
  assert.equal(ranked.selectedCharacters[0].data.prominenceRank, 1)
  assert.equal(ranked.selectedCharacters[0].data.selectedForPublication, true)
  assert.deepEqual(
    ranked.rankedCharacters.slice(-3).map(({ entityKey }) => entityKey),
    ['character:19', 'character:20', 'character:21']
  )
  assert.equal(
    ranked.entities.find(({ entityKey }) => entityKey === 'character:20')
      .data.selectedForPublication,
    false
  )
})

test('selection helper preserves the frozen rank and falls back for legacy snapshots', () => {
  const explicit = [
    character(1, ['one']),
    character(2, ['two']),
    character(3, ['three'])
  ]
  assert.deepEqual(
    selectedBookCharacterEntities(explicit, {
      version: BOOK_CHARACTER_SELECTION_VERSION,
      limit: 2,
      characterKeys: ['character:03', 'character:01']
    }).map(({ entityKey }) => entityKey),
    ['character:03', 'character:01']
  )

  const legacy = explicit.map((entity, index) => ({
    ...entity,
    data: {
      ...entity.data,
      observationCount: [2, 7, 4][index]
    }
  }))
  assert.deepEqual(
    selectedBookCharacterEntities(legacy, null, { limit: 2 })
      .map(({ entityKey }) => entityKey),
    ['character:02', 'character:03']
  )
})

test('book assembly publishes the selected frequency order without profiles for omitted characters', () => {
  const observations = []
  const entities = []
  for (let index = 1; index <= 22; index += 1) {
    const id = `mention-${index}`
    observations.push(observation(id, 'character_mention', index * 100))
    entities.push(character(index, [id]))
  }
  observations.push(observation('mention-22-b', 'character_mention', 2_250))
  entities[21].evidenceIds.push('mention-22-b')
  const ranked = rankBookCharacterEntities({ entities, observations })
  const characterProfiles = ranked.selectedCharacters.map((entity) => ({
    characterKey: entity.entityKey,
    name: entity.entityKey,
    fullName: entity.entityKey,
    aliases: [],
    identityEvidenceIds: entity.evidenceIds,
    firstAppearanceTextOffset: entity.data.firstEvidenceStartOffset,
    warmupTextOffset: 0,
    role: null,
    age: null,
    gender: null,
    description: null,
    traits: [],
    appearance: [],
    speechStyle: null,
    speechExamples: [],
    creative: {}
  }))

  const markup = assembleBookMarkupV3({
    snapshotId: 'snapshot-1',
    textLength: 30_000,
    entities: ranked.entities,
    observations,
    characterProfiles,
    characterSelection: ranked.selection
  })

  assert.equal(markup.characters.length, 20)
  assert.deepEqual(
    markup.characters.map(({ characterKey }) => characterKey),
    ranked.selection.characterKeys
  )
  assert.equal(markup.characters.some(({ characterKey }) => characterKey === 'character:20'), false)
})
