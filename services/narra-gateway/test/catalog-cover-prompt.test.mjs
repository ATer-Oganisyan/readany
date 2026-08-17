import assert from 'node:assert/strict'
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
