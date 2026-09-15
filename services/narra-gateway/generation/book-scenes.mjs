export const BOOK_SCENE_POLICY_VERSION = 'text-interval-v1'
export const BOOK_SCENE_INTERVAL_TEXT_LENGTH = 6_000
export const BOOK_READER_SCENE_VERSION = 'reader-card-v1'
export const BOOK_READER_SCENE_CONTEXT_TEXT_LENGTH = 500
export const BOOK_MEDIA_LOOKAHEAD_FRACTION = 0.1

function positiveTextLength(value, name = 'textLength') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name}: expected a positive safe integer`)
  }
  return value
}

function textOffset(value, textLength, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name}: expected a non-negative safe integer`)
  }
  return Math.min(value, textLength - 1)
}

export function bookScenePolicy(textLength, {
  intervalTextLength = BOOK_SCENE_INTERVAL_TEXT_LENGTH
} = {}) {
  positiveTextLength(textLength)
  if (!Number.isSafeInteger(intervalTextLength) || intervalTextLength < 1) {
    throw new TypeError('intervalTextLength: expected a positive safe integer')
  }
  return {
    version: BOOK_SCENE_POLICY_VERSION,
    startTextOffset: 0,
    intervalTextLength
  }
}

export function normalizeBookScenePolicy(value, textLength) {
  positiveTextLength(textLength)
  if (value == null) return bookScenePolicy(textLength)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('scenePolicy: expected an object')
  }
  const keys = Object.keys(value)
  if (keys.some((key) => !['version', 'startTextOffset', 'intervalTextLength'].includes(key))) {
    throw new TypeError('scenePolicy: unknown field')
  }
  if (value.version !== BOOK_SCENE_POLICY_VERSION) {
    throw new TypeError(`scenePolicy.version: expected ${BOOK_SCENE_POLICY_VERSION}`)
  }
  if (value.startTextOffset !== 0) {
    throw new TypeError('scenePolicy.startTextOffset: expected 0')
  }
  return bookScenePolicy(textLength, { intervalTextLength: value.intervalTextLength })
}

export function bookSceneSlotAt(policyValue, textLengthValue, readerTextOffsetValue) {
  const textLength = positiveTextLength(textLengthValue)
  const policy = normalizeBookScenePolicy(policyValue, textLength)
  const readerTextOffset = textOffset(readerTextOffsetValue, textLength, 'readerTextOffset')
  const slotIndex = Math.floor(
    Math.max(0, readerTextOffset - policy.startTextOffset) / policy.intervalTextLength
  )
  const slotStartTextOffset = Math.min(
    textLength - 1,
    policy.startTextOffset + slotIndex * policy.intervalTextLength
  )
  const slotEndTextOffset = Math.min(
    textLength,
    slotStartTextOffset + policy.intervalTextLength
  )
  const anchorTextOffset = slotStartTextOffset + Math.floor(
    (slotEndTextOffset - slotStartTextOffset) / 2
  )
  const excerptEndTextOffset = Math.min(slotEndTextOffset, anchorTextOffset + 1)
  const excerptStartTextOffset = Math.max(slotStartTextOffset, excerptEndTextOffset - 500)
  return {
    sceneKey: `${policy.version}:${slotIndex}`,
    slotIndex,
    anchorTextOffset,
    excerptStartTextOffset,
    excerptEndTextOffset
  }
}

/**
 * Отрезок книги, который иллюстрирует одна картинка.
 *
 * Картинка рисуется на интервал, а читатель просит её из точки внутри него.
 * Без явной границы клиент не знает, когда предлагать следующую врезку, и
 * предлагает по своему счёту страниц — тогда внутри одного интервала возникают
 * две врезки с одинаковой картинкой. Границу считает тот, кто владеет сеткой.
 */
export function bookSceneStretchAt(policyValue, textLengthValue, readerTextOffsetValue) {
  const textLength = positiveTextLength(textLengthValue)
  const policy = normalizeBookScenePolicy(policyValue, textLength)
  const readerTextOffset = textOffset(readerTextOffsetValue, textLength, 'readerTextOffset')
  const slotIndex = Math.floor(
    Math.max(0, readerTextOffset - policy.startTextOffset) / policy.intervalTextLength
  )
  const startTextOffset = Math.min(
    textLength - 1,
    policy.startTextOffset + slotIndex * policy.intervalTextLength
  )
  const endTextOffset = Math.min(textLength, startTextOffset + policy.intervalTextLength)
  return {
    startTextOffset,
    endTextOffset,
    // Доля, а не смещение: клиент живёт в долях прочитанного и в CFI, знаков он
    // не считает. Конец последнего отрезка — ровно единица, чтобы у книги не
    // осталось хвоста, в котором врезки предлагаются снова.
    endFraction: endTextOffset >= textLength ? 1 : endTextOffset / textLength
  }
}

/** A reader card owns its exact text position instead of sharing a 6k interval. */
export function bookReaderSceneAt(textLengthValue, readerTextOffsetValue) {
  const textLength = positiveTextLength(textLengthValue)
  const anchorTextOffset = textOffset(readerTextOffsetValue, textLength, 'readerTextOffset')
  const excerptEndTextOffset = Math.min(textLength, anchorTextOffset + 1)
  const excerptStartTextOffset = Math.max(
    0,
    excerptEndTextOffset - BOOK_READER_SCENE_CONTEXT_TEXT_LENGTH
  )
  return {
    policyVersion: BOOK_READER_SCENE_VERSION,
    sceneKey: `${BOOK_READER_SCENE_VERSION}:${anchorTextOffset}`,
    // Legacy interval slots are always below textLength, so this range cannot collide.
    slotIndex: textLength + anchorTextOffset,
    anchorTextOffset,
    excerptStartTextOffset,
    excerptEndTextOffset
  }
}

export function bookSceneSlotsThrough(policyValue, textLengthValue, frontierTextOffsetValue) {
  const textLength = positiveTextLength(textLengthValue)
  const policy = normalizeBookScenePolicy(policyValue, textLength)
  if (!Number.isSafeInteger(frontierTextOffsetValue) || frontierTextOffsetValue < 0) {
    throw new TypeError('frontierTextOffset: expected a non-negative safe integer')
  }
  const frontierTextOffset = Math.min(frontierTextOffsetValue, textLength)
  const slots = []
  for (let slotIndex = 0; ; slotIndex += 1) {
    const slotStart = policy.startTextOffset + slotIndex * policy.intervalTextLength
    if (slotStart >= textLength) break
    const slot = bookSceneSlotAt(policy, textLength, slotStart)
    if (slot.anchorTextOffset >= frontierTextOffset) break
    slots.push(slot)
  }
  return slots
}

/**
 * Докуда делать сцены.
 *
 * Отдельно от `bookMediaFrontier`, который решает про портреты персонажей и у
 * каталожной книги отдаёт её целиком. Для сцен это оказалось дорого: у «Героя
 * нашего времени» 45 слотов, и все 45 вставали в очередь разом в тот же миг,
 * когда книга опубликована. По всей установке так набралось 10 639 заданий, и
 * 31 августа очередь чистили руками.
 *
 * Поэтому сцены идут пачками за читателем: всё до его позиции плюс запас. Режим
 * `book` возвращает прежнее поведение — вся книга сразу.
 */
export function bookSceneFrontier({
  scope,
  textLength: textLengthValue,
  readerTextOffset = 0,
  mode = 'reader',
  lookaheadFraction = BOOK_MEDIA_LOOKAHEAD_FRACTION
}) {
  const textLength = positiveTextLength(textLengthValue)
  if (scope !== 'catalog' && scope !== 'private') {
    throw new TypeError('scope: expected catalog or private')
  }
  if (mode !== 'reader' && mode !== 'book') {
    throw new TypeError('mode: expected reader or book')
  }
  if (mode === 'book') return textLength
  if (!(lookaheadFraction > 0) || lookaheadFraction > 1) {
    throw new TypeError('lookaheadFraction: expected a fraction between 0 and 1')
  }
  const currentOffset = textOffset(readerTextOffset, textLength, 'readerTextOffset')
  return Math.min(textLength, currentOffset + Math.ceil(textLength * lookaheadFraction))
}

/**
 * Делать ли сцены заранее, и докуда.
 *
 * По умолчанию `none` — сцена появляется, когда читатель её открыл. Это не
 * лень, а решение после инцидента: 31 августа очередь сцен чистили руками
 * (10 639 заданий по 148 книгам), и на следующий день автоматический подогрев
 * выключили. Возвращать его по умолчанию нельзя.
 *
 * `reader` включает пачки: всё до позиции читателя плюс запас. Причина
 * инцидента была не в подогреве самом по себе, а в том, что у каталожной книги
 * фронтир равен всей книге, и 45 слотов «Героя нашего времени» вставали в
 * очередь разом. Пачка за читателем — это 4–14 сцен.
 *
 * `book` — прежнее «вся книга сразу», для тех, кто этого хочет осознанно.
 */
const SCENE_PREGENERATION_MODES = ['none', 'reader', 'book']

function parseScenePregenerationMode(raw, name) {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (!SCENE_PREGENERATION_MODES.includes(value)) {
    throw Object.assign(
      new TypeError(`${name} must be none, reader or book`),
      { code: 'BOOK_SCENE_PREGENERATION_INVALID' }
    )
  }
  return value
}

export function bookScenePregenerationMode(env = process.env) {
  return parseScenePregenerationMode(env.BOOK_SCENE_PREGENERATION, 'BOOK_SCENE_PREGENERATION')
    ?? 'none'
}

/**
 * Подогрев по области видимости книги.
 *
 * Причина инцидента 31 августа была не в подогреве самом по себе, а в том, что
 * у каталожной книги фронтир равен всей книге: 45 слотов «Героя нашего
 * времени» вставали в очередь разом, и по установке набралось 10 639 заданий.
 * У приватной книги фронтир другой по устройству — позиция читателя плюс
 * десятая часть книги, то есть 4–14 сцен за раз, — и включать подогрев ей
 * безопасно там, где каталогу нельзя.
 *
 * Отсюда отдельная настройка: `BOOK_SCENE_PREGENERATION_PRIVATE=reader`
 * разогревает только то, что человек загрузил сам, и не трогает пятьсот книг
 * каталога, которых никто не открывал. Без неё приватные книги живут по общей
 * настройке — поведение остаётся прежним.
 */
export function bookScenePregenerationModeForScope(scope, env = process.env) {
  if (scope === 'private') {
    const privateMode = parseScenePregenerationMode(
      env.BOOK_SCENE_PREGENERATION_PRIVATE,
      'BOOK_SCENE_PREGENERATION_PRIVATE'
    )
    if (privateMode) return privateMode
  }
  return bookScenePregenerationMode(env)
}

export function bookMediaFrontier({ scope, textLength: textLengthValue, readerTextOffset = 0 }) {
  const textLength = positiveTextLength(textLengthValue)
  if (scope === 'catalog') return textLength
  if (scope !== 'private') throw new TypeError('scope: expected catalog or private')
  const currentOffset = textOffset(readerTextOffset, textLength, 'readerTextOffset')
  return Math.min(
    textLength,
    currentOffset + Math.ceil(textLength * BOOK_MEDIA_LOOKAHEAD_FRACTION)
  )
}

export function bookSceneIdempotencyKey({
  bookEditionId,
  markupContentHash,
  policyVersion,
  slotIndex
}) {
  return [bookEditionId, 'scene', markupContentHash, policyVersion, slotIndex].join(':')
}
