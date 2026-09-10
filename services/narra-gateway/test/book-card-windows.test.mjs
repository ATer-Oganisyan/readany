import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CARD_WINDOW_VERSION,
  MIN_FIRST_WINDOW_CHARS,
  buildBookCardWindows,
  cardWindowForOffset,
  cardWindowIndexForOffset
} from '../analysis/book-card-windows.mjs'
import { cardWindow } from '../evaluation/score-character-cards.mjs'

function chapters(...lengths) {
  let offset = 0
  return lengths.map((length, index) => {
    const chapter = {
      index,
      key: `toc:${index + 1}`,
      title: `Глава ${index + 1}`,
      startOffset: offset,
      endOffset: offset + length
    }
    offset += length
    return chapter
  })
}

test('the card window ends with the chapter after the first mention', () => {
  const list = chapters(10_000, 10_000, 10_000, 10_000)
  assert.deepEqual(cardWindowForOffset(list, 500), {
    startOffset: 0,
    endOffset: 20_000,
    chapterIndexes: [0, 1]
  })
  assert.deepEqual(cardWindowForOffset(list, 25_000), {
    startOffset: 0,
    endOffset: 40_000,
    chapterIndexes: [2, 3]
  })
})

test('a mention in the last chapter cannot reach past the end of the book', () => {
  const list = chapters(10_000, 10_000)
  assert.deepEqual(cardWindowForOffset(list, 15_000), {
    startOffset: 0,
    endOffset: 20_000,
    chapterIndexes: [1]
  })
})

/**
 * Продакшен и оценка обязаны считать барьер одним правилом: иначе аудит «ни
 * одного факта из-за окна» проверял бы не то окно, которое было в вызове.
 */
test('the production window rule matches the evaluation harness rule', () => {
  const list = chapters(8_000, 9_000, 11_000, 7_000, 12_000)
  for (const offset of [0, 100, 8_000, 8_001, 17_000, 28_000, 34_999, 46_999]) {
    const expected = cardWindow(list, offset)
    const actual = cardWindowForOffset(list, offset)
    assert.equal(actual.startOffset, expected.startOffset, `startOffset при ${offset}`)
    assert.equal(actual.endOffset, expected.endOffset, `endOffset при ${offset}`)
  }
})

test('the first window covers two chapters and is followed by one window per chapter', () => {
  const list = chapters(20_000, 20_000, 20_000, 20_000)
  const result = buildBookCardWindows({ chapters: list })
  assert.equal(result.cardWindowVersion, CARD_WINDOW_VERSION)
  assert.equal(result.windows.length, 3)
  assert.deepEqual(result.windows[0], {
    windowIndex: 0,
    startOffset: 0,
    endOffset: 40_000,
    chapterIndexes: [0, 1],
    priorityClass: 'foreground'
  })
  assert.equal(result.windows[1].priorityClass, 'background')
  assert.equal(result.windows[1].endOffset, 60_000)
  assert.equal(result.windows.at(-1).endOffset, 80_000)
  // Каждое окно начинается с начала книги: карточка опирается на весь текст до
  // своей границы, а не только на свою главу.
  for (const window of result.windows) assert.equal(window.startOffset, 0)
})

test('very short opening chapters extend the first window to a chapter boundary', () => {
  const list = chapters(500, 600, 700, 20_000)
  const result = buildBookCardWindows({ chapters: list })
  assert.ok(
    result.windows[0].endOffset >= MIN_FIRST_WINDOW_CHARS,
    `первое окно осталось коротким: ${result.windows[0].endOffset}`
  )
  assert.deepEqual(result.windows[0].chapterIndexes, [0, 1, 2, 3])
  assert.equal(result.windows.length, 1)
})

test('a one-chapter book yields exactly one foreground window', () => {
  const result = buildBookCardWindows({ chapters: chapters(5_000) })
  assert.equal(result.windows.length, 1)
  assert.deepEqual(result.windows[0].chapterIndexes, [0])
  assert.equal(result.windows[0].priorityClass, 'foreground')
})

test('windows can be derived straight from the text when navigation is absent', () => {
  const text = `${'слово '.repeat(3_000)}\n\n`.repeat(6)
  const result = buildBookCardWindows({ text })
  assert.ok(result.windows.length >= 1)
  assert.equal(result.windows[0].startOffset, 0)
  assert.equal(result.windows.at(-1).endOffset, text.length)
})

test('a character is assigned the first window that reaches its barrier', () => {
  const list = chapters(10_000, 10_000, 10_000, 10_000)
  const { windows } = buildBookCardWindows({ chapters: list })
  assert.equal(cardWindowIndexForOffset(windows, list, 500), 0)
  assert.equal(cardWindowIndexForOffset(windows, list, 15_000), 1)
  assert.equal(cardWindowIndexForOffset(windows, list, 25_000), 2)
  assert.equal(cardWindowIndexForOffset(windows, list, 35_000), 2)
})

test('invalid inputs are rejected instead of producing an empty window list', () => {
  assert.throws(() => buildBookCardWindows({}), { code: 'CARD_WINDOW_INVALID' })
  assert.throws(() => buildBookCardWindows({ chapters: [] }), { code: 'CARD_WINDOW_INVALID' })
  assert.throws(() => cardWindowForOffset([], 0), { code: 'CARD_WINDOW_INVALID' })
  assert.throws(() => buildBookCardWindows({ chapters: chapters(100), firstWindowChapters: 0 }), {
    code: 'CARD_WINDOW_INVALID'
  })
})
