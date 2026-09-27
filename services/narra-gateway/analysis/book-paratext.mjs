/**
 * Служебный текст книги: то, что напечатано в книге, но историей не является.
 *
 * Титульный лист, благодарности, посвящение, эпиграфы, оглавление, синопсисы
 * глав и примечания переводчика читаются тем же проходом, что и роман, и имена
 * из них становились персонажами. «Кровавый меридиан» получал карточку «Джон»
 * с биографией «Автор хочет поблагодарить Фонд Линдхёрста…», «Прямо в воде?» —
 * «Катю» и «Лиз» из благодарностей за обложку.
 *
 * Вред не только в лишних героях. Имя со служебной страницы становится первым
 * упоминанием настоящего персонажа, а по первому упоминанию выбирается окно его
 * карточки. Мария Пилар из «Земли лишних» — 624 упоминания — впервые «встретилась»
 * на 13-м символе, в строке «Андрей Круз, Мария Круз» на титуле. Её карточка
 * собиралась по первым главам, где её нет, из единственной цитаты — титула, и
 * вышла «Мария Пилар — соавтор книги». Тоудвайн из «Кровавого меридиана» впервые
 * назван в синопсисе главы («Судья Холден — Скандал с дракой — Тоудвайн —
 * Поджог постоялого двора»), и модель приписала ему чужое прошлое из этого
 * перечня.
 *
 * Поэтому служебный текст не вырезается, а маскируется: буквы и цифры заменяются
 * нейтральным знаком, переводы строк остаются. Смещения, абзацы и их индексы у
 * маскированного текста те же, что у настоящего, — цитаты и окна по-прежнему
 * режутся из настоящего текста по тем же координатам, а инвентарь и сбор цитат
 * просто не видят в служебных местах ни одного слова.
 */

import { bookParagraphs } from './book-text-index.mjs'

export const PARATEXT_VERSION = 'paratext-v1'

/**
 * Знак маски. Не буква и не пробел: пробел абзац бы опустошил, и разбиение
 * выбросило бы его, сдвинув индексы всех следующих абзацев.
 */
const MASK_CHAR = '·'

/**
 * Предел служебного начала. Ведущий сегмент без пункта оглавления — титул и
 * благодарности, но бывает, что оглавление начинается со второй главы, и тогда
 * в этом сегменте лежит первая глава. Длинный сегмент поэтому не трогаем.
 */
const FRONT_MATTER_MAX_SHARE = 0.03
const FRONT_MATTER_MAX_CHARS = 20_000
/** Сегмент со служебным заголовком маскируется целиком, пока он не огромен. */
const PARATEXT_SECTION_MAX_SHARE = 0.1
/** Примечания и благодарности в конце ищутся только в хвосте книги. */
const BACK_MATTER_SHARE = 0.75
/** Без навигации служебное начало ищется по абзацам в этой голове книги. */
const HEAD_ZONE_SHARE = 0.02
const HEAD_ZONE_MAX_CHARS = 8_000
/** Синопсис главы — один из первых абзацев главы. */
const SYNOPSIS_HEAD_PARAGRAPHS = 3
const SYNOPSIS_MIN_PARTS = 4
const SYNOPSIS_MAX_PART_WORDS = 8

const PARATEXT_TITLE = new RegExp(
  '^\\s*(?:\\d+[.)]\\s*)?(?:' + [
    'содержание', 'оглавление', 'примечани[ея]', 'комментари[ийя]', 'благодарност[иь]',
    'от автора', 'об авторе', 'посвящени[ея]', 'аннотаци[яи]', 'библиографи[яи]',
    'словарь', 'глоссарий', 'указатель', 'список литературы',
    'contents', 'table of contents', 'notes', 'endnotes', 'footnotes',
    'acknowledge?ments?', 'about the authors?', 'dedication', 'copyright',
    'glossary', 'bibliography', 'index'
  ].join('|') + ')\\s*[:.]?\\s*$',
  'iu'
)

/** Заголовок хвостового раздела, стоящий отдельным абзацем внутри главы. */
const BACK_MATTER_HEADING = new RegExp(
  '^\\s*(?:' + [
    'примечания(?: переводчика| автора| редактора)?', 'комментарии', 'благодарности',
    'об авторе', 'notes', 'endnotes', "translator[’']?s notes", 'acknowledge?ments?',
    'about the authors?'
  ].join('|') + ')\\s*[:.]?\\s*$',
  'iu'
)

/**
 * Выходные данные и благодарности. Проверяются только в служебном начале: там
 * «спасибо, что поддерживаешь» — посвящение, а в романе — реплика героя.
 */
const CREDIT_PARAGRAPH = new RegExp([
  '©', '\\bISBN\\b', 'издательств', 'оформлени[ея]\\s', 'все права защищены', 'all rights reserved',
  'перевод(?:чик)?\\s+с\\s', 'translated\\s+(?:from|by)', 'хочет\\s+поблагодарить',
  // \b в JavaScript знает только латиницу: у кириллицы граница — «дальше не буква».
  'выражает\\s+признательность', 'благодар(?:ю|им|ит)(?!\\p{L})', 'спасибо,?\\s+что(?!\\p{L})',
  'спасибо\\s+каждому', '\\bthanks?\\s+to\\b', '\\bi\\s+(?:would\\s+like\\s+to\\s+)?thank\\b',
  'grateful\\s+to', 'посвящ(?:аю|ается|ение)', 'публикация\\s+на\\s+других'
].join('|'), 'iu')

const DIALOGUE_HEAD = /^[\s«"„“]*[—–-]/u

function mergeRanges(ranges) {
  const sorted = ranges
    .filter((range) => range.endOffset > range.startOffset)
    .sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset)
  const merged = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.startOffset <= last.endOffset) {
      last.endOffset = Math.max(last.endOffset, range.endOffset)
      if (!last.kinds.includes(range.kind)) last.kinds.push(range.kind)
      continue
    }
    merged.push({ startOffset: range.startOffset, endOffset: range.endOffset, kinds: [range.kind] })
  }
  return merged
}

function navigationSegments(navigation, length) {
  const segments = Array.isArray(navigation?.segments) ? navigation.segments : []
  return segments
    .filter((segment) =>
      Number.isSafeInteger(segment?.startOffset) && Number.isSafeInteger(segment?.endOffset) &&
      segment.startOffset >= 0 && segment.endOffset <= length &&
      segment.endOffset > segment.startOffset)
    .sort((left, right) => left.startOffset - right.startOffset)
}

function referencedSegmentKeys(navigation) {
  const keys = new Set()
  for (const item of Array.isArray(navigation?.items) ? navigation.items : []) {
    if (item?.key) keys.add(String(item.key))
    if (item?.sectionKey) keys.add(String(item.sectionKey))
  }
  return keys
}

function words(value) {
  return String(value).split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token))
}

/**
 * Синопсис главы: перечень событий через тире без законченных предложений —
 * «Детство в Теннесси — Уход из дома — Новый Орлеан — Драки». Абзац романа
 * тоже бывает с тире, но у него предложения и длинные части.
 */
export function isChapterSynopsis(paragraphText) {
  const value = String(paragraphText ?? '').trim()
  if (!value || DIALOGUE_HEAD.test(value)) return false
  // Точка в конце допустима, внутри — нет: внутри неё начинается предложение.
  if (/[.!?…](?=.{3,})/su.test(value)) return false
  const parts = value.split(/\s[—–]\s/u).map((part) => part.trim()).filter(Boolean)
  if (parts.length < SYNOPSIS_MIN_PARTS) return false
  return parts.every((part) => words(part).length <= SYNOPSIS_MAX_PART_WORDS)
}

/**
 * Диапазоны служебного текста, отсортированные и слитые.
 *
 * @param {string} text нормализованный текст книги
 * @param {object} [options]
 * @param {object} [options.navigation] навигация из Prepare
 * @param {Array} [options.paragraphs] абзацы, если уже посчитаны
 * @returns {Array<{startOffset:number,endOffset:number,kinds:string[]}>}
 */
export function bookParatextRanges(text, { navigation = null, paragraphs = null } = {}) {
  const source = String(text ?? '')
  const length = source.length
  if (!length) return []
  const allParagraphs = paragraphs ?? bookParagraphs(source)
  const ranges = []
  const segments = navigationSegments(navigation, length)
  const referenced = referencedSegmentKeys(navigation)

  // 1. Ведущие сегменты, на которые не ссылается оглавление: титул,
  //    благодарности, эпиграфы — всё, что стоит до первого пункта оглавления.
  let frontEnd = 0
  if (segments.length >= 2 && referenced.size) {
    const firstReferenced = segments.findIndex((segment) => referenced.has(String(segment.key)))
    if (firstReferenced > 0) frontEnd = segments[firstReferenced].startOffset
  }
  if (frontEnd > 0 && frontEnd <= Math.min(FRONT_MATTER_MAX_CHARS, length * FRONT_MATTER_MAX_SHARE)) {
    ranges.push({ startOffset: 0, endOffset: frontEnd, kind: 'front_matter' })
  } else {
    frontEnd = 0
  }

  // 2. Разделы со служебным заголовком: оглавление, примечания, об авторе.
  for (const segment of segments) {
    if (!PARATEXT_TITLE.test(String(segment.title ?? ''))) continue
    if (segment.endOffset - segment.startOffset > length * PARATEXT_SECTION_MAX_SHARE) continue
    ranges.push({ startOffset: segment.startOffset, endOffset: segment.endOffset, kind: 'paratext_section' })
  }

  // 3. Хвостовой раздел без своего пункта оглавления: «Примечания» отдельным
  //    абзацем внутри последней главы — и всё, что за ним, до конца главы.
  const segmentEndAt = (offset) =>
    segments.find((segment) => offset >= segment.startOffset && offset < segment.endOffset)?.endOffset ?? length
  for (const paragraph of allParagraphs) {
    if (paragraph.startOffset < length * BACK_MATTER_SHARE) continue
    if (!BACK_MATTER_HEADING.test(source.slice(paragraph.startOffset, paragraph.endOffset))) continue
    ranges.push({ startOffset: paragraph.startOffset, endOffset: segmentEndAt(paragraph.startOffset), kind: 'back_matter' })
    break
  }

  // 4. Без навигации служебного начала не видно по структуре — тогда выходные
  //    данные и благодарности ищутся абзацами в голове книги.
  if (!frontEnd) {
    const headLimit = Math.min(HEAD_ZONE_MAX_CHARS, Math.max(1, Math.floor(length * HEAD_ZONE_SHARE)))
    for (const paragraph of allParagraphs) {
      if (paragraph.startOffset >= headLimit) break
      const value = source.slice(paragraph.startOffset, paragraph.endOffset)
      if (DIALOGUE_HEAD.test(value) || !CREDIT_PARAGRAPH.test(value)) continue
      ranges.push({ startOffset: paragraph.startOffset, endOffset: paragraph.endOffset, kind: 'credits' })
    }
  }

  // 5. Синопсисы глав: первые абзацы главы, перечень событий через тире.
  const chapterStarts = segments.length >= 2
    ? segments.map(({ startOffset }) => startOffset)
    : [0]
  let cursor = 0
  for (const start of chapterStarts) {
    while (cursor < allParagraphs.length && allParagraphs[cursor].endOffset <= start) cursor += 1
    for (let offset = 0; offset < SYNOPSIS_HEAD_PARAGRAPHS; offset += 1) {
      const paragraph = allParagraphs[cursor + offset]
      if (!paragraph) break
      if (isChapterSynopsis(source.slice(paragraph.startOffset, paragraph.endOffset))) {
        ranges.push({ startOffset: paragraph.startOffset, endOffset: paragraph.endOffset, kind: 'chapter_synopsis' })
      }
    }
  }

  return mergeRanges(ranges)
}

/** Текст той же длины, в котором служебные места не содержат ни одного слова. */
export function maskBookParatext(text, ranges) {
  const source = String(text ?? '')
  if (!Array.isArray(ranges) || !ranges.length) return source
  let result = ''
  let cursor = 0
  for (const { startOffset, endOffset } of ranges) {
    const start = Math.max(cursor, Math.min(startOffset, source.length))
    const end = Math.max(start, Math.min(endOffset, source.length))
    result += source.slice(cursor, start)
    result += source.slice(start, end).replace(/[^\n]/gu, (char) => (/\s/u.test(char) ? char : MASK_CHAR))
    cursor = end
  }
  return result + source.slice(cursor)
}

/**
 * Текст, по которому ищутся персонажи: настоящий текст с замаскированным
 * служебным. Возвращает и сами диапазоны — их пишут в журнал подготовки.
 */
export function bookCharacterAnalysisText(text, { navigation = null } = {}) {
  const source = String(text ?? '')
  const paragraphs = bookParagraphs(source)
  const ranges = bookParatextRanges(source, { navigation, paragraphs })
  return { text: maskBookParatext(source, ranges), ranges }
}
