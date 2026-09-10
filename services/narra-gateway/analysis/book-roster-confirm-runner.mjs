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
        // Отсутствие пар для слияния — не отсутствие персонажей, и путать это
        // нельзя. При одном кандидате сливать действительно не с чем и звать
        // модель незачем, но герой-то есть: раньше такая ветка писала пустой
        // состав, карточек никто не ставил, и единственный настоящий персонаж
        // окна оставался без карточки навсегда.
        //
        // Классификация в этом случае берётся из детерминированной подсказки
        // инвентаря: спросить модель не о чем — вариантов имени нет, — а
        // подсказка на то и подсказка.
        const solo = candidates
          .filter((candidate) => candidate.kindHint === 'person')
          .map((candidate) => ({
            characterKey: `char:${candidate.candidateKey.replace(/^name:/, '')}`,
            candidateKeys: [candidate.candidateKey],
            canonicalName: candidate.displayName,
            names: [...new Set([
              candidate.displayName,
              ...(candidate.aliases ?? []),
              ...(candidate.fullName ? [candidate.fullName] : [])
            ])].filter(Boolean),
            mentionCount: candidate.count,
            firstMentionTextOffset: candidate.firstMentionTextOffset,
            chapterCount: candidate.chapterCount,
            tier: candidate.tier === 'significant' ? 'significant' : 'roster'
          }))
        log.info('roster.unconfirmed', 'Сливать не с чем, состав взят из инвентаря', {
          job: job.id,
          run: input.runId,
          window_index: input.windowIndex,
          candidate_count: candidates.length,
          character_count: solo.length
        })
        return repository.completeRosterConfirmation(job, {
          runId: input.runId,
          bookEditionId: input.bookEditionId,
          windowIndex: input.windowIndex,
          roster: solo,
          revisions: rosterRevisionsAfterConfirmation(input.previousRoster ?? [], solo),
          skipped: false
        })
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
      const roster = applyRosterConfirmation({ request, candidates, confirmation })
      const revisions = rosterRevisionsAfterConfirmation(input.previousRoster ?? [], roster)

      const result = await repository.completeRosterConfirmation(job, {
        runId: input.runId,
        bookEditionId: input.bookEditionId,
        windowIndex: input.windowIndex,
        roster,
        revisions,
        skipped: false
      })

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
        card_jobs_created: result?.cardJobsCreated ?? 0,
        next_confirmation: result?.nextConfirmation ?? 'none',
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
