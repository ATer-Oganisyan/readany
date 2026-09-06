import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBookAnalysisEntities } from '../book-analysis-resolver.mjs'
import { normalizeBookAnalysisCharacterProfile } from '../book-analysis-contracts.mjs'
import { assembleBookMarkupV3 } from '../book-analysis-assembler.mjs'

function fixture() {
  const text = 'Анна всегда была честной. Лев всегда был терпеливым. Анна и Лев — сестра и брат.'
  const rows = [
    ['character_trait', 'character', 'Анна', 'Анна всегда была честной.'],
    ['character_trait', 'character', 'Лев', 'Лев всегда был терпеливым.'],
    ['relationship', 'relationship', 'Анна и Лев', 'Анна и Лев — сестра и брат.']
  ]
  const observations = rows.map(([type, entityKind, entityCandidate, quote], index) => ({
    id: `11111111-1111-4111-8111-11111111111${index}`,
    observationKey: `observation-${index}`,
    type, entityKind, entityCandidate, relatedEntityCandidates: [], fact: quote,
    evidence: {
      quote, startOffset: text.indexOf(quote), endOffset: text.indexOf(quote) + quote.length,
      chapterKey: 'document'
    },
    confidence: 0.99, data: {}
  }))
  const entities = resolveBookAnalysisEntities({ observations })
  const relation = entities.find(entity => entity.entityKind === 'relationship')
  assert.equal(relation.resolutionStatus, 'confirmed')
  assert.equal(relation.data.relatedCharacterEntityKeys.length, 2)
  const characterProfiles = entities
    .filter(entity => entity.entityKind === 'character' && entity.resolutionStatus === 'confirmed')
    .map(entity => normalizeBookAnalysisCharacterProfile({ creative: {} }, { entity, textLength: text.length }))
  assert.equal(characterProfiles.length, 2)
  return { relation, input: {
    snapshotId: 'snapshot-fixture', textLength: text.length, entities, observations, characterProfiles
  } }
}

test('assembly preserves relationship participants already recovered by the resolver', () => {
  const { relation, input } = fixture()
  const markup = assembleBookMarkupV3(input)
  assert.equal(markup.relationships.length, 1, 'resolved sibling relationship must not disappear on publication')
  assert.deepEqual(new Set([
    markup.relationships[0].sourceCharacterKey, markup.relationships[0].targetCharacterKey
  ]), new Set(relation.data.relatedCharacterEntityKeys))
})

test('recovered participants do not create dangling references to unselected characters', () => {
  const { input } = fixture()
  input.characterSelection = { characterKeys: [input.characterProfiles[0].characterKey] }
  const markup = assembleBookMarkupV3(input)
  assert.equal(markup.characters.length, 1)
  assert.deepEqual(markup.relationships, [])
})

test('explicit participant order survives recovery and duplicate resolved keys', () => {
  const { relation, input } = fixture()
  const characters = input.entities.filter(entity => entity.entityKind === 'character')
  input.observations[2].relatedEntityCandidates = characters.map(entity => entity.canonicalName).reverse()
  relation.data.relatedCharacterEntityKeys.push(...relation.data.relatedCharacterEntityKeys)
  const markup = assembleBookMarkupV3(input)
  assert.equal(markup.relationships.length, 1)
  assert.equal(markup.relationships[0].sourceCharacterKey, characters[1].entityKey)
  assert.equal(markup.relationships[0].targetCharacterKey, characters[0].entityKey)
})

test('rejected relationships are not resurrected by recovered participants', () => {
  const { relation, input } = fixture()
  relation.resolutionStatus = 'rejected'
  assert.deepEqual(assembleBookMarkupV3(input).relationships, [])
})
