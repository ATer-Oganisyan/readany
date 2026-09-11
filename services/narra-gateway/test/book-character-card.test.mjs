import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_CARD_REQUEST_BYTES,
  buildCharacterCardRequest,
  characterCardFragmentSetHash,
  extractiveCardBio,
  finalizeCharacterCard
} from '../analysis/book-character-card.mjs'
import { CHARACTER_CARD_PROMPT_VERSION } from '../analysis/book-character-card-contract.mjs'

const WINDOW = { startOffset: 0, endOffset: 60_000, chapterIndexes: [0, 1] }
const HASH = 'a'.repeat(64)

function fragment(index, quote, startOffset = index * 1_000) {
  return {
    fragmentId: `frag:char:elizabeth:${index}`,
    characterKey: 'char:elizabeth',
    paragraphIndex: index,
    chapterIndex: 0,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
    mentionOffsets: [startOffset]
  }
}

const FRAGMENTS = [
  fragment(0, 'Элизабет Беннет жила в Лонгборне с четырьмя сёстрами.'),
  fragment(1, 'Элизабет заметила, что гость наблюдает за нею внимательно.'),
  fragment(2, 'Элизабет снова заметила эту привычку и промолчала.', 40_000)
]

function request(overrides = {}) {
  return buildCharacterCardRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    characterKey: 'char:elizabeth',
    character: {
      canonicalName: 'Элизабет',
      names: ['Элизабет', 'Лиззи'],
      mentionCount: 2_476,
      firstMentionTextOffset: 0
    },
    window: WINDOW,
    fragments: FRAGMENTS,
    title: 'Гордость и предубеждение',
    author: 'Джейн Остин',
    normalizedTextHash: HASH,
    inventoryVersion: 'name-inventory-v1',
    ...overrides
  })
}

function modelCard(overrides = {}) {
  return {
    name: 'Элизабет',
    fullName: 'Элизабет Беннет',
    aliases: ['Лиззи'],
    role: { value: 'вторая из пяти дочерей семьи Беннет', fragmentIds: ['frag:char:elizabeth:0'] },
    bio: { value: 'Элизабет живёт в Лонгборне с сёстрами.', fragmentIds: ['frag:char:elizabeth:0'] },
    traits: [{
      value: 'наблюдательная',
      fragmentIds: ['frag:char:elizabeth:1', 'frag:char:elizabeth:2'],
      confidence: 0.9
    }],
    locations: [{ value: 'Лонгборн', fragmentIds: ['frag:char:elizabeth:0'] }],
    appearancePrompt: 'тёмные живые глаза',
    gender: 'female',
    age: 'около двадцати',
    greeting: 'Здравствуйте. Я Элизабет.',
    ...overrides
  }
}

test('the request carries the window, the prompt version and the fragments', () => {
  const built = request()
  assert.equal(built.promptVersion, CHARACTER_CARD_PROMPT_VERSION)
  assert.deepEqual(built.cardWindow, WINDOW)
  assert.equal(built.fragments.length, 3)
  assert.equal(built.character.name, 'Элизабет')
  assert.ok(Buffer.byteLength(JSON.stringify(built)) <= MAX_CARD_REQUEST_BYTES)
})

test('a fragment outside the window is refused before the call, not after', () => {
  assert.throws(
    () => request({ fragments: [...FRAGMENTS, fragment(9, 'Позже.', 70_000)] }),
    { code: 'CARD_FRAGMENT_OUT_OF_WINDOW' }
  )
})

test('a fragment belonging to another character is refused', () => {
  assert.throws(
    () => request({
      fragments: [{ ...FRAGMENTS[0], characterKey: 'char:jane' }]
    }),
    { code: 'CARD_FRAGMENT_FOREIGN' }
  )
})

test('a character with no fragments produces no request', () => {
  assert.throws(() => request({ fragments: [] }), { code: 'CARD_FRAGMENTS_MISSING' })
})

test('the request budget caps fragments without dropping the earliest', () => {
  const many = Array.from({ length: 400 }, (_, index) =>
    fragment(index, `Элизабет сделала шаг номер ${index}.`, index * 100))
  const built = buildCharacterCardRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    characterKey: 'char:elizabeth',
    character: { canonicalName: 'Элизабет', names: ['Элизабет'] },
    window: WINDOW,
    fragments: many,
    title: 'Книга',
    normalizedTextHash: HASH,
    maxFragments: 20
  })
  assert.equal(built.fragments.length, 20)
  assert.equal(built.fragments[0].id, 'frag:char:elizabeth:0')
  assert.ok(built.fragments.at(-1).startOffset > built.fragments[0].startOffset)
})

test('the finalized card validates and records what the audit did', () => {
  const built = request()
  const finalized = finalizeCharacterCard({
    input: built,
    result: { card: modelCard() },
    fragments: FRAGMENTS,
    createdAt: '2026-09-10T10:00:00Z'
  })
  assert.equal(finalized.card.characterKey, 'char:elizabeth')
  assert.equal(finalized.card.bio.value, 'Элизабет живёт в Лонгборне с сёстрами.')
  assert.equal(finalized.card.role.value, 'вторая из пяти дочерей семьи Беннет')
  assert.deepEqual(finalized.card.traits.map(({ value }) => value), ['наблюдательная'])
  assert.equal(finalized.card.source.fragmentSetHash, finalized.fragmentSetHash)
  assert.equal(finalized.card.source.promptVersion, CHARACTER_CARD_PROMPT_VERSION)
  assert.equal(finalized.audit.bioSource, 'model')
  assert.equal(finalized.audit.roleAccepted, true)
  assert.equal(finalized.audit.citedFragmentCount, 3)
})

test('a claim citing a fragment that was not in the request is dropped whole', () => {
  const built = request()
  const finalized = finalizeCharacterCard({
    input: built,
    result: {
      card: modelCard({
        traits: [
          { value: 'наблюдательная', fragmentIds: ['frag:char:elizabeth:1'], confidence: 0.9 },
          { value: 'придуманная', fragmentIds: ['frag:not-in-request'], confidence: 0.9 }
        ],
        locations: [{ value: 'Пемберли', fragmentIds: ['frag:elsewhere'] }],
        role: { value: 'выдумка', fragmentIds: ['frag:elsewhere'] }
      })
    },
    fragments: FRAGMENTS,
    createdAt: '2026-09-10T10:00:00Z'
  })
  assert.deepEqual(finalized.card.traits.map(({ value }) => value), ['наблюдательная'])
  assert.deepEqual(finalized.card.locations, [])
  assert.equal(finalized.card.role, null)
  assert.equal(finalized.audit.droppedTraitCount, 1)
  assert.equal(finalized.audit.droppedLocationCount, 1)
  assert.equal(finalized.audit.roleAccepted, false)
})

test('a claim mixing a valid and an invalid fragment is not silently repaired', () => {
  const built = request()
  const finalized = finalizeCharacterCard({
    input: built,
    result: {
      card: modelCard({
        traits: [{
          value: 'наблюдательная',
          fragmentIds: ['frag:char:elizabeth:1', 'frag:elsewhere'],
          confidence: 0.9
        }]
      })
    },
    fragments: FRAGMENTS,
    createdAt: '2026-09-10T10:00:00Z'
  })
  assert.deepEqual(finalized.card.traits, [])
})

test('an empty bio falls back to whole sentences from the fragments', () => {
  const built = request()
  const finalized = finalizeCharacterCard({
    input: built,
    result: { card: modelCard({ bio: null }) },
    fragments: FRAGMENTS,
    createdAt: '2026-09-10T10:00:00Z'
  })
  assert.equal(finalized.audit.bioSource, 'extractive')
  assert.match(finalized.card.bio.value, /^Элизабет Беннет жила в Лонгборне/)
  for (const fragmentId of finalized.card.bio.fragmentIds) {
    assert.ok(FRAGMENTS.some((item) => item.fragmentId === fragmentId))
  }
})

test('a card with no defensible trait is still a card', () => {
  // Аудит вправе снять все черты; отказ выдать карточку был бы худшим исходом,
  // чем карточка с био и пустым «Характером».
  const built = request()
  const finalized = finalizeCharacterCard({
    input: built,
    result: { card: modelCard({ traits: [] }) },
    fragments: FRAGMENTS,
    createdAt: '2026-09-10T10:00:00Z'
  })
  assert.deepEqual(finalized.card.traits, [])
  assert.ok(finalized.card.bio.value)
})

test('a card with neither a bio nor usable fragment sentences fails the job', () => {
  const short = [{ ...fragment(0, 'Э.'), quote: 'Э.' }]
  const built = buildCharacterCardRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    characterKey: 'char:elizabeth',
    character: { canonicalName: 'Элизабет', names: ['Элизабет'] },
    window: WINDOW,
    fragments: short,
    title: 'Книга',
    normalizedTextHash: HASH
  })
  assert.throws(
    () => finalizeCharacterCard({
      input: built,
      result: { card: modelCard({ bio: null, traits: [], locations: [], role: null }) },
      fragments: short,
      createdAt: '2026-09-10T10:00:00Z'
    }),
    { code: 'CARD_BIO_MISSING' }
  )
})

test('the extractive bio prefers a sentence that actually names the character', () => {
  const fragments = [{
    fragmentId: 'frag:a',
    startOffset: 0,
    quote: 'Введение обсуждает нравы эпохи и её литературу. Элизабет Беннет — вторая дочь в семье.'
  }]
  const named = extractiveCardBio(fragments, { names: ['Элизабет', 'Беннет'] })
  assert.match(named.value, /^Элизабет Беннет/)
  const unnamed = extractiveCardBio(fragments)
  assert.match(unnamed.value, /^Введение/)
})

test('the extractive bio skips a truncated sentence', () => {
  const result = extractiveCardBio(
    [{ fragmentId: 'frag:a', startOffset: 0, quote: 'Элизабет шла по' }],
    { names: ['Элизабет'] }
  )
  assert.equal(result, null)
})

test('the fragment set hash depends on coordinates and not on order', () => {
  const forward = characterCardFragmentSetHash(FRAGMENTS)
  const backward = characterCardFragmentSetHash([...FRAGMENTS].reverse())
  assert.equal(forward, backward)
  assert.match(forward, /^[0-9a-f]{64}$/)
  const moved = characterCardFragmentSetHash([
    { ...FRAGMENTS[0], startOffset: 5 },
    ...FRAGMENTS.slice(1)
  ])
  assert.notEqual(forward, moved)
})

test('finalization refuses a window with no fragments at all', () => {
  const built = request()
  assert.throws(
    () => finalizeCharacterCard({
      input: built,
      result: { card: modelCard() },
      fragments: [],
      createdAt: '2026-09-10T10:00:00Z'
    }),
    { code: 'CARD_FRAGMENTS_MISSING' }
  )
})
