/**
 * Контракт карточки персонажа: форма запроса к модели и разбор ответа.
 *
 * Скелет ответа — не украшение промпта, а то, чему модель следует буквально.
 * Пока на месте bio стоял `null`, биография приходила голой строкой без
 * ссылок, разбор отбрасывал её целиком, и карточка всегда падала на
 * извлекающий запасной вариант — на всех трёх канареечных книгах, у каждого
 * персонажа.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  characterCardMessages,
  normalizeCharacterCardResult
} from '../generation/internal-generation-contracts.mjs'

test('the card skeleton shows the claim shape, so the model does not answer with a bare string', () => {
  // Пока на месте bio стоял `null`, модель заполняла скелет буквально:
  // биография приходила голой строкой без ссылок, нормализация отбрасывала её
  // целиком, и карточка всегда падала на извлекающий запасной вариант. Замер
  // на трёх книгах: со скелетом утверждений биография приходит с 3–4 ссылками
  // у всех проверенных персонажей, без него — ни у одного.
  const [system] = characterCardMessages({
    bookTitle: 'Обломов',
    bookAuthor: 'Гончаров',
    fragments: [{ id: 'frag:1', quote: 'Обломов лежал на диване.' }],
    cardWindow: { startOffset: 0, endOffset: 5000 },
    character: { name: 'Обломов' }
  })
  assert.doesNotMatch(system.content, /"bio":null/)
  assert.doesNotMatch(system.content, /"role":null/)
  assert.match(system.content, /"bio":\{"value":"","fragmentIds":\["frag:\.\.\."\],"confidence":0\.0\}/)
  assert.match(system.content, /"traits":\[\{"value":"","fragmentIds":\["frag:\.\.\."\],"confidence":0\.0\}\]/)
  assert.match(system.content, /объект этой формы, а не строка/)
  assert.match(system.content, /bio и role заполняются всегда/)
})

test('a bare string claim is dropped, so the skeleton is the only thing keeping the bio', () => {
  // Нормализация строку не чинит и не должна: утверждение без ссылки на
  // фрагмент — это факт без доказательства.
  const input = {
    fragments: [{ id: 'frag:1', quote: 'Обломов лежал на диване.' }],
    character: { name: 'Обломов' },
    cardWindow: { startOffset: 0, endOffset: 5000 },
    maxTraits: 6
  }
  const asString = normalizeCharacterCardResult({ bio: 'Обломов — барин.' }, input)
  assert.equal(asString.card.bio, null)
  const asClaim = normalizeCharacterCardResult(
    { bio: { value: 'Обломов — барин.', fragmentIds: ['frag:1'], confidence: 0.9 } },
    input
  )
  assert.equal(asClaim.card.bio.value, 'Обломов — барин.')
})
