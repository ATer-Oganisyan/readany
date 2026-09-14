import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ROSTER_CANDIDATES,
  NAME_INVENTORY_VERSION,
  buildBookNameInventory,
  inventoryRoster,
  inventorySignificant,
  nameClusterKey
} from '../analysis/book-name-inventory.mjs'

function paragraphs(...values) {
  return values.join('\n\n')
}

function candidate(inventory, displayName) {
  return inventory.candidates.find((item) => item.displayName === displayName)
}

test('Russian case forms of one surname collapse into a single candidate', () => {
  const inventory = buildBookNameInventory({
    text: paragraphs(
      'Раскольников вышел на улицу и остановился.',
      'У Раскольникова болела голова, сказал он тихо.',
      'Раскольникову было душно в этой комнате.',
      'Разумихин смотрел на Раскольникова и молчал.',
      'С Раскольниковым говорил Разумихин, и он ответил.'
    )
  })
  const raskolnikov = candidate(inventory, 'Раскольников')
  assert.ok(raskolnikov, 'Раскольников должен быть одним кандидатом')
  assert.equal(raskolnikov.count, 5)
  assert.ok(
    raskolnikov.surfaceForms.length >= 4,
    `ожидались падежные формы, получено ${JSON.stringify(raskolnikov.surfaceForms)}`
  )
  assert.equal(
    inventory.candidates.filter(({ displayName }) => displayName.startsWith('Раскольник')).length,
    1
  )
})

test('the instrumental case reaches its name even though one vowel is not enough', () => {
  // «Онегиным» не сводится к «онегин» отсечением гласного: нужен перебор
  // окончаний по весу основы, иначе получилось бы два кандидата.
  const inventory = buildBookNameInventory({
    text: paragraphs(
      'Онегин сказал, что уезжает.',
      'Онегина ждали в деревне, ответил сосед.',
      'С Онегиным спорил Ленский, сказал он.',
      'Онегину было скучно, заметил автор.'
    )
  })
  const onegin = candidate(inventory, 'Онегин')
  assert.ok(onegin, `ожидался кандидат «Онегин», есть ${JSON.stringify(inventory.candidates.map((item) => item.displayName))}`)
  assert.equal(onegin.count, 4)
})

test('adjectival surnames keep masculine and feminine apart', () => {
  assert.equal(nameClusterKey('ленский'), 'ленск:m')
  assert.equal(nameClusterKey('ленского'), 'ленск:m')
  assert.equal(nameClusterKey('ленским'), 'ленск:m')
  assert.equal(nameClusterKey('раневская'), 'раневск:f')
  assert.equal(nameClusterKey('раневскую'), 'раневск:f')
  assert.notEqual(nameClusterKey('вронский'), nameClusterKey('вронская'))
})

test('a surname shared by two honorifics becomes one candidate per person', () => {
  const text = paragraphs(
    ...Array.from({ length: 6 }, (_, index) =>
      `Mr. Bennet said nothing at all on the ${index} morning.`),
    ...Array.from({ length: 8 }, (_, index) =>
      `Mrs. Bennet replied that the ${index} visit was necessary.`),
    ...Array.from({ length: 5 }, (_, index) =>
      `Miss Bennet answered her mother on the ${index} evening.`)
  )
  const inventory = buildBookNameInventory({ text })
  const names = inventory.candidates.map(({ displayName }) => displayName)
  assert.ok(names.includes('Mr Bennet'), `нет «Mr Bennet»: ${JSON.stringify(names)}`)
  assert.ok(names.includes('Mrs Bennet'), `нет «Mrs Bennet»: ${JSON.stringify(names)}`)
  assert.ok(names.includes('Miss Bennet'), `нет «Miss Bennet»: ${JSON.stringify(names)}`)
  // Ни одна строка не заявляет одновременно обращение и голую фамилию: это
  // была бы склейка двух людей в одну идентичность.
  for (const item of inventory.candidates) {
    assert.ok(
      !(item.displayName.includes(' Bennet') && item.aliases.includes('Bennet')),
      `строка ${item.displayName} заявляет и «Bennet»`
    )
  }
})

test('a rare token that almost always precedes a frequent one becomes one full name', () => {
  const text = paragraphs(
    ...Array.from({ length: 9 }, (_, index) =>
      `The Mock Turtle sighed deeply and said nothing for the ${index} time.`),
    'Alice looked at the Mock Turtle and asked a question.'
  )
  const inventory = buildBookNameInventory({ text })
  const names = inventory.candidates.map(({ displayName }) => displayName)
  assert.ok(names.includes('Mock Turtle'), `нет «Mock Turtle»: ${JSON.stringify(names)}`)
})

test('a rare first name does not rename a surname that six people share', () => {
  const text = paragraphs(
    'Henry Dashwood died, and the estate passed on.',
    ...Array.from({ length: 12 }, (_, index) =>
      `Mrs. Dashwood answered that the ${index} plan suited nobody.`),
    ...Array.from({ length: 10 }, (_, index) =>
      `Miss Dashwood replied to her sister on the ${index} day.`)
  )
  const inventory = buildBookNameInventory({ text })
  const names = inventory.candidates.map(({ displayName }) => displayName)
  assert.ok(
    !names.includes('Henry Dashwood'),
    `редкое имя отца переименовало фамилию: ${JSON.stringify(names)}`
  )
})

test('sentence-initial-only words, roman numerals and calendar words are not names', () => {
  const inventory = buildBookNameInventory({
    text: paragraphs(
      'II',
      'Сегодня было холодно. Завтра будет теплее.',
      'Бог знает, что случится, сказал Ленский.',
      'Тогда Ленский ответил, что уезжает.',
      'Ленский сказал это ещё раз, и Ленский повторил.'
    )
  })
  const names = inventory.candidates.map(({ displayName }) => displayName)
  for (const rejected of ['II', 'Сегодня', 'Завтра', 'Бог', 'Тогда']) {
    assert.ok(!names.includes(rejected), `${rejected} не должен быть кандидатом: ${JSON.stringify(names)}`)
  }
  assert.ok(names.includes('Ленский'), `нет «Ленский»: ${JSON.stringify(names)}`)
})

test('a possessive form does not split its owner into a second candidate', () => {
  const inventory = buildBookNameInventory({
    text: paragraphs(
      'Dorian said nothing, and his silence lasted.',
      'Dorian’s portrait hung in the room, said the painter.',
      'Dorian replied that the portrait was his own.',
      'Basil asked Dorian about the picture again.'
    )
  })
  const names = inventory.candidates.map(({ displayName }) => displayName)
  assert.ok(!names.some((name) => name.includes('’')), `клитик не отрезан: ${JSON.stringify(names)}`)
  assert.ok(candidate(inventory, 'Dorian').count >= 4)
})

test('a place gets a place hint and stays out of the significant tier', () => {
  const inventory = buildBookNameInventory({
    text: paragraphs(
      'Патагония лежала перед ними.',
      ...Array.from({ length: 8 }, (_, index) =>
        `Экспедиция шла в Патагонию, и в Патагонии её ждали ${index} дней.`),
      ...Array.from({ length: 8 }, (_, index) =>
        `Гленарван сказал, что готов, и Гленарван повторил это ${index} раз.`)
    )
  })
  const patagonia = candidate(inventory, 'Патагония')
  assert.ok(patagonia, `нет кандидата-места: ${JSON.stringify(inventory.candidates.map((c) => c.displayName))}`)
  assert.equal(patagonia.kindHint, 'place')
  assert.equal(patagonia.tier === 'significant', false)
  const glenarvan = candidate(inventory, 'Гленарван')
  assert.equal(glenarvan.kindHint, 'person')
  assert.equal(glenarvan.tier, 'significant')
})

test('a family plural is marked as a group, not as a person', () => {
  const inventory = buildBookNameInventory({
    text: paragraphs(
      ...Array.from({ length: 10 }, (_, index) =>
        `Charlotte asked Lucas whether the ${index} evening was pleasant.`),
      'The Lucases came to dinner and said grace.',
      'Their neighbours replied that the Lucases were pleasant.'
    )
  })
  const plural = candidate(inventory, 'Lucases')
  assert.ok(plural, 'ожидался кандидат-множественное')
  assert.equal(plural.kindHint, 'group')
})

test('the roster tier is capped and the significant tier is a subset of it', () => {
  const text = paragraphs(...Array.from({ length: 400 }, (_, index) =>
    `Персонаж${index} сказал слово, и Персонаж${index} ответил снова.`))
  const inventory = buildBookNameInventory({ text, cap: 12 })
  assert.equal(inventory.inventoryVersion, NAME_INVENTORY_VERSION)
  const roster = inventoryRoster(inventory)
  const significant = inventorySignificant(inventory)
  assert.ok(roster.length <= 12, `roster превысил потолок: ${roster.length}`)
  assert.ok(significant.length <= roster.length)
  const rosterKeys = new Set(roster.map(({ candidateKey }) => candidateKey))
  for (const item of significant) assert.ok(rosterKeys.has(item.candidateKey))
  assert.ok(MAX_ROSTER_CANDIDATES > 12)
})

test('частый кандидат неясного типа не проигрывает потолок редким персонажам', () => {
  // Потолок выбирается по частоте и до всего остального. Пока его забирали
  // значимые, а ярус roster набирался из остатка, на книге со ста двадцатью
  // восемью персонажами остатка не оставалось вовсе: кандидат с 94
  // упоминаниями, чей тип счётчик не смог определить, проигрывал персонажу с
  // двенадцатью, не попадал в состав и не получал ни фрагментов, ни карточки.
  // Так пропал Ян ван Тох, герой, с которого начинается «Война с саламандрами».
  const speakers = ['Алексеев', 'Борисов', 'Волков', 'Громов', 'Дроздов', 'Егоров']
    .flatMap((name) => Array.from({ length: 5 }, () =>
      `— Здравствуйте, — сказал ${name}. — ${name} слушает.`))
  // Частое имя без речи рядом и без обращений: тип остаётся неясным.
  const frequent = Array.from({ length: 20 }, (_, index) =>
    `Вантох прошёл мимо, и Вантох не обернулся, потому что Вантох спешил, ${index}.`)
  const inventory = buildBookNameInventory({
    text: paragraphs(...speakers, ...frequent),
    cap: 4
  })

  const vantoh = inventory.candidates.find(({ displayName }) => displayName === 'Вантох')
  assert.ok(vantoh, 'частый кандидат исчез из инвентаря')
  assert.equal(vantoh.kindHint, 'unknown')
  assert.ok(vantoh.count > 12, `упоминаний мало: ${vantoh.count}`)
  assert.notEqual(vantoh.tier, 'minor')
  // Ярус roster и есть отобранный по частоте потолок: в нём не может быть
  // кандидата, менее частого, чем оставшийся за бортом.
  const roster = inventoryRoster(inventory)
  assert.ok(roster.length <= 4)
  const minorMax = Math.max(0, ...inventory.candidates
    .filter(({ tier }) => tier === 'minor').map(({ count }) => count))
  const rosterMin = Math.min(...roster.map(({ count }) => count))
  assert.ok(rosterMin >= minorMax, `в составе ${rosterMin}, за бортом ${minorMax}`)
})

test('места не вытесняют людей из значимого яруса, как бы часто их ни называли', () => {
  // Обратная сторона отбора по частоте: если потолок забьют места, настоящие
  // люди выпадут целиком и книга останется вовсе без персонажей. Значимые
  // занимают потолок без резерва, поэтому частота решает только остаток.
  const places = ['Гейблс', 'Кадриль', 'Лонгборн', 'Незерфилд']
    .flatMap((name) => Array.from({ length: 20 }, (_, index) =>
      `Дорога вела в ${name}, и в ${name} было тихо, ${index}.`))
  const people = ['Базаров', 'Кирсанов']
    .flatMap((name) => Array.from({ length: 5 }, () =>
      `— Здравствуйте, — сказал ${name}. — ${name} слушает.`))
  const inventory = buildBookNameInventory({ text: paragraphs(...places, ...people), cap: 4 })

  for (const name of ['Базаров', 'Кирсанов']) {
    const person = inventory.candidates.find(({ displayName }) => displayName === name)
    assert.ok(person, `${name} исчез из инвентаря`)
    assert.equal(person.tier, 'significant', `${name} проиграл потолок местам`)
  }
})

test('candidate keys are unique ASCII identifiers even for Cyrillic names', () => {
  const inventory = buildBookNameInventory({
    text: paragraphs(
      'Гленарван сказал слово, и Гленарван повторил его.',
      'Паганель ответил, и Паганель засмеялся.',
      'Мак-Наббс молчал, и Мак-Наббс кивнул.'
    )
  })
  const keys = inventory.candidates.map(({ candidateKey }) => candidateKey)
  assert.equal(new Set(keys).size, keys.length)
  for (const key of keys) {
    assert.match(key, /^name:[a-z0-9-]+$/, `ключ не ASCII-идентификатор: ${key}`)
  }
})

test('the same text always produces the same inventory', () => {
  const text = paragraphs(
    'Гленарван сказал слово, и Гленарван повторил.',
    'Паганель ответил Гленарвану, и Паганель замолчал.',
    'Мак-Наббс сказал, что согласен с Паганелем.'
  )
  const first = buildBookNameInventory({ text, normalizedTextHash: 'a'.repeat(64) })
  const second = buildBookNameInventory({ text, normalizedTextHash: 'a'.repeat(64) })
  assert.deepEqual(first, second)
})

test('invalid inputs are rejected instead of producing an empty inventory', () => {
  assert.throws(() => buildBookNameInventory({ text: '' }), { code: 'NAME_INVENTORY_INVALID' })
  assert.throws(() => buildBookNameInventory({ text: 'Слово.', coverage: 0 }), {
    code: 'NAME_INVENTORY_INVALID'
  })
  assert.throws(() => buildBookNameInventory({ text: 'Слово.', cap: 0 }), {
    code: 'NAME_INVENTORY_INVALID'
  })
})
