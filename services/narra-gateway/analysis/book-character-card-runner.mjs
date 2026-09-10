/**
 * Раннер задания `character_card`: один вызов на персонажа одного окна.
 *
 * Цитаты фрагментов здесь восстанавливаются из нормализованного текста по их
 * координатам, а не читаются из базы: в `book_character_fragments` текст
 * намеренно не дублируется, иначе у evidence появился бы второй источник
 * истины, и расхождение между ним и текстом книги было бы невозможно заметить.
 *
 * Целостность проверяется до вызова: если хэш прочитанного текста не совпал с
 * тем, под который посчитаны смещения, задание падает, а не строит карточку по
 * координатам от другого текста.
 */

import { createHash } from 'node:crypto'
import {
  CHARACTER_CARD_JOB_TYPE,
  buildCharacterCardRequest,
  characterCardMediaPriority,
  finalizeCharacterCard
} from './book-character-card.mjs'
import { createOperationalLogger } from '../platform/operational-log.mjs'

const MAX_NORMALIZED_TEXT_BYTES = 64 * 1024 * 1024

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function runnerError(code, message) {
  return Object.assign(new Error(message), { code })
}

export function createCharacterCardRunner({
  repository,
  storage,
  generator,
  maxTextBytes = MAX_NORMALIZED_TEXT_BYTES,
  now = () => new Date().toISOString(),
  logger = console
}) {
  if (!repository || !storage || !generator) {
    throw new TypeError('repository, storage and generator are required')
  }
  const log = createOperationalLogger({ component: 'character-card', logger })

  async function readNormalizedText(input) {
    const stored = await storage.getBytes({
      objectKey: input.normalizedTextObjectKey,
      maxBytes: maxTextBytes
    })
    const text = stored.bytes.toString('utf8')
    if (sha256(stored.bytes) !== input.normalizedTextHash) {
      throw runnerError(
        'CARD_TEXT_INTEGRITY',
        'normalized text does not match the hash the fragment offsets were computed against'
      )
    }
    return text
  }

  return {
    jobType: CHARACTER_CARD_JOB_TYPE,

    async run(job) {
      const startedAt = Date.now()
      const input = await repository.getCharacterCardInput(job)
      const text = await readNormalizedText(input)
      const fragments = input.fragments.map((fragment) => ({
        ...fragment,
        quote: text.slice(fragment.startOffset, fragment.endOffset)
      }))
      log.info('card.started', 'Собираю карточку персонажа', {
        job: job.id,
        run: input.runId,
        edition: input.bookEditionId,
        character_key: input.characterKey,
        window_index: input.windowIndex,
        fragment_count: fragments.length
      })
      const request = buildCharacterCardRequest({
        runId: input.runId,
        bookEditionId: input.bookEditionId,
        characterKey: input.characterKey,
        character: input.character,
        window: input.window,
        fragments,
        title: input.title,
        author: input.author,
        language: input.language,
        normalizedTextHash: input.normalizedTextHash,
        inventoryVersion: input.inventoryVersion
      })
      const result = await generator.generateCharacterCard(request)
      const finalized = finalizeCharacterCard({
        input: request,
        result,
        fragments,
        cardRevision: input.cardRevision ?? 1,
        createdAt: now()
      })
      // Приоритет медиа задаёт класс окна, а не порядок постановки: портреты
      // первых двух глав должны обгонять фоновые окна той же книги и всех
      // остальных книг в очереди.
      const mediaPriority = characterCardMediaPriority(input.priorityClass)
      const published = await repository.publishCharacterCard(job, {
        runId: input.runId,
        bookEditionId: input.bookEditionId,
        characterKey: input.characterKey,
        windowIndex: input.windowIndex,
        cardRevision: finalized.cardRevision,
        fragmentSetHash: finalized.fragmentSetHash,
        normalizedTextHash: input.normalizedTextHash,
        promptVersion: request.promptVersion,
        mediaPriority,
        card: finalized.card
      })
      log.info('card.published', 'Карточка персонажа записана', {
        job: job.id,
        run: input.runId,
        edition: input.bookEditionId,
        character_key: input.characterKey,
        card_revision: finalized.cardRevision,
        trait_count: finalized.card.traits.length,
        bio_source: finalized.audit.bioSource,
        cited_fragment_count: finalized.audit.citedFragmentCount,
        dropped_trait_count: finalized.audit.droppedTraitCount,
        media_priority: mediaPriority,
        media_status: published?.media?.status ?? 'unknown',
        duration_ms: Date.now() - startedAt
      })
      return {
        characterKey: input.characterKey,
        cardRevision: finalized.cardRevision,
        traitCount: finalized.card.traits.length,
        bioSource: finalized.audit.bioSource,
        mediaPriority
      }
    }
  }
}
