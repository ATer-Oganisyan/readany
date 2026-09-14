/**
 * Контракт `character-card-v1` — неизменяемая карточка персонажа.
 *
 * Карточка создаётся один раз на своё окно и больше не меняется. Правки текста
 * идут через существующий correction overlay (`book_character_corrections`), а
 * не мутацией строки; новая карточка того же персонажа возможна только как новая
 * `cardRevision` по явной операторской команде. Причина в воспроизводимости:
 * у карточки в `source` записаны хэши входа, и если строку можно править на
 * месте, эти хэши перестают что-либо значить.
 *
 * Главный инвариант — ссылочный: каждое утверждение карточки ссылается на
 * фрагменты, а каждый фрагмент обязан существовать, принадлежать этому
 * персонажу и лежать внутри окна карточки. Это и есть структурный
 * спойлер-барьер: факт из главы 8 не может попасть в карточку персонажа из
 * главы 1, потому что фрагмента из главы 8 в проверке не окажется.
 */

/**
 * Абзац принадлежит окну, в котором он начинается.
 *
 * Барьер отсекает главы, а не режет абзацы посередине. Предикат жил в четырёх
 * местах — постановка задания, сборка запроса, сборка карточки, проверка
 * контракта — и разошёлся: персонаж с единственным абзацем на границе окна
 * сначала падал на CARD_FRAGMENTS_MISSING, а после «целиком внутри» стал
 * пропадать молча. «Александр Троекуров» с четырнадцатью фрагментами остался
 * без карточки вовсе. Теперь он один на всех.
 */
export function fragmentBelongsToWindow(fragment, window) {
  return fragment.startOffset >= window.startOffset && fragment.startOffset < window.endOffset
}

export const CHARACTER_CARD_CONTRACT_VERSION = 'character-card-v1'
// v3: приветствие обращено к читателю, а не к герою книги. Промпт молчал о том,
//     кто собеседник, и модель писала реплику внутри сюжета: Драко здоровался
//     с читателем как с Грейнджер, Тонкс — как с Малфоем. Версия входит в ключ
//     карточки, поэтому без её подъёма старые приветствия остались бы жить.
export const CHARACTER_CARD_PROMPT_VERSION = 'character-card-prompt-v3'

/**
 * Сколько черт просить у модели. Просим с запасом: аудит стабильности черт
 * (`filterStableTraits`) намеренно состязателен и удаляет всё, что держится на
 * одной сцене, поэтому кандидатов должно быть больше, чем нужно на выходе.
 */
export const CARD_TRAIT_CANDIDATE_TARGET = 8
export const MAX_CARD_TRAITS = 6
export const MAX_CARD_LOCATIONS = 8
export const MAX_CARD_BIO_CHARS = 600
export const MAX_CARD_APPEARANCE_CHARS = 800

export const CHARACTER_CARD_GENDERS = Object.freeze(['male', 'female', 'unknown'])
export const CHARACTER_CARD_STATUSES = Object.freeze(['ready', 'pending'])

const GENDERS = new Set(CHARACTER_CARD_GENDERS)
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/

function invalid(message) {
  const error = new Error(message)
  error.code = 'CHARACTER_CARD_INVALID'
  error.status = 400
  throw error
}

function objectValue(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${name}: expected an object`)
  }
  return value
}

function textValue(value, name, maxLength, { optional = false } = {}) {
  if (optional && (value == null || value === '')) return ''
  if (typeof value !== 'string' || !value.trim()) invalid(`${name}: expected text`)
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length > maxLength) invalid(`${name}: exceeds ${maxLength} characters`)
  return normalized
}

function keyValue(value, name) {
  const normalized = textValue(value, name, 256)
  if (!KEY_PATTERN.test(normalized)) invalid(`${name}: invalid key`)
  return normalized
}

function offsetValue(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalid(`${name}: expected a non-negative safe integer`)
  }
  return value
}

function hashValue(value, name) {
  const normalized = textValue(value, name, 80)
  if (!SHA256.test(normalized)) invalid(`${name}: expected a SHA-256 digest`)
  return normalized
}

function nameArray(value, name, limit) {
  if (value == null) return []
  if (!Array.isArray(value)) invalid(`${name}: expected an array`)
  if (value.length > limit) invalid(`${name}: exceeds ${limit} entries`)
  const seen = new Set()
  const result = []
  for (const [index, item] of value.entries()) {
    const normalized = textValue(item, `${name}[${index}]`, 200)
    const key = normalized.toLocaleLowerCase('ru-RU')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function cardWindow(value, name) {
  const window = objectValue(value, name)
  const startOffset = offsetValue(window.startOffset, `${name}.startOffset`)
  const endOffset = offsetValue(window.endOffset, `${name}.endOffset`)
  if (endOffset <= startOffset) invalid(`${name}: endOffset must exceed startOffset`)
  if (!Array.isArray(window.chapterIndexes) || !window.chapterIndexes.length) {
    invalid(`${name}.chapterIndexes: expected a non-empty array`)
  }
  const chapterIndexes = window.chapterIndexes.map((item, index) =>
    offsetValue(item, `${name}.chapterIndexes[${index}]`))
  return { startOffset, endOffset, chapterIndexes }
}

/**
 * Утверждение карточки со ссылками на фрагменты. Утверждение без ссылок
 * отвергается: неподкреплённый факт — это то, за чем в карточку и приходят.
 */
function claim(value, name, { maxChars, requireFragments = true, withConfidence = false }) {
  const source = objectValue(value, name)
  const result = { value: textValue(source.value, `${name}.value`, maxChars) }
  if (!Array.isArray(source.fragmentIds)) invalid(`${name}.fragmentIds: expected an array`)
  const fragmentIds = [...new Set(source.fragmentIds.map((item, index) =>
    keyValue(item, `${name}.fragmentIds[${index}]`)))]
  if (requireFragments && !fragmentIds.length) {
    invalid(`${name}.fragmentIds: at least one fragment is required`)
  }
  result.fragmentIds = fragmentIds.sort()
  if (withConfidence) {
    const { confidence } = source
    if (confidence != null) {
      if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) {
        invalid(`${name}.confidence: expected a number within [0, 1]`)
      }
      result.confidence = Math.round(confidence * 100) / 100
    }
  }
  return result
}

function claimArray(value, name, limit, options) {
  if (value == null) return []
  if (!Array.isArray(value)) invalid(`${name}: expected an array`)
  if (value.length > limit) invalid(`${name}: exceeds ${limit} entries`)
  return value.map((item, index) => claim(item, `${name}[${index}]`, options))
}

/**
 * Проверяет карточку и её ссылочный инвариант.
 *
 * @param {object} card
 * @param {object} [context]
 * @param {Array<{fragmentId: string, characterKey: string, startOffset: number, endOffset: number}>}
 *   [context.fragments] фрагменты персонажа; без них ссылки не проверяются, и
 *   это осознанный режим только для чтения уже записанной карточки.
 */
export function validateCharacterCard(card, { fragments = null } = {}) {
  const source = objectValue(card, 'card')
  if (source.contractVersion !== CHARACTER_CARD_CONTRACT_VERSION) {
    invalid(`card.contractVersion: expected ${CHARACTER_CARD_CONTRACT_VERSION}`)
  }
  const characterKey = keyValue(source.characterKey, 'card.characterKey')
  const window = cardWindow(source.cardWindow, 'card.cardWindow')
  const firstMentionTextOffset = offsetValue(
    source.firstMentionTextOffset,
    'card.firstMentionTextOffset'
  )
  if (firstMentionTextOffset >= window.endOffset) {
    invalid('card.firstMentionTextOffset: must fall inside the card window')
  }
  const mentionCount = offsetValue(source.mentionCount, 'card.mentionCount')
  const mentionCountInWindow = offsetValue(
    source.mentionCountInWindow,
    'card.mentionCountInWindow'
  )
  if (mentionCountInWindow > mentionCount) {
    invalid('card.mentionCountInWindow: must not exceed mentionCount')
  }

  // Нижней границы у числа черт нет, и это осознанно: аудит устойчивости
  // (`filterStableTraits`) вправе удалить все заявленные черты, и жёсткий
  // минимум превратил бы строгую проверку в отказ выдать карточку вообще.
  // Карточка с био и пустым «Характером» полезнее отсутствующей.
  const traits = claimArray(source.traits, 'card.traits', MAX_CARD_TRAITS, {
    maxChars: 120,
    withConfidence: true
  })
  const bio = claim(source.bio, 'card.bio', { maxChars: MAX_CARD_BIO_CHARS })
  const role = source.role == null
    ? null
    : claim(source.role, 'card.role', { maxChars: 200 })
  const locations = claimArray(source.locations, 'card.locations', MAX_CARD_LOCATIONS, {
    maxChars: 160
  })

  const gender = textValue(source.gender, 'card.gender', 16)
  if (!GENDERS.has(gender)) {
    invalid(`card.gender: expected one of ${CHARACTER_CARD_GENDERS.join(', ')}`)
  }
  const sourceMeta = objectValue(source.source, 'card.source')
  const validated = {
    contractVersion: CHARACTER_CARD_CONTRACT_VERSION,
    characterKey,
    name: textValue(source.name, 'card.name', 200),
    fullName: textValue(source.fullName, 'card.fullName', 200, { optional: true }),
    aliases: nameArray(source.aliases, 'card.aliases', 24),
    firstMentionTextOffset,
    cardWindow: window,
    mentionCount,
    mentionCountInWindow,
    traits,
    bio,
    role,
    locations,
    appearancePrompt: textValue(
      source.appearancePrompt,
      'card.appearancePrompt',
      MAX_CARD_APPEARANCE_CHARS,
      { optional: true }
    ),
    gender,
    age: textValue(source.age, 'card.age', 80, { optional: true }),
    // Приветствие — творческое поле, а не факт книги, поэтому ссылок на
    // фрагменты у него нет и быть не должно: цитировать тут нечего.
    greeting: textValue(source.greeting, 'card.greeting', 600, { optional: true }),
    source: {
      normalizedTextHash: hashValue(
        sourceMeta.normalizedTextHash,
        'card.source.normalizedTextHash'
      ),
      inventoryVersion: textValue(
        sourceMeta.inventoryVersion,
        'card.source.inventoryVersion',
        80
      ),
      fragmentSetHash: hashValue(sourceMeta.fragmentSetHash, 'card.source.fragmentSetHash'),
      promptVersion: textValue(sourceMeta.promptVersion, 'card.source.promptVersion', 80)
    },
    createdAt: textValue(source.createdAt, 'card.createdAt', 40)
  }
  if (Number.isNaN(Date.parse(validated.createdAt))) {
    invalid('card.createdAt: expected an ISO-8601 timestamp')
  }

  if (fragments) {
    const byId = new Map()
    for (const fragment of fragments) {
      byId.set(String(fragment?.fragmentId ?? ''), fragment)
    }
    const referenced = new Set([
      ...traits.flatMap(({ fragmentIds }) => fragmentIds),
      ...bio.fragmentIds,
      ...(role?.fragmentIds ?? []),
      ...locations.flatMap(({ fragmentIds }) => fragmentIds)
    ])
    for (const fragmentId of referenced) {
      const fragment = byId.get(fragmentId)
      if (!fragment) invalid(`card: unknown fragment ${fragmentId}`)
      if (fragment.characterKey !== characterKey) {
        invalid(`card: fragment ${fragmentId} belongs to ${fragment.characterKey}`)
      }
      if (
        !fragmentBelongsToWindow(fragment, window)
      ) {
        invalid(`card: fragment ${fragmentId} lies outside the card window`)
      }
    }
    validated.referencedFragmentCount = referenced.size
  }
  return validated
}

/**
 * Проекция карточки в поля, которые ридер и manifest v3 читают сегодня.
 * Разметка клиента не меняется: `description` — это био, `traits` — значения
 * утверждений, `cardStatus` отличает готовую карточку от персонажа roster,
 * карточка которого ещё не построена.
 */
export function characterCardProjection(card, { cardStatus = 'ready' } = {}) {
  if (!CHARACTER_CARD_STATUSES.includes(cardStatus)) {
    invalid(`cardStatus: expected one of ${CHARACTER_CARD_STATUSES.join(', ')}`)
  }
  return {
    characterKey: card.characterKey,
    name: card.name,
    fullName: card.fullName,
    aliases: card.aliases,
    role: card.role?.value ?? null,
    description: card.bio.value,
    greeting: card.greeting,
    traits: card.traits.map(({ value }) => value),
    locations: card.locations.map(({ value }) => value),
    appearancePrompt: card.appearancePrompt,
    gender: card.gender,
    age: card.age,
    firstAppearanceTextOffset: card.firstMentionTextOffset,
    mentionCount: card.mentionCount,
    cardStatus
  }
}
