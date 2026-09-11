/**
 * Планировщик окон карточек (P6 work order'а).
 *
 * Окна идут цепочкой: окно N+1 ставится, когда окно N закончено. Причина не в
 * экономии, а в приоритетах — если поставить все окна сразу, очередь заполнится
 * фоновыми заданиями большой книги, и окно первых глав следующей книги будет
 * ждать за ними. Цепочка держит в очереди ровно один фронт на книгу.
 *
 * Для приватной книги фронт ограничен читателем: незачем рисовать главу 40,
 * пока человек на третьей. Каталожная книга готовится целиком — её читают
 * многие, и предугадывать некого.
 */

import { CARD_MEDIA_PRIORITY } from './book-character-card.mjs'

export const CARD_WINDOW_SCHEDULE_VERSION = 'card-window-schedule-v1'

/**
 * Насколько вперёд читателя готовится приватная книга: текущая глава плюс две.
 * Плоские 10% текста, которыми это мерилось раньше, на книге в тысячу страниц
 * означали сто страниц вперёд, а на короткой — половину главы.
 */
export const PRIVATE_LOOKAHEAD_CHAPTERS = 2

/** Бюджет сцен предгенерации: окно первых глав и каждое следующее. */
export const SCENE_BUDGET_FIRST_WINDOW = 12
export const SCENE_BUDGET_PER_WINDOW = 4

function scheduleError(message) {
  return Object.assign(new TypeError(message), { code: 'CARD_WINDOW_SCHEDULE_INVALID' })
}

/**
 * Индекс главы, до которой дочитал читатель.
 *
 * Окна и главы — не одно и то же: окно 1 покрывает две первые главы, дальше по
 * одной. Считать «главу читателя» по номеру окна значит ошибиться ровно на эту
 * разницу, поэтому фронт выражается в индексах глав, а не в смещениях окон.
 */
export function readerChapterIndex(windows, readerTextOffset) {
  const ordered = [...windows].sort((left, right) => left.windowIndex - right.windowIndex)
  const containing = ordered.find(({ startOffset, endOffset }) =>
    readerTextOffset >= startOffset && readerTextOffset < endOffset)
  const target = containing ?? (
    readerTextOffset >= (ordered.at(-1)?.endOffset ?? 0) ? ordered.at(-1) : ordered[0]
  )
  const indexes = target?.chapterIndexes ?? []
  return indexes.length ? Math.max(...indexes) : target?.windowIndex ?? 0
}

/**
 * До какой главы книга готовится сейчас.
 *
 * Каталожная книга готовится целиком — её читают многие, и предугадывать
 * некого. Приватная — до главы читателя плюс {@link PRIVATE_LOOKAHEAD_CHAPTERS}:
 * незачем рисовать главу 40, пока человек на третьей.
 *
 * @returns {number} последний допустимый индекс главы; Infinity для каталога
 */
export function cardWindowChapterFrontier({
  scope,
  windows,
  readerTextOffset = 0,
  lookaheadChapters = PRIVATE_LOOKAHEAD_CHAPTERS
}) {
  if (!Array.isArray(windows) || !windows.length) {
    throw scheduleError('windows must be a non-empty array')
  }
  if (scope === 'catalog') return Number.POSITIVE_INFINITY
  if (scope !== 'private') throw scheduleError('scope must be catalog or private')
  if (!Number.isSafeInteger(readerTextOffset) || readerTextOffset < 0) {
    throw scheduleError('readerTextOffset must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(lookaheadChapters) || lookaheadChapters < 0) {
    throw scheduleError('lookaheadChapters must be a non-negative safe integer')
  }
  return readerChapterIndex(windows, readerTextOffset) + lookaheadChapters
}

/**
 * Какое окно ставить следующим.
 *
 * Возвращает null, когда ставить нечего: либо предыдущее окно ещё в работе,
 * либо следующее уже за фронтом читателя, либо окна кончились. Пока окно N в
 * работе, окно N+1 в очередь не попадает, иначе цепочка перестаёт быть
 * цепочкой.
 *
 * Статусы читаются так же, как их пишет `book_card_windows`: `queued` — окно
 * ещё не поставлено, `running` — его карточки в работе, `ready` — закончено.
 * Путать первые два нельзя: непоставленное окно как раз и надо поставить.
 *
 * @param {object} input
 * @param {Array} input.windows окна прогона со статусами и `chapterIndexes`
 * @param {number} input.maxChapterIndex результат {@link cardWindowChapterFrontier}
 */
export function nextCardWindow({ windows, maxChapterIndex }) {
  if (!Array.isArray(windows) || !windows.length) {
    throw scheduleError('windows must be a non-empty array')
  }
  if (!(typeof maxChapterIndex === 'number' && maxChapterIndex >= 0)) {
    throw scheduleError('maxChapterIndex must be a non-negative number')
  }
  const ordered = [...windows].sort((left, right) => left.windowIndex - right.windowIndex)
  if (ordered.some(({ status }) => status === 'running')) return null
  const next = ordered.find(({ status }) => status === 'queued')
  if (!next) return null
  const firstChapter = next.chapterIndexes?.length
    ? Math.min(...next.chapterIndexes)
    : next.windowIndex
  if (firstChapter > maxChapterIndex) return null
  return {
    windowIndex: next.windowIndex,
    startOffset: next.startOffset,
    endOffset: next.endOffset,
    priorityClass: next.priorityClass,
    priority: CARD_MEDIA_PRIORITY[next.priorityClass] ?? CARD_MEDIA_PRIORITY.background
  }
}

/**
 * Бюджет сцен предгенерации на окно.
 *
 * Окно первых глав получает больше: это то, что читатель увидит сразу. Дальше
 * по четыре на окно — при активном чтении приватной книги даже четыре сцены на
 * главу складываются в заметные деньги, и без этого потолка предгенерация
 * съедала бы дневной бюджет за одну книгу.
 */
export function cardWindowSceneBudget(windowIndex, {
  firstWindow = SCENE_BUDGET_FIRST_WINDOW,
  perWindow = SCENE_BUDGET_PER_WINDOW
} = {}) {
  if (!Number.isSafeInteger(windowIndex) || windowIndex < 0) {
    throw scheduleError('windowIndex must be a non-negative safe integer')
  }
  return windowIndex === 0 ? firstWindow : perWindow
}

/**
 * Сколько сцен окна ещё можно поставить.
 *
 * Превышение бюджета не роняет прогон, а откладывает сцены: карточки и
 * портреты окна от этого не страдают, а сцены — единственное, что здесь можно
 * отложить без потери смысла.
 */
export function remainingSceneBudget({ windowIndex, alreadyQueued, options } = {}) {
  const budget = cardWindowSceneBudget(windowIndex, options)
  if (!Number.isSafeInteger(alreadyQueued) || alreadyQueued < 0) {
    throw scheduleError('alreadyQueued must be a non-negative safe integer')
  }
  return Math.max(0, budget - alreadyQueued)
}
