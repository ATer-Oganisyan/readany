import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractMarkupCharacters,
  loadPersonalityFixture,
  scoreFrozenPersonality
} from '../evaluation/score-frozen-personality.mjs'

function profile(character, traits, overrides = {}) {
  return {
    characterKey: `character:${character.id}`,
    name: character.name,
    fullName: character.name,
    aliases: character.aliases,
    gender: { value: 'female', evidenceIds: ['evidence-1'], confidence: 1 },
    traits: traits.map((value) => ({ value, evidenceIds: ['evidence-1'], confidence: 1 })),
    description: { value: `${character.name} description`, evidenceIds: ['evidence-1'], confidence: 1 },
    creative: { voice: 'Che', greeting: 'Hello.', appearancePrompt: '' },
    firstAppearanceTextOffset: 100,
    warmupTextOffset: 0,
    ...overrides
  }
}

test('personality scorer accepts canonical publication and operator JSON shapes', () => {
  const character = { name: 'Anna', data: { traits: [] } }
  assert.deepEqual(extractMarkupCharacters({ characters: [character] }), [{ name: 'Anna', traits: [] }])
  assert.deepEqual(
    extractMarkupCharacters({ canonicalMarkupVersions: [{ characters: [character] }] }),
    [{ name: 'Anna', traits: [] }]
  )
})

test('perfect frozen personality output passes every automatic gate', async () => {
  const fixture = await loadPersonalityFixture()
  const characters = fixture.characters.map((character) => profile(
    character,
    character.traits.map(({ accepted }) => accepted[0])
  ))
  const result = scoreFrozenPersonality({ fixture, input: { characters } })
  assert.deepEqual(result.metrics.micro, { precision: 1, recall: 1, f1: 1 })
  assert.deepEqual(result.metrics.coverage, {
    traits: 1,
    description: 1,
    uiCoreReady: 1,
    voiceGenderConsistency: 1
  })
  assert.equal(result.metrics.contradictionRate, 0)
  assert.equal(result.gate.passed, true)
})

test('scorer unions aliases, deduplicates traits and exposes contradictions', async () => {
  const fixture = await loadPersonalityFixture()
  const wickham = fixture.characters.find(({ id }) => id === 'PP/4')
  const first = profile(wickham, ['mercenary', 'principled'], {
    name: 'Mr. Wickham', fullName: 'Mr. Wickham', aliases: []
  })
  const second = profile(wickham, ['mercenary'], {
    characterKey: 'character:wickham-duplicate',
    name: 'George Wickham', fullName: 'George Wickham', aliases: []
  })
  const result = scoreFrozenPersonality({ fixture, input: { characters: [first, second] } })
  const score = result.characters.find(({ id }) => id === 'PP/4')
  assert.equal(score.rowCount, 2)
  assert.equal(score.predictionCount, 2)
  assert.deepEqual(score.matches.map(({ trait }) => trait.label), ['money-focused'])
  assert.deepEqual(score.contradictions, ['principled'])
  assert.equal(result.observed.contradictionCount, 1)
  assert.equal(result.gate.passed, false)
})

test('unknown gender with a gendered voice fails UI consistency', async () => {
  const fixture = await loadPersonalityFixture()
  const darcy = fixture.characters[0]
  const row = profile(darcy, ['reserved'], {
    gender: null,
    creative: { voice: 'She', greeting: 'Hello.', appearancePrompt: '' }
  })
  const result = scoreFrozenPersonality({ fixture, input: { characters: [row] } })
  const score = result.characters.find(({ id }) => id === darcy.id)
  assert.equal(score.coverage.voiceGenderConsistent, false)
})
