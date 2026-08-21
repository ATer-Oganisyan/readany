import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PORTRAIT_PROMPT_CHAR_LIMIT,
  buildCharacterPortraitPrompt
} from '../character-portrait-prompt.mjs'

test('character portrait prompt keeps origin framing, appearance and style within budget', () => {
  const prompt = buildCharacterPortraitPrompt({
    fullName: 'Анна Каренина',
    bookTitle: 'Анна Каренина',
    bookAuthor: 'Лев Толстой',
    character: {
      characterKey: 'character:anna',
      appearancePrompt: `аристократичная женщина, ${'тёмные волосы и чёрное платье XIX века, '.repeat(60)}`
    }
  })

  assert.match(prompt, /^Ровно один человек в кадре — Анна Каренина, никого больше/)
  assert.match(prompt, /Вертикальный портрет до талии в среднем плане, строго анфас/)
  assert.match(prompt, /ровно 10% высоты кадра/)
  assert.match(prompt, /Персонаж книги «Анна Каренина» \(Лев Толстой\)/)
  assert.match(prompt, /Внешность \(соблюдать точно\): аристократичная женщина/)
  assert.match(prompt, /Стиль: портретная иллюстрация.*классический живописный портрет/s)
  assert.ok(prompt.length <= PORTRAIT_PROMPT_CHAR_LIMIT)
})

test('character portrait prompt preserves the origin Buratino puppet case', () => {
  const prompt = buildCharacterPortraitPrompt({
    fullName: 'Буратино',
    bookTitle: 'Золотой ключик',
    bookAuthor: 'Алексей Толстой',
    character: { characterKey: 'character:buratino', appearancePrompt: 'деревянная кукла' }
  })

  assert.match(prompt, /^Ровно одна неодушевлённая театральная деревянная марионетка/)
  assert.match(prompt, /Это не человек и не ребёнок/)
  assert.match(prompt, /Кукольный персонаж книги «Золотой ключик» \(Алексей Толстой\)/)
  assert.ok(prompt.length <= PORTRAIT_PROMPT_CHAR_LIMIT)
})
