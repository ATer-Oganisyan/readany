/**
 * Правило счёта упоминаний для gold-фикстур.
 *
 * Знаменатель `significant` считается этим модулем, поэтому у него должен быть
 * тест на само правило, а не только на числа одной книги: иначе фикстуру нельзя
 * ни продлить на новую книгу, ни перепроверить старую.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MENTION_COUNT_RULE,
  characterMentions,
  mentionStatistics,
  significantTier,
  surfaceSpans
} from '../evaluation/count-identity-mentions.mjs'

test('a surface matches its Russian case forms and nothing else', () => {
  const text = 'Раскольников вышел. У Раскольникова не было денег. Раскольникову холодно. Расколоть нельзя.'
  assert.deepEqual(
    surfaceSpans(text, 'Раскольников').map(({ start }) => start),
    [0, 22, 51]
  )
})

test('a name is matched only where the text writes it as a proper noun', () => {
  // Строчная буква — не имя: иначе «соня» как существительное попала бы в счёт.
  const text = 'Соня молчала. Он спал как соня.'
  assert.equal(surfaceSpans(text, 'Соня').length, 1)
})

test('a multi-token surface requires the tokens to be adjacent', () => {
  const text = 'Порфирий Петрович вошел. Порфирий сел. Петрович ушел. Порфирий вдруг Петрович.'
  assert.equal(surfaceSpans(text, 'Порфирий Петрович').length, 1)
  assert.equal(surfaceSpans(text, 'Порфирий').length, 3)
})

test('a hyphen inside a name is a separator, not a break', () => {
  const text = 'Мак-Наббс молчал, и Мак-Наббса никто не спросил.'
  assert.equal(surfaceSpans(text, 'Мак-Наббс').length, 2)
})

test('a stopword token inside a surface matches literally, keeping two identities apart', () => {
  // «Миссис Олбинет» и «Олбинет» — две разные строки gold, и правило обязано их
  // различать, иначе жена стюарда получила бы все упоминания мужа.
  const text = 'Олбинет накрыл стол. Миссис Олбинет вошла.'
  assert.deepEqual(surfaceSpans(text, 'Миссис Олбинет').map(({ start }) => start), [21])
  assert.equal(surfaceSpans(text, 'Олбинет').length, 2)
})

test('a longer surface swallows the shorter one instead of counting twice', () => {
  const text = 'Джон Манглс поднялся. Манглс промолчал.'
  const mentions = characterMentions(text, ['Джон Манглс', 'Манглс'])
  assert.deepEqual(mentions.map(({ start }) => start), [0, 22])
})

test('mentionStatistics reports the count and the first offset the fixture pins', () => {
  const text = 'Дуня писала. Позже Авдотья Романовна пришла, и Дунечка заплакала.'
  const stats = mentionStatistics(text, ['Авдотья Романовна', 'Дуня', 'Дунечка'])
  assert.equal(stats.mentionCount, 3)
  assert.equal(stats.firstMentionTextOffset, 0)
})

test('a surface the text never uses reports no mention rather than throwing', () => {
  const stats = mentionStatistics('Соня молчала.', ['Свидригайлов'])
  assert.equal(stats.mentionCount, 0)
  assert.equal(stats.firstMentionTextOffset, -1)
})

test('the significant tier is the shortest prefix covering 95 percent of mentions', () => {
  const characters = [
    { id: 'a', mentionCount: 900 },
    { id: 'b', mentionCount: 60 },
    { id: 'c', mentionCount: 30 },
    { id: 'd', mentionCount: 10 }
  ]
  const tier = significantTier(characters, 0.95)
  assert.equal(tier.namedMentions, 1_000)
  assert.deepEqual([...tier.ids].sort(), ['a', 'b'])
  assert.equal(tier.boundaryMentionCount, 60)
})

test('everyone tied with the boundary joins the tier, so the cut is not arbitrary', () => {
  const tier = significantTier([
    { id: 'a', mentionCount: 900 },
    { id: 'b', mentionCount: 60 },
    { id: 'c', mentionCount: 60 },
    { id: 'd', mentionCount: 10 }
  ], 0.95)
  assert.deepEqual([...tier.ids].sort(), ['a', 'b', 'c'])
})

test('an unnamed gold row stays out of the tier and out of its denominator', () => {
  const tier = significantTier([
    { id: 'a', mentionCount: 100 },
    { id: 'narrator', mentionCount: 900, unnamed: true }
  ], 0.95)
  assert.equal(tier.namedMentions, 100)
  assert.deepEqual([...tier.ids], ['a'])
})

test('the rule is named, because the fixture cites it by name', () => {
  assert.equal(MENTION_COUNT_RULE, 'narra-name-endings-phrase-v1')
})
