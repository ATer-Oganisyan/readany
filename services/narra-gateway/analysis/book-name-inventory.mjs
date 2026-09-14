/**
 * Детерминированный инвентарь имён по всему тексту книги. Ноль LLM-вызовов.
 *
 * Зачем: сегодня персонажей *находит* сканирующий LLM-проход по каждому чанку,
 * поэтому полнота зависит от того, что модель заметила, а согласованность
 * поверхностных форм — от того, что она придумала. Инвентарь считает имена
 * счётчиком, а не моделью, и даёт пайплайну три вещи, которых у него нет:
 *
 * 1. Backstop полноты: имя, встреченное 12 раз в 3 главах, попадает в roster
 *    независимо от того, покрыла ли его хоть одна observation.
 * 2. Salience из текста, а не из мнения модели: ярус `roster` — это минимальный
 *    убывающий по частоте префикс, покрывающий {@link DEFAULT_COVERAGE}
 *    упоминаний. Это тот же протокол, которым в gold-фикстурах определён
 *    `significant`, поэтому метрика и отбор считаются по одному правилу.
 * 3. Стабильные поверхностные формы для промптов: одна нормальная форма на
 *    кластер падежных вариантов.
 *
 * Кластеризация русских падежных форм и матчинг словоформ — то же правило
 * `narra-name-endings-v1`, что в ридере и в `mentionCountProtocol` русских
 * gold-фикстур (см. `analysis/character-name-matcher.mjs`).
 */

import {
  MIN_NAME_STEM_LENGTH,
  NAME_ENDINGS,
  NAME_STOPWORDS,
  stemNameToken
} from './character-name-matcher.mjs'
import { buildBookTextIndex } from './book-text-index.mjs'
import { bookNarrationPerson } from './book-narration.mjs'

export const NAME_INVENTORY_VERSION = 'name-inventory-v1'

/** Доля упоминаний, которую обязан покрыть ярус `roster`. */
export const DEFAULT_COVERAGE = 0.95
/** Потолок roster — тот же, что у глобальной сверки имён. */
export const MAX_ROSTER_CANDIDATES = 128

const MIN_CANDIDATE_COUNT = 2
/** Своя строка для группы с обращением заводится от этой доли кластера. */
const HONORIFIC_SPLIT_SHARE = 0.08
const HONORIFIC_SPLIT_MIN = 4
/** Остаток без обращения становится своей строкой от этой доли кластера. */
const RESIDUAL_SPLIT_SHARE = 0.08
const RESIDUAL_SPLIT_MIN = 8
/**
 * Полное имя склеивается, когда редкий токен почти всегда стоит рядом с
 * частым И при этом покрывает существенную долю самого частого: «Mock» стоит
 * перед «Turtle» в 57 случаях из 59, это одно имя. Без второго условия редкое
 * имя отца («Henry» перед «Dashwood») переименовывало бы всю фамилию, которую
 * в книге носят шесть человек.
 */
const LINK_ADJACENCY_SHARE = 0.8
const LINK_ADJACENCY_MIN = 3
const LINK_MAJOR_SHARE = 0.5
/** Слово считается обычным (не именем), если оно часто встречается со строчной. */
const LOWERCASE_REJECT_SHARE = 0.25
const LOWERCASE_REJECT_MIN = 3
/** Окно соседства с речевыми глаголами — в словах, а не символах. */
const SPEECH_WINDOW_WORDS = 3
/**
 * Абсолютный порог значимости поверх частотного префикса: имя, встреченное
 * столько раз и в столько глав, значимо независимо от того, добрал ли префикс
 * свою долю упоминаний. Без этого порога персонаж со тридцатью упоминаниями
 * выпадает из яруса только потому, что главный герой книги упомянут четыреста
 * раз и один забирает почти всю долю.
 */
const SALIENCE_FLOOR_MENTIONS = 12
const SALIENCE_FLOOR_CHAPTERS = 3

/**
 * Пороги распознавания рассказчика. Оба измерены, а не выбраны: на одиннадцати
 * живых книгах доля абзацев с «я» вне реплик у книг от первого лица — 0.62 и
 * 0.71, у книг от третьего — от 0.014 до 0.22. Между ними пусто, и 0.45 лежит
 * в этой пустоте.
 *
 * Нижняя граница по числу абзацев отсекает не книги, а плохую разбивку: у двух
 * книг из замера повествовательных абзацев оказалось 36 и 56 на всю книгу, и
 * доля по такой выборке ничего не значит — одна из них дала ложные 0.55.
 *
 * Доля реплик у самого рассказчика: его зовут по имени, только когда к нему
 * обращаются, поэтому почти все упоминания его имени лежат внутри реплик. У
 * «Алексея Ивановича» это 0.95, у «Криса» 0.95, у «Кельвина» 0.82 — а у всех
 * остальных лиц тех же книг 0.29…0.63.
 */
const FIRST_PERSON_PARAGRAPH_SHARE = 0.45
const FIRST_PERSON_MIN_PARAGRAPHS = 100
const NARRATOR_DIALOGUE_SHARE = 0.75

const WORD_PATTERN = /\p{L}+(?:[-'’ʼ]\p{L}+)*/gu

/**
 * Английский клитик отрезается от слова: иначе «Dorian’s» становится формой,
 * не сводимой к «Dorian», и один персонаж превращается в двух кандидатов.
 * Апострофы внутри имён (O’Brien, D’Arcy) остаются — их продолжение не входит
 * в список клитиков.
 */
const CLITIC_SUFFIX = /['’](?:s|t|ll|d|ve|re|m)$/i

/**
 * Определители: имя собственное после них почти не встречается, а родовое
 * слово-эпитет («the Duke», «the English», «the Jew») — постоянно. Признак
 * работает по английскому тексту; в русском артиклей нет, и доля остаётся
 * нулевой, поэтому фильтр там просто не срабатывает.
 */
const DETERMINERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'every',
  'another', 'each', 'both', 'either', 'neither', 'many', 'few', 'several'
])

/**
 * Обращения: пол там, где он однозначен. Экспортируется, потому что теми же
 * обращениями скрапер фрагментов различает «Mr Bennet» и «Mrs Bennet», а
 * подтверждение roster проверяет коллизию пола.
 */
export const NAME_HONORIFICS = new Map([
  ['mr', 'male'], ['mister', 'male'], ['messrs', 'male'], ['sir', 'male'],
  ['lord', 'male'], ['master', 'male'], ['don', 'male'], ['monsieur', 'male'],
  ['herr', 'male'], ['signor', 'male'], ['senor', 'male'],
  ['mrs', 'female'], ['ms', 'female'], ['miss', 'female'], ['missus', 'female'],
  ['lady', 'female'], ['madam', 'female'], ['madame', 'female'],
  ['mademoiselle', 'female'], ['dona', 'female'], ['frau', 'female'],
  ['signora', 'female'], ['senora', 'female'],
  ['dr', null], ['doctor', null], ['prof', null], ['professor', null],
  ['rev', null], ['reverend', null], ['capt', null], ['captain', null],
  ['col', null], ['colonel', null], ['gen', null], ['general', null],
  ['lt', null], ['lieutenant', null], ['sgt', null], ['sergeant', null],
  ['major', null], ['admiral', null], ['st', null], ['saint', null],
  ['uncle', 'male'], ['aunt', 'female'], ['cousin', null],
  ['мистер', 'male'], ['мсье', 'male'],
  ['месье', 'male'], ['герр', 'male'],
  ['сэр', 'male'], ['лорд', 'male'],
  ['дон', 'male'], ['пан', 'male'],
  ['господин', 'male'],
  ['князь', 'male'], ['граф', 'male'],
  ['барон', 'male'], ['царь', 'male'],
  ['король', 'male'], ['принц', 'male'],
  ['дядя', 'male'], ['батюшка', 'male'],
  ['миссис', 'female'], ['мисс', 'female'],
  ['леди', 'female'], ['мадам', 'female'],
  ['мадемуазель', 'female'],
  ['фрау', 'female'], ['пани', 'female'],
  ['госпожа', 'female'],
  ['княжна', 'female'], ['княгиня', 'female'],
  ['графиня', 'female'], ['царица', 'female'],
  ['королева', 'female'],
  ['принцесса', 'female'],
  ['тётя', 'female'], ['тетя', 'female'],
  ['матушка', 'female'],
  ['доктор', null], ['профессор', null],
  ['капитан', null], ['майор', null],
  ['полковник', null], ['генерал', null],
  ['поручик', null], ['лейтенант', null],
  ['адмирал', null], ['святой', null]
])

/** Сокращения, после точки которых предложение не кончается: «Mr. Darcy». */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'capt', 'col', 'gen', 'lt', 'sgt', 'rev',
  'hon', 'jr', 'sr', 'prof', 'messrs', 'mme', 'mlle', 'esq', 'vol', 'ch',
  'no', 'pp', 'viz', 'i', 'e', 'g'
])

const SPEECH_VERBS = new Set([
  'said', 'says', 'say', 'saying', 'replied', 'replies', 'reply', 'asked',
  'asks', 'ask', 'answered', 'answers', 'answer', 'cried', 'cries', 'cry',
  'exclaimed', 'whispered', 'muttered', 'murmured', 'shouted', 'added',
  'remarked', 'observed', 'continued', 'returned', 'inquired', 'enquired',
  'demanded', 'declared', 'repeated', 'began', 'laughed', 'sighed', 'called',
  'thought', 'wrote', 'told'
])

/** Русские речевые глаголы задаются префиксами: спряжений слишком много. */
const RUSSIAN_SPEECH_PREFIXES = [
  'сказа', 'говор', 'отвеч',
  'ответ', 'спрос', 'восклик',
  'произн', 'шеп', 'прошеп',
  'крич', 'крикн', 'вскрик',
  'закрич', 'добав', 'замет',
  'возраз', 'подхват',
  'пробормот', 'промолв',
  'повтор', 'вздохн',
  'усмехн', 'засме', 'спрашив',
  'переби', 'обратил'
]

/** Предлоги, после которых имя чаще оказывается местом, а не человеком. */
const PLACE_PREPOSITIONS = new Set([
  'in', 'into', 'at', 'from', 'near', 'toward', 'towards', 'through',
  'across', 'beyond', 'beside', 'around',
  'в', 'во', 'на', 'из', 'под',
  'над', 'около', 'близ',
  'вокруг', 'возле', 'мимо',
  'через'
])

/**
 * Капитализованные слова, которые не бывают именами персонажа: служебные
 * слова, календарь, обращения к богу, слова оглавления. Заглавная буква у них
 * встречается и в середине предложения (в заголовках, в прямой речи), поэтому
 * фильтра «только начало предложения» недостаточно.
 */
const NON_NAME_WORDS = new Set([
  ...NAME_STOPWORDS,
  ...NAME_HONORIFICS.keys(),
  // английские служебные и частотные
  'the', 'a', 'an', 'and', 'but', 'or', 'nor', 'if', 'as', 'so', 'then',
  'than', 'that', 'this', 'these', 'those', 'there', 'here', 'when', 'where',
  'why', 'how', 'what', 'who', 'whom', 'whose', 'which', 'while', 'because',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
  'them', 'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours',
  'is', 'was', 'were', 'be', 'been', 'being', 'am', 'are', 'do', 'did',
  'does', 'have', 'has', 'had', 'will', 'would', 'shall', 'should', 'can',
  'could', 'may', 'might', 'must', 'not', 'no', 'yes', 'oh', 'ah', 'ay',
  'aye', 'well', 'now', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'from', 'into', 'upon', 'about', 'after', 'before', 'between', 'over',
  'under', 'again', 'very', 'all', 'some', 'any', 'such', 'one', 'two',
  'three', 'first', 'second', 'last', 'good', 'dear', 'poor', 'young', 'old',
  'god', 'lord', 'heaven', 'heavens', 'chapter', 'volume', 'book', 'part',
  'letter', 'contents', 'end', 'project', 'gutenberg', 'illustration',
  'footnote', 'preface', 'epilogue', 'prologue', 'appendix', 'note', 'notes',
  // демонимы, языки и конфессии: капитализованы, но человека не называют
  'english', 'french', 'greek', 'italian', 'venetian', 'british', 'american',
  'americans', 'german', 'spanish', 'russian', 'irish', 'scottish', 'scotch',
  'welsh', 'latin', 'roman', 'indian', 'chinese', 'japanese', 'persian',
  'egyptian', 'jewish', 'christian', 'catholic', 'protestant', 'jew', 'jews',
  'christ', 'europe', 'european', 'oriental', 'african', 'asian',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // русские служебные и частотные
  'и', 'а', 'но', 'или', 'если',
  'как', 'так', 'тогда', 'что',
  'чтоб', 'это', 'эти', 'этот',
  'тот', 'там', 'тут', 'здесь',
  'когда', 'где', 'почему',
  'кто', 'чей', 'который',
  'я', 'ты', 'он', 'она', 'оно',
  'мы', 'вы', 'они', 'меня',
  'его', 'её', 'ее', 'их', 'мой',
  'твой', 'свой', 'наш', 'ваш',
  'был', 'была', 'были', 'быть',
  'есть', 'нет', 'да', 'о', 'ах',
  'ох', 'ну', 'вот', 'теперь',
  'в', 'во', 'на', 'у', 'к', 'ко', 'с',
  'со', 'из', 'за', 'по', 'до', 'от',
  'для', 'при', 'про', 'над',
  'под', 'без', 'между', 'все',
  'всё', 'один', 'два',
  'первый', 'последний',
  'глава', 'часть', 'том',
  'книга', 'письмо', 'конец',
  'содержание',
  'оглавление', 'эпилог',
  'пролог', 'примечание',
  'бог', 'боже', 'господь',
  'господи', 'сегодня',
  'вчера', 'завтра',
  'январь', 'февраль',
  'март', 'апрель', 'май',
  'июнь', 'июль', 'август',
  'сентябрь', 'октябрь',
  'ноябрь', 'декабрь',
  'понедельник',
  'вторник', 'среда',
  'четверг', 'пятница',
  'суббота', 'воскресенье'
])

/**
 * Порядок предпочтения русских окончаний при выборе нормальной формы кластера.
 * Нулевое и мягкое/краткое окончание идут первыми (Гленарван, Паганель), затем
 * женское -а/-я (Татьяна, Ольга), затем косвенные падежи.
 */
const NOMINATIVE_ENDING_ORDER = [
  '', 'ь', 'й', 'а', 'я', 'о', 'ы', 'и',
  'е', 'у', 'ю', 'ой', 'ою', 'ей',
  'ею', 'ом', 'ем', 'ым', 'им',
  'ам', 'ям', 'ах', 'ях', 'ами',
  'ями', 'ье', 'ья', 'ью', 'ьи'
]
const ENDING_RANK = new Map(NOMINATIVE_ENDING_ORDER.map((ending, index) => [ending, index]))

const TRANSLITERATION = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e',
  ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
}))

function inventoryError(message) {
  return Object.assign(new TypeError(message), { code: 'NAME_INVENTORY_INVALID' })
}

function normalizedForm(value) {
  return String(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

function isCyrillic(value) {
  return /[а-яё]/.test(value)
}

function asciiSlug(value) {
  const transliterated = [...normalizedForm(value)]
    .map((char) => TRANSLITERATION.get(char) ?? char)
    .join('')
  return transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'name'
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000
}

function isSpeechWord(lower) {
  if (SPEECH_VERBS.has(lower)) return true
  return RUSSIAN_SPEECH_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

/**
 * Ключ кластера падежных форм. Латиница не склоняется, поэтому её ключ — сама
 * форма. Русские фамилии-прилагательные нормализуются отдельно и с пометкой
 * рода: склеить Вронского с Вронской значило бы слить мужа и жену.
 */
export function nameClusterKey(form, baseStemWeights = null) {
  const lower = normalizedForm(form)
  if (!isCyrillic(lower)) return lower
  const masculine = lower.match(/^(.*(?:ск|цк))(ий|ого|ому|им|ом)$/)
  if (masculine) return `${masculine[1]}:m`
  const feminine = lower.match(/^(.*(?:ск|цк))(ая|ой|ую|ою)$/)
  if (feminine) return `${feminine[1]}:f`
  const stem = stemNameToken(lower)
  const fallback = stem.length >= MIN_NAME_STEM_LENGTH ? stem : lower
  if (!baseStemWeights) return fallback
  // «Онегиным» не сводится к «онегин» отсечением одного гласного: нужен тот же
  // перебор окончаний, каким матчер ищет словоформы. Из подходящих основ
  // выбираем самую частотную — так падежная форма прирастает к своему имени,
  // а не заводит собственный кластер.
  let best = null
  let bestWeight = -1
  for (const ending of NAME_ENDINGS) {
    if (ending.length >= lower.length) continue
    if (ending && !lower.endsWith(ending)) continue
    const base = ending ? lower.slice(0, lower.length - ending.length) : lower
    if (base.length < MIN_NAME_STEM_LENGTH) continue
    const weight = baseStemWeights.get(base) ?? 0
    if (weight > bestWeight || (weight === bestWeight && best !== null && base.length < best.length)) {
      best = base
      bestWeight = weight
    }
  }
  return bestWeight > 0 ? best : fallback
}

class DisjointSet {
  constructor() {
    this.parents = new Map()
  }

  find(key) {
    if (!this.parents.has(key)) this.parents.set(key, key)
    let root = key
    while (this.parents.get(root) !== root) root = this.parents.get(root)
    let cursor = key
    while (this.parents.get(cursor) !== root) {
      const next = this.parents.get(cursor)
      this.parents.set(cursor, root)
      cursor = next
    }
    return root
  }

  union(left, right) {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot === rightRoot) return false
    this.parents.set(rightRoot, leftRoot)
    return true
  }
}

/** Слова текста с позициями и признаком начала предложения. */
function scanWords(text) {
  const words = []
  for (const match of text.matchAll(WORD_PATTERN)) {
    const value = match[0].replace(CLITIC_SUFFIX, '')
    if (!value) continue
    const start = match.index
    const previous = words[words.length - 1]
    const gap = text.slice(previous ? previous.end : 0, start)
    let sentenceInitial
    if (!previous) {
      sentenceInitial = true
    } else if (/\n[ \t]*\n/.test(gap)) {
      sentenceInitial = true
    } else if (/[.!?…:;]/.test(gap)) {
      sentenceInitial = !(/^\.[\s"'«“‘(\[]*$/.test(gap) && ABBREVIATIONS.has(previous.lower))
    } else {
      sentenceInitial = false
    }
    words.push({
      value,
      lower: normalizedForm(value),
      start,
      end: start + value.length,
      capitalized: /^\p{Lu}/u.test(value),
      sentenceInitial,
      gap
    })
  }
  return words
}

function occurrenceStatistics(words, position, index) {
  const word = words[position]
  const previous = words[position - 1]
  const next = words[position + 1]
  const paragraph = index.paragraphAt(word.start)
  const paragraphHead = paragraph
    ? index.textAt(paragraph.startOffset, Math.min(paragraph.startOffset + 3, paragraph.endOffset))
    : ''
  let speech = false
  for (let offset = -SPEECH_WINDOW_WORDS; offset <= SPEECH_WINDOW_WORDS; offset += 1) {
    const neighbour = words[position + offset]
    if (!neighbour || offset === 0) continue
    if (isSpeechWord(neighbour.lower)) {
      speech = true
      break
    }
  }
  const honorificWord = previous && /^[.\s]*$/.test(word.gap) && NAME_HONORIFICS.has(previous.lower)
    ? previous.lower
    : null
  return {
    speech,
    honorific: honorificWord,
    dialogueDash: /^[—–-]\s/.test(paragraphHead),
    possessive: index.possessiveAt(word.end),
    prepositional: Boolean(previous) && /^\s*$/.test(word.gap) &&
      PLACE_PREPOSITIONS.has(previous.lower),
    determined: Boolean(previous) && /^\s*$/.test(word.gap) &&
      DETERMINERS.has(previous.lower),
    followedByCapital: Boolean(next) && next.capitalized && /^ $/.test(next.gap),
    chapterIndex: index.chapterIndexAt(word.start)
  }
}

function emptyStats() {
  return {
    count: 0,
    midSentenceCount: 0,
    speechCount: 0,
    dialogueDashCount: 0,
    possessiveCount: 0,
    prepositionalCount: 0,
    determinedCount: 0,
    honorificCount: 0,
    chapters: new Set(),
    firstOffset: Number.POSITIVE_INFINITY,
    lastOffset: -1
  }
}

function accumulate(stats, word, occurrence) {
  stats.count += 1
  if (!word.sentenceInitial) stats.midSentenceCount += 1
  if (occurrence.speech) stats.speechCount += 1
  if (occurrence.dialogueDash) stats.dialogueDashCount += 1
  if (occurrence.possessive) stats.possessiveCount += 1
  if (occurrence.prepositional) stats.prepositionalCount += 1
  if (occurrence.determined) stats.determinedCount += 1
  if (occurrence.honorific) stats.honorificCount += 1
  if (occurrence.chapterIndex >= 0) stats.chapters.add(occurrence.chapterIndex)
  stats.firstOffset = Math.min(stats.firstOffset, word.start)
  stats.lastOffset = Math.max(stats.lastOffset, word.end)
}

function mergeStats(target, source) {
  target.count += source.count
  target.midSentenceCount += source.midSentenceCount
  target.speechCount += source.speechCount
  target.dialogueDashCount += source.dialogueDashCount
  target.possessiveCount += source.possessiveCount
  target.prepositionalCount += source.prepositionalCount
  target.determinedCount += source.determinedCount
  target.honorificCount += source.honorificCount
  for (const chapter of source.chapters) target.chapters.add(chapter)
  target.firstOffset = Math.min(target.firstOffset, source.firstOffset)
  target.lastOffset = Math.max(target.lastOffset, source.lastOffset)
}

/** Нормальная форма кластера: см. {@link NOMINATIVE_ENDING_ORDER}. */
function chooseDisplayForm(clusterKey, forms) {
  const base = clusterKey.replace(/:[mf]$/, '')
  let best = null
  for (const form of forms) {
    const lower = normalizedForm(form.value)
    const ending = lower.startsWith(base) ? lower.slice(base.length) : null
    const rank = ending === null ? NOMINATIVE_ENDING_ORDER.length : ENDING_RANK.get(ending) ?? NOMINATIVE_ENDING_ORDER.length
    const candidate = { form, rank, count: form.count }
    if (
      !best ||
      candidate.rank < best.rank ||
      (candidate.rank === best.rank && candidate.count > best.count) ||
      (candidate.rank === best.rank && candidate.count === best.count &&
        form.value.localeCompare(best.form.value, 'ru') < 0)
    ) {
      best = candidate
    }
  }
  return best?.form.value ?? ''
}

function titleCase(value) {
  return value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1)
}

function kindHint(rates) {
  if (
    rates.prepositionalRate >= 0.3 && rates.speechAdjacencyRate < 0.1 &&
    rates.honorificRate === 0 && rates.possessiveRate === 0 &&
    rates.dialogueDashRate < 0.05
  ) {
    return 'place'
  }
  if (
    rates.speechAdjacencyRate >= 0.15 || rates.honorificRate >= 0.1 ||
    rates.dialogueDashRate >= 0.2 || rates.possessiveRate >= 0.05
  ) {
    return 'person'
  }
  return 'unknown'
}

/**
 * Инвентарь имён по всему нормализованному тексту книги.
 *
 * @param {object} input
 * @param {string} input.text нормализованный текст (UTF-16 offsets)
 * @param {object} [input.navigation] `content_navigation` из Prepare
 * @param {string} [input.normalizedTextHash]
 * @param {number} [input.coverage] доля упоминаний для яруса roster
 * @param {number} [input.cap] потолок roster
 */
export function buildBookNameInventory({
  text,
  navigation = null,
  normalizedTextHash = '',
  coverage = DEFAULT_COVERAGE,
  cap = MAX_ROSTER_CANDIDATES
} = {}) {
  const source = String(text ?? '')
  if (!source.length) throw inventoryError('text must not be empty')
  if (!(coverage > 0 && coverage <= 1)) throw inventoryError('coverage must be within (0, 1]')
  if (!Number.isSafeInteger(cap) || cap < 1) throw inventoryError('cap must be a positive integer')

  const textIndex = buildBookTextIndex(source, { navigation })
  const index = {
    paragraphAt: (offset) => textIndex.paragraphAt(offset),
    chapterIndexAt: (offset) => textIndex.chapterIndexAt(offset),
    textAt: (start, end) => source.slice(start, end),
    possessiveAt: (offset) => /^['’]s(?![\p{L}])/u.test(source.slice(offset, offset + 3))
  }
  const words = scanWords(source)

  // Форма → статистика. Строчные вхождения считаются отдельно: слово, которое
  // часто встречается со строчной буквы, — обычное слово, а не имя.
  const forms = new Map()
  const lowercaseCounts = new Map()
  const occurrencesByForm = new Map()
  for (const [position, word] of words.entries()) {
    if (!word.capitalized) {
      lowercaseCounts.set(word.lower, (lowercaseCounts.get(word.lower) ?? 0) + 1)
      continue
    }
    const occurrence = occurrenceStatistics(words, position, index)
    let entry = forms.get(word.lower)
    if (!entry) {
      entry = { value: titleCase(word.value), lower: word.lower, stats: emptyStats(), casings: new Map() }
      forms.set(word.lower, entry)
      occurrencesByForm.set(word.lower, [])
    }
    entry.casings.set(word.value, (entry.casings.get(word.value) ?? 0) + 1)
    accumulate(entry.stats, word, occurrence)
    occurrencesByForm.get(word.lower).push({ position, word, occurrence })
  }

  const surviving = new Map()
  for (const [lower, entry] of forms) {
    if (lower.length < 2) continue
    if (NON_NAME_WORDS.has(lower)) continue
    // Римские цифры — нумерация глав, а не имя.
    if (/^[IVXLCDM]+$/.test(entry.value)) continue
    // Родовое слово, а не имя: «the English», «the Road». Определитель сам по
    // себе не приговор — у Кэрролла вся труппа так и зовётся («the Queen», «the
    // Hatter»), и gold принимает эти формы. Поэтому отбрасываем только то, у
    // чего вообще нет признаков человека: ни речи рядом, ни обращения, ни
    // притяжательного.
    if (
      entry.stats.determinedCount >= 0.6 * entry.stats.count &&
      entry.stats.speechCount < 0.1 * entry.stats.count &&
      entry.stats.honorificCount === 0 &&
      entry.stats.possessiveCount === 0
    ) continue
    const lowercaseCount = lowercaseCounts.get(lower) ?? 0
    const total = lowercaseCount + entry.stats.count
    if (lowercaseCount >= LOWERCASE_REJECT_MIN && lowercaseCount >= LOWERCASE_REJECT_SHARE * total) {
      continue
    }
    const [dominantCasing] = [...entry.casings].sort((left, right) =>
      right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
    surviving.set(lower, { ...entry, value: dominantCasing?.[0] ?? entry.value })
  }

  // Основы для сведения падежных форм: вес основы — сумма упоминаний форм,
  // чей однократный срез гласного даёт эту основу.
  const baseStemWeights = new Map()
  for (const [lower, entry] of surviving) {
    if (!isCyrillic(lower)) continue
    const stem = stemNameToken(lower)
    if (stem.length < MIN_NAME_STEM_LENGTH) continue
    baseStemWeights.set(stem, (baseStemWeights.get(stem) ?? 0) + entry.stats.count)
  }

  const clusters = new Map()
  const clusterKeyByForm = new Map()
  for (const [lower, entry] of surviving) {
    const key = nameClusterKey(lower, baseStemWeights)
    clusterKeyByForm.set(lower, key)
    let cluster = clusters.get(key)
    if (!cluster) {
      cluster = { key, forms: [], stats: emptyStats(), honorifics: new Map(), partners: new Map() }
      clusters.set(key, cluster)
    }
    cluster.forms.push({ value: entry.value, lower, count: entry.stats.count })
    mergeStats(cluster.stats, entry.stats)
  }

  // Обращения и соседние капитализованные слова — на кластер, а не на форму:
  // «Mr. Bennet» и «Мистеру Беннету» описывают одного человека.
  for (const [lower, entries] of occurrencesByForm) {
    const key = clusterKeyByForm.get(lower)
    if (!key) continue
    const cluster = clusters.get(key)
    for (const { position, occurrence } of entries) {
      if (occurrence.honorific) {
        cluster.honorifics.set(
          occurrence.honorific,
          (cluster.honorifics.get(occurrence.honorific) ?? 0) + 1
        )
      }
      const next = words[position + 1]
      if (!next?.capitalized) continue
      const partnerKey = clusterKeyByForm.get(next.lower)
      if (!partnerKey || partnerKey === key) continue
      cluster.partners.set(partnerKey, (cluster.partners.get(partnerKey) ?? 0) + 1)
    }
  }

  // Склейка полного имени: редкий токен, почти всегда стоящий рядом с другим
  // («Жак» перед «Паганелем»), — часть одного имени, а не отдельный персонаж.
  const links = new DisjointSet()
  const linkOrder = []
  for (const cluster of clusters.values()) {
    for (const [partnerKey, pairCount] of cluster.partners) {
      const partner = clusters.get(partnerKey)
      if (!partner) continue
      const minimum = Math.min(cluster.stats.count, partner.stats.count)
      const maximum = Math.max(cluster.stats.count, partner.stats.count)
      if (pairCount < LINK_ADJACENCY_MIN || pairCount < LINK_ADJACENCY_SHARE * minimum) continue
      if (pairCount < LINK_MAJOR_SHARE * maximum) continue
      if (links.union(cluster.key, partnerKey)) {
        linkOrder.push({ left: cluster.key, right: partnerKey, pairCount })
      }
    }
  }

  const groups = new Map()
  for (const cluster of clusters.values()) {
    const root = links.find(cluster.key)
    const group = groups.get(root) ?? { root, clusters: [] }
    group.clusters.push(cluster)
    groups.set(root, group)
  }

  const candidates = []
  for (const group of groups.values()) {
    const stats = emptyStats()
    const honorifics = new Map()
    const formList = []
    for (const cluster of group.clusters) {
      mergeStats(stats, cluster.stats)
      for (const [honorific, count] of cluster.honorifics) {
        honorifics.set(honorific, (honorifics.get(honorific) ?? 0) + count)
      }
      formList.push({
        clusterKey: cluster.key,
        display: chooseDisplayForm(cluster.key, cluster.forms),
        count: cluster.stats.count,
        forms: cluster.forms
      })
    }
    if (stats.count < MIN_CANDIDATE_COUNT) continue
    // «Только начало предложения» — признак обычного слова, но проверяется он
    // на кластере, а не на форме. Именительный падеж имени как раз и стоит в
    // начале предложения чаще всего: отбрасывая форму, мы отбирали у кластера
    // именно ту форму, которая должна была стать его нормальной.
    if (stats.midSentenceCount === 0) continue
    formList.sort((left, right) => right.count - left.count ||
      left.display.localeCompare(right.display, 'ru'))
    // Полное имя восстанавливается по порядку склейки: «Жак» + «Паганель».
    const linked = linkOrder.filter(({ left, right }) =>
      links.find(left) === group.root && links.find(right) === group.root)
    const fullName = linked.length
      ? linked.map(({ left, right }) => [left, right]
        .map((key) => formList.find((item) => item.clusterKey === key)?.display ?? '')
        .filter(Boolean).join(' ')).find(Boolean) ?? ''
      : ''
    const baseDisplay = formList[0]?.display ?? ''
    if (!baseDisplay) continue

    // Разделение по обращению: «Bennet» сам по себе не персонаж, а «Mr Bennet»,
    // «Mrs Bennet» и «Miss Bennet» — три разных человека. Группа с обращением
    // получает свою строку; остаток без обращения — свою, если он существен.
    const splitHonorifics = [...honorifics]
      .filter(([, count]) => count >= HONORIFIC_SPLIT_MIN && count >= HONORIFIC_SPLIT_SHARE * stats.count)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))
    const residual = stats.count - splitHonorifics.reduce((sum, [, count]) => sum + count, 0)
    // Каждое обращение — своя строка, и остаток без обращения — тоже своя.
    // Одна строка с двумя именами («Lady Catherine» плюс «Catherine») была бы
    // не строкой, а склейкой двух gold-персонажей: у Остин это тётя Дарси и
    // младшая Беннет, и frozen-скорер справедливо считает такое merge'ем.
    const parts = []
    for (const [honorific, count] of splitHonorifics) {
      parts.push({
        honorific,
        count,
        names: [
          `${titleCase(honorific)} ${baseDisplay}`,
          ...(fullName ? [`${titleCase(honorific)} ${fullName}`] : [])
        ]
      })
    }
    const residualQualifies = residual >= RESIDUAL_SPLIT_MIN &&
      residual >= RESIDUAL_SPLIT_SHARE * stats.count
    if (!parts.length || residualQualifies) {
      // Полное имя — каноническое: «Mock Turtle», а не «Turtle», «Жак Паганель»,
      // а не «Паганель». Короткая форма остаётся псевдонимом: это части одного
      // имени, а не две идентичности, поэтому склейкой gold-персонажей это не
      // становится.
      parts.push({
        honorific: null,
        count: parts.length ? residual : stats.count,
        names: fullName ? [fullName, baseDisplay] : [baseDisplay]
      })
    } else if (residual > 0) {
      // Остаток слишком мал для своей строки: его упоминания достаются самой
      // частой форме с обращением, чтобы не потеряться из счёта вовсе.
      parts[0].count += residual
    }

    for (const part of parts) {
      const share = stats.count > 0 ? part.count / stats.count : 0
      const rates = {
        speechAdjacencyRate: rounded(stats.speechCount / stats.count),
        dialogueDashRate: rounded(stats.dialogueDashCount / stats.count),
        honorificRate: rounded(stats.honorificCount / stats.count),
        possessiveRate: rounded(stats.possessiveCount / stats.count),
        prepositionalRate: rounded(stats.prepositionalCount / stats.count),
        determinerRate: rounded(stats.determinedCount / stats.count)
      }
      const chapterCount = stats.chapters.size
      const dispersion = textIndex.chapters.length > 0
        ? rounded(chapterCount / textIndex.chapters.length)
        : 0
      const surfaceForms = [...new Set([
        ...part.names,
        ...(part.honorific === null && fullName ? [fullName] : []),
        ...formList.flatMap(({ forms: clusterForms }) =>
          clusterForms.map(({ value }) => value))
      ])]
      candidates.push({
        candidateKey: '',
        displayName: part.names[0],
        aliases: part.names.slice(1),
        fullName: part.honorific === null ? fullName : '',
        honorific: part.honorific,
        honorificGender: part.honorific ? NAME_HONORIFICS.get(part.honorific) ?? null : null,
        surfaceForms,
        clusterKeys: formList.map(({ clusterKey }) => clusterKey),
        adjacentClusterKeys: [...new Map(group.clusters.flatMap((cluster) =>
          [...cluster.partners].filter(([partnerKey]) =>
            links.find(partnerKey) !== group.root))).entries()]
          .map(([clusterKey, count]) => ({ clusterKey, count }))
          .sort((left, right) => right.count - left.count)
          .slice(0, 8),
        count: part.count,
        midSentenceCount: Math.round(stats.midSentenceCount * share),
        sentenceInitialRatio: rounded(1 - stats.midSentenceCount / stats.count),
        chapterCount,
        chapterDispersion: dispersion,
        firstMentionTextOffset: stats.firstOffset,
        lastMentionTextOffset: stats.lastOffset,
        ...rates,
        kindHint: kindHint(rates),
        salience: rounded(part.count * (0.5 + 0.5 * dispersion)),
        tier: 'minor'
      })
    }
  }

  candidates.sort((left, right) =>
    right.count - left.count ||
    right.salience - left.salience ||
    left.displayName.localeCompare(right.displayName, 'ru'))

  const usedKeys = new Set()
  for (const candidate of candidates) {
    const base = `name:${asciiSlug(candidate.displayName)}`
    let key = base
    let suffix = 2
    while (usedKeys.has(key)) key = `${base}-${suffix++}`
    usedKeys.add(key)
    candidate.candidateKey = key
  }

  const totalMentions = candidates.reduce((sum, { count }) => sum + count, 0)

  // Групповое имя семьи: «Lucases» при наличии «Lucas», «Middletons» при
  // «Middleton». Это не персонаж, а множество персонажей, и в значимый ярус оно
  // попадать не должно. Проверка идёт по более частому единственному числу:
  // фамилия, которая сама кончается на -s («Collins»), единственного числа
  // среди кандидатов не имеет и остаётся человеком.
  const countByDisplay = new Map(candidates.map((candidate) =>
    [normalizedForm(candidate.displayName), candidate.count]))
  for (const candidate of candidates) {
    const display = normalizedForm(candidate.displayName)
    const singulars = [
      display.replace(/es$/, ''),
      display.replace(/s$/, '')
    ].filter((value) => value && value !== display)
    if (singulars.some((value) => (countByDisplay.get(value) ?? 0) > candidate.count)) {
      candidate.kindHint = 'group'
    }
  }

  // Соседство имён: «Евгений» стоит рядом с «Онегиным» и это одно лицо, но
  // общей основы у форм нет, и правило перекрытия токенов такую пару не видит.
  // Здесь она сохраняется как признак — не как склейка: решает подтверждение
  // roster, потому что рядом стоят и «Ольга» с «Ларин».
  const candidateByClusterKey = new Map()
  for (const candidate of candidates) {
    for (const clusterKey of candidate.clusterKeys) {
      const current = candidateByClusterKey.get(clusterKey)
      // Кластер, разделённый по обращению, принадлежит нескольким строкам:
      // соседство приписываем самой частой из них.
      if (!current || current.count < candidate.count) candidateByClusterKey.set(clusterKey, candidate)
    }
  }
  for (const candidate of candidates) {
    const adjacent = new Map()
    for (const { clusterKey, count } of candidate.adjacentClusterKeys ?? []) {
      const other = candidateByClusterKey.get(clusterKey)
      if (!other || other.candidateKey === candidate.candidateKey) continue
      adjacent.set(other.candidateKey, (adjacent.get(other.candidateKey) ?? 0) + count)
    }
    candidate.adjacentNames = [...adjacent.entries()]
      .map(([candidateKey, count]) => ({ candidateKey, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 8)
    delete candidate.adjacentClusterKeys
  }

  // Ярус `significant` — минимальный убывающий по частоте префикс по
  // кандидатам, не помеченным как место, покрывающий `coverage` их упоминаний,
  // с учётом ничьих на границе. Это буквально тот протокол, которым в
  // gold-фикстурах определён `significant`, поэтому отбор и метрика считаются
  // по одному правилу, а не по двум похожим.
  // Знаменатель — только кандидаты с признаками человека. «Iping», «Gables» и
  // «Quadrille» речи рядом не имеют, обращения не получают и притяжательной
  // формы не образуют; держать их в знаменателе значило бы растить ярус за счёт
  // строк, которые персонажами не станут. В backstop они остаются.
  // Рассказчик книги от первого лица. Счётчик имён видит его редко и поздно:
  // сам себя он называет «я», а по имени его зовут только собеседники. У
  // «Игрока» первое «Алексей Иванович» — на 78 364-м знаке, на 28 % книги, и
  // главный герой оказывался позади эпизодических лиц.
  //
  // Два условия сразу, потому что каждое по отдельности ошибается: книга должна
  // вестись от первого лица, а имя — встречаться почти только в репликах.
  //
  // Рассказчик в книге один, поэтому берётся ровно один — самый частый из
  // подходящих. Признак «зовут только в репликах» сам по себе не единственен:
  // у «Игрока» под него попадают ещё бабушка и её приживалка, к которым тоже
  // обращаются и о которых рассказчик говорит «она». Разница в частоте между
  // ними и рассказчиком пятикратная.
  const narration = bookNarrationPerson(source, textIndex)
  const firstPersonBook = narration.narrativeParagraphs >= FIRST_PERSON_MIN_PARAGRAPHS &&
    narration.firstPersonShare >= FIRST_PERSON_PARAGRAPH_SHARE
  const narrator = firstPersonBook
    ? candidates
      .filter((candidate) =>
        candidate.kindHint === 'person' &&
        candidate.count >= SALIENCE_FLOOR_MENTIONS &&
        candidate.dialogueDashRate >= NARRATOR_DIALOGUE_SHARE)
      .reduce(
        (best, candidate) => (!best || candidate.count > best.count ? candidate : best),
        null
      )
    : null
  if (narrator) narrator.narrator = true

  // Потолок выбирается по частоте и до всего остального. Пока его забирали
  // значимые, а ярус `roster` набирался из остатка, на книге со ста двадцатью
  // восемью персонажами остатка не оставалось вовсе — и кандидат с 94
  // упоминаниями, чей тип счётчик не смог определить, проигрывал персонажу с
  // двенадцатью. Он не попадал в состав, не получал фрагментов и не получал
  // карточки: так пропал Ян ван Тох, герой, с которого начинается «Война с
  // саламандрами». Backstop полноты обязан считать частоту, а не тип.
  const rosterKeys = new Set()
  for (const candidate of candidates) {
    if (rosterKeys.size >= cap) break
    rosterKeys.add(candidate.candidateKey)
  }

  const named = candidates.filter(({ candidateKey, kindHint }) =>
    kindHint === 'person' && rosterKeys.has(candidateKey))
  const namedMentions = named.reduce((sum, { count }) => sum + count, 0)
  const target = namedMentions * coverage
  let covered = 0
  let significantCount = 0
  for (const candidate of named) {
    if (covered >= target || significantCount >= cap) break
    covered += candidate.count
    significantCount += 1
  }
  const boundaryCount = named[significantCount - 1]?.count ?? 0
  while (
    significantCount < named.length && significantCount < cap &&
    named[significantCount].count === boundaryCount
  ) {
    covered += named[significantCount].count
    significantCount += 1
  }
  const significantKeys = new Set(
    named.slice(0, significantCount).map(({ candidateKey }) => candidateKey)
  )
  for (const candidate of named) {
    if (significantKeys.size >= cap) break
    if (
      candidate.count >= SALIENCE_FLOOR_MENTIONS &&
      candidate.chapterCount >= SALIENCE_FLOOR_CHAPTERS
    ) {
      significantKeys.add(candidate.candidateKey)
    }
  }
  // Рассказчик значим всегда: ярус считается по частоте имени, а у него имя и
  // занижено самой формой повествования.
  if (narrator && significantKeys.size < cap) significantKeys.add(narrator.candidateKey)
  significantCount = significantKeys.size
  for (const candidate of candidates) {
    candidate.tier = significantKeys.has(candidate.candidateKey) ? 'significant' : 'minor'
  }

  // Ярус `roster` — вход подтверждения состава и backstop полноты: место,
  // ошибочно помеченное как место, здесь ещё остаётся, и один LLM-вызов может
  // вернуть его в персонажи. Он и есть отобранный по частоте потолок.
  for (const candidate of candidates) {
    if (candidate.tier === 'significant') continue
    candidate.tier = rosterKeys.has(candidate.candidateKey) ? 'roster' : 'minor'
  }
  const rosterCount = rosterKeys.size

  return {
    inventoryVersion: NAME_INVENTORY_VERSION,
    normalizedTextHash: String(normalizedTextHash || ''),
    textLength: source.length,
    chapterCount: textIndex.chapters.length,
    totalMentions,
    narration: { ...narration, firstPerson: firstPersonBook },
    candidates,
    thresholds: {
      coverage,
      cap,
      significantCount,
      rosterCount,
      minorCount: candidates.length - rosterCount,
      namedMentions,
      significantMentionShare: namedMentions > 0 ? rounded(covered / namedMentions) : 0
    }
  }
}

/**
 * Ярус roster — вход подтверждения roster и скрапера: значимые кандидаты плюс
 * backstop полноты.
 */
export function inventoryRoster(inventory) {
  return (inventory?.candidates ?? [])
    .filter(({ tier }) => tier === 'significant' || tier === 'roster')
}

/**
 * Значимые кандидаты: те, кого текст называет достаточно часто, чтобы они
 * заслуживали карточку. По этому ярусу считаются precision и recall.
 */
export function inventorySignificant(inventory) {
  return (inventory?.candidates ?? []).filter(({ tier }) => tier === 'significant')
}
