import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FALLBACK_CHAPTER_CHARS,
  bookChapters,
  bookParagraphs,
  buildBookTextIndex
} from '../analysis/book-text-index.mjs'

test('paragraphs are split on blank lines and trimmed to their text', () => {
  const text = 'Первый абзац.\n\nВторой абзац.\n\n\n  Третий абзац.  '
  const paragraphs = bookParagraphs(text)
  assert.equal(paragraphs.length, 3)
  assert.deepEqual(
    paragraphs.map(({ startOffset, endOffset }) => text.slice(startOffset, endOffset)),
    ['Первый абзац.', 'Второй абзац.', 'Третий абзац.']
  )
  assert.deepEqual(paragraphs.map(({ index }) => index), [0, 1, 2])
})

test('a text normalized to single newlines still yields separate paragraphs', () => {
  const paragraphs = bookParagraphs('Строка одна.\nСтрока два.\nСтрока три.')
  assert.equal(paragraphs.length, 3)
})

test('navigation segments become chapters that cover the text contiguously', () => {
  const text = 'a'.repeat(300)
  const chapters = bookChapters(text, {
    navigation: {
      segments: [
        { key: 'toc:1', title: 'Глава 1', startOffset: 0, endOffset: 100 },
        { key: 'toc:2', title: 'Глава 2', startOffset: 100, endOffset: 200 }
      ]
    }
  })
  assert.deepEqual(chapters.map(({ key, startOffset, endOffset }) => [key, startOffset, endOffset]), [
    ['toc:1', 0, 100],
    ['toc:2', 100, 300]
  ])
})

test('a book without navigation falls back to paragraph-aligned windows', () => {
  const paragraph = `${'слово '.repeat(2_000)}\n\n`
  const text = paragraph.repeat(8)
  const chapters = bookChapters(text, { navigation: { segments: [] } })
  assert.ok(chapters.length >= 2, 'a long book must produce more than one window')
  assert.equal(chapters[0].startOffset, 0)
  assert.equal(chapters.at(-1).endOffset, text.length)
  for (const [index, chapter] of chapters.entries()) {
    assert.equal(chapter.index, index)
    if (index > 0) assert.equal(chapter.startOffset, chapters[index - 1].endOffset)
  }
  // Границы окон стоят на абзацах, а не ровно на 30 000 символов.
  assert.ok(chapters[0].endOffset >= FALLBACK_CHAPTER_CHARS)
})

test('a single navigation segment is treated as no navigation at all', () => {
  const text = 'а'.repeat(1_000)
  const chapters = bookChapters(text, {
    navigation: { segments: [{ key: 'fixed:document', startOffset: 0, endOffset: text.length }] }
  })
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].key, 'window:1')
})

test('offset lookups find the containing paragraph and chapter, and reject offsets past the end', () => {
  const text = 'Первый.\n\nВторой.\n\nТретий.'
  const index = buildBookTextIndex(text, {
    navigation: {
      segments: [
        { key: 'toc:1', startOffset: 0, endOffset: 9 },
        { key: 'toc:2', startOffset: 9, endOffset: text.length }
      ]
    }
  })
  assert.equal(index.paragraphAt(0).index, 0)
  assert.equal(index.paragraphAt(10).index, 1)
  assert.equal(index.chapterIndexAt(0), 0)
  assert.equal(index.chapterIndexAt(10), 1)
  assert.equal(index.chapterIndexAt(text.length + 5), -1)
  // Смещение в разрыве между абзацами не принадлежит ни одному из них.
  assert.equal(index.paragraphAt(8), null)
})

test('an empty text is rejected rather than silently indexed', () => {
  assert.throws(() => buildBookTextIndex(''), { code: 'BOOK_TEXT_INDEX_INVALID' })
})
