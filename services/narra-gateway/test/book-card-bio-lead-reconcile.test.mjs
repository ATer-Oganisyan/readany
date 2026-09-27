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

test('без общего начала биографии карточки не сливаются', () => {
  const cards = [
    card('a', 'Онегин', 'Евгений Онегин — столичный франт.'),
    card('b', 'Ленский', 'Владимир Ленский — юный поэт.')
  ]
  const result = reconcile(cards)
  assert.deepEqual(result.merges, [])
  assert.equal(result.cards.length, 2)
})

test('однословное имя получает полное имя из биографии', () => {
  // «Нолл» с биографией «Ричард Нолл — капитан» выходил в каталог как «Нолл».
  const result = reconcile([
    card('a', 'Онегин', 'Евгений Онегин — столичный франт.'),
    card('b', 'Военный', 'Военный — вербовщик, предлагающий службу.'),
    card('c', 'Катя', 'Катя — невеста Владимирского.')
  ])
  assert.deepEqual(result.renames.map(({ fromName, toName }) => [fromName, toName]), [
    ['Онегин', 'Евгений Онегин']
  ])
  const onegin = result.cards.find(({ characterKey }) => characterKey === 'a')
  assert.equal(onegin.name, 'Евгений Онегин')
  assert.ok(onegin.aliases.includes('Онегин'))
})

test('уменьшительное сливается с полным именем, когда роль в биографиях одна', () => {
  // «Прямо в воде?»: «Лав» и «Лаванда Браун» — один человек.
  const result = reconcile([
    card('a', 'Лав', 'Лав — пресс-секретарь Министерства магии, бывшая однокурсница Гермионы.', 18),
    card('b', 'Лаванда Браун', 'Лаванда Браун — пресс-секретарь Министерства магии, бывшая однокурсница Гермионы по Хогвартсу.', 50)
  ])
  assert.deepEqual(result.merges.map(({ fromName, toName }) => [fromName, toName]), [['Лав', 'Лаванда Браун']])
  assert.equal(result.cards.length, 1)
  assert.ok(result.cards[0].aliases.includes('Лав'))
})

test('начало имени без общей роли — не повод сливать', () => {
  const result = reconcile([
    card('a', 'Ник', 'Ник — водитель грузовика, возивший почту через перевал.'),
    card('b', 'Николай Барабанов', 'Николай Барабанов — подполковник, служивший в Кандагаре.')
  ])
  assert.deepEqual(result.merges, [])
})

test('уменьшительное, подходящее двоим, не сливается ни с кем', () => {
  const role = 'служит в охране базы и дежурит на воротах по ночам.'
  const result = reconcile([
    card('a', 'Ник', `Ник — ${role}`),
    card('b', 'Никита Орлов', `Никита Орлов — ${role}`),
    card('c', 'Николай Барабанов', `Николай Барабанов — ${role}`)
  ])
  assert.deepEqual(result.merges, [])
})

function gendered(characterKey, name, bio, gender, mentionCount = 10) {
  return { ...card(characterKey, name, bio, mentionCount), gender }
}

test('полное имя в скобках уводит карточку к её владельцу', () => {
  const result = reconcile([
    card('a', 'Скар', 'Скар (Скарлетт Йорк) — коллега Драко, готовит иск.', 74),
    card('b', 'Скарлетт Йорк', 'Скарлетт Йорк — управляющая круизным лайнером.', 495)
  ])
  assert.deepEqual(result.merges.map(({ fromName, toName }) => [fromName, toName]), [['Скар', 'Скарлетт Йорк']])
})

test('начало слова в общем начале биографии — тот же человек', () => {
  const result = reconcile([
    card('a', 'Алекс', 'Александра Стенли — финансовый директор Драко Малфоя.', 128),
    card('b', 'Александра Стенли', 'Александра Стенли — урождённая англичанка.', 49)
  ])
  assert.equal(result.cards.length, 1)
  assert.equal(result.cards[0].name, 'Александра Стенли')
  // Упоминания складываются: по ним список героев ранжируется.
  assert.equal(result.cards[0].mentionCount, 177)
})

test('имя без фамилии уходит к единственному полному носителю', () => {
  const result = reconcile([
    gendered('a', 'Судья', 'Судья — огромный лысый человек.', 'male', 419),
    gendered('b', 'Холден', 'Судья Холден — член отряда головорезов.', 'male', 11)
  ])
  assert.equal(result.cards.length, 1)
  assert.equal(result.cards[0].name, 'Судья Холден')
  assert.equal(result.cards[0].mentionCount, 430)
})

test('фамилия, которую носят двое, не решает ничего', () => {
  const result = reconcile([
    card('a', 'Браун', 'Браун — один из братьев.'),
    card('b', 'Дэвид Браун', 'Дэвид Браун — старший брат.'),
    card('c', 'Джон Браун', 'Джон Браун — младший брат.')
  ])
  assert.equal(result.cards.length, 3)
})

test('отец и дочь с общей фамилией не сливаются по фамилии', () => {
  const result = reconcile([
    gendered('a', 'Прайс', 'Прайс — отставной моряк.', 'male'),
    gendered('b', 'Фанни Прайс', 'Фанни Прайс — героиня, живущая у тётки.', 'female')
  ])
  assert.equal(result.cards.length, 2)
})

test('имя из нескольких слов получает порядок и отчество из биографии', () => {
  const result = reconcile([
    card('a', 'Родман Спенсер', 'Спенсер Родман Четвертый — представитель влиятельной семьи.'),
    card('b', 'Николай Барабанов', 'Николай Сергеевич Барабанов — подполковник.'),
    card('c', 'Светлана Беляева', 'Светлана — сотрудница иммиграционного контроля.')
  ])
  assert.deepEqual(result.renames.map(({ fromName, toName }) => [fromName, toName]), [
    ['Родман Спенсер', 'Спенсер Родман Четвертый'],
    ['Николай Барабанов', 'Николай Сергеевич Барабанов']
  ])
})

test('биография, которая сама называет второе имя, сводит две карточки в одну', () => {
  // «Кровавый меридиан»: судью книга зовёт «судья» четыреста раз и «Холден» —
  // одиннадцать. Остаётся карточка, собранная по большему числу цитат.
  const judge = reconcile([
    gendered('s', 'Судья', 'Судья — громадный лысый человек.', 'male', 419),
    gendered('h', 'Холден', 'Холден, известный как судья, — один из головорезов.', 'male', 11)
  ])
  assert.deepEqual(judge.cards.map(({ characterKey, name, mentionCount }) => [characterKey, name, mentionCount]), [
    ['s', 'Судья Холден', 430]
  ])
  // Карточка, описывающая того, чьё имя стоит в начале, уходит к нему.
  const davy = reconcile([
    gendered('d', 'Дэйви', 'Дэвид Браун, которого товарищи называют Дэйви, — член отряда.', 'male', 7),
    gendered('b', 'Дэвид Браун', 'Дэвид Браун — один из братьев Браун.', 'male', 103)
  ])
  assert.deepEqual(davy.cards.map(({ name }) => name), ['Дэвид Браун'])
})

test('полное имя в скобках становится именем карточки', () => {
  const result = reconcile([card('w', 'Уэбстер', 'Уэбстер (Маркус Уэбстер) — разведчик отряда.', 21)])
  assert.equal(result.cards[0].name, 'Маркус Уэбстер')
})
