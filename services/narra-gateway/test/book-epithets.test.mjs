/**
 * Прозвища из нарицательных слов и первое упоминание слитого героя.
 *
 * «Кровавый меридиан» зовёт обоих главных героев со строчной — «малец»,
 * «судья», — и инвентарь имён их не видел. «Земля лишних» потеряла Рауля:
 * первое упоминание досталось ему от формы, для которой цитат не собирали.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBookNameInventory } from '../analysis/book-name-inventory.mjs'
import { collectBookCharacterFragments } from '../analysis/book-character-fragments.mjs'
import { applyRosterConfirmation } from '../analysis/book-roster-confirmation.mjs'

/**
 * Книга, где героя зовут только «малец», а рядом ходит названный Глэнтон. Без
 * оглавления главы синтетические, по тридцать тысяч символов, а прозвище
 * обязано встретиться хотя бы в трёх, — отсюда длинная прерия в каждой главе.
 */
const PRAIRIE = 'Прерия тянулась до горизонта, и ветер гнал по ней пыль. '.repeat(400)

function epithetBook() {
  const chapters = []
  for (let chapter = 1; chapter <= 6; chapter += 1) {
    const paragraphs = [`Глава ${chapter}`, PRAIRIE]
    for (let line = 0; line < 10; line += 1) {
      paragraphs.push(`Держись левее, сказал малец. Мальцу никто не ответил, и малец пошёл к реке.`)
      paragraphs.push(`Глэнтон посмотрел на воду. Нет, сказал Глэнтон, и Глэнтон сплюнул.`)
      paragraphs.push(`Дорога шла через прерию, и дорога была пуста, а небо было белым.`)
    }
    chapters.push(paragraphs.join('\n\n'))
  }
  return chapters.join('\n\n')
}

test('a common noun the book keeps calling a hero by becomes an epithet candidate', () => {
  const inventory = buildBookNameInventory({ text: epithetBook() })
  const kid = inventory.candidates.find(({ displayName }) => displayName === 'Малец')
  assert.ok(kid, 'прозвище не найдено')
  assert.equal(kid.epithet, true)
  assert.ok(kid.epithetForms.includes('мальцу'), 'косвенный падеж должен войти в формы')
  // Обычное слово, стоящее рядом с речью не в роли говорящего, прозвищем не
  // становится: «дорога» ни разу не стоит сразу после «сказал».
  assert.ok(!inventory.candidates.some(({ displayName }) => displayName === 'Дорога'))
  // Имя остаётся именем, а не прозвищем.
  const glanton = inventory.candidates.find(({ displayName }) => displayName === 'Глэнтон')
  assert.ok(glanton && !glanton.epithet)
})

test('epithet forms are found in any case, other words are not', () => {
  const text = 'Малец вышел.\n\nНикто не ждал мальца у реки.\n\nМалая Садовая была пуста.'
  const [kid] = collectBookCharacterFragments({
    text,
    characters: [{ characterKey: 'name:malec', names: ['Малец'], epithetForms: ['малец', 'мальца'] }]
  }).characters
  assert.deepEqual(kid.fragments.map(({ paragraphIndex }) => paragraphIndex), [0, 1])
})

test('a merged hero is not placed before his first quote', () => {
  // «Рауль» упомянут раньше, но цитаты собраны только для «Раулито»: окно,
  // выбранное по раннему упоминанию, не нашло бы ни одной цитаты.
  const candidates = [
    { candidateKey: 'name:raulito', displayName: 'Раулито', aliases: [], count: 160,
      firstMentionTextOffset: 864_717, chapterCount: 40, tier: 'roster' },
    { candidateKey: 'name:raul', displayName: 'Рауль', aliases: [], count: 26,
      firstMentionTextOffset: 520_570, chapterCount: 5, tier: 'minor' }
  ]
  const confirmation = {
    classifications: [
      { candidateKey: 'name:raulito', kind: 'person', canonicalName: 'Рауль' },
      { candidateKey: 'name:raul', kind: 'person', canonicalName: 'Рауль' }
    ],
    acceptedMerges: [{ leftKey: 'name:raulito', rightKey: 'name:raul', basis: 'nickname' }]
  }
  const fragments = { characters: [
    { characterKey: 'name:raulito', fragments: [{ startOffset: 864_117 }, { startOffset: 881_000 }] }
  ] }
  const [withQuotes] = applyRosterConfirmation({ request: {}, candidates, confirmation, fragments })
  assert.equal(withQuotes.firstMentionTextOffset, 864_117)
  // Без цитат — прежнее правило: самое раннее упоминание.
  const [withoutQuotes] = applyRosterConfirmation({ request: {}, candidates, confirmation })
  assert.equal(withoutQuotes.firstMentionTextOffset, 520_570)
})

test('a quote that starts with the mention keeps the mention as the first appearance', () => {
  const candidates = [{ candidateKey: 'name:smit', displayName: 'Смит', aliases: [], count: 300,
    firstMentionTextOffset: 1_200, chapterCount: 30, tier: 'roster' }]
  const confirmation = {
    classifications: [{ candidateKey: 'name:smit', kind: 'person', canonicalName: 'Смит' }],
    acceptedMerges: []
  }
  const fragments = { characters: [{ characterKey: 'name:smit', fragments: [{ startOffset: 1_150 }] }] }
  const [smith] = applyRosterConfirmation({ request: {}, candidates, confirmation, fragments })
  assert.equal(smith.firstMentionTextOffset, 1_200)
})

test('the name form is the nominative, not the colloquial vocative', () => {
  // «Кать, иди сюда» — звательный падеж из реплики. В «Земле лишних» «Кать»
  // встречается дважды, «Катя» — 184 раза, и героиня выходила «Кать».
  const paragraphs = []
  for (let index = 0; index < 40; index += 1) {
    paragraphs.push('Катя открыла дверь, и Катя улыбнулась гостю.')
    paragraphs.push('Иван вошёл следом. Ивана никто не ждал, но Иван остался.')
  }
  paragraphs.push('— Кать, иди сюда, — позвал Иван.')
  const inventory = buildBookNameInventory({ text: paragraphs.join('\n\n') })
  const names = inventory.candidates.map(({ displayName }) => displayName)
  assert.ok(names.includes('Катя'), names.join(', '))
  assert.ok(!names.includes('Кать'))
  assert.ok(names.includes('Иван'), 'мужское имя остаётся в именительном')
})
