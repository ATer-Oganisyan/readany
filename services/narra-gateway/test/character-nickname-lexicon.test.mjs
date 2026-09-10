import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NICKNAME_LEXICON_GROUPS,
  NICKNAME_LEXICON_VERSION,
  nicknameCandidatePairs,
  nicknameGenderForSurface,
  nicknameGroupsForSurface
} from '../analysis/character-nickname-lexicon.mjs'

test('the lexicon links an English diminutive to its canonical name', () => {
  assert.ok(nicknameGroupsForSurface('Kitty').includes('en:catherine'))
  assert.ok(nicknameGroupsForSurface('Lizzy').includes('en:elizabeth'))
  assert.ok(nicknameGroupsForSurface('Jo').includes('en:josephine') === false)
  assert.ok(nicknameGroupsForSurface('Josie').includes('en:josephine'))
})

test('Russian diminutives are found through their case forms', () => {
  assert.deepEqual(nicknameGroupsForSurface('Родя'), ['ru:родион'])
  assert.deepEqual(nicknameGroupsForSurface('Лизе'), ['ru:елизавета'])
  assert.deepEqual(nicknameGroupsForSurface('Танечку'), ['ru:татьяна'])
})

test('a diminutive shared by two canonical names yields both groups and no gender', () => {
  assert.deepEqual(nicknameGroupsForSurface('Женя'), ['ru:евгений', 'ru:евгения'])
  assert.equal(nicknameGenderForSurface('Женя'), null)
  assert.deepEqual(nicknameGroupsForSurface('Саша'), ['ru:александр', 'ru:александра'])
  assert.equal(nicknameGenderForSurface('Саша'), null)
  assert.equal(nicknameGenderForSurface('Таня'), 'female')
  assert.equal(nicknameGenderForSurface('Родя'), 'male')
})

test('a multi-word name is matched through its own tokens', () => {
  assert.ok(nicknameGroupsForSurface('Lizzy Bennet').includes('en:elizabeth'))
  assert.deepEqual(nicknameGroupsForSurface('Mock Turtle'), [])
})

test('candidate pairs link Kitty to Catherine without merging them', () => {
  const pairs = nicknameCandidatePairs([
    { key: 'a', names: ['Kitty'] },
    { key: 'b', names: ['Catherine'] },
    { key: 'c', names: ['Mock Turtle'] }
  ])
  assert.equal(pairs.length, 1)
  assert.deepEqual(
    { leftKey: pairs[0].leftKey, rightKey: pairs[0].rightKey, basis: pairs[0].basis },
    { leftKey: 'a', rightKey: 'b', basis: 'nickname_lexicon' }
  )
  assert.equal(pairs[0].canonical, 'catherine')
})

test('pairs already visible to token overlap are not duplicated by the lexicon', () => {
  // «Catherine Bennet» и «Elizabeth Bennet» связаны общим токеном фамилии, и
  // это правило перекрытия уже видит; лексикон здесь молчит.
  const pairs = nicknameCandidatePairs([
    { key: 'a', names: ['Catherine Bennet'] },
    { key: 'b', names: ['Elizabeth Bennet'] }
  ])
  assert.deepEqual(pairs, [])
})

test('pairs are stable and deduplicated regardless of input order', () => {
  const forward = nicknameCandidatePairs([
    { key: 'x', names: ['Eliza'] },
    { key: 'y', names: ['Lizzy'] },
    { key: 'z', names: ['Beth'] }
  ])
  const backward = nicknameCandidatePairs([
    { key: 'z', names: ['Beth'] },
    { key: 'y', names: ['Lizzy'] },
    { key: 'x', names: ['Eliza'] }
  ])
  assert.deepEqual(forward, backward)
  assert.equal(forward.length, 3)
})

test('every lexicon group declares a canonical name, a language and unique surfaces', () => {
  assert.equal(NICKNAME_LEXICON_VERSION, 'nickname-lexicon-v1')
  const ids = new Set()
  for (const group of NICKNAME_LEXICON_GROUPS) {
    assert.match(group.groupId, /^(?:ru|en):\p{L}+$/u)
    assert.ok(!ids.has(group.groupId), `дубль группы: ${group.groupId}`)
    ids.add(group.groupId)
    assert.ok(['male', 'female'].includes(group.gender))
    assert.equal(new Set(group.surfaces).size, group.surfaces.length)
    assert.equal(group.surfaces[0], group.canonical)
  }
})

test('an unknown name produces no groups and no pairs', () => {
  assert.deepEqual(nicknameGroupsForSurface('Гленарван'), [])
  assert.deepEqual(nicknameGroupsForSurface(''), [])
  assert.deepEqual(nicknameCandidatePairs([]), [])
  assert.deepEqual(nicknameCandidatePairs(null), [])
})
