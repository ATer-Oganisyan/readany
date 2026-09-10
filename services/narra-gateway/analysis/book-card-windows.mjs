/**
 * Окна карточек персонажей (решение D1 work order'а).
 *
 * Карточка строится не из всей книги, а из фрагментов внутри своего окна: от
 * начала книги до конца главы, следующей за главой первого упоминания. Причина
 * не в экономии, а в спойлерах: unlock карточки в ридере идёт по
 * `firstMentionTextOffset`, и если био собрать по всему обработанному тексту,
 * читатель на первой главе увидит факты из восьмой. Окно «глава появления + 1»
 * даёт основные факты и одновременно делает результат воспроизводимым:
 * одинаковое окно — одинаковый вход — одинаковый хэш.
 *
 * Окно 1 (главы 1–2) ставится сразу после Prepare с высоким приоритетом;
 * дальше окна идут цепочкой, окно N+1 после завершения окна N.
 */

import { bookChapters, bookParagraphs } from './book-text-index.mjs'

export const CARD_WINDOW_VERSION = 'card-window-v1'

/** Сколько глав входит в первое окно. */
export const FIRST_WINDOW_CHAPTERS = 2
/**
 * Если первые главы совсем короткие, окно расширяется до ближайшей границы
 * главы: иначе в окне 1 не окажется ни одного слота сцены и предгенерация
 * «в моменте» останется без работы.
 */
export const MIN_FIRST_WINDOW_CHARS = 8_000

function windowError(message) {
  return Object.assign(new TypeError(message), { code: 'CARD_WINDOW_INVALID' })
}

function normalizeChapters(input) {
  if (Array.isArray(input?.chapters)) return input.chapters
  if (typeof input?.text === 'string' && input.text.length) {
    return bookChapters(input.text, {
      navigation: input.navigation ?? null,
      paragraphs: bookParagraphs(input.text)
    })
  }
  throw windowError('either chapters or text is required')
}

/**
 * Окно карточки для персонажа с первым упоминанием на `firstMentionTextOffset`.
 *
 * Правило совпадает с `evaluation/score-character-cards.mjs#cardWindow`: оценка
 * и продакшен считают барьер по одному правилу, иначе аудит «ни одного факта
 * из-за окна» проверял бы не то окно, которое действительно было в вызове.
 */
export function cardWindowForOffset(chapters, firstMentionTextOffset) {
  if (!Array.isArray(chapters) || !chapters.length) {
    throw windowError('chapters must be a non-empty array')
  }
  const offset = Number.isFinite(firstMentionTextOffset) ? firstMentionTextOffset : 0
  let index = chapters.findIndex((chapter) =>
    offset >= chapter.startOffset && offset < chapter.endOffset)
  if (index < 0) index = 0
  const lastIndex = Math.min(index + 1, chapters.length - 1)
  return {
    startOffset: 0,
    endOffset: chapters[lastIndex].endOffset,
    chapterIndexes: index === lastIndex ? [index] : [index, lastIndex]
  }
}

/**
 * Цепочка окон по главам. Окно 1 — первые {@link FIRST_WINDOW_CHAPTERS} глав
 * (расширенное до {@link MIN_FIRST_WINDOW_CHARS}), дальше по одной главе.
 * Каждое окно начинается с начала книги: карточка персонажа, впервые
 * появившегося в главе 5, всё равно опирается на весь текст до конца главы 6.
 */
export function buildBookCardWindows({
  chapters: chapterInput,
  text,
  navigation = null,
  firstWindowChapters = FIRST_WINDOW_CHAPTERS,
  minFirstWindowChars = MIN_FIRST_WINDOW_CHARS
} = {}) {
  const chapters = normalizeChapters({ chapters: chapterInput, text, navigation })
  if (!chapters.length) throw windowError('chapters must be a non-empty array')
  if (!Number.isSafeInteger(firstWindowChapters) || firstWindowChapters < 1) {
    throw windowError('firstWindowChapters must be a positive integer')
  }

  let firstEndIndex = Math.min(firstWindowChapters, chapters.length) - 1
  while (
    firstEndIndex < chapters.length - 1 &&
    chapters[firstEndIndex].endOffset < minFirstWindowChars
  ) {
    firstEndIndex += 1
  }

  const windows = [{
    windowIndex: 0,
    startOffset: 0,
    endOffset: chapters[firstEndIndex].endOffset,
    chapterIndexes: chapters.slice(0, firstEndIndex + 1).map(({ index }) => index),
    priorityClass: 'foreground'
  }]
  for (let index = firstEndIndex + 1; index < chapters.length; index += 1) {
    windows.push({
      windowIndex: windows.length,
      startOffset: 0,
      endOffset: chapters[index].endOffset,
      chapterIndexes: [chapters[index].index],
      priorityClass: 'background'
    })
  }
  return {
    cardWindowVersion: CARD_WINDOW_VERSION,
    chapterCount: chapters.length,
    windows: withAssignmentRanges(windows, chapters)
  }
}

/**
 * Диапазон первых упоминаний, за который отвечает окно.
 *
 * Барьер окна и его состав героев — разные вещи, и путать их дорого. Барьер —
 * это `[startOffset, endOffset]`, и он у всех окон начинается с нуля: карточка
 * персонажа из главы 5 опирается на весь текст до конца главы 6. Состав же
 * должен быть у каждого окна свой и не пересекаться с соседями, иначе ранний
 * персонаж попадёт в каждое следующее окно, а персонаж главы 2 получит карточку
 * уже по первым двум главам — то есть не по правилу D1.
 *
 * Правило состава здесь ровно то же, что у {@link cardWindowIndexForOffset}: за
 * персонажа отвечает первое окно, чей конец не раньше конца главы, следующей за
 * главой первого упоминания. Диапазон считается по границам глав, а не
 * подбирается вручную, поэтому расхождения между назначением и барьером быть не
 * может по построению.
 */
function withAssignmentRanges(windows, chapters) {
  const ownedChapters = new Map(windows.map(({ windowIndex }) => [windowIndex, []]))
  for (const chapter of chapters) {
    const windowIndex = cardWindowIndexForOffset(windows, chapters, chapter.startOffset)
    ownedChapters.get(windowIndex).push(chapter)
  }
  return windows.map((window) => {
    const owned = ownedChapters.get(window.windowIndex)
    return {
      ...window,
      // Пустой диапазон — законный ответ: окно есть, героев в нём нет.
      assignStartOffset: owned.length ? owned[0].startOffset : window.endOffset,
      assignEndOffset: owned.length ? owned[owned.length - 1].endOffset : window.endOffset
    }
  })
}

/**
 * Окно, в котором должна быть построена карточка персонажа: первое окно, чей
 * конец не раньше конца главы, следующей за главой первого упоминания.
 */
export function cardWindowIndexForOffset(windows, chapters, firstMentionTextOffset) {
  const target = cardWindowForOffset(chapters, firstMentionTextOffset)
  const found = windows.find(({ endOffset }) => endOffset >= target.endOffset)
  return found ? found.windowIndex : windows.length - 1
}
