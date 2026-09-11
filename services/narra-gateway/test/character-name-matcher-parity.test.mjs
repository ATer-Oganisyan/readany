import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  MIN_NAME_STEM_LENGTH,
  NAME_ENDINGS,
  NAME_STOPWORDS,
  buildCharacterNameMatcherSpec,
  findCharacterNameMatches,
  stemNameToken
} from '../analysis/character-name-matcher.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const READER_MATCHER = path.resolve(
  directory,
  '..',
  '..',
  '..',
  'packages',
  'app-expo',
  'src',
  'lib',
  'narra',
  'character-name-matcher.ts'
)

/**
 * Достаёт строковый массив из TS-исходника ридера: имя константы, затем
 * литерал до закрывающей скобки. Разбор нарочно узкий — если объявление
 * изменит форму, тест упадёт, а не молча пропустит расхождение.
 */
function readerStringArray(source, name) {
  const declaration = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`)
  const match = source.match(declaration)
  assert.ok(match, `${name} is not declared as a string array literal in the reader module`)
  const values = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(([, value]) => value)
  assert.ok(values.length > 0, `${name} in the reader module has no string entries`)
  return values
}

test('ported endings, stopwords and stem length match the reader module', async () => {
  const source = await readFile(READER_MATCHER, 'utf8')
  assert.deepEqual(readerStringArray(source, 'NAME_ENDINGS'), [...NAME_ENDINGS])
  assert.deepEqual(readerStringArray(source, 'NAME_STOPWORDS'), [...NAME_STOPWORDS])
  const stemLength = source.match(/MIN_NAME_STEM_LENGTH\s*=\s*(\d+)/)
  assert.ok(stemLength, 'reader module no longer declares MIN_NAME_STEM_LENGTH')
  assert.equal(Number(stemLength[1]), MIN_NAME_STEM_LENGTH)
})

test('the ported matcher clusters Russian case forms of one surname', () => {
  const spec = buildCharacterNameMatcherSpec([
    { id: 'raskolnikov', name: 'Раскольников', fullName: 'Родион Раскольников' }
  ])
  const text = 'Раскольников вышел. У Раскольникова болела голова. Раскольникову было душно.'
  const matches = findCharacterNameMatches(text, spec)
  assert.equal(matches.length, 3)
  assert.deepEqual([...new Set(matches.map(({ characterId }) => characterId))], ['raskolnikov'])
  for (const match of matches) {
    assert.match(text.slice(match.start, match.end), /^Раскольников/)
  }
})

test('a surname shared by two characters is not attributed on its own', () => {
  const spec = buildCharacterNameMatcherSpec([
    { id: 'draco', name: 'Драко Малфой', fullName: 'Драко Малфой' },
    { id: 'lucius', name: 'Люциус Малфой', fullName: 'Люциус Малфой' }
  ])
  const ambiguous = findCharacterNameMatches('Малфой усмехнулся.', spec)
  assert.deepEqual(ambiguous, [])
  const disambiguated = findCharacterNameMatches('Драко Малфой усмехнулся.', spec)
  assert.equal(disambiguated.length, 1)
  assert.equal(disambiguated[0].characterId, 'draco')
})

test('adjectival surnames match their oblique cases through the exact form table', () => {
  const spec = buildCharacterNameMatcherSpec([{ id: 'lensky', name: 'Владимир Ленский' }])
  const matches = findCharacterNameMatches('Ленский приехал. У Ленского гости. С Ленским спор.', spec)
  assert.equal(matches.length, 3)
  assert.deepEqual([...new Set(matches.map(({ characterId }) => characterId))], ['lensky'])
})

test('stemNameToken strips exactly one final vowel, soft or short sign', () => {
  assert.equal(stemNameToken('раскольников'), 'раскольников')
  assert.equal(stemNameToken('раскольникова'), 'раскольников')
  assert.equal(stemNameToken('ленский'), 'ленски')
  assert.equal(stemNameToken('я'), 'я')
})
