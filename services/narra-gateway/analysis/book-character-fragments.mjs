/**
 * Скрапер фрагментов персонажа: все абзацы, где встречается имя.
 *
 * Фрагмент — это evidence в том же смысле, в котором его сегодня требует
 * Validate: точная цитата плюс глобальные UTF-16 смещения нормализованного
 * текста. Разница в том, что цитату здесь не пишет модель, а вырезает счётчик,
 * поэтому класс ошибок EVIDENCE_MISMATCH для карточек не существует
 * конструктивно: смещения приходят из того же места, что и текст.
 *
 * Однозначность — правило ридера: поверхностная форма, принадлежащая двум
 * персонажам (общая фамилия), одиночным упоминанием не засчитывается, и только
 * фраза, сужающая кандидатов до одного («Драко Малфой»), даёт совпадение.
 */

import {
  buildCharacterNameMatcherSpec,
  findCharacterNameMatches,
  lookupNameFormIds
} from './character-name-matcher.mjs'
import { buildBookTextIndex } from './book-text-index.mjs'
import { NAME_HONORIFICS } from './book-name-inventory.mjs'

export const CHARACTER_FRAGMENTS_VERSION = 'character-fragments-v1'

/** Предел фрагментов на персонажа во входе LLM-вызова карточки. */
export const MAX_FRAGMENTS_PER_CHARACTER = 240
/** Предел длины цитаты: абзац-простыня во вход карточки не помещается. */
export const MAX_FRAGMENT_QUOTE_CHARS = 1_200

function fragmentsError(message) {
  return Object.assign(new TypeError(message), { code: 'CHARACTER_FRAGMENTS_INVALID' })
}

/**
 * Цитата фрагмента. Абзац длиннее предела обрезается вокруг первого упоминания,
 * а не с начала: смысл фрагмента — контекст имени, и обрезка с начала выкинула
 * бы именно его. Границы двигаются к пробелу, чтобы цитата оставалась цитатой,
 * и никогда не разрезают суррогатную пару.
 */
export function fragmentQuoteRange({
  text,
  paragraphStart,
  paragraphEnd,
  mentionStart,
  maxChars = MAX_FRAGMENT_QUOTE_CHARS
}) {
  if (paragraphEnd - paragraphStart <= maxChars) {
    return { startOffset: paragraphStart, endOffset: paragraphEnd }
  }
  const half = Math.floor(maxChars / 2)
  let start = Math.max(paragraphStart, Math.min(mentionStart - half, paragraphEnd - maxChars))
  let end = Math.min(paragraphEnd, start + maxChars)
  while (start > paragraphStart && !/\s/.test(text[start - 1])) start -= 1
  while (end < paragraphEnd && !/\s/.test(text[end])) end += 1
  if (isLowSurrogate(text[start])) start -= 1
  if (isLowSurrogate(text[end])) end -= 1
  return { startOffset: start, endOffset: end }
}

function isLowSurrogate(char) {
  return typeof char === 'string' && /[\uDC00-\uDFFF]/.test(char)
}

/**
 * Равномерный отбор до `limit` элементов из отсортированного списка с
 * сохранением порядка. Первый и последний фрагменты сохраняются всегда: они
 * задают границы окна, по которым сервер проверяет ссылки карточки.
 */
export function evenlySampled(items, limit) {
  if (items.length <= limit) return [...items]
  if (limit <= 0) return []
  if (limit === 1) return [items[0]]
  const step = (items.length - 1) / (limit - 1)
  const picked = []
  const seen = new Set()
  for (let index = 0; index < limit; index += 1) {
    const position = Math.round(index * step)
    if (seen.has(position)) continue
    seen.add(position)
    picked.push(items[position])
  }
  return picked
}

const WORD_PATTERN = /\p{L}+(?:[-'’ʼ]\p{L}+)*/gu

function normalizedToken(value) {
  return String(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

/**
 * Разбирает имена персонажа на обращения и базовые формы.
 *
 * Ридерский матчер обращения выбрасывает: для подсветки они не нужны. Здесь
 * они несут различие между людьми — «Mr Bennet», «Mrs Bennet» и «Miss Bennet»
 * это три персонажа с одной фамилией, и без обращения ни один из них не
 * получит ни одного фрагмента: правило однозначности справедливо откажется
 * приписывать одиночную «Bennet» кому-то одному.
 */
export function splitHonorificNames(names) {
  const honorifics = new Set()
  const baseNames = []
  for (const name of names) {
    const tokens = String(name).trim().split(/\s+/).filter(Boolean)
    let cursor = 0
    while (cursor < tokens.length && NAME_HONORIFICS.has(normalizedToken(tokens[cursor]))) {
      honorifics.add(normalizedToken(tokens[cursor]))
      cursor += 1
    }
    const base = tokens.slice(cursor).join(' ')
    if (base) baseNames.push(base)
  }
  return { honorifics: [...honorifics].sort(), baseNames }
}

/** Пары «обращение + следующее слово с заглавной» в абзаце. */
function honorificPhrases(paragraphText) {
  const words = []
  for (const match of paragraphText.matchAll(WORD_PATTERN)) {
    words.push({ value: match[0], lower: normalizedToken(match[0]), start: match.index })
  }
  const phrases = []
  for (const [position, word] of words.entries()) {
    if (!NAME_HONORIFICS.has(word.lower)) continue
    const next = words[position + 1]
    if (!next || !/^\p{Lu}/u.test(next.value)) continue
    const gap = paragraphText.slice(word.start + word.value.length, next.start)
    if (!/^\.?\s+$/.test(gap)) continue
    phrases.push({
      honorific: word.lower,
      nameToken: next.lower,
      start: word.start,
      end: next.start + next.value.length
    })
  }
  return phrases
}

/**
 * Фрагменты для набора персонажей.
 *
 * @param {object} input
 * @param {string} input.text нормализованный текст книги
 * @param {Array<{ characterKey: string, names: string[] }>} input.characters
 * @param {object} [input.navigation] `content_navigation` из Prepare
 * @param {{ startOffset: number, endOffset: number }} [input.window]
 *   окно карточки: за его пределами фрагменты не собираются, и это и есть
 *   структурный спойлер-барьер — факт из главы 8 в карточку не попадёт, потому
 *   что его текст в вызов не передаётся.
 */
export function collectBookCharacterFragments({
  text,
  characters,
  navigation = null,
  window = null,
  maxFragmentsPerCharacter = MAX_FRAGMENTS_PER_CHARACTER,
  maxQuoteChars = MAX_FRAGMENT_QUOTE_CHARS
} = {}) {
  const source = String(text ?? '')
  if (!source.length) throw fragmentsError('text must not be empty')
  if (!Array.isArray(characters) || !characters.length) {
    throw fragmentsError('characters must be a non-empty array')
  }
  if (!Number.isSafeInteger(maxFragmentsPerCharacter) || maxFragmentsPerCharacter < 1) {
    throw fragmentsError('maxFragmentsPerCharacter must be a positive integer')
  }
  const startOffset = window ? window.startOffset : 0
  const endOffset = window ? window.endOffset : source.length
  if (
    !Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
    startOffset < 0 || endOffset > source.length || endOffset <= startOffset
  ) {
    throw fragmentsError('window must be a non-empty range inside the text')
  }

  const keys = new Set()
  const sources = characters.map((character) => {
    const characterKey = String(character?.characterKey || '')
    if (!characterKey) throw fragmentsError('every character needs a characterKey')
    if (keys.has(characterKey)) throw fragmentsError(`duplicate characterKey: ${characterKey}`)
    keys.add(characterKey)
    const names = (Array.isArray(character.names) ? character.names : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
    if (!names.length) throw fragmentsError(`character ${characterKey} has no names`)
    return { characterKey, names, ...splitHonorificNames(names) }
  })
  // Персонажи с одинаковым базовым именем — одна семья с общей фамилией
  // («Mr Bennet», «Mrs Bennet», «Miss Bennet», «Bennet»). Внутри такой группы
  // одиночная фамилия достаётся ровно тому, у кого обращения нет: именно он и
  // означает «Беннет без уточнения». Если такого нет, одиночная фамилия не
  // достаётся никому — это правило однозначности ридера.
  const groups = new Map()
  for (const item of sources) {
    const groupKey = item.baseNames.map(normalizedToken).sort().join('|')
    const group = groups.get(groupKey) ?? []
    group.push(item)
    groups.set(groupKey, group)
  }
  const siblingHonorifics = new Map()
  const primarySources = []
  for (const group of groups.values()) {
    const bare = group.find(({ honorifics }) => honorifics.length === 0)
    const primary = bare ?? (group.length === 1 ? group[0] : null)
    if (primary) primarySources.push(primary)
    if (group.length > 1) {
      const honorifics = new Set(group.flatMap(({ honorifics: values }) => values))
      for (const item of group) siblingHonorifics.set(item.characterKey, honorifics)
    }
  }
  const spec = primarySources.length
    ? buildCharacterNameMatcherSpec(primarySources.map(({ characterKey, names }) =>
      ({ id: characterKey, name: names.join(' '), aliases: names })))
    : null
  // Персонажи, которых отличает только обращение, получают персональную спеку
  // по базовому имени: по ней проверяется второе слово фразы «Mrs. Bennet».
  // Тот, кто уже попал в основную спеку, второго прохода не получает: его
  // базовое имя там однозначно, и фраза с обращением дала бы то же упоминание
  // второй раз.
  const primaryKeys = new Set(primarySources.map(({ characterKey }) => characterKey))
  const honorificSources = sources
    .filter(({ characterKey, honorifics, baseNames }) =>
      honorifics.length && baseNames.length && !primaryKeys.has(characterKey))
    .map((item) => ({
      ...item,
      honorificSet: new Set(item.honorifics),
      baseSpec: buildCharacterNameMatcherSpec([
        { id: item.characterKey, name: item.baseNames.join(' '), aliases: item.baseNames }
      ])
    }))

  const index = buildBookTextIndex(source, { navigation })
  const byCharacter = new Map([...keys].map((key) => [key, new Map()]))

  // Матчинг идёт по абзацу, а не по всему тексту: фраза «Драко Малфой» не
  // должна склеиваться через границу абзаца, и правило однозначности считается
  // в том же окне, в котором его считает ридер.
  for (const paragraph of index.paragraphs) {
    if (paragraph.endOffset <= startOffset || paragraph.startOffset >= endOffset) continue
    const paragraphText = source.slice(paragraph.startOffset, paragraph.endOffset)
    const matches = (spec ? findCharacterNameMatches(paragraphText, spec) : [])
      // «Mr.» перед фамилией забирает упоминание у безобращенческого
      // однофамильца: «Mr. Bennet» — не та же строка, что «Bennet».
      .filter((match) => {
        const honorifics = siblingHonorifics.get(match.characterId)
        if (!honorifics) return true
        const before = paragraphText.slice(0, match.start).match(/(\p{L}+)\.?\s+$/u)
        return !before || !honorifics.has(normalizedToken(before[1]))
      })
    for (const phrase of honorificPhrases(paragraphText)) {
      for (const item of honorificSources) {
        if (!item.honorificSet.has(phrase.honorific)) continue
        if (!lookupNameFormIds(phrase.nameToken, item.baseSpec).length) continue
        matches.push({ start: phrase.start, end: phrase.end, characterId: item.characterKey })
      }
    }
    if (!matches.length) continue
    const chapter = index.chapterAt(paragraph.startOffset)
    for (const match of matches) {
      const mentionStart = paragraph.startOffset + match.start
      if (mentionStart < startOffset || mentionStart >= endOffset) continue
      const fragments = byCharacter.get(match.characterId)
      if (!fragments) continue
      let fragment = fragments.get(paragraph.index)
      if (!fragment) {
        const range = fragmentQuoteRange({
          text: source,
          paragraphStart: paragraph.startOffset,
          paragraphEnd: paragraph.endOffset,
          mentionStart,
          maxChars: maxQuoteChars
        })
        fragment = {
          fragmentId: `frag:${match.characterId}:${paragraph.index}`,
          characterKey: match.characterId,
          paragraphIndex: paragraph.index,
          chapterIndex: chapter ? chapter.index : -1,
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          quote: source.slice(range.startOffset, range.endOffset),
          mentionOffsets: []
        }
        fragments.set(paragraph.index, fragment)
      }
      if (!fragment.mentionOffsets.includes(mentionStart)) {
        fragment.mentionOffsets.push(mentionStart)
      }
    }
  }

  const result = []
  for (const [characterKey, fragments] of byCharacter) {
    const ordered = [...fragments.values()]
      .map((fragment) => ({
        ...fragment,
        mentionOffsets: [...fragment.mentionOffsets].sort((left, right) => left - right)
      }))
      .sort((left, right) => left.startOffset - right.startOffset)
    const mentionCount = ordered.reduce((sum, { mentionOffsets }) => sum + mentionOffsets.length, 0)
    const selected = evenlySampled(ordered, maxFragmentsPerCharacter)
    result.push({
      characterKey,
      fragmentCount: ordered.length,
      mentionCount,
      selectedCount: selected.length,
      firstMentionTextOffset: ordered[0]?.mentionOffsets[0] ?? -1,
      chapterIndexes: [...new Set(ordered
        .map(({ chapterIndex }) => chapterIndex)
        .filter((value) => value >= 0))].sort((left, right) => left - right),
      fragments: selected
    })
  }
  result.sort((left, right) =>
    right.mentionCount - left.mentionCount ||
    left.characterKey.localeCompare(right.characterKey, 'en'))
  return {
    fragmentsVersion: CHARACTER_FRAGMENTS_VERSION,
    window: { startOffset, endOffset },
    characters: result
  }
}
