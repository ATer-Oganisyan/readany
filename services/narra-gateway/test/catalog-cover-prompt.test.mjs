import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  BOOK_COVER_PROMPT_VERSION,
  bookCoverPrompt,
  catalogCoverPrompt,
  generatedCoverBackgroundColor
} from '../catalog-cover-prompt.mjs'

test('gateway builds the approved main-branch cover prompt from structured context', () => {
  const prompt = bookCoverPrompt({
    title: 'Анна Каренина',
    author: 'Лев Толстой',
    description: 'Роман о семье, любви и давлении общества.',
    subjects: ['literary fiction']
  })

  assert.equal(BOOK_COVER_PROMPT_VERSION, 'book-cover-prompt-v3')
  assert.match(prompt, /Create the complete front-cover artwork/)
  assert.match(prompt, /two-fifths of the total canvas height/)
  assert.match(prompt, /38–42%/)
  assert.match(prompt, /must never exceed about 45%/)
  assert.match(prompt, /ABSOLUTELY NO TEXT/)
  assert.match(prompt, /“Анна Каренина”/)
  assert.match(prompt, /Лев Толстой/)
  assert.match(prompt, /BOOK GENRE:\nliterary fiction/)
  assert.match(prompt, /psychological and social tension/)
  assert.match(prompt, /SHARED BACKGROUND SYSTEM — IDENTICAL ACROSS ALL GENRES/)
  assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/u)
  assert.ok(prompt.length < 8_000)
})

test('personal and catalog covers share one canonical builder and stable palette', () => {
  const input = { title: 'Неизвестная книга', author: '' }
  assert.equal(catalogCoverPrompt(input), bookCoverPrompt(input))
  assert.equal(generatedCoverBackgroundColor(input), 'deep cobalt blue')
  assert.match(bookCoverPrompt(input), /BOOK GENRE:\nclassics \/ general literature/)
})

test('gateway infers a fresh genre-specific art direction from content', () => {
  const prompt = bookCoverPrompt({
    title: 'Книга',
    description: 'Исторический роман о семье на фоне революции.'
  })

  assert.match(prompt, /BOOK GENRE:\nhistorical fiction/)
  assert.match(prompt, /era-specific engraved figure/)
})

test('gateway stays byte-identical to the main client prompt for Fathers and Sons', () => {
  const prompt = bookCoverPrompt({
    title: 'Отцы и дети',
    author: 'Иван Тургенев'
  })

  assert.equal(Buffer.byteLength(prompt), 7_266)
  assert.equal(
    createHash('sha256').update(prompt).digest('hex'),
    'c53e88fc3fdd086c701ee25d4cce2e09e1ad021cc960a1a2374e484f93826224'
  )
})

test('gateway matches main when genre evidence follows the 800-character theme excerpt', () => {
  const prompt = bookCoverPrompt({
    title: 'Книга',
    description: `${'x'.repeat(900)} manga`
  })

  assert.match(prompt, /BOOK GENRE:\nmanga or anime graphic fiction/)
  assert.match(prompt, /hand-painted 1990s cel anime/)
  assert.doesNotMatch(prompt, /x{801}/u)
})

test('gateway matches the main client background override and ignores non-main context', () => {
  const input = { title: 'Книга', accentColor1: 'bright red' }
  assert.match(bookCoverPrompt(input), /REQUIRED DOMINANT BACKGROUND COLOR:\nbright red/)
  assert.equal(
    bookCoverPrompt(input),
    bookCoverPrompt({ ...input, context: 'manga anime' })
  )
})

test('gateway normalizes catalog bibliography noise before building the cover prompt', () => {
  const prompt = bookCoverPrompt({
    title: 'Мертвое озеро (Часть первая)[1]',
    author: 'Жюль Верн, илл. Риу Э. (Édouard Riou)'
  })

  assert.match(prompt, /“Мертвое озеро”/u)
  assert.match(prompt, /“Мертвое озеро” by Жюль Верн\./u)
  assert.doesNotMatch(prompt, /\[1\]|Часть первая|илл\.|Riou/u)
})

test('gateway cover normalization preserves meaningful title punctuation', () => {
  for (const title of [
    'Что делать?',
    'Хорошо!',
    'Росла́влев, или Русские в 1812 году'
  ]) {
    assert.ok(bookCoverPrompt({ title }).includes(title))
  }
})

test('gateway hashes normalized cover identity for a stable generated palette', () => {
  assert.equal(
    generatedCoverBackgroundColor({
      title: 'Маскарад[1]',
      author: 'Михаил Лермонтов (1814—1841)'
    }),
    generatedCoverBackgroundColor({ title: 'Маскарад', author: 'Михаил Лермонтов' })
  )
})
