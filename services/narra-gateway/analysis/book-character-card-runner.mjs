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
import { createCardPublicationRunner } from './book-card-publication-runner.mjs'
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
  // Цепочка окон — часть контракта воркера, а не необязательное украшение:
  // без неё книга получит карточки только первых глав, и заметить это можно
  // будет лишь по тому, что остальные окна навсегда остались `queued`.
  if (typeof repository.advanceCardWindows !== 'function') {
    throw new TypeError('repository must advance card windows')
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

  // Публикация умеет только собрать и записать: модель ей не нужна, поэтому
  // она живёт рядом с карточкой, а не отдельным заданием очереди.
  const publicationRunner = typeof repository.getCardPublicationInput === 'function'
    ? createCardPublicationRunner({ repository, storage, maxTextBytes, logger })
    : null

  return {
    jobType: CHARACTER_CARD_JOB_TYPE,

    async run(job) {
      const startedAt = Date.now()
      const input = await repository.getCharacterCardInput(job)
      // Цепочку окон двигает завершение карточки, а не её успех. Пока
      // двигало только успешное, одна упавшая карточка останавливала книгу
      // навсегда: окно оставалось `running`, следующее не ставил никто.
      // «Обломов» встал так на восемнадцати готовых карточках второго окна.
      try {
        return await build(job, input, startedAt)
      } catch (error) {
        // Своё задание исключаем из счёта незавершённых: воркер пометит его
        // провалившимся только после возврата отсюда, и без этого окно, где
        // оно было последним, осталось бы `running` навсегда — то самое, от
        // чего цепочку и стали двигать по завершению карточки.
        await advanceWindows(input, null, job.id).catch(() => {})
        throw error
      }
    }
  }

  async function build(job, input, startedAt) {
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
        cardRevision: input.cardRevision ?? 1,
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
      await advanceWindows(input, text)
      return {
        characterKey: input.characterKey,
        cardRevision: finalized.cardRevision,
        traitCount: finalized.card.traits.length,
        bioSource: finalized.audit.bioSource,
        mediaPriority
      }
  }

  async function advanceWindows(input, normalizedText = null, failingJobId = null) {
    const advanced = await repository.advanceCardWindows({
      runId: input.runId,
      bookEditionId: input.bookEditionId,
      failingJobId
    })
    if (advanced?.closed?.length || advanced?.enqueued?.created) {
      log.info('card.window_advanced', 'Окно карточек продвинуто', {
        run: input.runId,
        edition: input.bookEditionId,
        closed: advanced.closed,
        enqueued_window: advanced.enqueued?.windowIndex ?? null,
        enqueued_cards: advanced.enqueued?.created ?? 0
      })
    }
    // Закрытое окно — момент, когда состав карточек перестал меняться. Раньше
    // публиковать нечего, позже — значит держать книгу закрытой для читателя.
    if (advanced?.closed?.length && publicationRunner) {
      await publicationRunner
        .publish({ runId: input.runId, normalizedText })
        .catch((error) => {
          log.error('card.publication_failed', 'Разметку из карточек опубликовать не удалось', {
            run: input.runId,
            edition: input.bookEditionId,
            error_code: error?.code ?? 'UNKNOWN'
          })
        })
    }
    return advanced
  }
}
