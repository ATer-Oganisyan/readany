/**
 * Счётчик упоминаний для gold-фикстур идентичности (`evaluation/identity/*.json`).
 *
 * Зачем отдельный модуль. `mentionCount` в фикстуре — знаменатель яруса
 * `significant`, то есть решает, за кого метрика отвечает, а за кого нет. Такой
 * знаменатель обязан быть пересчитываемым из текста одной командой, иначе
 * фикстуру нельзя ни проверить, ни продлить на новую книгу. Две первых русских
 * фикстуры (Верн, Онегин) объявляют `narra-name-endings-v1`, но их числа этим
 * правилом не воспроизводятся — они собраны вручную; здесь правило записано
 * кодом, и число в фикстуре сверяется с текстом тестом.
 *
 * Правило `narra-name-endings-phrase-v1` — то же семейство словоформ, что у
 * ридерского матчера (`analysis/character-name-matcher.mjs`), но применённое к
 * поверхности целиком, а не к отдельному слову:
 *
 * - поверхность («Родион Романович Раскольников») — последовательность токенов;
 *   каждый токен матчится своими падежными формами по NAME_ENDINGS, между
 *   токенами допускаются пробелы и дефис («Мак-Наббс», «Каи-Куму»);
 * - первый токен обязан начинаться с заглавной: имя в тексте — имя собственное;
 *   токен-стопслово («миссис», «леди») матчится буквально, а не по основе,
 *   поэтому «Миссис Олбинет» — не то же, что «Олбинет»;
 * - совпадения всех поверхностей персонажа склеиваются в один набор без
 *   пересечений: длинное совпадение забирает диапазон себе, короткое внутри
 *   него не считается вторым упоминанием («Джон Манглс» + «Манглс» = один).
 *
 * Неоднозначность между персонажами правило не решает и решать не должно:
 * общая фамилия («Раскольников» у трёх Раскольниковых) отдаётся тому, кого так
 * называют ссылочные страницы, а пересечение фиксируется в `collisionGuards`.
 */

import {
  MIN_NAME_STEM_LENGTH,
  NAME_ENDINGS,
  NAME_STOPWORDS,
  stemNameToken
} from '../analysis/character-name-matcher.mjs'

export const MENTION_COUNT_RULE = 'narra-name-endings-phrase-v1'

const STOPWORDS = new Set(NAME_STOPWORDS)
const WORD = /[A-Za-zА-Яа-яЁё]+/g
/** Разделитель внутри имени: пробелы или дефис («Мак-Наббс», «Каи-Куму»). */
const NAME_SEPARATOR = /^[\s]*-?[\s]*$/

function tokenFormMatches(word, token) {
  const lowerWord = word.toLowerCase()
  const lowerToken = token.toLowerCase()
  if (lowerWord === lowerToken) return true
  // Стопслово матчится только буквально: иначе «Миссис Олбинет» схлопнулось бы
  // в «Олбинет» и две разные строки gold стали бы одной.
  if (STOPWORDS.has(lowerToken)) return false
  const stem = stemNameToken(lowerToken)
  if (stem.length < MIN_NAME_STEM_LENGTH) return false
  for (const ending of NAME_ENDINGS) {
    if (ending.length >= lowerWord.length) continue
    if (ending && !lowerWord.endsWith(ending)) continue
    const wordStem = ending ? lowerWord.slice(0, lowerWord.length - ending.length) : lowerWord
    if (wordStem.length >= MIN_NAME_STEM_LENGTH && wordStem === stem) return true
  }
  return false
}

/** Индекс слов текста; строится один раз на книгу и переиспользуется. */
export function buildWordIndex(text) {
  return [...String(text ?? '').matchAll(WORD)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    word: match[0]
  }))
}

/** Диапазоны, в которых текст называет персонажа этой поверхностью. */
export function surfaceSpans(text, surface, words = buildWordIndex(text)) {
  const tokens = String(surface ?? '').match(WORD) ?? []
  if (!tokens.length) return []
  const spans = []
  for (let index = 0; index + tokens.length <= words.length; index += 1) {
    if (!/^[A-ZА-ЯЁ]/.test(words[index].word)) continue
    let matched = true
    for (let offset = 0; offset < tokens.length && matched; offset += 1) {
      const current = words[index + offset]
      if (!tokenFormMatches(current.word, tokens[offset])) matched = false
      else if (offset > 0 &&
        !NAME_SEPARATOR.test(text.slice(words[index + offset - 1].end, current.start))) matched = false
    }
    if (matched) spans.push({ start: words[index].start, end: words[index + tokens.length - 1].end })
  }
  return spans
}

/**
 * Упоминания одного персонажа: объединение диапазонов всех его поверхностей,
 * без пересечений и с приоритетом более длинного совпадения.
 */
export function characterMentions(text, surfaces, words = buildWordIndex(text)) {
  const spans = []
  for (const surface of surfaces) {
    if (!surface) continue
    spans.push(...surfaceSpans(text, surface, words))
  }
  spans.sort((left, right) =>
    left.start - right.start || (right.end - right.start) - (left.end - left.start))
  const kept = []
  for (const span of spans) {
    const previous = kept[kept.length - 1]
    if (previous && span.start < previous.end) continue
    kept.push(span)
  }
  return kept
}

/** Число упоминаний и смещение первого — ровно то, что пишется в фикстуру. */
export function mentionStatistics(text, surfaces, words = buildWordIndex(text)) {
  const mentions = characterMentions(text, surfaces, words)
  return {
    mentionCount: mentions.length,
    firstMentionTextOffset: mentions.length ? mentions[0].start : -1,
    mentions
  }
}

/**
 * Ярус `significant`: минимальный префикс по убыванию упоминаний, покрывающий
 * не менее `coverage` всех упоминаний названных персонажей, вместе с
 * персонажами, стоящими на границе с тем же числом упоминаний.
 */
export function significantTier(characters, coverage = 0.95) {
  const named = characters.filter(({ unnamed }) => unnamed !== true)
  const total = named.reduce((sum, { mentionCount }) => sum + mentionCount, 0)
  const ordered = [...named].sort((left, right) =>
    right.mentionCount - left.mentionCount || left.id.localeCompare(right.id, 'en'))
  const ids = new Set()
  let covered = 0
  let boundary = 0
  for (const character of ordered) {
    if (covered >= total * coverage) break
    ids.add(character.id)
    covered += character.mentionCount
    boundary = character.mentionCount
  }
  for (const character of ordered) {
    if (character.mentionCount === boundary) ids.add(character.id)
  }
  return { ids, namedMentions: total, boundaryMentionCount: boundary }
}
