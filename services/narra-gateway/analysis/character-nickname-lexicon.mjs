/**
 * Лексикон уменьшительных и никнеймов (RU/EN).
 *
 * Задача — генератор пар-кандидатов, а НЕ автослияние: «Kitty» и «Catherine»
 * попадают в один candidate pair, но решение о склейке принимает подтверждение
 * roster с теми же hard-guards (коллизия пола, родство, со-упоминание как двух
 * участников). Лексикон закрывает класс, который перекрытие токенов не видит
 * вовсе: у «Лиззи» и «Элизабет» нет общей основы.
 *
 * Группа лексикона — каноническое имя. Одна поверхностная форма может
 * принадлежать нескольким группам («Женя» → Евгений и Евгения); пол берётся из
 * группы, поэтому неоднозначность не превращается в ложный пол.
 */

import {
  buildCharacterNameMatcherSpec,
  lookupNameFormIds
} from './character-name-matcher.mjs'

export const NICKNAME_LEXICON_VERSION = 'nickname-lexicon-v1'

/**
 * `[каноническое имя, пол, ...уменьшительные]`. Пол — только там, где он
 * однозначен для канонического имени; для парных форм заведены две группы.
 */
const RUSSIAN_GROUPS = [
  ['александр', 'male', 'саша', 'сашка', 'саня', 'шура', 'алекс'],
  ['александра', 'female', 'саша', 'сашенька', 'шура', 'аля'],
  ['алексей', 'male', 'алёша', 'алеша', 'лёша', 'леша'],
  ['анатолий', 'male', 'толя', 'толик'],
  ['анна', 'female', 'аня', 'анюта', 'нюра', 'нюша', 'ася'],
  ['антонина', 'female', 'тоня'],
  ['аркадий', 'male', 'аркаша'],
  ['борис', 'male', 'боря'],
  ['вадим', 'male', 'вадик'],
  ['валентин', 'male', 'валя'],
  ['валентина', 'female', 'валя'],
  ['василий', 'male', 'вася', 'васька'],
  ['вениамин', 'male', 'веня'],
  ['виктор', 'male', 'витя'],
  ['виктория', 'female', 'вика'],
  ['владимир', 'male', 'володя', 'вова', 'вовка'],
  ['всеволод', 'male', 'сева'],
  ['вячеслав', 'male', 'слава'],
  ['галина', 'female', 'галя'],
  ['геннадий', 'male', 'гена'],
  ['георгий', 'male', 'жора', 'гоша'],
  ['григорий', 'male', 'гриша'],
  ['дарья', 'female', 'даша', 'дашенька'],
  ['дмитрий', 'male', 'дима', 'митя'],
  ['евгений', 'male', 'женя'],
  ['евгения', 'female', 'женя'],
  ['евдокия', 'female', 'дуня', 'дуняша'],
  ['екатерина', 'female', 'катя', 'катенька', 'катюша'],
  ['елена', 'female', 'лена', 'алёна', 'алена'],
  ['елизавета', 'female', 'лиза', 'лизавета', 'лизонька'],
  ['зинаида', 'female', 'зина'],
  ['иван', 'male', 'ваня', 'ванька', 'ванюша'],
  ['илья', 'male', 'илюша'],
  ['ирина', 'female', 'ира', 'ириша'],
  ['клавдия', 'female', 'клава'],
  ['константин', 'male', 'костя'],
  ['лариса', 'female', 'лара'],
  ['леонид', 'male', 'лёня', 'леня'],
  ['лидия', 'female', 'лида'],
  ['людмила', 'female', 'люда', 'люся', 'мила'],
  ['мария', 'female', 'маша', 'машенька', 'маруся'],
  ['марфа', 'female', 'марфуша'],
  ['матвей', 'male', 'мотя'],
  ['михаил', 'male', 'миша', 'мишка', 'мишенька'],
  ['наталья', 'female', 'наташа', 'ната'],
  ['николай', 'male', 'коля', 'колька', 'николаша'],
  ['ольга', 'female', 'оля', 'олечка'],
  ['павел', 'male', 'паша', 'павлуша'],
  ['пётр', 'male', 'петя', 'петруша'],
  ['петр', 'male', 'петя', 'петруша'],
  ['платон', 'male', 'платоша'],
  ['прасковья', 'female', 'параша'],
  ['раиса', 'female', 'рая'],
  ['родион', 'male', 'родя'],
  ['семён', 'male', 'сеня', 'сёма'],
  ['семен', 'male', 'сеня', 'сема'],
  ['сергей', 'male', 'серёжа', 'сережа', 'серёга'],
  ['софья', 'female', 'соня', 'сонечка'],
  ['софия', 'female', 'соня'],
  ['степан', 'male', 'стёпа', 'степа'],
  ['тамара', 'female', 'тома'],
  ['татьяна', 'female', 'таня', 'танюша', 'танечка'],
  ['фёдор', 'male', 'федя', 'федька'],
  ['федор', 'male', 'федя', 'федька'],
  ['юрий', 'male', 'юра', 'юрочка'],
  ['яков', 'male', 'яша']
]

const ENGLISH_GROUPS = [
  ['albert', 'male', 'bert'],
  ['alexander', 'male', 'alec', 'aleck', 'sandy', 'alex'],
  ['alfred', 'male', 'alf'],
  ['amelia', 'female', 'amy', 'millie'],
  ['andrew', 'male', 'andy', 'drew'],
  ['ann', 'female', 'nan', 'nancy', 'annie'],
  ['anne', 'female', 'nan', 'nancy', 'annie'],
  ['anthony', 'male', 'tony'],
  ['antoinette', 'female', 'nettie'],
  ['augustus', 'male', 'gus'],
  ['beatrix', 'female', 'trixie'],
  ['benjamin', 'male', 'ben', 'benny'],
  ['catherine', 'female', 'kitty', 'kate', 'katie', 'cathy', 'cate'],
  ['charles', 'male', 'charlie', 'chuck', 'chas'],
  ['charlotte', 'female', 'lottie'],
  ['christopher', 'male', 'chris', 'kit'],
  ['constance', 'female', 'connie'],
  ['daniel', 'male', 'dan', 'danny'],
  ['dorothy', 'female', 'dolly', 'dora'],
  ['edward', 'male', 'ted', 'teddy', 'ned', 'eddie'],
  ['eleanor', 'female', 'nell', 'nelly', 'ellie'],
  ['elizabeth', 'female', 'lizzy', 'lizzie', 'liza', 'eliza', 'beth', 'bessie', 'bess', 'betsy', 'betty', 'libby'],
  ['emily', 'female', 'emmy'],
  ['euphemia', 'female', 'effie'],
  ['florence', 'female', 'flossie'],
  ['frances', 'female', 'fanny', 'frankie'],
  ['francis', 'male', 'frank'],
  ['frederick', 'male', 'fred', 'freddy'],
  ['george', 'male', 'georgie'],
  ['gregory', 'male', 'greg'],
  ['harold', 'male', 'harry', 'hal'],
  ['helen', 'female', 'nelly', 'nell'],
  ['henrietta', 'female', 'hetty', 'etta'],
  ['henry', 'male', 'harry', 'hal', 'hank'],
  ['james', 'male', 'jim', 'jimmy', 'jamie'],
  ['jane', 'female', 'jenny', 'janie', 'jennie'],
  ['jessica', 'female', 'jessie'],
  ['john', 'male', 'jack', 'johnny', 'jock'],
  ['joseph', 'male', 'joe', 'joey'],
  ['josephine', 'female', 'josie'],
  ['katherine', 'female', 'kate', 'katie', 'kitty'],
  ['lawrence', 'male', 'larry', 'laurie'],
  ['margaret', 'female', 'meg', 'maggie', 'peggy', 'greta'],
  ['martha', 'female', 'patty', 'mattie'],
  ['mary', 'female', 'molly', 'polly', 'mamie'],
  ['matthew', 'male', 'matt'],
  ['michael', 'male', 'mike', 'mickey'],
  ['mildred', 'female', 'milly'],
  ['nicholas', 'male', 'nick', 'nicky'],
  ['patrick', 'male', 'paddy'],
  ['philip', 'male', 'phil', 'pip'],
  ['raymond', 'male', 'ray'],
  ['rebecca', 'female', 'becky', 'becca'],
  ['richard', 'male', 'dick', 'rick', 'richie'],
  ['robert', 'male', 'bob', 'bobby', 'rob', 'robin'],
  ['ronald', 'male', 'ronnie'],
  ['samuel', 'male', 'sam', 'sammy'],
  ['sarah', 'female', 'sally', 'sadie'],
  ['stephen', 'male', 'steve', 'stevie'],
  ['susan', 'female', 'susie', 'suky'],
  ['teresa', 'female', 'tess', 'tessa'],
  ['theodore', 'male', 'ted', 'teddy'],
  ['thomas', 'male', 'tom', 'tommy'],
  ['timothy', 'male', 'tim', 'timmy'],
  ['victoria', 'female', 'vicky', 'vickie'],
  ['walter', 'male', 'walt', 'wally'],
  ['wilhelmina', 'female', 'minnie', 'willa'],
  ['william', 'male', 'bill', 'billy', 'will', 'willie'],
  ['winifred', 'female', 'winnie', 'freda']
]

function buildGroups() {
  const groups = []
  for (const [language, rows] of [['ru', RUSSIAN_GROUPS], ['en', ENGLISH_GROUPS]]) {
    for (const [canonical, gender, ...diminutives] of rows) {
      groups.push(Object.freeze({
        groupId: `${language}:${canonical}`,
        language,
        canonical,
        gender,
        surfaces: Object.freeze([...new Set([canonical, ...diminutives])])
      }))
    }
  }
  return Object.freeze(groups)
}

export const NICKNAME_LEXICON_GROUPS = buildGroups()

const GROUP_BY_ID = new Map(NICKNAME_LEXICON_GROUPS.map((group) => [group.groupId, group]))

/**
 * Спека матчера по всем поверхностным формам лексикона: русские падежные формы
 * («Лизе», «Танечку») ловятся тем же правилом `narra-name-endings-v1`, что и
 * имена персонажей, поэтому лексикон работает на склоняемом тексте.
 */
const LEXICON_SPEC = buildCharacterNameMatcherSpec(
  NICKNAME_LEXICON_GROUPS.map(({ groupId, surfaces }) => ({
    id: groupId,
    name: surfaces.join(' ')
  }))
)

function normalizedSurface(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

const EXACT_GROUPS = (() => {
  const index = new Map()
  for (const group of NICKNAME_LEXICON_GROUPS) {
    for (const surface of group.surfaces) {
      const key = normalizedSurface(surface)
      const values = index.get(key) ?? new Set()
      values.add(group.groupId)
      index.set(key, values)
    }
  }
  return index
})()

/**
 * Группы лексикона, которым может принадлежать поверхностная форма. Имя из
 * нескольких слов проверяется по каждому слову: «Лиззи Беннет» находит группу
 * `en:elizabeth` по первому токену.
 */
export function nicknameGroupsForSurface(surface) {
  const normalized = normalizedSurface(surface)
  if (!normalized) return []
  const found = new Set(EXACT_GROUPS.get(normalized) ?? [])
  for (const token of normalized.split(' ')) {
    for (const groupId of EXACT_GROUPS.get(token) ?? []) found.add(groupId)
    for (const groupId of lookupNameFormIds(token, LEXICON_SPEC)) found.add(groupId)
  }
  return [...found].sort()
}

/**
 * Пол, на который однозначно указывает лексикон. Форма из двух групп разного
 * пола («Женя») пола не даёт — в этом и смысл вернуть null, а не угадать.
 */
export function nicknameGenderForSurface(surface) {
  const genders = new Set(
    nicknameGroupsForSurface(surface)
      .map((groupId) => GROUP_BY_ID.get(groupId)?.gender)
      .filter(Boolean)
  )
  return genders.size === 1 ? [...genders][0] : null
}

/**
 * Пары кандидатов между переданными сущностями: две сущности связываются, если
 * их имена попадают в одну группу лексикона и при этом ни один нормализованный
 * токен не совпадает буквально — буквальное совпадение уже видят правила
 * перекрытия токенов, и дублировать их здесь незачем.
 *
 * @param {Array<{ key: string, names: string[] }>} candidates
 */
export function nicknameCandidatePairs(candidates) {
  const rows = []
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = String(candidate?.key || '')
    if (!key) continue
    const names = (Array.isArray(candidate.names) ? candidate.names : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
    const groups = new Set()
    for (const name of names) {
      for (const groupId of nicknameGroupsForSurface(name)) groups.add(groupId)
    }
    if (!groups.size) continue
    rows.push({
      key,
      groups,
      tokens: new Set(names.flatMap((name) => normalizedSurface(name).split(' ')).filter(Boolean))
    })
  }

  const pairs = new Map()
  for (const [index, left] of rows.entries()) {
    for (const right of rows.slice(index + 1)) {
      const shared = [...left.groups].filter((groupId) => right.groups.has(groupId)).sort()
      if (!shared.length) continue
      if ([...left.tokens].some((token) => right.tokens.has(token))) continue
      const [leftKey, rightKey] = [left.key, right.key].sort()
      const groupId = shared[0]
      pairs.set(`${leftKey}\u0000${rightKey}`, {
        leftKey,
        rightKey,
        basis: 'nickname_lexicon',
        groupId,
        canonical: GROUP_BY_ID.get(groupId)?.canonical ?? '',
        gender: GROUP_BY_ID.get(groupId)?.gender ?? null
      })
    }
  }
  return [...pairs.values()].sort((left, right) =>
    left.leftKey.localeCompare(right.leftKey, 'en') ||
    left.rightKey.localeCompare(right.rightKey, 'en')
  )
}
