/**
 * Матчер имён персонажей в тексте книги — порт
 * `packages/app-expo/src/lib/narra/character-name-matcher.ts` в gateway.
 *
 * Зачем порт, а не общий пакет: ридерская версия собирается esbuild'ом в
 * reader-бандл и не должна тянуть за собой server-зависимости, а gateway не
 * компилирует TypeScript. Идентичность таблиц и поведения закреплена тестом
 * `test/character-name-matcher-parity.test.mjs`, который читает TS-исходник:
 * расхождение ломает сборку, поэтому две копии не разъезжаются молча.
 *
 * Правило матчинга здесь — то же `narra-name-endings-v1`, которым посчитаны
 * mentionCount в русских gold-фикстурах (`evaluation/identity/*-ru-v1.json`),
 * поэтому инвентарь имён измеряется тем же счётчиком, что и gold.
 */

export const MIN_NAME_STEM_LENGTH = 4

export const NAME_ENDINGS = Object.freeze([
  '',
  'а',
  'я',
  'у',
  'ю',
  'е',
  'о',
  'ы',
  'и',
  'й',
  'ь',
  'ой',
  'ою',
  'ей',
  'ею',
  'ом',
  'ем',
  'ым',
  'им',
  'ам',
  'ям',
  'ах',
  'ях',
  'ами',
  'ями',
  'ье',
  'ья',
  'ью',
  'ьи'
])

export const NAME_STOPWORDS = Object.freeze([
  // титулы и обращения
  'князь',
  'княжна',
  'княгиня',
  'граф',
  'графиня',
  'барон',
  'баронесса',
  'лорд',
  'леди',
  'сэр',
  'мадам',
  'месье',
  'мистер',
  'миссис',
  'мисс',
  'пан',
  'пани',
  'дон',
  'донна',
  'фрау',
  'герр',
  'доктор',
  'профессор',
  'капитан',
  'майор',
  'полковник',
  'генерал',
  'поручик',
  'лейтенант',
  'сержант',
  'адмирал',
  'отец',
  'мать',
  'матушка',
  'батюшка',
  'брат',
  'сестра',
  'дядя',
  'тётя',
  'тетя',
  'господин',
  'госпожа',
  'товарищ',
  'святой',
  'святая',
  'царь',
  'царица',
  'король',
  'королева',
  'принц',
  'принцесса',
  'император',
  'императрица',
  // частотные слова-омонимы имён
  'вера',
  'надежда',
  'любовь',
  'воля',
  'роза',
  'лилия',
  'мир',
  'лев',
  'свет',
  'света',
  'заря',
  'земля',
  'победа',
  'слава',
  'радость',
  'правда',
  'истина'
])

const VOWELS = 'аеёиоуыэюя'

/** Основа словоформы имени: срезаем один финальный гласный, «й» или «ь». */
export function stemNameToken(token) {
  if (token.length < 2) return token
  const last = token[token.length - 1]
  if (last === 'й' || last === 'ь' || VOWELS.includes(last)) {
    return token.slice(0, -1)
  }
  return token
}

/**
 * Полные словоформы, получаемые без словаря и без матчинга по произвольному
 * продолжению основы: короткие имена (Анна → Анну) и фамилии-прилагательные
 * (Вронский → Вронского, Раневская → Раневскую).
 */
export function exactRussianNameForms(token) {
  const forms = new Set()
  const addForms = (base, endings) => {
    for (const ending of endings) forms.add(`${base}${ending}`)
  }

  const stem = stemNameToken(token)
  if (token.length >= MIN_NAME_STEM_LENGTH && stem.length < MIN_NAME_STEM_LENGTH) {
    forms.add(token)
    if (token.endsWith('а')) {
      const base = token.slice(0, -1)
      const genitiveEnding = /[гкхжчшщц]$/.test(base) ? 'и' : 'ы'
      addForms(base, [genitiveEnding, 'е', 'у', 'ой', 'ою'])
    } else if (token.endsWith('я')) {
      addForms(token.slice(0, -1), ['и', 'е', 'ю', 'ей', 'ею'])
    }
  }

  if (/(?:ск|цк)ий$/.test(token)) {
    addForms(token.slice(0, -2), ['ого', 'ому', 'им', 'ом'])
  } else if (/(?:ск|цк)ая$/.test(token)) {
    addForms(token.slice(0, -2), ['ой', 'ую', 'ою'])
  }

  return [...forms]
}

function addId(map, key, id) {
  const existing = map[key]
  if (!existing) {
    map[key] = [id]
    return
  }
  if (!existing.includes(id)) existing.push(id)
}

/** Строит спеку матчера из персонажей книги (name/fullName/aliases). */
export function buildCharacterNameMatcherSpec(characters) {
  const stems = {}
  const exact = {}
  const stopwordSet = new Set(NAME_STOPWORDS)

  for (const character of characters) {
    if (!character?.id) continue
    const raw = [character.name, character.fullName ?? '', ...(character.aliases ?? [])].join(' ')
    const tokens = raw.toLowerCase().match(/[a-zа-яё]+/g) ?? []
    for (const token of new Set(tokens)) {
      if (token.length < 3 || stopwordSet.has(token)) continue
      for (const form of exactRussianNameForms(token)) addId(exact, form, character.id)
      const stem = stemNameToken(token)
      if (stem.length >= MIN_NAME_STEM_LENGTH) addId(stems, stem, character.id)
    }
  }

  return { stems, exact, endings: [...NAME_ENDINGS], stopwords: [...NAME_STOPWORDS] }
}

const preparedCache = new WeakMap()

function prepareSpec(spec) {
  const cached = preparedCache.get(spec)
  if (cached) return cached
  const prepared = {
    stems: new Map(Object.entries(spec.stems ?? {})),
    exact: new Map(Object.entries(spec.exact ?? {})),
    stopwords: new Set(spec.stopwords ?? []),
    endings: spec.endings?.length ? spec.endings : [...NAME_ENDINGS]
  }
  preparedCache.set(spec, prepared)
  return prepared
}

function lookupWordIds(word, prepared) {
  const ids = new Set()
  const exactIds = prepared.exact.get(word)
  if (exactIds) for (const id of exactIds) ids.add(id)
  for (const ending of prepared.endings) {
    if (ending.length >= word.length) continue
    if (ending && !word.endsWith(ending)) continue
    const stem = ending ? word.slice(0, word.length - ending.length) : word
    if (stem.length < MIN_NAME_STEM_LENGTH) continue
    const stemIds = prepared.stems.get(stem)
    if (stemIds) for (const id of stemIds) ids.add(id)
  }
  return [...ids]
}

/**
 * Публичный доступ к тому же поиску по формам, которым пользуется матчер.
 * Нужен потребителям, которым важны все кандидаты, включая неоднозначные
 * (лексикон уменьшительных), тогда как `findCharacterNameMatches` намеренно
 * возвращает только однозначные упоминания.
 */
export function lookupNameFormIds(word, spec) {
  if (!word || !spec) return []
  return lookupWordIds(word.toLowerCase(), prepareSpec(spec))
}

function isUpperCaseLetter(char) {
  return /[A-ZА-ЯЁ]/.test(char)
}

/**
 * Однозначные упоминания персонажей в тексте. Соседние слова одного персонажа
 * склеиваются в один матч; неоднозначные основы матчатся только когда фраза
 * сужает кандидатов до одного («Анна Аркадьевна Каренина» — да, «Каренина»
 * при двух Карениных — нет).
 */
export function findCharacterNameMatches(text, spec) {
  if (!text || !spec) return []
  if (!/[A-ZА-ЯЁ]/.test(text)) return []
  const prepared = prepareSpec(spec)
  if (prepared.stems.size === 0 && prepared.exact.size === 0) return []

  const tokens = []
  for (const match of text.matchAll(/[A-Za-zА-Яа-яЁё]+/g)) {
    const word = match[0]
    if (match.index == null || !isUpperCaseLetter(word[0])) continue
    const lower = word.toLowerCase()
    if (prepared.stopwords.has(lower)) continue
    const ids = lookupWordIds(lower, prepared)
    if (ids.length === 0) continue
    tokens.push({ start: match.index, end: match.index + word.length, ids })
  }

  const matches = []
  let index = 0
  while (index < tokens.length) {
    const first = tokens[index]
    let candidateIds = first.ids
    let lastIncluded = index
    let next = index + 1
    while (next < tokens.length) {
      const gap = text.slice(tokens[next - 1].end, tokens[next].start)
      if (!/^\s+$/.test(gap)) break
      const intersection = candidateIds.filter((id) => tokens[next].ids.includes(id))
      if (intersection.length === 0) break
      candidateIds = intersection
      lastIncluded = next
      next += 1
    }
    if (candidateIds.length === 1 && (first.ids.length === 1 || lastIncluded > index)) {
      matches.push({
        start: first.start,
        end: tokens[lastIncluded].end,
        characterId: candidateIds[0]
      })
      index = lastIncluded + 1
    } else {
      index += 1
    }
  }
  return matches
}
