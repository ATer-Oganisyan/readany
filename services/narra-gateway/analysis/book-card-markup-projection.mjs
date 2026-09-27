/**
 * Проекция карточек и фрагментов в модель снапшота (P7 work order'а).
 *
 * Совместимость здесь достигается не обещанием, а формой данных. Validate,
 * ассемблер `book-markup-v3`, TTS sidecar, чат и граф читают наблюдения и
 * сущности снапшота; значит, конвейер карточек должен отдать именно наблюдения
 * и сущности, а не «что-то похожее». Тогда существующая проверка работает без
 * изменений — и если проекция врёт, падает она, а не потребитель через месяц.
 *
 * Перевод устроен так:
 *
 * - фрагмент — уже evidence в нужном смысле: точная цитата с глобальными
 *   смещениями. Наблюдение из него получается добавлением типа;
 * - тип наблюдения диктует потребитель. Validate требует, чтобы `role`
 *   ссылался на `character_role`, `age` — на `character_age`, черта — на
 *   поведенческие типы. Один фрагмент, процитированный и ролью, и чертой, даёт
 *   два наблюдения с разными типами и разными id: тип — это утверждение о том,
 *   чем цитата служит, а не свойство абзаца;
 * - карточка становится профилем персонажа v3, а подтверждённый персонаж —
 *   сущностью `character` со статусом `confirmed`.
 *
 * Ограничение Validate, которое стоит помнить: `fullName` персонажа обязан
 * совпадать с каноническим именем сущности, иначе проверка считает это
 * расхождением идентичности. Поэтому полное имя карточки уходит в псевдонимы,
 * а не в `fullName`.
 */

import { cardBioLeadName } from './book-character-card.mjs'
import { createHash } from 'node:crypto'
import {
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION
} from './book-analysis-contracts.mjs'

export const CARD_MARKUP_PROJECTION_VERSION = 'card-markup-projection-v1'

/** Тип наблюдения под каждое поле карточки — так, как их требует Validate. */
const CLAIM_OBSERVATION_TYPES = Object.freeze({
  role: 'character_role',
  age: 'character_age',
  gender: 'character_gender',
  bio: 'character_mention',
  trait: 'character_action',
  location: 'character_mention',
  identity: 'character_mention'
})

function projectionError(code, message) {
  return Object.assign(new Error(message), { code })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

/** Тот же хэш, которым Validate проверяет замороженные наборы. */
export function projectionContentHash(value) {
  return sha256(JSON.stringify(canonical(value)))
}

function observationId(fragmentId, type) {
  return `${fragmentId}:${type}`
}

function claimFrom(claim, type, allowed) {
  if (!claim) return null
  const ids = claim.fragmentIds.filter((fragmentId) => allowed.has(fragmentId))
  if (!ids.length) return null
  return {
    value: claim.value,
    evidenceIds: ids.map((fragmentId) => observationId(fragmentId, type)),
    confidence: typeof claim.confidence === 'number' ? claim.confidence : 0.9
  }
}

/**
 * Одного человека, разошедшегося на несколько карточек, выдаёт его же биография.
 *
 * Состав книги закрепляется до того, как модель напишет карточки, и голое имя
 * успевает стать отдельным персонажем. Но, сочиняя биографию для «Роберта»,
 * модель начинает её словами «Роберт Паглиньо — друг детства рассказчика» —
 * то есть сама называет, кто это. То же на «Аяксе», чья биография начинается
 * с «Аякс Теламонид», и на «Duke», чья — с «Duke Senior».
 *
 * Признак различает и обратные случаи: у сестёр Торп и близнецов Дэви с Дорой
 * биографии начинаются каждая со своего имени, и они остаются врозь.
 *
 * Ограда от родни под общей фамилией: сливаются только карточки, чьи имена
 * целиком набраны из слов этого общего начала. «Роберт» и «Паглиньо» набраны
 * из «Роберта Паглиньо» и сходятся под полным именем. «Mr Price» из «Fanny
 * Price» не набирается — слова «mr» там нет, и это её отец. Так же разъезжаются
 * «Sir Felix Glyde» и «Sir Percival Glyde», «Крылов» и «Лизавета Сергеевна
 * Крылова» (в «Крылове» нет ни одного слова жены), «Anne Thorpe» и «Maria
 * Thorpe» при общем «Anne Thorpe».
 *
 * Прозвище проходит по второму допуску: карточка «Паг» набрана не из слов
 * «Роберта Паглиньо», но сама перечисляет это имя среди своих псевдонимов —
 * значит, речь о нём же. Своим именем родственника карточки не зовут, поэтому
 * ограда держится.
 *
 * «Глостера» к «Ричарду» и «Бедного Тома» к «Эдгару» правило не соберёт, пока
 * ни разбор по словам, ни псевдонимы их не связывают. Это намеренно: такое
 * прозвище не отличить от родственника, о котором зашла речь в первых словах
 * чужой биографии.
 */
const BIO_LEAD_MIN_LENGTH = 4
const BIO_LEAD_SEPARATOR = /^(.{0,44}?)(\s[—–-]\s|\sis\s|\swas\s|,\s|\.\s|\.$)/u
const NAME_TOKEN_SEPARATOR = /[^\p{L}\p{N}]+/u

function bioLeadName(card) {
  const bio = String(card?.bio?.value ?? '').trim()
  if (!bio) return ''
  const lead = (BIO_LEAD_SEPARATOR.exec(bio)?.[1] ?? '').trim()
  return lead.length >= BIO_LEAD_MIN_LENGTH ? lead : ''
}

function nameTokens(name) {
  return String(name ?? '').toLowerCase().split(NAME_TOKEN_SEPARATOR).filter(Boolean)
}

/**
 * Уменьшительное: «Лав» из «Прямо в воде?» — это Лаванда Браун, и обе карточки
 * начинались словами «пресс-секретарь Министерства магии, бывшая однокурсница
 * Гермионы». Начало имени само по себе ничего не доказывает — «Ник» бывает и
 * Никитой, и Николаем, — поэтому нужна ещё и одна и та же роль. Роль берётся из
 * первого предложения биографии: дальше биографии одного человека расходятся
 * подробностями, и по всему тексту совпадение тонуло в различиях.
 */
const DIMINUTIVE_MIN_LENGTH = 3
const DIMINUTIVE_ROLE_OVERLAP = 0.5
const ROLE_WORD_MIN_LENGTH = 4
const ROLE_STEM_LENGTH = 5
/** Полное имя из биографии: два-три слова с заглавной, как «Ричард Нолл». */
const FULL_NAME_MAX_TOKENS = 3

/** Основы слов роли: первое предложение биографии после имени. */
function bioRoleStems(card, name = card.name) {
  const bio = String(card?.bio?.value ?? '')
  const lead = cardBioLeadName(bio)
  const rest = lead ? bio.slice(bio.indexOf(lead) + lead.length) : bio
  const firstSentence = rest.split(/[.!?…](?:\s|$)/u)[0] ?? rest
  const own = new Set(nameTokens([name, card.name, ...(card.aliases ?? [])].join(' ')))
  return new Set((firstSentence.toLowerCase().match(/\p{L}+/gu) ?? [])
    .filter((word) => word.length >= ROLE_WORD_MIN_LENGTH && !own.has(word))
    .map((word) => word.slice(0, ROLE_STEM_LENGTH)))
}

/** Доля общих основ от меньшего набора: у короткой роли не штраф за длинную. */
function overlap(left, right) {
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const item of left) if (right.has(item)) shared += 1
  return shared / Math.min(left.size, right.size)
}

/**
 * Полное имя, которым биография называет персонажа с однословным именем:
 * «Нолл» с биографией «Нолл Ричардс — капитан» — это «Нолл Ричардс».
 * Имя берётся, только если оно содержит имя карточки, и только из двух-трёх
 * слов с заглавной: «Военный — вербовщик» полным именем не становится.
 * Выдуманное полное имя сюда не доходит: его отвергает приёмка карточки.
 */
function fullNameFromBio(card) {
  const tokens = nameTokens(card.name)
  if (!tokens.length || tokens.length > FULL_NAME_MAX_TOKENS) return ''
  const lead = cardBioLeadName(card?.bio?.value)
  const words = lead.split(/\s+/u).filter(Boolean)
  if (words.length < 2 || words.length > FULL_NAME_MAX_TOKENS) return ''
  const leadTokens = nameTokens(lead)
  if (!tokens.every((token) => leadTokens.includes(token))) return ''
  // Полнее — больше слов, или те же слова в том порядке, в каком их даёт
  // биография: «Родман Спенсер» из состава — это «Спенсер Родман Четвертый».
  return leadTokens.join(' ') === tokens.join(' ') ? '' : lead
}

/**
 * Полное имя в скобках сразу за именем биографии: «Скар (Скарлетт Йорк) —
 * коллега Драко», «Дэйви (Дэвид Браун) — участник отряда». Модель сама
 * говорит, кто это; остаётся найти карточку с этим именем.
 */
function parentheticalName(card) {
  const bio = String(card?.bio?.value ?? '').trim()
  const lead = cardBioLeadName(bio)
  if (!lead) return ''
  const match = /^\s*\(([^()]{2,60})\)/u.exec(bio.slice(lead.length))
  return match ? cardBioLeadName(match[1]) : ''
}

/**
 * Оборот, которым биография сама называет второе имя человека: «Холден,
 * известный как судья», «Дэвид Браун, которого товарищи называют Дэйви»,
 * «Ирвинг, по прозвищу Док». Это прямое утверждение модели по цитатам, а не
 * догадка по сходству, и сильнее него у проекции признака нет.
 */
const ALIAS_STATEMENT = new RegExp(
  '(?:называ\\p{L}*|зовут|прозва\\p{L}*|клич\\p{L}*|по\\s+прозвищу|по\\s+кличке|' +
  'известн\\p{L}*\\s+как|он\\s+же|она\\s+же|a\\.?k\\.?a\\.?|known\\s+as|nicknamed|called)' +
  "\\s+[«\"„“]?(\\p{L}[\\p{L}’'-]*(?:\\s+\\p{Lu}[\\p{L}’'-]*)?)",
  'giu'
)

function aliasStatements(card) {
  const bio = String(card?.bio?.value ?? '')
  const firstSentence = bio.split(/[.!?…](?:\s|$)/u)[0] ?? bio
  return [...firstSentence.matchAll(ALIAS_STATEMENT)].map((match) => match[1])
}

function sameTokens(left, right) {
  const a = nameTokens(left)
  const b = nameTokens(right)
  return a.length > 0 && a.length === b.length && a.every((token) => b.includes(token))
}

/**
 * Токен — начало другого токена: «алекс» в «александра», «лав» в «лаванда».
 * Продолжение не короче двух букв: одна буква — это женская форма фамилии или
 * падеж, «Крылов» и «Крылова» — муж и жена, а не одно лицо.
 */
const PREFIX_MIN_EXTENSION = 2

function isPrefixToken(short, long) {
  return short.length >= DIMINUTIVE_MIN_LENGTH &&
    long.length - short.length >= PREFIX_MIN_EXTENSION &&
    long.startsWith(short)
}

function gendersCompatible(left, right) {
  const a = left?.gender ?? 'unknown'
  const b = right?.gender ?? 'unknown'
  return a === 'unknown' || b === 'unknown' || a === b
}

export function reconcileCardsByBioLead({ cards, fragmentsByCharacter }) {
  const groups = new Map()
  for (const card of cards) {
    const lead = bioLeadName(card)
    if (!lead) continue
    const group = groups.get(lead.toLowerCase()) ?? { lead, members: [] }
    group.members.push(card)
    groups.set(lead.toLowerCase(), group)
  }
  const absorbed = new Map()
  const renamed = new Map()
  for (const [key, { lead, members }] of groups) {
    if (members.length < 2) continue
    const leadTokens = [...new Set(nameTokens(key))]
    const kin = members.filter((card) => {
      if ((card.aliases ?? []).some((alias) => String(alias).toLowerCase() === key)) return true
      const tokens = nameTokens(card.name)
      // Слово имени — слово общего начала или его начало: «Алекс» — это
      // «Александра Стенли», если биография Алекса так и начинается.
      return tokens.length > 0 && tokens.every((token) =>
        leadTokens.includes(token) || leadTokens.some((part) => isPrefixToken(token, part)))
    })
    if (kin.length < 2) continue
    const primary = kin.sort((left, right) =>
      nameTokens(right.name).length - nameTokens(left.name).length ||
      (right.mentionCount ?? 0) - (left.mentionCount ?? 0) ||
      left.characterKey.localeCompare(right.characterKey, 'en'))[0]
    // Оставшийся зовётся так, как его называет биография: «Роберт» и «Паглиньо»
    // сходятся не в одного из двоих, а в «Роберта Паглиньо».
    if (String(primary.name ?? '').toLowerCase() !== key) renamed.set(primary.characterKey, lead)
    for (const card of kin) {
      if (card.characterKey !== primary.characterKey) absorbed.set(card.characterKey, primary.characterKey)
    }
  }

  // Однословное имя получает полное из биографии — до поиска остальных
  // дублей: «Холден» становится «Судьёй Холденом», и лишь тогда видно, что
  // «Судья» — это он.
  for (const card of cards) {
    if (absorbed.has(card.characterKey) || renamed.has(card.characterKey)) continue
    const fullName = fullNameFromBio(card)
    if (fullName) renamed.set(card.characterKey, fullName)
  }
  const nameOf = (card) => renamed.get(card.characterKey) ?? card.name
  const standing = () => cards.filter((card) => !absorbed.has(card.characterKey))

  // Полное имя в скобках: «Скар (Скарлетт Йорк)» уходит к «Скарлетт Йорк».
  for (const card of standing()) {
    const named = parentheticalName(card)
    if (!named) continue
    const wanted = nameTokens(named)
    const targets = standing().filter((other) =>
      other.characterKey !== card.characterKey &&
      wanted.every((token) => nameTokens(nameOf(other)).includes(token)))
    if (targets.length === 1) absorbed.set(card.characterKey, targets[0].characterKey)
  }

  // Полное имя в скобках без своей карточки — это полное имя самой карточки:
  // «Уэбстер (Маркус Уэбстер)» и есть Маркус Уэбстер.
  for (const card of standing()) {
    if (absorbed.has(card.characterKey)) continue
    const named = parentheticalName(card)
    if (!named || nameTokens(named).length > FULL_NAME_MAX_TOKENS) continue
    if (!nameTokens(nameOf(card)).every((token) => nameTokens(named).includes(token))) continue
    if (sameTokens(named, nameOf(card))) continue
    renamed.set(card.characterKey, named)
  }

  // Биография сама говорит, что это один человек. Оставшейся становится
  // карточка с большим числом упоминаний — она собрана по большему числу
  // цитат, — а именем — полное обращение: прозвище перед именем, «Судья Холден».
  for (const card of standing()) {
    if (absorbed.has(card.characterKey)) continue
    const lead = cardBioLeadName(card?.bio?.value)
    const describesItself = Boolean(lead) && nameTokens(lead).every((token) =>
      nameTokens(nameOf(card)).includes(token) ||
      (card.aliases ?? []).some((name) => nameTokens(name).includes(token)))
    for (const alias of aliasStatements(card)) {
      let other = null
      let combined = ''
      if (describesItself) {
        // «Холден, известный как судья»: второе имя — чужая карточка «Судья».
        other = standing().find((item) => item.characterKey !== card.characterKey &&
          sameTokens(nameOf(item), alias))
        if (other && nameTokens(alias).length === 1 && nameTokens(nameOf(card)).length === 1) {
          combined = `${alias.charAt(0).toLocaleUpperCase('ru-RU')}${alias.slice(1)} ${nameOf(card)}`
        }
      } else if (sameTokens(alias, nameOf(card))) {
        // «Дэвид Браун, которого называют Дэйви» в карточке «Дэйви»: карточка
        // описывает того, чьё имя стоит в начале.
        other = standing().find((item) => item.characterKey !== card.characterKey &&
          sameTokens(nameOf(item), lead))
      }
      if (!other || absorbed.has(other.characterKey) || !gendersCompatible(card, other)) continue
      const [primary, secondary] = (other.mentionCount ?? 0) > (card.mentionCount ?? 0)
        ? [other, card]
        : [card, other]
      absorbed.set(secondary.characterKey, primary.characterKey)
      if (combined) renamed.set(primary.characterKey, combined)
      else if (primary === card && !describesItself) renamed.set(primary.characterKey, nameOf(other))
      break
    }
  }

  // Уменьшительное имя сливается с полным, когда роль в биографиях одна. Если
  // подходящих полных двое, решать не из чего — карточки остаются врозь.
  for (const short of standing()) {
    const [token, ...rest] = nameTokens(nameOf(short))
    if (!token || rest.length || token.length < DIMINUTIVE_MIN_LENGTH) continue
    if (absorbed.has(short.characterKey)) continue
    const shortRole = bioRoleStems(short, nameOf(short))
    if (shortRole.size < 2) continue
    const fuller = standing().filter((other) =>
      other.characterKey !== short.characterKey &&
      nameTokens(nameOf(other)).some((part) => isPrefixToken(token, part)) &&
      overlap(shortRole, bioRoleStems(other, nameOf(other))) >= DIMINUTIVE_ROLE_OVERLAP)
    if (fuller.length !== 1) continue
    absorbed.set(short.characterKey, fuller[0].characterKey)
  }

  // Имя без фамилии или фамилия без имени — та же персона, что полное имя,
  // если такое слово носит ровно одна полная карточка и пол не спорит: «Рон»
  // и «Рон Уизли», «Судья» и «Судья Холден». Двое носителей — это семья или
  // тёзки, и слово ничего не решает.
  for (const short of standing()) {
    const [token, ...rest] = nameTokens(nameOf(short))
    if (!token || rest.length || absorbed.has(short.characterKey)) continue
    const bearers = standing().filter((other) =>
      other.characterKey !== short.characterKey &&
      nameTokens(nameOf(other)).length > 1 &&
      nameTokens(nameOf(other)).includes(token))
    if (bearers.length !== 1 || !gendersCompatible(short, bearers[0])) continue
    absorbed.set(short.characterKey, bearers[0].characterKey)
  }

  if (!absorbed.size && !renamed.size) return { cards, fragmentsByCharacter, merges: [], renames: [] }

  // Цепочка слияний сводится к последнему: карточка, поглотившая другую, могла
  // сама уйти к третьей.
  const finalTarget = (key) => {
    let current = key
    const seen = new Set()
    while (absorbed.has(current) && !seen.has(current)) {
      seen.add(current)
      current = absorbed.get(current)
    }
    return current
  }
  const byKey = new Map(cards.map((card) => [card.characterKey, card]))
  const mergedFragments = new Map(fragmentsByCharacter)
  const merges = []
  for (const fromKey of absorbed.keys()) {
    const toKey = finalTarget(fromKey)
    const from = byKey.get(fromKey)
    const to = byKey.get(toKey)
    if (!from || !to || fromKey === toKey) continue
    const previousName = to.name
    const leadName = renamed.get(toKey)
    if (leadName) {
      to.name = leadName
      to.fullName = to.fullName && nameTokens(to.fullName).length > nameTokens(leadName).length
        ? to.fullName
        : leadName
      renamed.delete(toKey)
    }
    // Поглощённый несёт свои упоминания: список героев ранжируется по ним, и
    // «Судья» с четырьмя сотнями упоминаний не должен уступать место из-за
    // того, что остался «Судья Холден» с одиннадцатью.
    to.mentionCount = (to.mentionCount ?? 0) + (from.mentionCount ?? 0)
    merges.push({ fromKey, toKey, fromName: from.name, toName: to.name })
    to.aliases = [...new Set([
      ...(to.aliases ?? []),
      ...(previousName && previousName !== to.name ? [previousName] : []),
      ...(from.name && from.name !== to.name ? [from.name] : []),
      ...(from.aliases ?? [])
    ])].slice(0, 32)
    mergedFragments.set(toKey, [
      ...(mergedFragments.get(toKey) ?? []),
      ...(mergedFragments.get(fromKey) ?? [])
    ])
    mergedFragments.delete(fromKey)
  }
  // Переименования без слияния: имя из биографии, прежнее имя — в псевдонимы.
  const renames = []
  for (const [characterKey, fullName] of renamed) {
    const card = byKey.get(characterKey)
    if (!card || absorbed.has(characterKey)) continue
    const previousName = card.name
    card.name = fullName
    if (!card.fullName || nameTokens(card.fullName).length <= nameTokens(fullName).length) {
      card.fullName = fullName
    }
    card.aliases = [...new Set([...(card.aliases ?? []), previousName])]
      .filter((alias) => alias && alias !== card.name)
      .slice(0, 32)
    renames.push({ characterKey, fromName: previousName, toName: fullName })
  }
  return {
    cards: cards.filter((card) => !absorbed.has(card.characterKey)),
    fragmentsByCharacter: mergedFragments,
    merges,
    renames
  }
}

/**
 * Наблюдения и сущности из карточек и фрагментов.
 *
 * @param {object} input
 * @param {Array} input.cards валидированные карточки `character-card-v1`
 * @param {Map<string, Array>|object} input.fragmentsByCharacter фрагменты по персонажу
 * @param {number} input.textLength
 */
export function projectCardsToSnapshot({ cards, fragmentsByCharacter, textLength }) {
  if (!Array.isArray(cards) || !cards.length) {
    throw projectionError('CARD_PROJECTION_EMPTY', 'cards must be a non-empty array')
  }
  if (!Number.isSafeInteger(textLength) || textLength < 1) {
    throw projectionError('CARD_PROJECTION_INVALID', 'textLength must be a positive safe integer')
  }
  const reconciled = reconcileCardsByBioLead({
    cards,
    fragmentsByCharacter: fragmentsByCharacter instanceof Map
      ? fragmentsByCharacter
      : new Map(Object.entries(fragmentsByCharacter ?? {}))
  })
  const reconciledCards = reconciled.cards
  const byCharacter = reconciled.fragmentsByCharacter

  const observations = []
  const seenObservations = new Set()
  const entities = []
  const characterProfiles = []
  const warmupDistance = Math.max(2_000, Math.round(textLength * 0.02))

  for (const card of [...reconciledCards].sort((left, right) =>
    left.characterKey.localeCompare(right.characterKey, 'en'))) {
    const fragments = byCharacter.get(card.characterKey) ?? []
    if (!fragments.length) {
      throw projectionError(
        'CARD_PROJECTION_FRAGMENTS_MISSING',
        `character ${card.characterKey} has no fragments to project`
      )
    }
    const fragmentById = new Map(fragments.map((fragment) => [fragment.fragmentId, fragment]))
    const allowed = new Set(fragmentById.keys())
    const entityEvidenceIds = []

    const emit = (fragmentId, type) => {
      const fragment = fragmentById.get(fragmentId)
      if (!fragment) return null
      const id = observationId(fragmentId, type)
      if (!seenObservations.has(id)) {
        seenObservations.add(id)
        if (fragment.endOffset > textLength) {
          throw projectionError(
            'CARD_PROJECTION_INVALID',
            `fragment ${fragmentId} lies past the end of the text`
          )
        }
        observations.push({
          id,
          observationKey: id,
          type,
          entityKind: 'character',
          entityCandidate: card.name,
          relatedEntityCandidates: [],
          fact: card.name,
          evidence: {
            quote: fragment.quote,
            startOffset: fragment.startOffset,
            endOffset: fragment.endOffset,
            chapterKey: fragment.chapterIndex >= 0 ? `chapter:${fragment.chapterIndex}` : ''
          },
          confidence: 0.99,
          data: {}
        })
      }
      if (!entityEvidenceIds.includes(id)) entityEvidenceIds.push(id)
      return id
    }

    // Идентичность персонажа опирается на его первые фрагменты: Validate
    // требует хотя бы один identityEvidenceId и проверяет, что он принадлежит
    // сущности.
    const identityFragments = [...fragments]
      .sort((left, right) => left.startOffset - right.startOffset)
      .slice(0, 64)
    for (const fragment of identityFragments) {
      emit(fragment.fragmentId, CLAIM_OBSERVATION_TYPES.identity)
    }
    // Био ссылается на улики того же типа, что и идентичность, но цитирует оно
    // что угодно из карточки — а идентичность берёт только первые 64 фрагмента.
    // Пока эти два множества расходились, био ссылалось на наблюдение, которого
    // в снимке нет, и Validate отбивал публикацию целиком: «Маленький принц» со
    // 177 фрагментами так и не опубликовался ни разу.
    for (const fragmentId of card.bio.fragmentIds) {
      emit(fragmentId, CLAIM_OBSERVATION_TYPES.identity)
    }
    for (const type of [
      CLAIM_OBSERVATION_TYPES.role,
      CLAIM_OBSERVATION_TYPES.age,
      CLAIM_OBSERVATION_TYPES.gender,
      CLAIM_OBSERVATION_TYPES.trait
    ]) {
      const source = type === CLAIM_OBSERVATION_TYPES.trait
        ? card.traits.flatMap(({ fragmentIds }) => fragmentIds)
        : type === CLAIM_OBSERVATION_TYPES.role
          ? (card.role?.fragmentIds ?? [])
          : card.bio.fragmentIds
      for (const fragmentId of source) emit(fragmentId, type)
    }

    const identityEvidenceIds = identityFragments
      .map(({ fragmentId }) => observationId(fragmentId, CLAIM_OBSERVATION_TYPES.identity))
    const firstAppearanceTextOffset = Math.min(
      card.firstMentionTextOffset,
      ...fragments.map(({ startOffset }) => startOffset)
    )
    // Полное имя уходит в псевдонимы: Validate требует fullName === canonical.
    const aliases = [...new Set([
      ...card.aliases,
      ...(card.fullName && card.fullName !== card.name ? [card.fullName] : [])
    ])].slice(0, 32)

    entities.push({
      entityKey: card.characterKey,
      entityKind: 'character',
      canonicalName: card.name,
      aliases,
      resolutionStatus: 'confirmed',
      confidence: 0.95,
      evidenceIds: entityEvidenceIds,
      data: {
        observationCount: entityEvidenceIds.length,
        firstEvidenceStartOffset: firstAppearanceTextOffset,
        lastEvidenceEndOffset: Math.max(...fragments.map(({ endOffset }) => endOffset))
      }
    })

    characterProfiles.push({
      characterKey: card.characterKey,
      name: card.name,
      fullName: card.name,
      aliases,
      identityEvidenceIds,
      firstAppearanceTextOffset,
      warmupTextOffset: Math.max(0, firstAppearanceTextOffset - warmupDistance),
      role: claimFrom(card.role, CLAIM_OBSERVATION_TYPES.role, allowed),
      age: card.age
        ? claimFrom(
            { value: card.age, fragmentIds: card.bio.fragmentIds },
            CLAIM_OBSERVATION_TYPES.age,
            allowed
          )
        : null,
      gender: card.gender === 'unknown'
        ? null
        : claimFrom(
            { value: card.gender, fragmentIds: card.bio.fragmentIds },
            CLAIM_OBSERVATION_TYPES.gender,
            allowed
          ),
      description: claimFrom(card.bio, CLAIM_OBSERVATION_TYPES.identity, allowed),
      traits: card.traits
        .map((trait) => claimFrom(trait, CLAIM_OBSERVATION_TYPES.trait, allowed))
        .filter(Boolean),
      personalityTimelineVersion: '',
      personalitySnapshots: [],
      // Паспорт внешности — творческое поле карточки, а не цитируемый факт,
      // поэтому в `appearance` он не идёт: там каждое утверждение обязано
      // ссылаться на наблюдение соответствующего типа.
      appearance: [],
      speechStyle: null,
      speechExamples: [],
      creative: {
        greeting: card.greeting ?? '',
        appearancePrompt: card.appearancePrompt ?? '',
        voice: ''
      }
    })
  }

  const observationIds = observations.map(({ id }) => id)
  const snapshotEntities = entities.map(({ ...entity }) => entity)
  return {
    projectionVersion: CARD_MARKUP_PROJECTION_VERSION,
    observations,
    entities,
    characterProfiles,
    characterSelection: null,
    snapshotData: {
      observationIds,
      observationSetHash: projectionContentHash(observations),
      entities: snapshotEntities,
      entitySetHash: projectionContentHash(snapshotEntities),
      characterSelection: null
    },
    evidenceCount: observations.length
  }
}

/**
 * Снапшот в форме, которую читает Validate: `id`, `contentHash`,
 * `evidenceCount`, `data`. Хэш считается по тем же правилам, что и в проверке,
 * иначе она справедливо сочтёт снапшот подделанным.
 */
export function cardSnapshotFor({ snapshotId, projection }) {
  const data = { ...projection.snapshotData }
  return {
    id: snapshotId,
    contentHash: projectionContentHash(data),
    evidenceCount: projection.evidenceCount,
    data
  }
}

export const CARD_MARKUP_TARGET = Object.freeze({
  schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
  analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION
})
