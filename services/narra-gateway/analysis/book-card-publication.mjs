import { createHash, randomUUID } from 'node:crypto'
import { assembleBookMarkupV3 } from './book-analysis-assembler.mjs'
import { validateBookMarkupV3 } from './book-analysis-validator.mjs'
import { cardSnapshotFor, projectCardsToSnapshot } from './book-card-markup-projection.mjs'

/**
 * Снимок книги, собранный из карточек, готовый к публикации.
 *
 * Конвейер карточек до сих пор не публиковал ничего, и свежая приватная книга
 * оставалась «в обработке» навсегда: читатель видит книгу через
 * `book_markup_versions`, а их заполняет только публикация.
 *
 * Перевод карточек в наблюдения и сущности уже написан — `projectCardsToSnapshot`
 * отдаёт их в той форме, которую читает Validate. Здесь из них собирается
 * разметка и проверяется теми же правилами, что и разметка narra: проверка не
 * ослаблена под новый конвейер, иначе она перестала бы что-либо значить.
 *
 * Публикуется то, что готово сейчас. Окна приватной книги открываются за
 * читателем, и карточек в начале ровно на первую пачку — это не половинчатая
 * разметка, а честный снимок: книга открывается сразу, а следующая публикация
 * догонит окна.
 */
export function buildCardPublication({
  cards,
  fragmentsByCharacter,
  normalizedText,
  normalizedTextHash,
  snapshotId = randomUUID()
}) {
  const textLength = normalizedText.length
  if (sha256(normalizedText) !== normalizedTextHash) {
    throw publicationError(
      'CARD_PUBLICATION_TEXT_MISMATCH',
      'normalized text does not match the hash the fragments were measured against'
    )
  }
  // Персонаж без фрагментов спроецировать нельзя: цитировать нечего. Такие
  // карточки пропускаются, а не роняют публикацию всей книги.
  const usable = cards.filter(({ characterKey }) =>
    (fragmentsByCharacter.get(characterKey) ?? []).length > 0)
  if (!usable.length) {
    throw publicationError('CARD_PUBLICATION_EMPTY', 'no card has fragments to cite')
  }
  const projection = projectCardsToSnapshot({
    cards: usable,
    fragmentsByCharacter,
    textLength
  })
  const snapshot = cardSnapshotFor({ snapshotId, projection })
  const markup = assembleBookMarkupV3({
    snapshotId,
    textLength,
    entities: projection.entities,
    observations: projection.observations,
    characterProfiles: projection.characterProfiles,
    characterSelection: projection.characterSelection
  })
  const validation = validateBookMarkupV3({
    markup,
    snapshot,
    observations: projection.observations,
    normalizedText,
    normalizedTextHash
  })
  const markupContentHash = contentHash(markup)
  return {
    snapshot,
    markup,
    markupContentHash,
    observations: projection.observations,
    validation,
    skippedCharacterKeys: cards
      .filter(({ characterKey }) => !(fragmentsByCharacter.get(characterKey) ?? []).length)
      .map(({ characterKey }) => characterKey),
    bindings: {
      snapshotId,
      snapshotContentHash: snapshot.contentHash,
      normalizedTextHash,
      markupContentHash
    }
  }
}

function publicationError(code, message) {
  return Object.assign(new Error(message), { code })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Тот же хэш содержимого, которым артефакты разметки считает narra. */
export function contentHash(value) {
  return sha256(JSON.stringify(canonical(value)))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}
