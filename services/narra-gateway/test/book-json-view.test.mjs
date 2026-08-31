import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractBookJsonCharacters,
  summarizeBookJson
} from '../operator-ui/book-json-view.js'

test('book JSON view reads canonical operator payload without changing the API shape', () => {
  const input = {
    canonicalMarkupVersions: [{
      characters: [{
        characterKey: 'character:anna',
        firstAppearanceTextOffset: 100,
        warmupTextOffset: 0,
        data: {
          name: 'Анна',
          fullName: 'Анна',
          aliases: [],
          gender: null,
          traits: [],
          description: null,
          appearance: [],
          speechExamples: [],
          speechStyle: null,
          creative: { voice: 'Erm', greeting: 'Здравствуйте.' }
        }
      }]
    }]
  }
  const characters = extractBookJsonCharacters(input)
  assert.equal(characters.length, 1)
  assert.equal(characters[0].name, 'Анна')
  assert.equal(Object.hasOwn(characters[0], 'data'), false)
  const summary = summarizeBookJson(input)
  assert.equal(summary.fields.identity, 1)
  assert.equal(summary.fields.timeline, 1)
  assert.equal(summary.fields.voiceGenderConsistency, 1)
  assert.equal(summary.fields.traits, 0)
})

test('book JSON view flags a gendered voice when gender is unknown', () => {
  const summary = summarizeBookJson({ characters: [{
    characterKey: 'character:anna', name: 'Анна', fullName: 'Анна', aliases: [],
    gender: null, traits: [], description: null, appearance: [], speechExamples: [],
    speechStyle: null, creative: { voice: 'Che', greeting: 'Здравствуйте.' },
    firstAppearanceTextOffset: 100, warmupTextOffset: 0
  }] })
  assert.equal(summary.fields.voiceGenderConsistency, 0)
})
