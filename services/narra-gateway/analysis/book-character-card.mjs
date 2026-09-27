/**
 * Карточка персонажа: сборка запроса и приёмка ответа (P3 work order'а).
 *
 * Разделение ответственности между генератором и шлюзом здесь не формальность.
 * Генератор превращает фрагменты в утверждения и сам же проверяет их
 * обоснованность и устойчивость черт — это его предметная проверка. Шлюз
 * проверяет другое: что каждая процитированная ссылка ведёт на фрагмент этого
 * персонажа внутри его окна. Вторая проверка обязана жить здесь, потому что
 * именно шлюз пишет строку карточки: спойлер-барьер не может зависеть от
 * добросовестности того, кто прислал ответ.
 *
 * Из этого следует и порядок: сначала контракт, потом запись. Карточка, не
 * прошедшая {@link validateCharacterCard}, не пишется вовсе — падает job, а не
 * инвариант.
 */

import { createHash } from 'node:crypto'
import {
  buildCharacterNameMatcherSpec,
  findCharacterNameMatches,
  stemNameToken
} from './character-name-matcher.mjs'
import {
  fragmentBelongsToWindow,
  CARD_TRAIT_CANDIDATE_TARGET,
  CHARACTER_CARD_CONTRACT_VERSION,
  CHARACTER_CARD_PROMPT_VERSION,
  MAX_CARD_BIO_CHARS,
  MAX_CARD_TRAITS,
  validateCharacterCard
} from './book-character-card-contract.mjs'

export const CHARACTER_CARD_JOB_TYPE = 'character_card'
/** target_version задания карточки: контракт, а не ревизия медиа. */
export const CHARACTER_CARD_TARGET_VERSION = 'character-card-v1'

/**
 * Приоритеты медиа персонажа, поставленного от карточки (P4 work order'а).
 *
 * Окно 1 — это то, что читатель откроет через минуту после импорта, поэтому его
 * портреты обгоняют всё фоновое. Разрыв между 65 и 45 не косметический: у
 * очереди генерации приоритет — первый ключ сортировки при выборе задания, и
 * фоновое окно большой книги иначе заняло бы воркеры на часы вперёд.
 */
export const CARD_MEDIA_PRIORITY = Object.freeze({ foreground: 65, background: 45 })

export function characterCardMediaPriority(priorityClass) {
  return CARD_MEDIA_PRIORITY[priorityClass] ?? CARD_MEDIA_PRIORITY.background
}

/**
 * Меньше цитат — не карточка. Черта требует двух разных абзацев, био — чего-то
 * кроме первого упоминания, и из одной-двух цитат модель собирает не человека, а
 * пересказ абзаца: Тоудвайн из «Кровавого меридиана» получил биографию из
 * перечня событий главы, потому что других цитат в его окне не было. Такую
 * карточку переносим в окно, где материала больше, а не зовём модель впустую.
 */
export const MIN_CARD_FRAGMENTS = 3
/** Карточка без черт характера не выводится: это цитата с именем, а не персонаж. */
export const MIN_CARD_TRAITS = 1

/** Предел входа одного вызова карточки — как в D3 work order'а. */
export const MAX_CARD_REQUEST_BYTES = 48 * 1024
export const MAX_CARD_REQUEST_FRAGMENTS = 240
const MAX_CARD_QUOTE_CHARS = 1_200

function cardError(code, message) {
  return Object.assign(new Error(message), { code })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Хэш набора фрагментов: идентичность входа карточки. В него входят только
 * координаты и порядок, но не текст — текст восстанавливается из
 * нормализованного текста по этим же координатам, а его собственный хэш у
 * карточки записан отдельно.
 */
/**
 * Отпечаток набора цитат, ушедших в запрос.
 *
 * Ключ идемпотентности несёт прогон, персонажа, промпт, ревизию и окно — всё,
 * что задумано. Но набор цитат при повторе задания может выйти другим: отбор
 * равномерный по окну и с запасом по байтам, и достаточно появиться одному
 * новому фрагменту, чтобы выборка сдвинулась. Кеш тогда отвечает 409 «этот
 * ключ уже занят другим запросом», и повторы не лечат его никогда — на
 * каталоге так и осталось 36 карточек. Отпечаток набора делает другой запрос
 * другим ключом, а одинаковый — тем же.
 */
export function characterCardRequestFragmentsFingerprint(fragments) {
  const canonical = (Array.isArray(fragments) ? fragments : [])
    .map(({ id, startOffset, endOffset }) => [id, startOffset, endOffset].join(':'))
    .sort(compareText)
    .join('\n')
  return sha256(canonical).slice(0, 16)
}

/**
 * Ключ идемпотентности запроса карточки.
 *
 * Считается одинаково тем, кто запрос шлёт, и тем, кто его принимает: разойдись
 * они — и каждый запрос отвергался бы как «ключ не соответствует запросу».
 * В ключ входит всё, от чего зависит ответ: прогон, персонаж, версия промпта,
 * ревизия состава, окно и набор цитат.
 */
export function characterCardIdempotencyKey({
  runId,
  characterKey,
  promptVersion,
  cardRevision = 1,
  cardWindow,
  fragments
}) {
  return [
    runId,
    'character-card',
    characterKey,
    promptVersion,
    `rev-${Number.isSafeInteger(cardRevision) && cardRevision >= 1 ? cardRevision : 1}`,
    `win-${cardWindow?.startOffset ?? 0}`,
    `frag-${characterCardRequestFragmentsFingerprint(fragments)}`
  ].join(':')
}

export function characterCardFragmentSetHash(fragments) {
  const canonical = [...fragments]
    .map(({ fragmentId, startOffset, endOffset }) =>
      [fragmentId, startOffset, endOffset].join(':'))
    .sort(compareText)
    .join('\n')
  return sha256(canonical)
}

/**
 * Фрагменты, попадающие во вход вызова. Отбор равномерный по окну и с запасом
 * по байтам: цитаты длиннее предела режутся, а сам список — усекается с конца,
 * потому что порядок здесь хронологический и терять надо позднее, а не раннее.
 */
function selectRequestFragments(fragments, { maxBytes, maxFragments }) {
  const ordered = [...fragments].sort((left, right) =>
    left.startOffset - right.startOffset || compareText(left.fragmentId, right.fragmentId))
  const capped = ordered.length <= maxFragments
    ? ordered
    : Array.from({ length: maxFragments }, (_, index) =>
      ordered[Math.round(index * (ordered.length - 1) / (maxFragments - 1))])
  const selected = []
  const seen = new Set()
  let bytes = 2
  for (const fragment of capped) {
    if (seen.has(fragment.fragmentId)) continue
    const item = {
      id: fragment.fragmentId,
      quote: String(fragment.quote ?? '').slice(0, MAX_CARD_QUOTE_CHARS),
      startOffset: fragment.startOffset,
      endOffset: fragment.endOffset,
      chapterIndex: fragment.chapterIndex ?? -1
    }
    const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1
    if (bytes + size > maxBytes) break
    seen.add(fragment.fragmentId)
    selected.push(item)
    bytes += size
  }
  return selected
}

/**
 * Запрос карточки персонажа.
 *
 * Фрагменты обязаны лежать внутри окна ещё до вызова: окно — это то, чего
 * модель не увидит, а не то, что она обещает не использовать.
 */
export function buildCharacterCardRequest({
  cardRevision = 1,
  runId,
  bookEditionId,
  characterKey,
  character,
  window,
  fragments,
  title,
  author = '',
  language = '',
  normalizedTextHash,
  inventoryVersion = '',
  promptVersion = CHARACTER_CARD_PROMPT_VERSION,
  maxBytes = MAX_CARD_REQUEST_BYTES,
  maxFragments = MAX_CARD_REQUEST_FRAGMENTS,
  minFragments = MIN_CARD_FRAGMENTS
}) {
  if (!runId || !characterKey) throw cardError('CARD_REQUEST_INVALID', 'runId and characterKey are required')
  if (!window || !Number.isSafeInteger(window.startOffset) || !Number.isSafeInteger(window.endOffset) ||
      window.endOffset <= window.startOffset) {
    throw cardError('CARD_REQUEST_INVALID', 'window must be a non-empty range')
  }
  const list = Array.isArray(fragments) ? fragments : []
  if (!list.length) {
    throw cardError('CARD_FRAGMENTS_MISSING', `character ${characterKey} has no fragments in its window`)
  }
  for (const fragment of list) {
    // Проверяется начало абзаца, а не его конец: абзац принадлежит окну, в
    // котором начался, и барьер отсекает главы, а не режет абзацы посередине.
    if (!fragmentBelongsToWindow(fragment, window)) {
      throw cardError(
        'CARD_FRAGMENT_OUT_OF_WINDOW',
        `fragment ${fragment.fragmentId} lies outside the card window`
      )
    }
    if (fragment.characterKey && fragment.characterKey !== characterKey) {
      throw cardError(
        'CARD_FRAGMENT_FOREIGN',
        `fragment ${fragment.fragmentId} belongs to ${fragment.characterKey}`
      )
    }
  }
  if (list.length < minFragments) {
    throw cardError(
      'CARD_FRAGMENTS_THIN',
      `character ${characterKey} has ${list.length} fragments in its window, fewer than ${minFragments}`
    )
  }
  const selected = selectRequestFragments(list, { maxBytes, maxFragments })
  if (!selected.length) {
    throw cardError('CARD_FRAGMENTS_MISSING', 'no fragment fits the request budget')
  }
  return {
    runId,
    bookEditionId,
    characterKey,
    promptVersion,
    // Ревизия — часть запроса, а не только результата: полный заход по книге
    // переиздаёт карточки тех, чей состав имён изменился, и по прежнему ключу
    // под тем же промптом лежал ответ на прежние имена.
    cardRevision,
    contractVersion: CHARACTER_CARD_CONTRACT_VERSION,
    inventoryVersion,
    normalizedTextHash,
    bookTitle: title,
    bookAuthor: author,
    language,
    traitCandidateTarget: CARD_TRAIT_CANDIDATE_TARGET,
    maxTraits: MAX_CARD_TRAITS,
    character: {
      characterKey,
      name: character.canonicalName ?? character.name,
      aliases: (character.names ?? character.aliases ?? []).slice(0, 16),
      mentionCount: character.mentionCount ?? 0,
      firstMentionTextOffset: character.firstMentionTextOffset ?? 0
    },
    cardWindow: {
      startOffset: window.startOffset,
      endOffset: window.endOffset,
      chapterIndexes: window.chapterIndexes ?? []
    },
    fragments: selected
  }
}

const SENTENCE_BOUNDARY = /[^.!?…]+[.!?…]+["»”')\]]*/gu

function fragmentSentences(quote, maxLength) {
  const normalized = String(quote ?? '').replace(/\s+/gu, ' ').trim()
  if (!normalized) return []
  const matches = normalized.match(SENTENCE_BOUNDARY) ??
    (/[.!?…]$/u.test(normalized) ? [normalized] : [])
  return matches
    .map((sentence) => sentence.trim())
    // Оборванное предложение не берём: цитата обязана читаться как цитата.
    .filter((sentence) => sentence.length >= 12 && sentence.length <= maxLength)
}

/**
 * Экстрактивное био из фрагментов окна — когда модель не дала обоснованного
 * описания. Берутся целые предложения из самых ранних фрагментов: это заведомо
 * факт из текста, потому что это и есть текст. Тот же приём, которым
 * `character-profile-v8` спасал пустое description, только источник другой —
 * абзацы, а не fact-заметки модели.
 *
 * Предложение выбирается не первое в абзаце, а первое, которое персонажа
 * называет. Абзац попал в его фрагменты потому, что упоминает его где-то, и
 * первое предложение может быть вообще не о нём — на изданиях Gutenberg с
 * длинным вступлением так и получается.
 */
export function extractiveCardBio(fragments, {
  names = [],
  maxLength = MAX_CARD_BIO_CHARS,
  maxSentences = 3
} = {}) {
  const spec = names.length
    ? buildCharacterNameMatcherSpec([{ id: 'character', name: names.join(' '), aliases: names }])
    : null
  const ordered = [...fragments].sort((left, right) =>
    left.startOffset - right.startOffset || compareText(left.fragmentId, right.fragmentId))
  const sentences = []
  const fragmentIds = []
  const seen = new Set()
  let length = 0
  for (const fragment of ordered) {
    if (sentences.length >= maxSentences) break
    const candidates = fragmentSentences(fragment.quote, maxLength)
    if (!candidates.length) continue
    const sentence = spec
      ? candidates.find((item) => findCharacterNameMatches(item, spec).length > 0)
      : candidates[0]
    if (!sentence) continue
    const key = sentence.toLocaleLowerCase('ru-RU')
    if (seen.has(key)) continue
    const nextLength = length + (sentences.length ? 1 : 0) + sentence.length
    if (nextLength > maxLength) continue
    seen.add(key)
    sentences.push(sentence)
    fragmentIds.push(fragment.fragmentId)
    length = nextLength
  }
  if (!sentences.length) return null
  return { value: sentences.join(' '), fragmentIds: [...new Set(fragmentIds)].sort() }
}

const NAME_WORD = /\p{L}+(?:[-’']\p{L}+)*/gu
/** Служебные частицы внутри имени: «Клара де Малье», «Ludwig van Beethoven». */
const NAME_PARTICLES = new Set([
  'де', 'дю', 'фон', 'ван', 'дер', 'ди', 'да', 'ла', 'ле', 'ибн', 'бен',
  'de', 'du', 'von', 'van', 'der', 'di', 'da', 'la', 'le', 'al', 'ibn', 'bin', 'of'
])

/**
 * Имя, которым начинается биография: слова с заглавной подряд — до первого
 * строчного слова или знака препинания. Модель просят начинать био с имени, и
 * это начало говорит, о ком карточка.
 *
 * Не «всё до тире»: биография без тире — «Элизабет живёт в Лонгборне с
 * сёстрами.» — тогда целиком сошла бы за имя, и «Лонгборн» проверялся бы как
 * чужой человек.
 */
export function cardBioLeadName(value) {
  const words = []
  for (const match of String(value ?? '').trim().matchAll(/(\p{L}+(?:[-’']\p{L}+)*)([^\p{L}]*)/gu)) {
    const [, word, separator] = match
    if (!/^\p{Lu}/u.test(word) && !NAME_PARTICLES.has(word.toLocaleLowerCase('ru-RU'))) break
    words.push(word)
    if (!/^\s*$/u.test(separator)) break
  }
  while (words.length && NAME_PARTICLES.has(words[words.length - 1].toLocaleLowerCase('ru-RU'))) {
    words.pop()
  }
  return words.join(' ')
}

function lowerTokens(value) {
  return String(value ?? '').toLocaleLowerCase('ru-RU').match(NAME_WORD) ?? []
}

/**
 * Полное имя в начале биографии, которого нет ни среди имён персонажа, ни в его
 * цитатах. Такое имя модель собрала сама: в «Прямо в воде?» капитан Нолл и
 * пассажир Ричард Ричардс получили по биографии «Ричард Нолл — капитан корабля»,
 * хотя «Ричард Нолл» в книге не встречается ни разу, — и у Ричардса описание
 * оказалось чужим. Имя из собственных имён персонажа проверять незачем; чужое
 * обязано найтись в цитатах словами подряд, в любом падеже и порядке.
 */
export function ungroundedBioLead(bioValue, { names = [], fragments = [] } = {}) {
  const lead = cardBioLeadName(bioValue)
  const tokens = (lead.match(NAME_WORD) ?? []).filter((token) => /^\p{Lu}/u.test(token))
  if (tokens.length < 2) return null
  const own = new Set(names.flatMap(lowerTokens))
  if (tokens.every((token) => own.has(token.toLocaleLowerCase('ru-RU')))) return null
  // Слова имени обязаны стоять подряд — в прямом порядке или в обратном
  // («Барабанов Николай Сергеевич»). Окно «где-то рядом» пропускало «Ричарда
  // Нолла»: в цитатах «Нолл» и «Ричарду» стоят через слово, а человека с таким
  // именем в книге нет.
  const wanted = tokens.map((token) => stemNameToken(token.toLocaleLowerCase('ru-RU')))
  const reversed = [...wanted].reverse()
  const matchesAt = (stems, start, sequence) =>
    sequence.every((stem, offset) => stems[start + offset] === stem)
  for (const fragment of fragments) {
    const stems = lowerTokens(fragment.quote).map((word) => stemNameToken(word))
    for (let start = 0; start + wanted.length <= stems.length; start += 1) {
      if (matchesAt(stems, start, wanted) || matchesAt(stems, start, reversed)) return null
    }
  }
  return lead
}

function claimFragmentIds(claim) {
  return Array.isArray(claim?.fragmentIds) ? claim.fragmentIds : []
}

/**
 * Оставляет только утверждения, все ссылки которых ведут на известные
 * фрагменты этого персонажа внутри окна. Утверждение с посторонней ссылкой
 * отбрасывается целиком, а не «чинится» удалением ссылки: обрезанное
 * подтверждение — уже не то подтверждение, которое модель имела в виду.
 */
function groundedClaims(claims, allowed) {
  const kept = []
  let dropped = 0
  for (const claim of Array.isArray(claims) ? claims : []) {
    const fragmentIds = claimFragmentIds(claim)
    if (!fragmentIds.length || !fragmentIds.every((id) => allowed.has(id))) {
      dropped += 1
      continue
    }
    kept.push(claim)
  }
  return { kept, dropped }
}

function groundedClaim(claim, allowed) {
  if (!claim) return null
  const fragmentIds = claimFragmentIds(claim)
  if (!fragmentIds.length || !fragmentIds.every((id) => allowed.has(id))) return null
  return claim
}

/**
 * Приёмка ответа генератора: ссылочный аудит, экстрактивный fallback для био и
 * проверка контракта. Возвращает готовую к записи строку карточки.
 *
 * @param {object} input запрос, построенный {@link buildCharacterCardRequest}
 * @param {object} result ответ генератора
 * @param {Array} fragments полный набор фрагментов персонажа в окне
 */
export function finalizeCharacterCard({
  input,
  result,
  fragments,
  cardRevision = 1,
  createdAt = new Date().toISOString()
}) {
  if (!input) throw cardError('CARD_REQUEST_INVALID', 'input is required')
  const windowFragments = (Array.isArray(fragments) ? fragments : [])
    .filter((fragment) => fragmentBelongsToWindow(fragment, input.cardWindow))
  const mentionCountInWindow = windowFragments.reduce(
    (sum, fragment) => sum + (fragment.mentionOffsets?.length ?? fragment.mentionCount ?? 1),
    0
  )
  if (!windowFragments.length) {
    throw cardError('CARD_FRAGMENTS_MISSING', 'no fragments available for the card window')
  }
  // Разрешены только те фрагменты, которые действительно были в запросе:
  // модель не могла обосноваться тем, чего не видела.
  const allowed = new Set(input.fragments.map(({ id }) => id))
  const card = result?.card && typeof result.card === 'object' ? result.card : result ?? {}

  const traitResult = groundedClaims(card.traits, allowed)
  const traits = traitResult.kept.slice(0, MAX_CARD_TRAITS)
  const locationResult = groundedClaims(card.locations, allowed)
  const role = groundedClaim(card.role, allowed)
  // Био и характер обязательны. Прежде био без модели заменялось первыми
  // предложениями цитат, и читатель видел вместо описания абзац книги: «Когда
  // малец познакомился с Тоудвайном, дождь лил уже шестнадцать дней подряд». Из
  // пятидесяти двух героев трёх проверенных книг у тридцати восьми не было ни
  // одной черты. Такая карточка не выводится; окно дальше по книге, где цитат
  // больше, получает её ещё раз.
  const bio = groundedClaim(card.bio, allowed)
  if (!bio) {
    throw cardError('CARD_BIO_MISSING', 'the model returned no grounded bio')
  }
  if (traits.length < MIN_CARD_TRAITS) {
    throw cardError('CARD_TRAITS_MISSING', 'the model returned no stable trait')
  }
  // Только имена из инвентаря и состава: свои псевдонимы модель пишет сама, и
  // выдуманное полное имя в них прошло бы проверку, которую должно не пройти.
  const names = [input.character.name, ...(input.character.aliases ?? [])]
    .filter((name) => typeof name === 'string' && name.trim())
  const foreignLead = ungroundedBioLead(bio.value, { names, fragments: input.fragments })
  if (foreignLead) {
    throw cardError(
      'CARD_BIO_UNGROUNDED_NAME',
      `bio opens with «${foreignLead}», a name the fragments never give`
    )
  }
  const bioSource = 'model'

  const fragmentSetHash = characterCardFragmentSetHash(windowFragments)
  const validated = validateCharacterCard({
    contractVersion: CHARACTER_CARD_CONTRACT_VERSION,
    characterKey: input.characterKey,
    name: card.name || input.character.name,
    fullName: card.fullName ?? '',
    aliases: Array.isArray(card.aliases) && card.aliases.length
      ? card.aliases
      : input.character.aliases,
    firstMentionTextOffset: input.character.firstMentionTextOffset,
    cardWindow: input.cardWindow,
    // Два счётчика из разных проходов: в ростере — вхождения поверхностей имени
    // по инвентарю, в окне — упоминания по фрагментам. Обычно первый больше, но
    // не всегда, и тогда карточка падала на собственном инварианте
    // «в окне не больше, чем в книге». Инвариант верен, а меньшее из двух
    // чисел — нет: если окно насчитало больше, значит недосчитал ростер.
    mentionCount: Math.max(input.character.mentionCount ?? 0, mentionCountInWindow),
    mentionCountInWindow,
    traits,
    bio,
    role,
    locations: locationResult.kept,
    appearancePrompt: card.appearancePrompt ?? '',
    gender: card.gender || 'unknown',
    age: card.age ?? '',
    greeting: card.greeting ?? '',
    source: {
      normalizedTextHash: input.normalizedTextHash,
      inventoryVersion: input.inventoryVersion || 'name-inventory-v1',
      fragmentSetHash,
      promptVersion: input.promptVersion
    },
    createdAt
  }, { fragments: windowFragments })

  return {
    card: validated,
    cardRevision,
    fragmentSetHash,
    audit: {
      bioSource,
      requestFragmentCount: input.fragments.length,
      windowFragmentCount: windowFragments.length,
      droppedTraitCount: traitResult.dropped + Math.max(0, traitResult.kept.length - traits.length),
      droppedLocationCount: locationResult.dropped,
      // Что именно снял аудит устойчивости, и по какой причине. Считает
      // `filterStableTraits` на стороне генератора; здесь эти числа только
      // переносятся в отчёт, потому что иначе они теряются между двумя
      // приёмками, и снятие черт остаётся невидимым.
      providerTraitCount: result?.providerTraitCount ?? null,
      stableTraitCount: result?.acceptedTraitCount ?? null,
      traitRejections: result?.traitRejections ?? {},
      roleAccepted: Boolean(role),
      citedFragmentCount: validated.referencedFragmentCount ?? 0
    }
  }
}
