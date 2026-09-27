/**
 * Раннер задания `roster_confirm`: подтверждение состава книги моделью.
 *
 * Заходов на прогон два, и это не оптимизация, а решение продукта. Замер на
 * «Отцах и детях»: подтверждение по всей книге заняло 328 секунд из 540 до
 * первых героев на четырёх исполнителях — больше половины ожидания читателя,
 * открывшего книгу. Окну первых глав из 112 кандидатов нужны 13, то есть 19 %
 * запроса и 3 пары вместо 36. Поэтому сперва подтверждается окно, а полный
 * заход идёт следом, в фоне.
 *
 * Цена решения не прячется: ранний заход видит только своё окно, и полный может
 * слить уже выпущенного персонажа с кандидатом из поздней главы. Карточка
 * неизменяема, поэтому такое слияние — не правка строки, а новая ревизия, и
 * список переизданий возвращается вызывающему явно.
 *
 * Цитаты фрагментов восстанавливаются из нормализованного текста по координатам,
 * а не читаются из базы: в `book_character_fragments` текст намеренно не
 * дублируется. Целостность проверяется до вызова модели.
 */

import { createHash } from 'node:crypto'
import {
  applyRosterConfirmation,
  buildRosterConfirmationRequest,
  rosterCandidatesForWindow,
  rosterConfirmationIdempotencyKey,
  rosterRevisionsAfterConfirmation,
  validateRosterConfirmation
} from './book-roster-confirmation.mjs'
import { createCardPublicationRunner } from './book-card-publication-runner.mjs'
import { createOperationalLogger } from '../platform/operational-log.mjs'

export const ROSTER_CONFIRM_JOB_TYPE = 'roster_confirm'

const MAX_NORMALIZED_TEXT_BYTES = 64 * 1024 * 1024

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function runnerError(code, message) {
  return Object.assign(new Error(message), { code })
}

export function createRosterConfirmRunner({
  repository,
  storage,
  generator,
  maxTextBytes = MAX_NORMALIZED_TEXT_BYTES,
  logger = console
}) {
  if (!repository || !storage || !generator) {
    throw new TypeError('repository, storage and generator are required')
  }
  const log = createOperationalLogger({ component: 'roster-confirm', logger })

  // Публикация висит и здесь, а не только на карточке. У книги без персонажей
  // карточек не будет ни одной, а значит и публиковать разметку будет некому:
  // прогон «Мцыри» так и остался на `synthesize`, а книга — в «обрабатывается»
  // навсегда. Закрытое окно — тот же самый момент «состав перестал меняться».
  const publicationRunner = typeof repository.getCardPublicationInput === 'function'
    ? createCardPublicationRunner({ repository, storage, maxTextBytes, logger })
    : null

  async function readNormalizedText(input) {
    const stored = await storage.getBytes({
      objectKey: input.normalizedTextObjectKey,
      maxBytes: maxTextBytes
    })
    if (sha256(stored.bytes) !== input.normalizedTextHash) {
      throw runnerError(
        'ROSTER_TEXT_INTEGRITY',
        'normalized text does not match the hash the fragment offsets were computed against'
      )
    }
    return stored.bytes.toString('utf8')
  }

  /**
   * Полный заход публикует всегда, а не только когда сам закрыл окно.
   *
   * Публикация случается в момент закрытия окна, и у книги без персонажей этот
   * момент приходится на первый заход: к полному окно уже `ready`, закрывать
   * нечего, и публиковать оказывалось некому. «Мцыри» так и остался с
   * закрытым окном и нулём публикаций. Повторная публикация безвредна —
   * артефакт и канал уникальны, — а пропущенная держит книгу в
   * «обрабатывается» навсегда.
   */
  async function publishClosedWindows(input, _advanced, normalizedText) {
    if (!publicationRunner) return
    await publishOrFinish(input, normalizedText)
  }

  async function publishOrFinish(input, normalizedText) {
    const published = await publicationRunner
      .publish({ runId: input.runId, normalizedText })
      .catch((error) => {
        log.error('roster.publication_failed', 'Разметку из карточек опубликовать не удалось', {
          run: input.runId,
          edition: input.bookEditionId,
          error_code: error?.code ?? 'UNKNOWN'
        })
        return null
      })
    if (published?.published !== false || published?.reason !== 'no_cards') return
    // Публиковать нечего: проекция требует хотя бы одну карточку, и это
    // правильно — пустая разметка не разметка. Но прогон обязан на чём-то
    // закончиться, иначе книга навсегда останется в «обрабатывается».
    if (typeof repository.finishCardsRunWithoutCharacters !== 'function') return
    const finished = await repository
      .finishCardsRunWithoutCharacters({ runId: input.runId })
      .catch((error) => {
        log.error('roster.finish_failed', 'Прогон без персонажей закрыть не удалось', {
          run: input.runId,
          edition: input.bookEditionId,
          error_code: error?.code ?? 'UNKNOWN'
        })
        return null
      })
    if (finished?.finished) {
      log.info('roster.finished_without_characters', 'Прогон закрыт: персонажей в книге нет', {
        run: input.runId,
        edition: input.bookEditionId
      })
    }
  }

  return {
    jobType: ROSTER_CONFIRM_JOB_TYPE,

    async run(job) {
      const startedAt = Date.now()
      const input = await repository.getRosterConfirmationInput(job)
      const text = await readNormalizedText(input)

      // Окно отбирает кандидатов, а не фрагменты: фрагменты нужны все, потому
      // что по ним считаются со-упоминания, а они — защита от слияния двух
      // разных участников одной сцены.
      const candidates = input.windowIndex === null
        ? input.candidates
        : rosterCandidatesForWindow(input.candidates, input.window)
      const fragments = {
        characters: (input.fragments?.characters ?? []).map((entry) => ({
          characterKey: entry.characterKey,
          fragments: (entry.fragments ?? []).map((fragment) => ({
            ...fragment,
            quote: text.slice(fragment.startOffset, fragment.endOffset)
          }))
        }))
      }

      const request = buildRosterConfirmationRequest({
        runId: input.runId,
        bookEditionId: input.bookEditionId,
        title: input.title,
        author: input.author,
        language: input.language,
        inventoryVersion: input.inventoryVersion,
        normalizedTextHash: input.normalizedTextHash,
        windowIndex: input.windowIndex,
        candidates,
        fragments
      })
      if (!request) {
        // Ни одного кандидата — законный исход, а не ошибка: у книги может не
        // быть персонажей в первых главах. Единственный кандидат сюда уже не
        // попадает: его классифицирует модель, потому что `kindHint` —
        // эвристика, и по ней место рискует получить карточку, а герой с
        // неопределённой подсказкой — не получить.
        log.info('roster.empty', 'Подтверждать некого', {
          job: job.id,
          run: input.runId,
          window_index: input.windowIndex
        })
        const empty = await repository.completeRosterConfirmation(job, {
          runId: input.runId,
          bookEditionId: input.bookEditionId,
          windowIndex: input.windowIndex,
          roster: [],
          revisions: [],
          skipped: true
        })
        if (input.windowIndex === null) {
          const advancedEmpty = await repository.advanceCardWindows({
            runId: input.runId,
            bookEditionId: input.bookEditionId
          })
          await publishClosedWindows(input, advancedEmpty, text)
        }
        return empty
      }

      log.info('roster.started', 'Подтверждаю состав книги', {
        job: job.id,
        run: input.runId,
        edition: input.bookEditionId,
        window_index: input.windowIndex,
        candidate_count: request.roster.length,
        pair_count: request.candidatePairs.length,
        forbidden_pair_count: request.forbiddenPairs.length
      })

      const response = await generator.confirmBookRoster({
        idempotencyKey: rosterConfirmationIdempotencyKey({
          runId: input.runId,
          windowIndex: input.windowIndex,
          inventoryVersion: request.inventoryVersion,
          promptVersion: request.promptVersion
        }),
        ...request
      })
      const confirmation = validateRosterConfirmation({ request, response })
      const roster = applyRosterConfirmation({ request, candidates, confirmation, fragments })
      const revisions = rosterRevisionsAfterConfirmation(input.previousRoster ?? [], roster)

      const result = await repository.completeRosterConfirmation(job, {
        runId: input.runId,
        bookEditionId: input.bookEditionId,
        windowIndex: input.windowIndex,
        roster,
        revisions,
        skipped: false
      })

      // Полный заход — тот, кого цепочка окон ждала: до него состав книги
      // известен лишь по первым главам. Подтвердив его, двигаем цепочку сами,
      // иначе следующее окно не поставит никто: воркер карточки двигает её
      // после карточки, а карточек за пределами первого окна ещё нет.
      let advanced = null
      if (input.windowIndex === null) {
        advanced = await repository.advanceCardWindows({
          runId: input.runId,
          bookEditionId: input.bookEditionId
        })
        await publishClosedWindows(input, advanced, text)
      }

      log.info('roster.confirmed', 'Состав книги подтверждён', {
        job: job.id,
        run: input.runId,
        edition: input.bookEditionId,
        window_index: input.windowIndex,
        candidate_count: request.roster.length,
        character_count: roster.length,
        accepted_merge_count: confirmation.acceptedMerges.length,
        rejected_count: confirmation.rejected.length,
        revision_count: revisions.length,
        card_jobs_created: (result?.cardJobsCreated ?? 0) + (advanced?.enqueued?.created ?? 0),
        next_confirmation: result?.nextConfirmation ?? 'none',
        advanced_window: advanced?.enqueued?.windowIndex ?? null,
        duration_ms: Date.now() - startedAt
      })
      return {
        windowIndex: input.windowIndex,
        characterCount: roster.length,
        revisions,
        ...result
      }
    }
  }
}
