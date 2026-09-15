import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cardSceneGapChars,
  characterCardMessages,
  filterStableTraits,
  normalizeCharacterCardRequest,
  normalizeCharacterCardResult
} from '../generation/internal-generation-contracts.mjs'
import { characterCardIdempotencyKey } from '../analysis/book-character-card.mjs'

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
  return { idempotencyKey: characterCardIdempotencyKey(body), ...body }
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

test('the audit says what it removed and why', () => {
  // Раньше снятия были не видны: `droppedTraitCount` считал только
  // необоснованные ссылки, и две итерации правки промпта шли против фильтра,
  // вывод которого нельзя было прочитать.
  const normalized = normalizeCharacterCardRequest(request())
  const result = normalizeCharacterCardResult({
    bio: { value: 'Elizabeth lives at Longbourn.', fragmentIds: ['frag:char:elizabeth:0'] },
    traits: [
      { value: 'kind', fragmentIds: ['frag:char:elizabeth:0'], confidence: 0.9 },
      { value: 'beautiful', fragmentIds: ['frag:char:elizabeth:1', 'frag:char:elizabeth:2'], confidence: 0.9 },
      { value: 'kind and honest', fragmentIds: ['frag:char:elizabeth:1', 'frag:char:elizabeth:2'], confidence: 0.9 }
    ],
    gender: 'female'
  }, normalized)

  assert.deepEqual(result.card.traits, [])
  assert.deepEqual(result.traitRejections, {
    single_scene: 1,
    not_a_trait: 1,
    two_traits_in_one: 1
  })
})

test('the card audit keeps up to MAX_TRAITS, not a hidden four', () => {
  // Промпт обещает модели MAX_TRAITS=6, контракт карточки допускает 6, а срез
  // в `filterStableTraits` оставлял 4 — и все сильные карточки Верна встали
  // ровно на 4, то есть решал потолок, а не доказательства.
  const fragments = Array.from({ length: 14 }, (_, index) =>
    fragment(index, `Elizabeth showed her quality number ${index} again.`, index * 3_000))
  const normalized = normalizeCharacterCardRequest(request({ fragments }))
  const values = ['observant', 'loyal', 'brave', 'patient', 'curious', 'stubborn', 'generous']
  const result = normalizeCharacterCardResult({
    bio: { value: 'Elizabeth lives at Longbourn.', fragmentIds: [fragments[0].id] },
    traits: values.map((value, index) => ({
      value,
      fragmentIds: [fragments[index].id, fragments[index + 7].id],
      confidence: 0.9
    })),
    gender: 'female'
  }, normalized)

  assert.equal(result.card.traits.length, 6)
  assert.equal(result.traitRejections.over_cap, 1)
})

test('a hedged confidence survives on the card path and dies on the profile path', () => {
  // На карточке уверенность выставляет тот же вызов, который сделал
  // утверждение: независимого свидетельства в ней нет. У профиля она приходит
  // из отдельного вызова-аудита, и там порог остаётся.
  const normalized = normalizeCharacterCardRequest(request())
  const result = normalizeCharacterCardResult({
    bio: { value: 'Elizabeth lives at Longbourn.', fragmentIds: ['frag:char:elizabeth:0'] },
    traits: [{
      value: 'observant',
      fragmentIds: ['frag:char:elizabeth:1', 'frag:char:elizabeth:2'],
      confidence: 0.62
    }],
    gender: 'female'
  }, normalized)
  assert.deepEqual(result.card.traits.map(({ value }) => value), ['observant'])

  // Цитаты обязаны различаться: аудит считает сценой место книги, а два
  // дословно одинаковых абзаца — одно место, не два.
  const evidenceById = new Map([
    ['frag:char:elizabeth:1', 'Elizabeth observed that the guest was watching her.'],
    ['frag:char:elizabeth:2', 'Elizabeth observed the same habit again and said nothing.']
  ].map(([id, quote], index) => [id, {
    id,
    type: 'character_action',
    fact: '',
    quote,
    startOffset: index * 40_000,
    confidence: 1
  }]))
  const profileClaims = [{
    value: 'observant',
    evidenceIds: [...evidenceById.keys()],
    confidence: 0.62
  }]
  assert.deepEqual(filterStableTraits(profileClaims, evidenceById, 100_000), [])
  assert.deepEqual(
    filterStableTraits(profileClaims, evidenceById, 100_000, { minConfidence: 0 }),
    profileClaims
  )
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

test('приветствие обращено к читателю, а не к герою книги', () => {
  // Пока промпт не говорил, кто собеседник, модель заполняла пропуск сама: в
  // «Драко Малфой и мучительное испытание любовью» Драко приветствовал читателя
  // как Грейнджер, а Тонкс — как Малфоя. Приветствие писалось репликой внутри
  // сюжета, обращённой к другому герою.
  const system = characterCardMessages(normalizeCharacterCardRequest(request()))[0].content
  assert.match(system, /Приветствие обращено к читателю, а не к герою книги/)
  assert.match(system, /не называй собеседника по имени/)
  assert.match(system, /не приписывай ему общего с тобой прошлого/)
})

/**
 * Ключ идемпотентности несёт набор цитат.
 *
 * Отбор цитат равномерный по окну и с запасом по байтам: достаточно появиться
 * одному новому фрагменту, чтобы выборка при повторе задания сдвинулась. Пока
 * набор в ключ не входил, кеш отвечал на такой повтор 409 «этот ключ уже занят
 * другим запросом» — и вылечить это повторами было нельзя никогда: на каталоге
 * так осталось 36 карточек, то есть 36 персонажей без карточки вовсе.
 */
test('a different set of quotes is a different request, not a conflict', () => {
  const base = request()
  const fewer = request({ fragments: base.fragments.slice(0, 2) })
  assert.notEqual(base.idempotencyKey, fewer.idempotencyKey)
  // Оба запроса при этом остаются валидными: контракт считает ключ так же.
  assert.equal(normalizeCharacterCardRequest(base).fragments.length, 3)
  assert.equal(normalizeCharacterCardRequest(fewer).fragments.length, 2)
})

test('the same set of quotes keeps the same key whatever their order', () => {
  // Иначе повтор того же задания платил бы за модель второй раз.
  const base = request()
  const shuffled = request({ fragments: [...base.fragments].reverse() })
  assert.equal(base.idempotencyKey, shuffled.idempotencyKey)
})

test('window and revision stay part of the key', () => {
  const base = request()
  assert.notEqual(
    base.idempotencyKey,
    request({ cardWindow: { ...WINDOW, startOffset: 12_000 } }).idempotencyKey
  )
  assert.notEqual(base.idempotencyKey, request({ cardRevision: 2 }).idempotencyKey)
})
