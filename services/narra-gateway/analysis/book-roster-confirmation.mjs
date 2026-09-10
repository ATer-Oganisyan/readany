/**
 * Подтверждение roster: один LLM-вызов на книгу (решение D3 work order'а).
 *
 * Модель отвечает на два вопроса, на которые счётчик не отвечает: человек это,
 * место, группа или другое — и какие кандидаты суть варианты одного имени.
 * Всё остальное здесь детерминированно, и это принципиально: пары-кандидаты
 * генерируются правилами, запреты — правилами, а ответ модели проходит
 * валидацию, которая физически не может принять то, чего в запросе не было.
 *
 * Hard-guards перенесены из `book-analysis-identity-reconciliation.mjs`: слияние
 * не принимается при коллизии пола и при со-упоминании как двух участников.
 * Родство и коллизия пола — правила, а не признаки модели, потому что цена
 * ошибки несимметрична: лишний дубль исправляется, склеенные муж с женой — нет.
 */

import {
  nicknameCandidatePairs,
  nicknameGenderForSurface
} from './character-nickname-lexicon.mjs'
import { NAME_HONORIFICS } from './book-name-inventory.mjs'
import { splitHonorificNames } from './book-character-fragments.mjs'

export const ROSTER_CONFIRMATION_VERSION = 'roster-confirm-v1'
export const ROSTER_CONFIRMATION_PROMPT_VERSION = 'roster-confirm-prompt-v2'

export const MAX_CONFIRMATION_CANDIDATES = 128
export const MAX_FRAGMENTS_PER_CANDIDATE = 2
export const MAX_CANDIDATE_PAIRS = 128
export const MAX_REQUEST_BYTES = 96 * 1024
const MAX_FRAGMENT_QUOTE_CHARS = 240

// `mentioned` отделяет названное лицо от действующего. Байрон, Цицерон и
// Пушкин — люди, и как `person` они получали карточку наравне с Печориным,
// хотя в книге не действуют, а помянуты для сравнения. Карточку получает
// только `person`, поэтому различие тут и живёт.
export const ROSTER_CANDIDATE_KINDS = Object.freeze([
  'person', 'mentioned', 'place', 'group', 'other'
])
export const ROSTER_MERGE_BASES = Object.freeze([
  'name_variant',
  'nickname',
  'married_name',
  'explicit_alias',
  'persona'
])

/** Со-упоминание как двух участников: столько общих абзацев и такая их доля. */
const CO_MENTION_MIN = 3
const CO_MENTION_SHARE = 0.2
/**
 * Сколько раз имена должны встретиться подряд, чтобы пара попала в кандидаты.
 * «Евгений Онегин» и «Владимир Ленский» — одно лицо на два кандидата, но общей
 * основы у форм нет, и перекрытие токенов такую пару не видит вовсе. Порог
 * держит от случайного соседства двух разных людей в одной фразе.
 */
const ADJACENT_NAME_MIN = 2

const KINDS = new Set(ROSTER_CANDIDATE_KINDS)
const BASES = new Set(ROSTER_MERGE_BASES)

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function pairKey(left, right) {
  return [left, right].sort(compareText).join('\u0000')
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function boundedText(value, length) {
  return String(value || '').trim().replace(/\s+/gu, ' ').slice(0, length)
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value))
}

function identityTokens(value) {
  return normalizedName(value).split(' ').filter((token) =>
    token && !NAME_HONORIFICS.has(token))
}

function orderedSubset(shorter, longer) {
  if (!shorter.length || shorter.length >= longer.length) return false
  let cursor = 0
  for (const token of longer) {
    if (token === shorter[cursor]) cursor += 1
    if (cursor === shorter.length) return true
  }
  return false
}

/**
 * Пол, на который указывают детерминированные признаки: обращение в имени и
 * лексикон уменьшительных. Два разных значения дают пустой результат — это не
 * «неизвестно», а «признаки спорят», и спорный пол запрета не создаёт.
 */
export function candidateGenderSignals(candidate) {
  const values = new Set()
  for (const name of candidateNames(candidate)) {
    const { honorifics } = splitHonorificNames([name])
    for (const honorific of honorifics) {
      const gender = NAME_HONORIFICS.get(honorific)
      if (gender) values.add(gender)
    }
    const lexicon = nicknameGenderForSurface(name)
    if (lexicon) values.add(lexicon)
  }
  if (candidate.honorificGender) values.add(candidate.honorificGender)
  return values
}

function candidateNames(candidate) {
  return [...new Set([
    candidate.displayName,
    ...(Array.isArray(candidate.aliases) ? candidate.aliases : []),
    ...(candidate.fullName ? [candidate.fullName] : [])
  ])].filter(Boolean)
}

/**
 * Признак пары по именам. Тот же набор, что у глобальной сверки имён: полное
 * совпадение ядра имени, расширение имени, общее личное имя, общая фамилия.
 */
export function namePairSignal(left, right) {
  for (const leftName of candidateNames(left)) {
    const leftTokens = identityTokens(leftName)
    for (const rightName of candidateNames(right)) {
      const rightTokens = identityTokens(rightName)
      if (!leftTokens.length || !rightTokens.length) continue
      if (leftTokens.join(' ') === rightTokens.join(' ')) return 'same_core_name'
      if (orderedSubset(leftTokens, rightTokens) || orderedSubset(rightTokens, leftTokens)) {
        return 'name_extension'
      }
      if (leftTokens[0] === rightTokens[0]) return 'shared_given_name'
      if (leftTokens.at(-1) === rightTokens.at(-1)) return 'shared_family_name'
    }
  }
  return null
}

function coMentionParagraphs(fragments) {
  const byCharacter = new Map()
  for (const entry of fragments?.characters ?? []) {
    byCharacter.set(
      entry.characterKey,
      new Set((entry.fragments ?? []).map(({ paragraphIndex }) => paragraphIndex))
    )
  }
  return byCharacter
}

/**
 * Запрещённые пары: слияние по ним не принимается ни при каком ответе модели.
 *
 * `gender_conflict` — оба кандидата дают однозначный и разный пол.
 * `co_mentioned_participants` — кандидаты систематически встречаются в одном
 * абзаце, то есть текст показывает их как двух участников сцены, а не как два
 * имени одного человека.
 *
 * Со-упоминание снимается соседством. «Обломов» и «Илья» стоят в одних абзацах
 * постоянно — это и есть обычный русский повествовательный приём, когда одного
 * человека называют то по имени, то по фамилии, — и запрет держал ровно ту
 * пару, которую надо было слить: до модели она не доходила никогда. Но те же
 * имена встречаются и подряд, одним оборотом («Илья Ильич Обломов»), а вот
 * двое участников сцены рядом не стоят. Поэтому соседство сильнее
 * со-упоминания: пара уходит к модели вместе с цитатами, и решает она.
 *
 * Коллизию пола соседство не снимает: там спорят не роли в сцене, а
 * доказательства, и лишний повод их не примиряет.
 */
export function rosterForbiddenPairs(candidates, { fragments = null } = {}) {
  const paragraphs = coMentionParagraphs(fragments)
  const genders = new Map(candidates.map((candidate) =>
    [candidate.candidateKey, candidateGenderSignals(candidate)]))
  const values = new Map()
  for (const [index, left] of candidates.entries()) {
    for (const right of candidates.slice(index + 1)) {
      const [leftKey, rightKey] = [left.candidateKey, right.candidateKey].sort(compareText)
      const key = pairKey(leftKey, rightKey)
      const leftGender = genders.get(left.candidateKey)
      const rightGender = genders.get(right.candidateKey)
      if (
        leftGender.size === 1 && rightGender.size === 1 &&
        ![...leftGender].some((value) => rightGender.has(value))
      ) {
        values.set(key, { leftKey, rightKey, reason: 'gender_conflict' })
        continue
      }
      const leftParagraphs = paragraphs.get(left.candidateKey)
      const rightParagraphs = paragraphs.get(right.candidateKey)
      if (!leftParagraphs?.size || !rightParagraphs?.size) continue
      let shared = 0
      const [smaller, larger] = leftParagraphs.size <= rightParagraphs.size
        ? [leftParagraphs, rightParagraphs]
        : [rightParagraphs, leftParagraphs]
      for (const paragraph of smaller) if (larger.has(paragraph)) shared += 1
      if (shared >= CO_MENTION_MIN && shared >= CO_MENTION_SHARE * smaller.size) {
        const adjacency = Math.max(
          adjacentCount(left, right.candidateKey),
          adjacentCount(right, left.candidateKey)
        )
        if (adjacency >= ADJACENT_NAME_MIN) continue
        values.set(key, { leftKey, rightKey, reason: 'co_mentioned_participants' })
      }
    }
  }
  return [...values.values()].sort((left, right) =>
    compareText(left.leftKey, right.leftKey) || compareText(left.rightKey, right.rightKey))
}

/**
 * Пары-кандидаты: только они могут быть слиты. Сигналы — перекрытие токенов
 * имени и лексикон уменьшительных. Лексикон здесь именно генератор пар:
 * «Kitty» и «Catherine» без него не связаны ничем, потому что общей основы у
 * них нет, но и слить их автоматически нельзя — у Остин это две разные
 * Кэтрин, и решает вызов вместе с запретами.
 */
export function rosterCandidatePairs(candidates, { forbiddenPairs = [] } = {}) {
  const blocked = new Set(forbiddenPairs.map(({ leftKey, rightKey }) => pairKey(leftKey, rightKey)))
  const lexiconPairs = new Map(
    nicknameCandidatePairs(candidates.map((candidate) => ({
      key: candidate.candidateKey,
      names: candidateNames(candidate)
    }))).map((pair) => [pairKey(pair.leftKey, pair.rightKey), pair])
  )
  const rows = []
  for (const [index, left] of candidates.entries()) {
    for (const right of candidates.slice(index + 1)) {
      const key = pairKey(left.candidateKey, right.candidateKey)
      if (blocked.has(key)) continue
      const nameSignal = namePairSignal(left, right)
      const lexicon = lexiconPairs.get(key)
      const adjacency = Math.max(
        adjacentCount(left, right.candidateKey),
        adjacentCount(right, left.candidateKey)
      )
      const adjacent = adjacency >= ADJACENT_NAME_MIN
      if (!nameSignal && !lexicon && !adjacent) continue
      const [leftKey, rightKey] = [left.candidateKey, right.candidateKey].sort(compareText)
      rows.push({
        leftKey,
        rightKey,
        signals: [
          ...(nameSignal ? [nameSignal] : []),
          ...(lexicon ? ['nickname_lexicon'] : []),
          ...(adjacent ? ['adjacent_full_name'] : [])
        ],
        adjacentCount: adjacent ? adjacency : 0,
        lexiconCanonical: lexicon?.canonical ?? ''
      })
    }
  }
  // Первыми идут пары, которых не видит перекрытие токенов: лексикон и
  // соседство. При упоре в потолок терять надо не их.
  const unseenByOverlap = (row) =>
    Number(!row.signals.includes('nickname_lexicon') && !row.signals.includes('adjacent_full_name'))
  return rows.sort((left, right) =>
    unseenByOverlap(left) - unseenByOverlap(right) ||
    right.adjacentCount - left.adjacentCount ||
    compareText(left.leftKey, right.leftKey) ||
    compareText(left.rightKey, right.rightKey)
  ).slice(0, MAX_CANDIDATE_PAIRS)
}

function adjacentCount(candidate, otherKey) {
  return (candidate.adjacentNames ?? [])
    .find(({ candidateKey }) => candidateKey === otherKey)?.count ?? 0
}

function candidateFragments(fragments, characterKey, limit) {
  const entry = (fragments?.characters ?? []).find((item) => item.characterKey === characterKey)
  const selected = (entry?.fragments ?? []).slice(0, limit)
  return selected.map((fragment) => ({
    id: fragment.fragmentId,
    quote: boundedText(fragment.quote, MAX_FRAGMENT_QUOTE_CHARS),
    startOffset: fragment.startOffset
  }))
}

function confirmationRoster(candidates, fragments, fragmentLimit) {
  return candidates.map((candidate) => ({
    candidateKey: candidate.candidateKey,
    names: candidateNames(candidate).sort(compareText),
    mentionCount: candidate.count,
    chapterCount: candidate.chapterCount,
    kindHint: candidate.kindHint,
    signals: {
      speechAdjacencyRate: candidate.speechAdjacencyRate,
      dialogueDashRate: candidate.dialogueDashRate,
      honorificRate: candidate.honorificRate,
      prepositionalRate: candidate.prepositionalRate
    },
    fragments: candidateFragments(fragments, candidate.candidateKey, fragmentLimit)
  }))
}

/**
 * Запрос подтверждения roster.
 *
 * @param {object} input
 * @param {Array} input.candidates ярус roster инвентаря
 * @param {object} [input.fragments] результат скрапера — источник цитат и
 *   со-упоминаний; без него запрос строится, но запрет по со-упоминанию не
 *   работает и в запрос это записано явно.
 * @returns {object|null} null, когда подтверждать нечего
 */
/**
 * Область подтверждения: окно или вся книга.
 *
 * Подтверждений на прогон теперь больше одного — сперва окно первых глав, потом
 * вся книга, — и различать их обязано всё, что кэшируется по ключу. Без области
 * оба захода имели бы один ключ идемпотентности, и второй молча получил бы
 * ответ первого: полный roster подменился бы roster'ом одного окна.
 */
export function rosterConfirmationScope(windowIndex) {
  return Number.isSafeInteger(windowIndex) && windowIndex >= 0
    ? `window-${windowIndex}`
    : 'book'
}

export function rosterConfirmationIdempotencyKey({
  runId,
  windowIndex = null,
  inventoryVersion,
  promptVersion
}) {
  return [
    runId,
    'roster-confirm',
    rosterConfirmationScope(windowIndex),
    inventoryVersion,
    promptVersion
  ].join(':')
}

export function buildRosterConfirmationRequest({
  runId,
  bookEditionId,
  title,
  author = '',
  language = '',
  inventoryVersion,
  normalizedTextHash,
  candidates,
  fragments = null,
  windowIndex = null,
  maxCandidates = MAX_CONFIRMATION_CANDIDATES
}) {
  const ordered = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.candidateKey)
    .sort((left, right) =>
      right.count - left.count || compareText(left.candidateKey, right.candidateKey))
    .slice(0, maxCandidates)
  // Одного кандидата тоже спрашивают. Сливать при нём не с чем, но
  // классификация остаётся вопросом к модели: `kindHint` — эвристика, и на
  // «По дороге шла Анна. Корзину несла Анна.» она даёт `unknown`. Раньше запрос
  // при одном кандидате не собирался вовсе, и единственный герой окна оставался
  // без карточки — либо, если довериться подсказке, карточку получило бы место.
  if (!ordered.length) return null

  const forbiddenPairs = rosterForbiddenPairs(ordered, { fragments })
  const candidatePairs = rosterCandidatePairs(ordered, { forbiddenPairs })
  const included = new Set(ordered.map(({ candidateKey }) => candidateKey))
  const common = {
    runId,
    bookEditionId,
    confirmationVersion: ROSTER_CONFIRMATION_VERSION,
    promptVersion: ROSTER_CONFIRMATION_PROMPT_VERSION,
    inventoryVersion: inventoryVersion ?? '',
    normalizedTextHash: normalizedTextHash ?? '',
    bookTitle: title,
    bookAuthor: author,
    language,
    coMentionGuardApplied: Boolean(fragments),
    // Область живёт в самом запросе, а не только в ключе: по ответу должно быть
    // видно, за что он отвечает — за окно или за всю книгу.
    windowIndex: Number.isSafeInteger(windowIndex) && windowIndex >= 0 ? windowIndex : null,
    forbiddenPairs: forbiddenPairs.filter(({ leftKey, rightKey }) =>
      included.has(leftKey) && included.has(rightKey)),
    candidatePairs
  }
  let request = {
    ...common,
    roster: confirmationRoster(ordered, fragments, MAX_FRAGMENTS_PER_CANDIDATE)
  }
  if (serializedBytes(request) > MAX_REQUEST_BYTES) {
    request = { ...common, roster: confirmationRoster(ordered, fragments, 1) }
  }
  if (serializedBytes(request) > MAX_REQUEST_BYTES) {
    request = { ...common, roster: confirmationRoster(ordered, null, 0) }
  }
  return serializedBytes(request) <= MAX_REQUEST_BYTES ? request : null
}

class DisjointSet {
  constructor(keys) {
    this.parents = new Map(keys.map((key) => [key, key]))
    this.groups = new Map(keys.map((key) => [key, [key]]))
  }

  find(key) {
    let root = key
    while (this.parents.get(root) !== root) root = this.parents.get(root)
    return root
  }

  members(key) {
    return this.groups.get(this.find(key)) ?? [key]
  }

  union(left, right) {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot === rightRoot) return false
    this.parents.set(rightRoot, leftRoot)
    this.groups.set(leftRoot, [
      ...(this.groups.get(leftRoot) ?? []),
      ...(this.groups.get(rightRoot) ?? [])
    ])
    this.groups.delete(rightRoot)
    return true
  }
}

function crossesForbidden(sets, left, right, forbidden) {
  return sets.members(left).some((one) =>
    sets.members(right).some((other) => forbidden.has(pairKey(one, other))))
}

/**
 * Проверка ответа модели.
 *
 * Принимается только то, что было в запросе: классификация — для известного
 * ключа и известного вида, слияние — только по паре из `candidatePairs`, не
 * попавшей в `forbiddenPairs`, и только если объединение не соединяет два
 * компонента, между которыми есть запрет. Последнее важнее, чем кажется:
 * запрет между A и C должен блокировать и цепочку A—B, B—C.
 */
export function validateRosterConfirmation({ request, response }) {
  if (!request) return { classifications: [], acceptedMerges: [], rejected: [] }
  const known = new Map(request.roster.map((item) => [item.candidateKey, item]))
  const forbidden = new Set(request.forbiddenPairs.map(({ leftKey, rightKey }) =>
    pairKey(leftKey, rightKey)))
  const allowed = new Set(request.candidatePairs.map(({ leftKey, rightKey }) =>
    pairKey(leftKey, rightKey)))

  const rejected = []
  const seenKeys = new Set()
  const classifications = []
  for (const raw of Array.isArray(response?.classifications) ? response.classifications : []) {
    const candidateKey = typeof raw?.candidateKey === 'string' ? raw.candidateKey : ''
    const kind = typeof raw?.kind === 'string' ? raw.kind : ''
    if (!known.has(candidateKey) || !KINDS.has(kind) || seenKeys.has(candidateKey)) {
      rejected.push({ kind: 'classification', candidateKey, reason: 'unknown_key_or_kind' })
      continue
    }
    seenKeys.add(candidateKey)
    classifications.push({
      candidateKey,
      kind,
      canonicalName: boundedText(raw.canonicalName, 120) ||
        known.get(candidateKey).names[0]
    })
  }
  // Кандидат без классификации остаётся собой: молчание модели не повод менять
  // подсказку инвентаря на что-то другое.
  for (const item of request.roster) {
    if (seenKeys.has(item.candidateKey)) continue
    classifications.push({
      candidateKey: item.candidateKey,
      kind: item.kindHint === 'person' ? 'person' : 'other',
      canonicalName: item.names[0],
      unconfirmed: true
    })
  }
  classifications.sort((left, right) => compareText(left.candidateKey, right.candidateKey))

  const sets = new DisjointSet([...known.keys()])
  const acceptedMerges = []
  const seenEdges = new Set()
  for (const raw of (Array.isArray(response?.merges) ? response.merges : []).slice(0, 128)) {
    const leftKey = typeof raw?.leftKey === 'string' ? raw.leftKey : ''
    const rightKey = typeof raw?.rightKey === 'string' ? raw.rightKey : ''
    const basis = typeof raw?.basis === 'string' ? raw.basis : ''
    const edge = pairKey(leftKey, rightKey)
    if (leftKey === rightKey || !known.has(leftKey) || !known.has(rightKey) || !BASES.has(basis)) {
      rejected.push({ kind: 'merge', leftKey, rightKey, reason: 'unknown_key_or_basis' })
      continue
    }
    if (seenEdges.has(edge)) continue
    if (forbidden.has(edge)) {
      rejected.push({ kind: 'merge', leftKey, rightKey, reason: 'forbidden_pair' })
      continue
    }
    if (!allowed.has(edge)) {
      rejected.push({ kind: 'merge', leftKey, rightKey, reason: 'not_a_candidate_pair' })
      continue
    }
    if (crossesForbidden(sets, leftKey, rightKey, forbidden)) {
      rejected.push({ kind: 'merge', leftKey, rightKey, reason: 'forbidden_across_components' })
      continue
    }
    if (!sets.union(leftKey, rightKey)) continue
    seenEdges.add(edge)
    acceptedMerges.push({ leftKey, rightKey, basis })
  }

  /*
   * Одно каноническое имя — один человек.
   *
   * Слияние принимается только по паре из `candidatePairs`, и это правильно:
   * модель не должна изобретать связи. Но у неё есть второй, независимый способ
   * заявить тождество — поле `canonicalName`, которое она заполняет по каждому
   * кандидату сама. На «Преступлении и наказании» это разошлось громко: модель
   * назвала «Родион Романович Раскольников» четыре разных кандидата
   * (char:raskolnikov, char:rodion-romanych, char:romanovich и ещё один),
   * «Авдотья Романовна Раскольникова» — четыре, «Софья Семёновна Мармеладова» —
   * три, а пары между ними в запрос не попали, потому что их не породил
   * генератор кандидатов. В ростер ушли дубли, каждый со своей карточкой и
   * своим портретом, и каждый занял слот публикации.
   *
   * Поэтому одинаковое каноническое имя объединяет кандидатов так же, как
   * явное слияние, и с теми же ограничениями: только людей, только когда
   * между компонентами нет запрета. Запреты и есть та защита, из-за которой
   * правило безопасно: два героя, стоящие в одних абзацах или разного пола,
   * не сольются, даже если модель назвала их одинаково.
   */
  // Из двух запретов одноимённость перебивает только один, и это измеренное
  // различие, а не смягчение правила. `co_mentioned_participants` говорит о
  // поверхностях, а не о людях: фамилия и имя-отчество одного героя стоят в
  // одних абзацах по устройству русской прозы — рассказчик зовёт «Раскольников»,
  // персонажи «Родион Романыч», и это одна сцена. На этой книге запрет по
  // со-упоминанию ложно держал четыре пары из двадцати одной, и среди них
  // Раскольникова, Свидригайлова и Лебезятникова — то есть оставлял
  // расщеплённым главного героя. `gender_conflict` не перебивает ничто:
  // цена ошибки несимметрична, и слитые муж с женой не исправляются.
  const genderConflicts = new Set(request.forbiddenPairs
    .filter(({ reason }) => reason === 'gender_conflict')
    .map(({ leftKey, rightKey }) => pairKey(leftKey, rightKey)))
  const personKeys = new Set(classifications
    .filter(({ kind }) => kind === 'person')
    .map(({ candidateKey }) => candidateKey))
  const byCanonicalName = new Map()
  for (const item of classifications) {
    if (!personKeys.has(item.candidateKey)) continue
    const key = normalizedName(item.canonicalName)
    if (!key) continue
    const members = byCanonicalName.get(key) ?? []
    members.push(item.candidateKey)
    byCanonicalName.set(key, members)
  }
  for (const members of byCanonicalName.values()) {
    if (members.length < 2) continue
    const ordered = [...members].sort(compareText)
    const [anchor] = ordered
    for (const candidateKey of ordered.slice(1)) {
      const edge = pairKey(anchor, candidateKey)
      if (seenEdges.has(edge)) continue
      if (
        genderConflicts.has(edge) ||
        crossesForbidden(sets, anchor, candidateKey, genderConflicts)
      ) {
        rejected.push({
          kind: 'merge',
          leftKey: anchor,
          rightKey: candidateKey,
          reason: 'same_canonical_name_but_gender_conflict'
        })
        continue
      }
      if (!sets.union(anchor, candidateKey)) continue
      seenEdges.add(edge)
      acceptedMerges.push({ leftKey: anchor, rightKey: candidateKey, basis: 'name_variant' })
    }
  }
  return { classifications, acceptedMerges, rejected }
}

/**
 * Итоговый roster после подтверждения: слитые кандидаты становятся одной
 * записью, места и группы отсеиваются. Каноническое имя компонента — имя
 * самого частого кандидата, если модель не назвала другое.
 */
export function applyRosterConfirmation({ request, candidates, confirmation }) {
  const byKey = new Map(candidates.map((candidate) => [candidate.candidateKey, candidate]))
  const kinds = new Map(confirmation.classifications.map((item) => [item.candidateKey, item]))
  const sets = new DisjointSet([...byKey.keys()])
  for (const { leftKey, rightKey } of confirmation.acceptedMerges) sets.union(leftKey, rightKey)

  const components = new Map()
  for (const key of byKey.keys()) {
    const root = sets.find(key)
    const members = components.get(root) ?? []
    members.push(key)
    components.set(root, members)
  }

  const roster = []
  for (const members of components.values()) {
    const rows = members
      .map((key) => byKey.get(key))
      .filter(Boolean)
      .sort((left, right) => right.count - left.count ||
        compareText(left.candidateKey, right.candidateKey))
    if (!rows.length) continue
    if (!rows.some((row) => kinds.get(row.candidateKey)?.kind === 'person')) continue
    const [primary] = rows
    const canonicalName = kinds.get(primary.candidateKey)?.canonicalName || primary.displayName
    const names = [...new Set(rows.flatMap((row) => candidateNames(row)))]
    roster.push({
      characterKey: `char:${primary.candidateKey.replace(/^name:/, '')}`,
      candidateKeys: members.slice().sort(compareText),
      canonicalName,
      names: names.filter((name) => normalizedName(name) !== normalizedName(canonicalName)),
      mentionCount: rows.reduce((sum, { count }) => sum + count, 0),
      firstMentionTextOffset: Math.min(...rows.map(({ firstMentionTextOffset }) =>
        firstMentionTextOffset)),
      chapterCount: Math.max(...rows.map(({ chapterCount }) => chapterCount)),
      tier: rows.some(({ tier }) => tier === 'significant') ? 'significant' : 'roster'
    })
  }
  return roster.sort((left, right) =>
    right.mentionCount - left.mentionCount ||
    compareText(left.characterKey, right.characterKey))
}

/**
 * Кандидаты, за которых отвечает окно.
 *
 * Подтверждение по всей книге — самый долгий шаг быстрого пути: у «Отцов и
 * детей» это ~40 000 токенов запроса и 36 пар, у «Преступления и наказания» тот
 * же вызов шёл около пяти минут. Всё это время читатель, открывший книгу, не
 * видит ни одного героя, хотя окну первых глав из 112 кандидатов нужны 13 —
 * пятая часть запроса и три пары вместо тридцати шести.
 *
 * Поэтому подтверждение идёт в два захода: сначала кандидаты окна, потом вся
 * книга в фоне. Состав окна берётся из `assignStartOffset`/`assignEndOffset` —
 * тех же границ, по которым окну назначаются карточки, — а не из барьера
 * окна: барьер у всех окон начинается с нуля и состава не задаёт.
 */
export function rosterCandidatesForWindow(candidates, window) {
  if (!Array.isArray(candidates)) return []
  const start = Number.isSafeInteger(window?.assignStartOffset) ? window.assignStartOffset : 0
  const end = Number.isSafeInteger(window?.assignEndOffset) ? window.assignEndOffset : 0
  if (end <= start) return []
  return candidates.filter((candidate) => {
    const offset = candidate?.firstMentionTextOffset
    return Number.isSafeInteger(offset) && offset >= start && offset < end
  })
}

/**
 * Персонажи, чья личность изменилась после более полного подтверждения.
 *
 * Ранний заход видит только кандидатов своего окна, поэтому герой, впервые
 * названный в первой главе, может слиться с кандидатом из десятой только на
 * втором заходе. Карточка неизменяема, значит такое слияние — не правка строки,
 * а повод для новой ревизии: возвращаются ключи уже выпущенных персонажей,
 * состав кандидатов у которых вырос или которые ушли под другой ключ.
 *
 * Возвращается именно «что переиздать», а не «что изменилось вообще»: персонаж,
 * которого второй заход не тронул, переиздания не требует, и лишняя ревизия
 * стоила бы вызова модели и нового портрета.
 */
export function rosterRevisionsAfterConfirmation(previousRoster, nextRoster) {
  const nextByCandidate = new Map()
  for (const character of nextRoster ?? []) {
    for (const candidateKey of character.candidateKeys ?? []) {
      nextByCandidate.set(candidateKey, character)
    }
  }
  const revisions = []
  for (const previous of previousRoster ?? []) {
    const owners = new Set()
    for (const candidateKey of previous.candidateKeys ?? []) {
      const owner = nextByCandidate.get(candidateKey)
      if (owner) owners.add(owner)
    }
    if (owners.size !== 1) {
      // Ноль владельцев — персонаж исчез из roster; больше одного — его
      // кандидаты разъехались. И то и другое требует решения человека, а не
      // молчаливой новой ревизии.
      revisions.push({
        characterKey: previous.characterKey,
        reason: owners.size === 0 ? 'dropped_from_roster' : 'split_across_characters',
        nextCharacterKeys: [...owners].map(({ characterKey }) => characterKey)
      })
      continue
    }
    const [owner] = owners
    const grew = (owner.candidateKeys ?? []).length > (previous.candidateKeys ?? []).length
    if (!grew && owner.characterKey === previous.characterKey) continue
    revisions.push({
      characterKey: previous.characterKey,
      reason: owner.characterKey === previous.characterKey ? 'absorbed_more_candidates' : 'merged_into',
      nextCharacterKeys: [owner.characterKey],
      canonicalName: owner.canonicalName,
      addedCandidateKeys: (owner.candidateKeys ?? [])
        .filter((key) => !(previous.candidateKeys ?? []).includes(key))
    })
  }
  return revisions.sort((left, right) => compareText(left.characterKey, right.characterKey))
}
