import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_FRAGMENT_QUOTE_CHARS,
  collectBookCharacterFragments,
  evenlySampled,
  fragmentQuoteRange,
  splitHonorificNames
} from '../analysis/book-character-fragments.mjs'

function paragraphs(...values) {
  return values.join('\n\n')
}

function forCharacter(result, characterKey) {
  return result.characters.find((item) => item.characterKey === characterKey)
}

test('every fragment quote matches the text at its own offsets', () => {
  const text = paragraphs(
    'Гленарван поднялся на мостик и осмотрелся.',
    'Паганель развернул карту, и Гленарван подошёл ближе.',
    'Мак-Наббс молчал.'
  )
  const result = collectBookCharacterFragments({
    text,
    characters: [
      { characterKey: 'char:glenarvan', names: ['Гленарван'] },
      { characterKey: 'char:paganel', names: ['Паганель'] }
    ]
  })
  for (const entry of result.characters) {
    for (const fragment of entry.fragments) {
      assert.equal(
        text.slice(fragment.startOffset, fragment.endOffset),
        fragment.quote,
        `цитата ${fragment.fragmentId} не совпала с текстом по своим смещениям`
      )
      for (const offset of fragment.mentionOffsets) {
        assert.ok(offset >= fragment.startOffset && offset < fragment.endOffset)
      }
    }
  }
  assert.equal(forCharacter(result, 'char:glenarvan').fragmentCount, 2)
  assert.equal(forCharacter(result, 'char:glenarvan').mentionCount, 2)
})

test('Russian case forms are collected as mentions of the same character', () => {
  const text = paragraphs(
    'Раскольников вышел.',
    'У Раскольникова болела голова.',
    'С Раскольниковым говорил Разумихин.'
  )
  const result = collectBookCharacterFragments({
    text,
    characters: [{ characterKey: 'char:raskolnikov', names: ['Раскольников'] }]
  })
  assert.equal(forCharacter(result, 'char:raskolnikov').mentionCount, 3)
})

test('a surname shared by two characters is not attributed on its own', () => {
  const text = paragraphs(
    'Малфой усмехнулся и отвернулся.',
    'Драко Малфой вошёл первым.',
    'Люциус Малфой остался в дверях.'
  )
  const result = collectBookCharacterFragments({
    text,
    characters: [
      { characterKey: 'char:draco', names: ['Драко Малфой'] },
      { characterKey: 'char:lucius', names: ['Люциус Малфой'] }
    ]
  })
  assert.equal(forCharacter(result, 'char:draco').mentionCount, 1)
  assert.equal(forCharacter(result, 'char:lucius').mentionCount, 1)
  // Одиночный «Малфой» из первого абзаца не достался никому.
  for (const entry of result.characters) {
    for (const fragment of entry.fragments) assert.ok(fragment.startOffset > 0)
  }
})

test('an honorific separates people who share a surname', () => {
  const text = paragraphs(
    'Mr. Bennet said nothing.',
    'Mrs. Bennet replied at once.',
    'Miss Bennet looked away.',
    'Bennet was the family name.'
  )
  const result = collectBookCharacterFragments({
    text,
    characters: [
      { characterKey: 'char:mr-bennet', names: ['Mr Bennet'] },
      { characterKey: 'char:mrs-bennet', names: ['Mrs Bennet'] },
      { characterKey: 'char:miss-bennet', names: ['Miss Bennet'] },
      { characterKey: 'char:bennet', names: ['Bennet'] }
    ]
  })
  assert.equal(forCharacter(result, 'char:mr-bennet').mentionCount, 1)
  assert.equal(forCharacter(result, 'char:mrs-bennet').mentionCount, 1)
  assert.equal(forCharacter(result, 'char:miss-bennet').mentionCount, 1)
  // Голая фамилия достаётся ровно тому, у кого обращения нет, и только там,
  // где обращения действительно не было.
  const bare = forCharacter(result, 'char:bennet')
  assert.equal(bare.mentionCount, 1)
  assert.equal(bare.fragments[0].paragraphIndex, 3)
})

test('siblings with no bare candidate leave the lone surname unattributed', () => {
  const result = collectBookCharacterFragments({
    text: paragraphs('Mr. Bennet said nothing.', 'Bennet was the family name.'),
    characters: [
      { characterKey: 'char:mr-bennet', names: ['Mr Bennet'] },
      { characterKey: 'char:mrs-bennet', names: ['Mrs Bennet'] }
    ]
  })
  assert.equal(forCharacter(result, 'char:mr-bennet').mentionCount, 1)
  assert.equal(forCharacter(result, 'char:mrs-bennet').mentionCount, 0)
})

test('a lone honorific-qualified character still matches its bare surname', () => {
  const result = collectBookCharacterFragments({
    text: paragraphs('Mr. Erskine laughed.', 'Erskine said nothing more.'),
    characters: [{ characterKey: 'char:erskine', names: ['Mr Erskine'] }]
  })
  assert.equal(forCharacter(result, 'char:erskine').mentionCount, 2)
})

test('the window is a hard boundary: nothing past it is collected', () => {
  const text = paragraphs(
    'Гленарван поднялся на мостик.',
    'Гленарван спустился в каюту.',
    'Гленарван вернулся через час.'
  )
  const boundary = text.indexOf('Гленарван спустился')
  const result = collectBookCharacterFragments({
    text,
    characters: [{ characterKey: 'char:glenarvan', names: ['Гленарван'] }],
    window: { startOffset: 0, endOffset: boundary }
  })
  const entry = forCharacter(result, 'char:glenarvan')
  assert.equal(entry.mentionCount, 1)
  assert.deepEqual(result.window, { startOffset: 0, endOffset: boundary })
  for (const fragment of entry.fragments) assert.ok(fragment.endOffset <= text.length)
})

test('a paragraph longer than the quote limit is cut around the mention', () => {
  const filler = 'слово '.repeat(400)
  const text = `${filler}Гленарван сказал слово. ${filler}`
  const paragraphEnd = text.length
  const mentionStart = text.indexOf('Гленарван')
  const range = fragmentQuoteRange({
    text,
    paragraphStart: 0,
    paragraphEnd,
    mentionStart,
    maxChars: 200
  })
  assert.ok(range.endOffset - range.startOffset <= 200 + 20)
  assert.ok(range.startOffset <= mentionStart && mentionStart < range.endOffset)
  assert.ok(MAX_FRAGMENT_QUOTE_CHARS > 200)
})

test('the fragment limit samples evenly and keeps the first entry', () => {
  const items = Array.from({ length: 100 }, (_, index) => index)
  const sampled = evenlySampled(items, 5)
  assert.equal(sampled.length, 5)
  assert.equal(sampled[0], 0)
  assert.equal(sampled.at(-1), 99)
  assert.deepEqual(evenlySampled(items, 200), items)
  assert.deepEqual(evenlySampled(items, 1), [0])
  assert.deepEqual(evenlySampled(items, 0), [])
})

test('the per-character fragment cap is applied without losing the count', () => {
  const text = paragraphs(...Array.from({ length: 40 }, (_, index) =>
    `Гленарван сказал слово номер ${index}.`))
  const result = collectBookCharacterFragments({
    text,
    characters: [{ characterKey: 'char:glenarvan', names: ['Гленарван'] }],
    maxFragmentsPerCharacter: 10
  })
  const entry = forCharacter(result, 'char:glenarvan')
  assert.equal(entry.fragmentCount, 40)
  assert.equal(entry.mentionCount, 40)
  assert.equal(entry.selectedCount, 10)
  assert.equal(entry.fragments.length, 10)
})

test('honorifics are split off the front of a name', () => {
  assert.deepEqual(splitHonorificNames(['Mr Bennet']), {
    honorifics: ['mr'],
    baseNames: ['Bennet']
  })
  assert.deepEqual(splitHonorificNames(['Lady Catherine de Bourgh']), {
    honorifics: ['lady'],
    baseNames: ['Catherine de Bourgh']
  })
  assert.deepEqual(splitHonorificNames(['Гленарван']), {
    honorifics: [],
    baseNames: ['Гленарван']
  })
})

test('invalid inputs are rejected instead of returning empty results', () => {
  assert.throws(() => collectBookCharacterFragments({ text: '', characters: [] }), {
    code: 'CHARACTER_FRAGMENTS_INVALID'
  })
  assert.throws(() => collectBookCharacterFragments({ text: 'Текст.', characters: [] }), {
    code: 'CHARACTER_FRAGMENTS_INVALID'
  })
  assert.throws(() => collectBookCharacterFragments({
    text: 'Текст.',
    characters: [{ characterKey: 'a', names: [] }]
  }), { code: 'CHARACTER_FRAGMENTS_INVALID' })
  assert.throws(() => collectBookCharacterFragments({
    text: 'Текст.',
    characters: [{ characterKey: 'a', names: ['Имя'] }, { characterKey: 'a', names: ['Имя'] }]
  }), { code: 'CHARACTER_FRAGMENTS_INVALID' })
  assert.throws(() => collectBookCharacterFragments({
    text: 'Текст.',
    characters: [{ characterKey: 'a', names: ['Имя'] }],
    window: { startOffset: 5, endOffset: 3 }
  }), { code: 'CHARACTER_FRAGMENTS_INVALID' })
})
