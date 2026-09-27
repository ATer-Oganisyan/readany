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
  MIN_CARD_FRAGMENTS,
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

/**
 * Ошибки, после которых карточку имеет смысл собрать в другом окне, а не
 * похоронить: у персонажа просто нечем обосноваться здесь и сейчас.
 */
const DEFERRABLE_CARD_ERRORS = new Set([
  'CARD_BIO_MISSING',
  'CARD_TRAITS_MISSING',
  'CARD_BIO_UNGROUNDED_NAME',
  'CARD_FRAGMENTS_MISSING',
  'CARD_FRAGMENTS_THIN'
])
/** Здесь модель не звали: цитат мало, и достаточно дойти до нужного числа. */
const PRE_MODEL_CARD_ERRORS = new Set(['CARD_FRAGMENTS_MISSING', 'CARD_FRAGMENTS_THIN'])

/**
 * Сколько цитат требовать от следующего окна.
 *
 * Если модель уже не смогла собрать карточку, окно с одной лишней цитатой даст
 * тот же ответ за ту же цену: у главного героя книги в сотни окон перенос на
 * «+1 цитату» превращался бы в сотню вызовов. Поэтому после вызова модели
 * просим заметного прироста — вдвое, но не меньше трёх цитат сверху, — а до
 * вызова достаточно дойти до минимума карточки.
 */
export function deferredCardFragmentTarget(errorCode, currentFragmentCount) {
  const current = Math.max(0, Number(currentFragmentCount) || 0)
  if (PRE_MODEL_CARD_ERRORS.has(errorCode)) return Math.max(MIN_CARD_FRAGMENTS, current + 1)
  return Math.max(current + 3, Math.ceil(current * 2))
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
        // Нечем обосноваться — не всегда конец: персонаж попадает в окно
        // первого упоминания, и там у него может быть один проходной абзац,
        // тогда как дальше в книге их сотня. Пока такая карточка падала
        // насовсем, персонаж терялся целиком — «Иван Матвеевич» из «Обломова»
        // с 95 фрагментами не получил карточки вовсе.
        const deferred = DEFERRABLE_CARD_ERRORS.has(error?.code)
          ? await deferToLaterWindow(job, input, error)
          : null
        // Своё задание исключаем из счёта незавершённых: воркер пометит его
        // провалившимся только после возврата отсюда, и без этого окно, где
        // оно было последним, осталось бы `running` навсегда — то самое, от
        // чего цепочку и стали двигать по завершению карточки.
        await advanceWindows(input, null, job.id).catch(() => {})
        if (deferred) return deferred
        throw error
      }
    }
  }

  /**
   * Перенос карточки в окно, где персонажу есть чем обосноваться.
   *
   * Репозиторий сам выбирает ближайшее окно, где фрагментов станет больше, и
   * отвечает «нет», если такого нет: тогда падение честное — больше про этого
   * персонажа в книге не сказано.
   */
  async function deferToLaterWindow(job, input, cause) {
    if (typeof repository.deferCharacterCard !== 'function') return null
    try {
      const moved = await repository.deferCharacterCard({
        runId: input.runId,
        bookEditionId: input.bookEditionId,
        characterKey: input.characterKey,
        windowIndex: input.windowIndex,
        priority: job.priority ?? 50,
        jobId: job.id,
        minFragments: deferredCardFragmentTarget(cause?.code, input.fragments?.length ?? 0),
        // Если книга не дотягивает до минимума карточки, в последнем окне цитат
        // будет всё так же мало: переносить туда — лишний круг без результата.
        fallbackToLast: !PRE_MODEL_CARD_ERRORS.has(cause?.code)
      })
      if (!moved?.deferred) return null
      log.info('card.deferred', 'Карточка перенесена в окно с цитатами', {
        job: job.id,
        run: input.runId,
        edition: input.bookEditionId,
        character_key: input.characterKey,
        window_index: input.windowIndex,
        next_window_index: moved.windowIndex,
        next_fragment_count: moved.fragmentCount,
        error_code: cause?.code ?? 'UNKNOWN'
      })
      return {
        status: 'deferred',
        characterKey: input.characterKey,
        windowIndex: input.windowIndex,
        deferredToWindow: moved.windowIndex
      }
    } catch (error) {
      log.error('card.defer_failed', 'Не удалось перенести карточку в следующее окно', {
        job: job.id,
        run: input.runId,
        character_key: input.characterKey,
        error_code: error?.code ?? 'UNKNOWN'
      })
      return null
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
