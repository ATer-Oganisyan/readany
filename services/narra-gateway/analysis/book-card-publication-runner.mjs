import { createHash } from 'node:crypto'
import { validateCharacterCard } from './book-character-card-contract.mjs'
import { buildCardPublication } from './book-card-publication.mjs'
import { createOperationalLogger } from '../platform/operational-log.mjs'

const MAX_NORMALIZED_TEXT_BYTES = 64 * 1024 * 1024

/**
 * Публикация разметки книги по мере готовности окон карточек.
 *
 * Вызывается там же, где закрывается окно: пока окно открыто, состав карточек
 * ещё меняется, и публиковать промежуточное состояние значит плодить ревизии
 * разметки без нового содержимого.
 *
 * Ошибка публикации не роняет карточку. Карточка уже сделана и сохранена, а
 * публикация — следующий шаг, который повторится на следующем окне. Уронить
 * задание здесь значило бы переделать оплаченный вызов модели из-за сбоя в
 * том, что вызова не требует.
 */
export function createCardPublicationRunner({
  repository,
  storage,
  maxTextBytes = MAX_NORMALIZED_TEXT_BYTES,
  logger = console
}) {
  if (typeof repository?.getCardPublicationInput !== 'function') {
    throw new TypeError('repository.getCardPublicationInput is required')
  }
  if (typeof repository?.publishCardsMarkup !== 'function') {
    throw new TypeError('repository.publishCardsMarkup is required')
  }
  if (typeof storage?.getBytes !== 'function') {
    throw new TypeError('storage.getBytes is required')
  }
  const log = createOperationalLogger({ component: 'book-cards', logger })

  return {
    async publish({ runId, normalizedText = null }) {
      const startedAt = Date.now()
      const input = await repository.getCardPublicationInput({ runId })
      if (!input) return { published: false, reason: 'run_missing' }
      if (!input.cards.length) return { published: false, reason: 'no_cards' }

      const text = normalizedText ?? await readNormalizedText(input)
      const fragmentsByCharacter = new Map()
      for (const fragment of input.fragments) {
        const list = fragmentsByCharacter.get(fragment.characterKey) ?? []
        list.push({ ...fragment, quote: text.slice(fragment.startOffset, fragment.endOffset) })
        fragmentsByCharacter.set(fragment.characterKey, list)
      }
      const built = buildCardPublication({
        cards: input.cards.map((document) => validateCharacterCard(document)),
        fragmentsByCharacter,
        normalizedText: text,
        normalizedTextHash: input.normalizedTextHash
      })
      if (!built.validation.valid) {
        log.error('cards.publication_invalid', 'Разметка из карточек не прошла проверку', {
          run: runId,
          edition: input.bookEditionId,
          error_codes: [...new Set(built.validation.errors.map(({ code }) => code))].slice(0, 8),
          error_count: built.validation.errors.length
        })
        return { published: false, reason: 'invalid', errors: built.validation.errors.slice(0, 20) }
      }
      const result = await repository.publishCardsMarkup({
        runId,
        bookEditionId: input.bookEditionId,
        snapshot: built.snapshot,
        markup: built.markup,
        markupContentHash: built.markupContentHash,
        validation: built.validation
      })
      if (result.published) {
        log.info('cards.published', 'Разметка книги опубликована из карточек', {
          run: runId,
          edition: input.bookEditionId,
          publication: result.publicationId,
          revision: result.revision,
          character_count: result.characterCount,
          skipped_characters: built.skippedCharacterKeys.length,
          duration_ms: Date.now() - startedAt
        })
      }
      return result
    }
  }

  async function readNormalizedText(input) {
    const stored = await storage.getBytes({
      objectKey: input.normalizedTextObjectKey,
      maxBytes: maxTextBytes
    })
    const text = stored.bytes.toString('utf8')
    if (createHash('sha256').update(stored.bytes).digest('hex') !== input.normalizedTextHash) {
      throw Object.assign(
        new Error('normalized text does not match the hash the fragments were measured against'),
        { code: 'CARD_TEXT_INTEGRITY' }
      )
    }
    return text
  }
}
