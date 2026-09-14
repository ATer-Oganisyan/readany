/**
 * Рассказчик книги от первого лица.
 *
 * Пороги здесь не выбраны, а измерены на одиннадцати живых книгах: доля
 * повествовательных абзацев с «я» у книг от первого лица — 0.62 и 0.71, у книг
 * от третьего — от 0.014 до 0.22. Тест держит обе стороны этой границы и то,
 * ради чего она нужна: рассказчика, которого по имени зовут поздно.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { bookNarrationPerson, firstPersonMentionAt } from '../analysis/book-narration.mjs'
import { buildBookTextIndex } from '../analysis/book-text-index.mjs'
import { buildBookNameInventory, inventoryRoster } from '../analysis/book-name-inventory.mjs'
import { collectBookCharacterFragments } from '../analysis/book-character-fragments.mjs'

/**
 * Книга от первого лица: рассказчик говорит «я», а по имени его называет только
 * собеседник, и только во второй половине.
 */
function firstPersonBook() {
  const opening = Array.from({ length: 120 }, (_, index) =>
    `Я снова проигрался в тот вечер и не жалел об этом ни минуты, номер ${index}.`)
  // Обращений столько же по порядку, сколько в настоящем «Игроке»: имя
  // рассказчика звучит часто, но всегда из чужих уст и всегда внутри реплики.
  const middle = Array.from({ length: 14 }, (_, index) => [
    `— Алексей Иванович, вы опять были за столом? — спросила Полина, ${index}.`,
    'Полина смотрела на меня с упрёком, и я молчал.',
    'Полина Александровна вышла, а я остался считать свои деньги.'
  ]).flat()
  return [...opening, ...middle].join('\n\n')
}

/** Та же книга, но от третьего лица: «я» звучит только в репликах. */
function thirdPersonBook() {
  const opening = Array.from({ length: 120 }, (_, index) =>
    `Алексей снова проигрался в тот вечер и не жалел об этом, номер ${index}.`)
  const middle = [
    '— Я больше не могу, — сказала Полина.',
    'Полина смотрела на Алексея с упрёком, и он молчал.',
    '— Я ухожу, — сказала Полина.'
  ]
  return [...opening, ...middle].join('\n\n')
}

test('повествование от первого лица отличается от третьего по абзацам вне реплик', () => {
  const first = firstPersonBook()
  const third = thirdPersonBook()
  const firstShare = bookNarrationPerson(first, buildBookTextIndex(first, { navigation: null }))
  const thirdShare = bookNarrationPerson(third, buildBookTextIndex(third, { navigation: null }))

  assert.ok(firstShare.firstPersonShare > 0.45, `первое лицо: ${firstShare.firstPersonShare}`)
  // В книге от третьего лица «я» есть, но только внутри реплик, а они не в счёт.
  assert.ok(thirdShare.firstPersonShare < 0.1, `третье лицо: ${thirdShare.firstPersonShare}`)
})

test('рассказчик попадает в значимый ярус, хотя по имени его зовут редко', () => {
  const inventory = buildBookNameInventory({ text: firstPersonBook() })
  const narrator = inventory.candidates.find(({ narrator: flag }) => flag)

  assert.ok(narrator, 'рассказчик не распознан')
  assert.equal(narrator.displayName, 'Алексей Иванович')
  assert.equal(narrator.tier, 'significant')
  assert.equal(inventory.narration.firstPerson, true)
  // Появляется он там, где заговорил, а не там, где его впервые назвали: окно
  // карточек набирает состав по этому полю, и замок читателя считается по нему
  // же. Пока оно указывало на первое называние, главный герой был недоступен
  // читателю до четверти книги.
  assert.ok(
    narrator.firstMentionTextOffset < 200,
    `рассказчик появляется поздно: ${narrator.firstMentionTextOffset}`
  )
  assert.equal(inventory.narration.firstPersonStartOffset >= 0, true)
  // Полина названа чаще и вне реплик — рассказчиком её считать нельзя.
  const polina = inventory.candidates.find(({ displayName }) => displayName.startsWith('Полина'))
  assert.ok(polina)
  assert.notEqual(polina.narrator, true)
  // Рассказчик в книге ровно один: признак «зовут только в репликах» сам по
  // себе не единственен, и на «Игроке» под него попадают ещё двое.
  assert.equal(inventory.candidates.filter(({ narrator: flag }) => flag).length, 1)
})

test('рассказчик не выносит состав за потолок', () => {
  // Он добавлялся в значимые в обход потолка: inventoryRoster отдавал на
  // одного больше, чем cap, а rosterCount врал. Потребители считают по этим
  // числам размер вызова подтверждения состава.
  const inventory = buildBookNameInventory({ text: firstPersonBook(), cap: 2 })
  const roster = inventoryRoster(inventory)
  assert.ok(roster.length <= 2, `состав превысил потолок: ${roster.length}`)
  assert.equal(inventory.thresholds.rosterCount, roster.length)
  assert.equal(
    inventory.thresholds.minorCount,
    inventory.candidates.filter(({ tier }) => tier === 'minor').length
  )
})

test('книга от третьего лица рассказчика не заводит', () => {
  const inventory = buildBookNameInventory({ text: thirdPersonBook() })
  assert.equal(inventory.narration.firstPerson, false)
  assert.equal(inventory.candidates.some(({ narrator }) => narrator), false)
})

test('свидетельства рассказчика начинаются с первой страницы, а не с первого называния', () => {
  // Карточка подтверждается цитатами. Пока ими были только упоминания имени,
  // подтвердить рассказчика в начале книги было нечем — и персонаж без единой
  // цитаты выпадал молча.
  const text = firstPersonBook()
  const characters = [{ characterKey: 'name:aleksey', names: ['Алексей Иванович'] }]
  const withoutNarrator = collectBookCharacterFragments({ text, characters })
  const withNarrator = collectBookCharacterFragments({
    text,
    characters,
    narratorKey: 'name:aleksey'
  })

  const byName = withoutNarrator.characters[0].fragments
  const byVoice = withNarrator.characters[0].fragments
  assert.ok(byVoice.length > byName.length)
  // Первая цитата по имени — уже в середине книги, по голосу — на первой строке.
  assert.ok(byName[0].startOffset > 1_000, `по имени: ${byName[0].startOffset}`)
  assert.equal(byVoice[0].startOffset, 0)
  assert.match(byVoice[0].quote, /Я снова проигрался/)
})

test('голос рассказчика не вытесняет из выборки его имя', () => {
  // Голос цитируется всей книгой, имя — десятком абзацев. Пока выборка не
  // различала их, на трёх тысячах абзацев из двухсот сорока отобранных имя
  // оставалось ровно в одном: модель почти не видела ни имени, ни обращений,
  // ни признаков пола, а mentionCount переставал быть счётчиком упоминаний.
  const voice = Array.from({ length: 900 }, (_, index) =>
    `Я шёл дальше и считал свои шаги, ${index}.`)
  const named = Array.from({ length: 12 }, (_, index) =>
    `— Алексей Иванович, вы опять здесь? — спросила Полина, ${index}.`)
  const text = [...voice, ...named].join('\n\n')
  const [character] = collectBookCharacterFragments({
    text,
    characters: [{ characterKey: 'name:aleksey', names: ['Алексей Иванович'] }],
    narratorKey: 'name:aleksey',
    maxFragmentsPerCharacter: 40
  }).characters

  const withName = character.fragments.filter(({ quote }) => quote.includes('Алексей Иванович'))
  assert.equal(withName.length, 12, 'именные абзацы вытеснены голосом')
  assert.equal(character.fragments.length, 40)
  // Счётчик упоминаний считает имя, а не голос: иначе он перестаёт значить то,
  // что значит у всех остальных персонажей.
  assert.equal(character.mentionCount, 12)
  // Выборка идёт по тексту подряд, а не голосом после имени.
  const offsets = character.fragments.map(({ startOffset }) => startOffset)
  assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right))
})

test('в репликах «я» принадлежит говорящему, а не рассказчику', () => {
  const text = [
    'Я шёл по набережной и думал о деньгах.',
    '— Я больше не дам вам ни гульдена, — сказала Полина.'
  ].join('\n\n')
  const result = collectBookCharacterFragments({
    text,
    characters: [{ characterKey: 'name:aleksey', names: ['Алексей Иванович'] }],
    narratorKey: 'name:aleksey'
  })
  assert.equal(result.characters[0].fragments.length, 1)
  assert.match(result.characters[0].fragments[0].quote, /набережной/)
})

test('первое «я» абзаца находится по слову, а не по подстроке', () => {
  assert.equal(firstPersonMentionAt('Мясо и ямы'), -1)
  assert.equal(firstPersonMentionAt('Потом я ушёл'), 6)
  assert.equal(firstPersonMentionAt('Меня не звали'), 0)
})
