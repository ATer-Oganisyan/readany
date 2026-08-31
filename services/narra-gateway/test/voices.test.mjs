import assert from 'node:assert/strict'
import test from 'node:test'
import { voiceForGender } from '../voices.mjs'

test('unknown character gender always gets the unspecified fallback voice', () => {
  assert.equal(voiceForGender('She', null), 'Erm')
  assert.equal(voiceForGender('Che', undefined), 'Erm')
  assert.equal(voiceForGender('Ast', 'unspecified'), 'Erm')
  assert.equal(voiceForGender('unsupported', ''), 'Erm')
})

test('known character gender keeps only a compatible supported voice', () => {
  assert.equal(voiceForGender('Ast', 'male'), 'Ast')
  assert.equal(voiceForGender('Ste', 'female'), 'Ste')
  assert.equal(voiceForGender('Che', 'male'), 'She')
  assert.equal(voiceForGender('She', 'female'), 'Che')
})
