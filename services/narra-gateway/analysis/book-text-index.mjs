/**
 * Позиционный индекс нормализованного текста книги: абзацы и главы.
 *
 * Один индекс на весь текст переиспользуют инвентарь имён (разброс по главам),
 * скрапер фрагментов (абзац как единица фрагмента) и окна карточек (граница
 * спойлер-барьера). Все смещения — UTF-16 code units нормализованного текста,
 * тот же счёт, что у `content_navigation.segments` и у evidence-offsets.
 */

export const BOOK_TEXT_INDEX_VERSION = 'book-text-index-v1'

/** Ширина синтетической главы для книг без навигации (TXT без заголовков). */
export const FALLBACK_CHAPTER_CHARS = 30_000

function indexError(message) {
  return Object.assign(new TypeError(message), { code: 'BOOK_TEXT_INDEX_INVALID' })
}

/**
 * Абзацы: максимальные непустые куски между разрывами из двух и более
 * переводов строки. Если книга нормализована в одиночные переводы строки,
 * разделителем становится один перевод — иначе весь текст был бы одним абзацем
 * и фрагмент перестал бы быть цитируемым.
 */
export function bookParagraphs(text) {
  const source = String(text ?? '')
  if (!source.length) return []
  const separator = /\n[ \t]*\n/.test(source) ? /(?:\n[ \t]*)+\n/g : /\n/g
  const paragraphs = []
  let cursor = 0
  const push = (startOffset, endOffset) => {
    let start = startOffset
    let end = endOffset
    while (start < end && /\s/.test(source[start])) start += 1
    while (end > start && /\s/.test(source[end - 1])) end -= 1
    if (end > start) paragraphs.push({ index: paragraphs.length, startOffset: start, endOffset: end })
  }
  for (const match of source.matchAll(separator)) {
    push(cursor, match.index)
    cursor = match.index + match[0].length
  }
  push(cursor, source.length)
  return paragraphs
}

function fallbackChapters(text, paragraphs) {
  const length = String(text ?? '').length
  if (!length) return []
  if (!paragraphs.length) {
    return [{ index: 0, key: 'window:1', title: '', startOffset: 0, endOffset: length }]
  }
  const chapters = []
  let startOffset = 0
  for (const paragraph of paragraphs) {
    if (paragraph.endOffset - startOffset < FALLBACK_CHAPTER_CHARS) continue
    chapters.push({
      index: chapters.length,
      key: `window:${chapters.length + 1}`,
      title: '',
      startOffset,
      endOffset: paragraph.endOffset
    })
    startOffset = paragraph.endOffset
  }
  if (startOffset < length || !chapters.length) {
    chapters.push({
      index: chapters.length,
      key: `window:${chapters.length + 1}`,
      title: '',
      startOffset,
      endOffset: length
    })
  } else {
    chapters[chapters.length - 1].endOffset = length
  }
  return chapters
}

/**
 * Главы книги. Навигация из Prepare — источник истины; книги без оглавления
 * (единственный сегмент `fixed:document`) получают синтетические окна по
 * {@link FALLBACK_CHAPTER_CHARS} символов с границей на абзаце, как требует
 * work order: спойлер-барьер тогда грубее, но он есть.
 */
export function bookChapters(text, { navigation, paragraphs } = {}) {
  const length = String(text ?? '').length
  const segments = Array.isArray(navigation?.segments) ? navigation.segments : []
  const usable = segments
    .filter((segment) =>
      Number.isSafeInteger(segment?.startOffset) &&
      Number.isSafeInteger(segment?.endOffset) &&
      segment.endOffset > segment.startOffset &&
      segment.startOffset >= 0 &&
      segment.endOffset <= length)
    .sort((left, right) => left.startOffset - right.startOffset)
  if (usable.length < 2) {
    return fallbackChapters(text, paragraphs ?? bookParagraphs(text))
  }
  return usable.map((segment, index) => ({
    index,
    key: String(segment.key || `segment:${index + 1}`),
    title: String(segment.title || ''),
    startOffset: segment.startOffset,
    endOffset: index === usable.length - 1 ? length : usable[index + 1].startOffset
  })).filter((chapter) => chapter.endOffset > chapter.startOffset)
    .map((chapter, index) => ({ ...chapter, index }))
}

/**
 * Индекс диапазонов, отсортированных по startOffset и не пересекающихся.
 * Возвращает индекс диапазона, содержащего смещение, или -1.
 */
function createRangeLookup(ranges) {
  const starts = ranges.map(({ startOffset }) => startOffset)
  return function lookup(offset) {
    if (!Number.isFinite(offset) || !ranges.length) return -1
    let low = 0
    let high = starts.length - 1
    let found = -1
    while (low <= high) {
      const middle = (low + high) >> 1
      if (starts[middle] <= offset) {
        found = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    if (found < 0) return -1
    return offset < ranges[found].endOffset ? found : -1
  }
}

export function buildBookTextIndex(text, { navigation } = {}) {
  const source = String(text ?? '')
  if (!source.length) throw indexError('text must not be empty')
  const paragraphs = bookParagraphs(source)
  const chapters = bookChapters(source, { navigation, paragraphs })
  const paragraphAt = createRangeLookup(paragraphs)
  const chapterAt = createRangeLookup(chapters)
  return {
    version: BOOK_TEXT_INDEX_VERSION,
    textLength: source.length,
    paragraphs,
    chapters,
    paragraphIndexAt: paragraphAt,
    /**
     * Глава по смещению. Между главами дыр нет (сегменты навигации
     * контигуозны), но смещение за концом текста даёт -1, а не последнюю главу:
     * молчаливое приписывание к последней главе сломало бы спойлер-барьер.
     */
    chapterIndexAt: chapterAt,
    paragraphAt(offset) {
      const index = paragraphAt(offset)
      return index < 0 ? null : paragraphs[index]
    },
    chapterAt(offset) {
      const index = chapterAt(offset)
      return index < 0 ? null : chapters[index]
    }
  }
}
