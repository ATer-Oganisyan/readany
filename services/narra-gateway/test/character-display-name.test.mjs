import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCharacterDisplayName } from '../character-display-name.mjs'

test('character display names capitalize every lowercase word start', () => {
  assert.equal(formatCharacterDisplayName('анна каренина'), 'Анна Каренина')
  assert.equal(
    formatCharacterDisplayName('родион романович раскольников'),
    'Родион Романович Раскольников'
  )
  assert.equal(formatCharacterDisplayName('жан-вальжан'), 'Жан-Вальжан')
  assert.equal(formatCharacterDisplayName("o'connor"), "O'Connor")
  assert.equal(formatCharacterDisplayName('а. с. пушкин'), 'А. С. Пушкин')
})

test('character display names normalize spacing without destroying existing casing', () => {
  assert.equal(formatCharacterDisplayName('  mcDonald\tиВАНОВ  '), 'McDonald ИВАНОВ')
  assert.equal(formatCharacterDisplayName('МАРИЯ'), 'МАРИЯ')
  assert.equal(formatCharacterDisplayName(null), '')
})
