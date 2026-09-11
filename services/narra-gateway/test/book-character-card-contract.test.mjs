import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHARACTER_CARD_CONTRACT_VERSION,
  MAX_CARD_TRAITS,
  characterCardProjection,
  validateCharacterCard
} from '../analysis/book-character-card-contract.mjs'

const HASH = 'a'.repeat(64)

function fragment(id, startOffset, endOffset, characterKey = 'char:elizabeth-bennet') {
  return { fragmentId: id, characterKey, startOffset, endOffset }
}

function card(overrides = {}) {
  return {
    contractVersion: CHARACTER_CARD_CONTRACT_VERSION,
    characterKey: 'char:elizabeth-bennet',
    name: 'Элизабет',
    fullName: 'Элизабет Беннет',
    aliases: ['Лиззи', 'мисс Беннет'],
    firstMentionTextOffset: 8_132,
    cardWindow: { startOffset: 0, endOffset: 61_240, chapterIndexes: [0, 1] },
    mentionCount: 2_476,
    mentionCountInWindow: 214,
    traits: [
      { value: 'наблюдательная', fragmentIds: ['frag:a'], confidence: 0.9 },
      { value: 'независимая', fragmentIds: ['frag:b'] },
      { value: 'острая на язык', fragmentIds: ['frag:a', 'frag:c'] }
    ],
    bio: { value: 'Вторая из пяти дочерей семьи Беннет.', fragmentIds: ['frag:a'] },
    locations: [{ value: 'Лонгборн', fragmentIds: ['frag:b'] }],
    appearancePrompt: 'тёмные живые глаза, простое платье',
    gender: 'female',
    age: 'около двадцати',
    source: {
      normalizedTextHash: `sha256:${HASH}`,
      inventoryVersion: 'name-inventory-v1',
      fragmentSetHash: HASH,
      promptVersion: 'character-card-prompt-v1'
    },
    createdAt: '2026-09-09T10:00:00Z',
    ...overrides
  }
}

const FRAGMENTS = [
  fragment('frag:a', 1_000, 1_400),
  fragment('frag:b', 20_000, 20_500),
  fragment('frag:c', 60_000, 61_000)
]

test('a well-formed card validates and normalizes its claims', () => {
  const validated = validateCharacterCard(card(), { fragments: FRAGMENTS })
  assert.equal(validated.characterKey, 'char:elizabeth-bennet')
  assert.deepEqual(validated.traits[2].fragmentIds, ['frag:a', 'frag:c'])
  assert.equal(validated.traits[0].confidence, 0.9)
  assert.equal(validated.referencedFragmentCount, 3)
})

test('a fragment outside the card window is rejected — this is the spoiler barrier', () => {
  assert.throws(
    () => validateCharacterCard(card(), {
      fragments: [...FRAGMENTS.slice(0, 2), fragment('frag:c', 90_000, 90_500)]
    }),
    { code: 'CHARACTER_CARD_INVALID', message: /outside the card window/ }
  )
})

test('a fragment belonging to another character is rejected', () => {
  assert.throws(
    () => validateCharacterCard(card(), {
      fragments: [
        ...FRAGMENTS.slice(0, 2),
        fragment('frag:c', 60_000, 61_000, 'char:jane-bennet')
      ]
    }),
    { code: 'CHARACTER_CARD_INVALID', message: /belongs to char:jane-bennet/ }
  )
})

test('a claim referencing an unknown fragment is rejected', () => {
  assert.throws(
    () => validateCharacterCard(card(), { fragments: FRAGMENTS.slice(0, 2) }),
    { code: 'CHARACTER_CARD_INVALID', message: /unknown fragment frag:c/ }
  )
})

test('an unsupported claim is rejected: a fact with no fragments is what cards exist to avoid', () => {
  assert.throws(
    () => validateCharacterCard(
      card({ bio: { value: 'Она вышла замуж за Дарси.', fragmentIds: [] } }),
      { fragments: FRAGMENTS }
    ),
    { code: 'CHARACTER_CARD_INVALID', message: /at least one fragment/ }
  )
})

test('the trait ceiling is enforced and there is deliberately no floor', () => {
  const many = Array.from({ length: MAX_CARD_TRAITS + 1 }, (_, index) =>
    ({ value: `черта ${index}`, fragmentIds: ['frag:a'] }))
  assert.throws(() => validateCharacterCard(card({ traits: many })), {
    code: 'CHARACTER_CARD_INVALID',
    message: /exceeds 6 entries/
  })
  // Аудит устойчивости черт состязателен и вправе снять все заявленные черты.
  // Нижняя граница превратила бы строгую проверку в отказ выдать карточку, а
  // карточка с био и пустым «Характером» полезнее отсутствующей.
  const none = validateCharacterCard(card({ traits: [] }), { fragments: FRAGMENTS })
  assert.deepEqual(none.traits, [])
  assert.ok(none.bio.value)
  const one = validateCharacterCard(
    card({ traits: [{ value: 'наблюдательная', fragmentIds: ['frag:a'] }] }),
    { fragments: FRAGMENTS }
  )
  assert.equal(one.traits.length, 1)
})

test('role is optional but must be grounded when present', () => {
  const withRole = validateCharacterCard(
    card({ role: { value: 'вторая из пяти дочерей', fragmentIds: ['frag:a'] } }),
    { fragments: FRAGMENTS }
  )
  assert.equal(withRole.role.value, 'вторая из пяти дочерей')
  assert.equal(validateCharacterCard(card(), { fragments: FRAGMENTS }).role, null)
  assert.throws(
    () => validateCharacterCard(card({ role: { value: 'выдумка', fragmentIds: [] } })),
    { code: 'CHARACTER_CARD_INVALID', message: /at least one fragment/ }
  )
  assert.throws(
    () => validateCharacterCard(
      card({ role: { value: 'выдумка', fragmentIds: ['frag:elsewhere'] } }),
      { fragments: FRAGMENTS }
    ),
    { code: 'CHARACTER_CARD_INVALID', message: /unknown fragment/ }
  )
})

test('the greeting is creative and carries no fragment references', () => {
  const validated = validateCharacterCard(
    card({ greeting: 'Здравствуйте. Я Элизабет.' }),
    { fragments: FRAGMENTS }
  )
  assert.equal(validated.greeting, 'Здравствуйте. Я Элизабет.')
  assert.equal(characterCardProjection(validated).greeting, 'Здравствуйте. Я Элизабет.')
  assert.equal(validateCharacterCard(card(), { fragments: FRAGMENTS }).greeting, '')
})

test('the contract version, gender, hashes and timestamp are all checked', () => {
  assert.throws(() => validateCharacterCard(card({ contractVersion: 'character-card-v2' })), {
    code: 'CHARACTER_CARD_INVALID'
  })
  assert.throws(() => validateCharacterCard(card({ gender: 'other' })), {
    code: 'CHARACTER_CARD_INVALID',
    message: /card\.gender/
  })
  assert.throws(() => validateCharacterCard(card({ createdAt: 'вчера' })), {
    code: 'CHARACTER_CARD_INVALID',
    message: /ISO-8601/
  })
  assert.throws(
    () => validateCharacterCard(card({
      source: { ...card().source, fragmentSetHash: 'not-a-hash' }
    })),
    { code: 'CHARACTER_CARD_INVALID', message: /SHA-256/ }
  )
})

test('a first mention past the window end is rejected', () => {
  assert.throws(() => validateCharacterCard(card({ firstMentionTextOffset: 70_000 })), {
    code: 'CHARACTER_CARD_INVALID',
    message: /inside the card window/
  })
})

test('in-window mentions cannot exceed the whole-book count', () => {
  assert.throws(
    () => validateCharacterCard(card({ mentionCount: 10, mentionCountInWindow: 11 })),
    { code: 'CHARACTER_CARD_INVALID', message: /must not exceed mentionCount/ }
  )
})

test('the projection keeps the field names the reader already renders', () => {
  const validated = validateCharacterCard(card(), { fragments: FRAGMENTS })
  const projection = characterCardProjection(validated)
  assert.equal(projection.description, 'Вторая из пяти дочерей семьи Беннет.')
  assert.deepEqual(projection.traits, ['наблюдательная', 'независимая', 'острая на язык'])
  assert.equal(projection.firstAppearanceTextOffset, 8_132)
  assert.equal(projection.cardStatus, 'ready')
  assert.equal(characterCardProjection(validated, { cardStatus: 'pending' }).cardStatus, 'pending')
  assert.throws(() => characterCardProjection(validated, { cardStatus: 'draft' }), {
    code: 'CHARACTER_CARD_INVALID'
  })
})

test('without a fragment set the card is still structurally validated', () => {
  const validated = validateCharacterCard(card())
  assert.equal(validated.referencedFragmentCount, undefined)
  assert.equal(validated.bio.value, 'Вторая из пяти дочерей семьи Беннет.')
})
