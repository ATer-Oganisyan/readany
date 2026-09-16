/**
 * Карточки, чья биография начинается одним и тем же именем, — это один человек,
 * названный по-разному. Проверяем, что сливаются именно они, а родня под общей
 * фамилией остаётся врозь.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileCardsByBioLead } from '../analysis/book-card-markup-projection.mjs'

function card(characterKey, name, bio, mentionCount = 10, aliases = []) {
  return { characterKey, name, fullName: name, aliases, mentionCount, bio: { value: bio, fragmentIds: [] } }
}

function reconcile(cards) {
  const fragmentsByCharacter = new Map(cards.map((item) => [item.characterKey, [`frag:${item.characterKey}`]]))
  return reconcileCardsByBioLead({ cards, fragmentsByCharacter })
}

test('короткое имя уходит к полному, названному в биографии', () => {
  const result = reconcile([
    card('a', 'Роберт', 'Роберт Паглиньо — друг детства рассказчика.', 43),
    card('b', 'Роберт Паглиньо', 'Роберт Паглиньо — лучший друг рассказчика.', 55)
  ])
  assert.deepEqual(result.merges.map((item) => [item.fromName, item.toName]), [['Роберт', 'Роберт Паглиньо']])
  assert.deepEqual(result.cards.map((item) => item.name), ['Роберт Паглиньо'])
  assert.ok(result.cards[0].aliases.includes('Роберт'))
})

test('фрагменты поглощённой карточки достаются оставшейся', () => {
  const result = reconcile([
    card('a', 'Аякс', 'Аякс Теламонид, один из сильнейших воинов ахейцев.'),
    card('b', 'Аякс Теламонид', 'Аякс Теламонид, сын Теламона.')
  ])
  assert.deepEqual(result.fragmentsByCharacter.get('b'), ['frag:b', 'frag:a'])
  assert.equal(result.fragmentsByCharacter.has('a'), false)
})

test('муж и жена под общей фамилией не сливаются', () => {
  const result = reconcile([
    card('a', 'Крылов', 'Лизавета Сергеевна Крылова — жена помещика Крылова.'),
    card('b', 'Лизавета Сергеевна', 'Лизавета Сергеевна Крылова — жена помещика Крылова.')
  ])
  assert.deepEqual(result.merges, [])
  assert.equal(result.cards.length, 2)
})

test('отец и дочь не сливаются: обращение не входит в названное имя', () => {
  const result = reconcile([
    card('a', 'Mr Price', 'Fanny Price is the eldest daughter of the Price family.'),
    card('b', 'Fanny Price', 'Fanny Price is the heroine sent to Mansfield Park.')
  ])
  assert.deepEqual(result.merges, [])
})

test('сёстры с одинаковым описанием роли не сливаются', () => {
  const result = reconcile([
    card('a', 'Anne Thorpe', 'Anne Thorpe is the second Miss Thorpe.'),
    card('b', 'Maria Thorpe', 'Maria Thorpe is the second Miss Thorpe.')
  ])
  assert.deepEqual(result.merges, [])
})

test('остаётся карточка, которую биография называет, а не самая частая', () => {
  const result = reconcile([
    card('a', 'Долгорукий', 'Аркадий Макарович Долгорукий — рассказчик.', 400),
    card('b', 'Аркадий Макарович Долгорукий', 'Аркадий Макарович Долгорукий — подросток.', 30)
  ])
  assert.deepEqual(result.cards.map((item) => item.name), ['Аркадий Макарович Долгорукий'])
})

test('прозвище уходит к полному имени через свои же псевдонимы', () => {
  const result = reconcile([
    card('a', 'Роберт', 'Роберт Паглиньо — лучший друг рассказчика со школьных лет.', 30, ['Роберт Паглиньо']),
    card('b', 'Паг', 'Роберт Паглиньо — школьный друг рассказчика.', 24, ['Паг', 'Роберт Паглиньо']),
    card('c', 'Паглиньо', 'Роберт Паглиньо — единственный друг рассказчика.', 18, ['Роберт Паглиньо'])
  ])
  assert.equal(result.cards.length, 1)
  assert.equal(result.cards[0].name, 'Роберт Паглиньо')
  assert.deepEqual(result.merges.map((item) => item.fromName).sort(), ['Паг', 'Паглиньо'])
  assert.ok(['Паг', 'Паглиньо', 'Роберт'].every((name) => result.cards[0].aliases.includes(name)))
})

test('оставшийся получает имя из биографии, когда так не звали никого', () => {
  const result = reconcile([
    card('a', 'Аркадий', 'Аркадий Макарович Долгорукий — рассказчик.', 200),
    card('b', 'Долгорукий', 'Аркадий Макарович Долгорукий — подросток.', 90)
  ])
  assert.equal(result.cards.length, 1)
  assert.equal(result.cards[0].name, 'Аркадий Макарович Долгорукий')
  assert.equal(result.cards[0].fullName, 'Аркадий Макарович Долгорукий')
  assert.deepEqual(result.cards[0].aliases, ['Аркадий', 'Долгорукий'])
})

test('без общего начала биографии карточки не трогаются', () => {
  const cards = [
    card('a', 'Онегин', 'Евгений Онегин — столичный франт.'),
    card('b', 'Ленский', 'Владимир Ленский — юный поэт.')
  ]
  const result = reconcile(cards)
  assert.deepEqual(result.merges, [])
  assert.equal(result.cards, cards)
})
