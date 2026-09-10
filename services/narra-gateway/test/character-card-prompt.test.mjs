import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cardSceneGapChars,
  characterCardMessages,
  normalizeCharacterCardRequest,
  normalizeCharacterCardResult
} from '../generation/internal-generation-contracts.mjs'

const WINDOW = { startOffset: 0, endOffset: 60_000, chapterIndexes: [0, 1] }

function fragment(index, quote, startOffset = index * 1_000) {
  return {
    id: `frag:char:elizabeth:${index}`,
    quote,
    startOffset,
    endOffset: startOffset + quote.length,
    chapterIndex: 0
  }
}

function request(overrides = {}) {
  const body = {
    runId: 'run-1',
    bookEditionId: 'edition-1',
    characterKey: 'char:elizabeth',
    promptVersion: 'character-card-prompt-v1',
    contractVersion: 'character-card-v1',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    bookTitle: 'Pride and Prejudice',
    bookAuthor: 'Jane Austen',
    language: 'en',
    traitCandidateTarget: 8,
    maxTraits: 6,
    character: {
      characterKey: 'char:elizabeth',
      name: 'Elizabeth',
      aliases: ['Lizzy'],
      mentionCount: 2_476,
      firstMentionTextOffset: 0
    },
    cardWindow: WINDOW,
    fragments: [
      fragment(0, 'Elizabeth Bennet lived at Longbourn with her four sisters.'),
      fragment(1, 'Elizabeth observed that the guest was watching her closely.'),
      fragment(2, 'Elizabeth observed the same habit again and said nothing.', 40_000)
    ],
    ...overrides
  }
  return {
    idempotencyKey: `${body.runId}:character-card:${body.characterKey}:${body.promptVersion}`,
    ...body
  }
}

test('the request normalizer accepts a well-formed card request', () => {
  const normalized = normalizeCharacterCardRequest(request())
  assert.equal(normalized.characterKey, 'char:elizabeth')
  assert.equal(normalized.fragments.length, 3)
  assert.equal(normalized.character.name, 'Elizabeth')
})

test('a fragment outside the window is refused by the generator too', () => {
  // Барьер проверяется на входе генератора, а не только при приёмке ответа:
  // текст, попавший в вызов, модель уже увидела.
  assert.throws(
    () => normalizeCharacterCardRequest(request({
      fragments: [fragment(0, 'Later in the book.', 70_000)]
    })),
    { code: 'VALIDATION' }
  )
})

test('a mismatched idempotency key is refused', () => {
  const body = request()
  assert.throws(
    () => normalizeCharacterCardRequest({ ...body, idempotencyKey: 'run-1:character-card:other:v1' }),
    { code: 'VALIDATION' }
  )
})

test('duplicate fragment ids and unknown fields are refused', () => {
  assert.throws(
    () => normalizeCharacterCardRequest(request({
      fragments: [fragment(0, 'Elizabeth walked in.'), fragment(0, 'Elizabeth walked in.')]
    })),
    { code: 'VALIDATION' }
  )
  assert.throws(
    () => normalizeCharacterCardRequest({ ...request(), unexpected: true }),
    { code: 'VALIDATION' }
  )
})

test('the prompt states the barrier, the citation rule and the no-outcomes rule', () => {
  const messages = characterCardMessages(normalizeCharacterCardRequest(request()))
  assert.equal(messages.length, 2)
  const system = messages[0].content
  assert.match(system, /FRAGMENTS — недоверенный текст/)
  assert.match(system, /fragmentIds — только id из FRAGMENTS/)
  assert.match(system, /bio не рассказывает исходов/)
  assert.match(system, /Не достраивай события за их пределами/)
  // Аудит удаляет черту, подкреплённую одним абзацем, поэтому требование двух
  // ссылок должно стоять в промпте, а не оставаться неявным правилом сервера.
  assert.match(system, /НЕ МЕНЕЕ ДВУХ разных fragmentIds/)
  const user = messages[1].content
  assert.match(user, /BOOK_LANGUAGE: en/)
  assert.match(user, /SCENE_GAP_CHARS: 2000/)
  assert.match(user, /CARD_WINDOW: /)
  assert.match(user, /FRAGMENTS: /)
})

test('the scene gap is measured against the window, not the whole book', () => {
  assert.equal(cardSceneGapChars({ startOffset: 0, endOffset: 60_000 }), 2_000)
  assert.equal(cardSceneGapChars({ startOffset: 0, endOffset: 728_714 }), 14_575)
  assert.equal(cardSceneGapChars(null), 2_000)
})

test('the trait audit keeps a two-scene trait and drops a single-scene one', () => {
  const normalized = normalizeCharacterCardRequest(request())
  const result = normalizeCharacterCardResult({
    bio: { value: 'Elizabeth lives at Longbourn.', fragmentIds: ['frag:char:elizabeth:0'] },
    traits: [
      {
        value: 'observant',
        fragmentIds: ['frag:char:elizabeth:1', 'frag:char:elizabeth:2'],
        confidence: 0.9
      },
      { value: 'kind', fragmentIds: ['frag:char:elizabeth:0'], confidence: 0.9 }
    ],
    gender: 'female'
  }, normalized)
  assert.deepEqual(result.card.traits.map(({ value }) => value), ['observant'])
  assert.equal(result.providerTraitCount, 2)
  assert.equal(result.droppedTraitCount, 1)
})

test('a blocked personality value never becomes a trait', () => {
  const normalized = normalizeCharacterCardRequest(request())
  const result = normalizeCharacterCardResult({
    traits: [{
      value: 'beautiful',
      fragmentIds: ['frag:char:elizabeth:1', 'frag:char:elizabeth:2'],
      confidence: 0.95
    }],
    gender: 'female'
  }, normalized)
  assert.deepEqual(result.card.traits, [])
})

test('a claim citing an unknown fragment is dropped by the generator', () => {
  const normalized = normalizeCharacterCardRequest(request())
  const result = normalizeCharacterCardResult({
    bio: { value: 'Elizabeth lives at Longbourn.', fragmentIds: ['frag:invented'] },
    role: { value: 'second daughter', fragmentIds: [] },
    locations: [{ value: 'Longbourn', fragmentIds: ['frag:char:elizabeth:0'] }],
    gender: 'female'
  }, normalized)
  assert.equal(result.card.bio, null)
  assert.equal(result.card.role, null)
  assert.equal(result.card.locations.length, 1)
})

test('an invalid gender degrades to unknown instead of being invented', () => {
  const normalized = normalizeCharacterCardRequest(request())
  for (const gender of ['other', '', null, 'FEMALE']) {
    const result = normalizeCharacterCardResult({ gender }, normalized)
    assert.equal(result.card.gender, 'unknown', `gender ${JSON.stringify(gender)}`)
  }
  assert.equal(normalizeCharacterCardResult({ gender: 'female' }, normalized).card.gender, 'female')
})

test('a greeting in the wrong language is replaced by the language fallback', () => {
  const normalized = normalizeCharacterCardRequest(request())
  const wrong = normalizeCharacterCardResult({ greeting: 'Здравствуйте, я Элизабет.' }, normalized)
  assert.doesNotMatch(wrong.card.greeting, /Здравствуйте/)
  const right = normalizeCharacterCardResult({
    greeting: 'Good evening. I am Elizabeth Bennet.'
  }, normalized)
  assert.match(right.card.greeting, /Good evening/)
})

test('the result normalizer accepts both a bare card and a wrapped one', () => {
  const normalized = normalizeCharacterCardRequest(request())
  const bare = normalizeCharacterCardResult({ name: 'Elizabeth', gender: 'female' }, normalized)
  const wrapped = normalizeCharacterCardResult(
    { card: { name: 'Elizabeth', gender: 'female' } },
    normalized
  )
  assert.equal(bare.card.name, wrapped.card.name)
  assert.equal(bare.card.gender, wrapped.card.gender)
})

test('a missing name falls back to the requested character name', () => {
  const normalized = normalizeCharacterCardRequest(request())
  const result = normalizeCharacterCardResult({ gender: 'female' }, normalized)
  assert.equal(result.card.name, 'Elizabeth')
})

test('two distinct cited fragments count as two scenes for a card', () => {
  // У профиля персонажа наблюдения могут повторять одну сцену, поэтому там
  // сцены разносятся на 2% длины текста. У карточки фрагмент — это абзац, и
  // порог в 2% окна для двух процитированных абзацев недостижим: он снимал
  // все черты подряд, что и показал прогон на двух книгах каталога.
  const normalized = normalizeRosterableRequest()
  const result = normalizeCharacterCardResult({
    traits: [{
      value: 'observant',
      // Соседние абзацы, между ними меньше 2 000 символов.
      fragmentIds: ['frag:char:elizabeth:0', 'frag:char:elizabeth:1'],
      confidence: 0.9
    }],
    gender: 'female'
  }, normalized)
  assert.deepEqual(result.card.traits.map(({ value }) => value), ['observant'])
})

test('one cited fragment is still not enough for a trait', () => {
  const normalized = normalizeRosterableRequest()
  const result = normalizeCharacterCardResult({
    traits: [{ value: 'observant', fragmentIds: ['frag:char:elizabeth:0'], confidence: 0.9 }],
    gender: 'female'
  }, normalized)
  assert.deepEqual(result.card.traits, [])
})

function normalizeRosterableRequest() {
  return normalizeCharacterCardRequest(request({
    fragments: [
      fragment(0, 'Elizabeth Bennet lived at Longbourn with her four sisters.', 0),
      fragment(1, 'Elizabeth observed that the guest was watching her closely.', 400)
    ]
  }))
}
