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
import { buildBookNameInventory } from '../analysis/book-name-inventory.mjs'
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
  // Полина названа чаще и вне реплик — рассказчиком её считать нельзя.
  const polina = inventory.candidates.find(({ displayName }) => displayName.startsWith('Полина'))
  assert.ok(polina)
  assert.notEqual(polina.narrator, true)
  // Рассказчик в книге ровно один: признак «зовут только в репликах» сам по
  // себе не единственен, и на «Игроке» под него попадают ещё двое.
  assert.equal(inventory.candidates.filter(({ narrator: flag }) => flag).length, 1)
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
