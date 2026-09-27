/**
 * Служебный текст не участвует в поиске персонажей, но и не сдвигает текст:
 * маска сохраняет длину, абзацы и их индексы, иначе цитаты и окна разошлись бы
 * с настоящим текстом книги.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bookCharacterAnalysisText,
  bookParatextRanges,
  isChapterSynopsis,
  maskBookParatext
} from '../analysis/book-paratext.mjs'
import { bookParagraphs } from '../analysis/book-text-index.mjs'

const STORY = 'Малец сидел у огня. Судья смотрел на него через костёр. '.repeat(40)

/** Книга как её отдаёт Prepare: ведущий сегмент без пункта оглавления. */
function book({ front, chapters, tail = '' }) {
  const parts = [front, ...chapters.map(({ title, body }) => `${title}\n\n${body}`)]
  const text = parts.join('\n\n') + tail
  const segments = []
  let offset = 0
  segments.push({ key: 'navigation:ncx:start', title: 'ch1', startOffset: 0, endOffset: front.length + 2 })
  offset = front.length + 2
  for (const [index, { title, body }] of chapters.entries()) {
    const length = `${title}\n\n${body}`.length + (index < chapters.length - 1 ? 2 : tail.length)
    segments.push({ key: `toc:ncx:${index + 1}`, title, startOffset: offset, endOffset: offset + length })
    offset += length
  }
  const navigation = {
    segments,
    items: chapters.map((_, index) => ({ key: `toc:ncx:${index + 1}`, sectionKey: `toc:ncx:${index + 1}` }))
  }
  return { text, navigation }
}

test('the front matter before the first contents entry is paratext', () => {
  const front = 'КОРМАК МАККАРТИ\n\nАвтор хочет поблагодарить Фонд Джона Саймона Гуггенхайма.'
  const { text, navigation } = book({
    front,
    chapters: [{ title: 'I', body: STORY }, { title: 'II', body: STORY }]
  })
  const ranges = bookParatextRanges(text, { navigation })
  assert.equal(ranges[0].startOffset, 0)
  assert.ok(ranges[0].kinds.includes('front_matter'))
  assert.ok(ranges[0].endOffset >= front.length)
})

test('a long leading segment is kept: it may be the first chapter itself', () => {
  const { text, navigation } = book({
    front: STORY.repeat(6),
    chapters: [{ title: 'II', body: STORY }]
  })
  const ranges = bookParatextRanges(text, { navigation })
  assert.ok(!ranges.some(({ kinds }) => kinds.includes('front_matter')))
})

test('a chapter synopsis is paratext, a chapter paragraph with dashes is not', () => {
  assert.equal(isChapterSynopsis(
    'Детство в Теннесси — Уход из дома — Новый Орлеан — Драки — Судья Холден — Тоудвайн'
  ), true)
  assert.equal(isChapterSynopsis(
    'Он вышел — и замер. Над полем стояла луна — огромная, белая — и молчала.'
  ), false)
  assert.equal(isChapterSynopsis('— Спасибо за воду — крикнул он — и ушёл — не оглянувшись'), false)
})

test('the notes heading in the tail masks the notes up to the end of the chapter', () => {
  const tail = '\n\nПримечания\n\n1\n\nАлександр Уильям Донифан (1808–1887) — американский полковник.'
  const { text, navigation } = book({
    front: 'Титул.',
    chapters: [{ title: 'I', body: STORY }, { title: 'Эпилог', body: STORY }],
    tail
  })
  const ranges = bookParatextRanges(text, { navigation })
  const back = ranges.find(({ kinds }) => kinds.includes('back_matter'))
  assert.ok(back, 'примечания не найдены')
  assert.equal(text.slice(back.startOffset, back.startOffset + 10), 'Примечания')
  assert.equal(back.endOffset, text.length)
})

test('without navigation only credit paragraphs at the head are masked', () => {
  const text = [
    '© Круз А., Круз М., 2021',
    'Катя, спасибо, что поддерживаешь любое начинание!',
    '— Спасибо, — сказал Смит.',
    STORY
  ].join('\n\n')
  const ranges = bookParatextRanges(text)
  const masked = ranges.map(({ startOffset, endOffset }) => text.slice(startOffset, endOffset))
  assert.deepEqual(masked, [
    '© Круз А., Круз М., 2021',
    'Катя, спасибо, что поддерживаешь любое начинание!'
  ])
})

test('the mask keeps length, paragraphs and their indexes', () => {
  const { text, navigation } = book({
    front: 'Андрей Круз, Мария Круз\n\n© Оформление. ООО «Издательство», 2021',
    chapters: [{ title: 'Исход', body: STORY }]
  })
  const { text: masked, ranges } = bookCharacterAnalysisText(text, { navigation })
  assert.equal(masked.length, text.length)
  assert.deepEqual(
    bookParagraphs(masked).map(({ startOffset, endOffset }) => [startOffset, endOffset]),
    bookParagraphs(text).map(({ startOffset, endOffset }) => [startOffset, endOffset])
  )
  const front = masked.slice(ranges[0].startOffset, ranges[0].endOffset)
  assert.doesNotMatch(front, /\p{L}/u, 'в маске не должно остаться букв')
  assert.equal(masked.slice(ranges[0].endOffset), text.slice(ranges[0].endOffset))
})

test('masking without ranges returns the text untouched', () => {
  assert.equal(maskBookParatext('Текст книги.', []), 'Текст книги.')
})
