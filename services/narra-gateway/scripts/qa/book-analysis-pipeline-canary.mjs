/**
 * Канарейка конвейера карточек (acceptance P7).
 *
 * Work order ссылается на этот скрипт, но в репозитории его не было. Он делает
 * то, ради чего назван: берёт отчёт сквозного прогона, собирает из карточек
 * `book-markup-v3`, прогоняет **настоящий** Validate и печатает, что вышло.
 * Ничего не публикует и в базу не пишет: канарейка должна отвечать на вопрос
 * «можно ли включать», а не менять состояние, о котором отвечает.
 *
 *   node scripts/qa/book-analysis-pipeline-canary.mjs \
 *     --report /tmp/run.json --text /tmp/book.txt [--pretty] [--require-pass]
 *
 * `--report` — вывод `evaluation/run-card-pipeline.mjs`, `--text` —
 * нормализованный текст той же книги: Validate сверяет каждую цитату с текстом
 * по смещениям, и подменённый текст канарейка обязана заметить.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleBookMarkupV3 } from '../../analysis/book-analysis-assembler.mjs'
import { validateBookMarkupV3 } from '../../analysis/book-analysis-validator.mjs'
import { validateCharacterCard } from '../../analysis/book-character-card-contract.mjs'
import {
  cardSnapshotFor,
  projectCardsToSnapshot
} from '../../analysis/book-card-markup-projection.mjs'
import { BOOK_ANALYSIS_PIPELINE_CARDS } from '../../analysis/book-analysis-pipeline.mjs'

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'CANARY_INPUT_INVALID' })
}

function parseArguments(argv) {
  const result = { pretty: false, requirePass: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--report') result.reportPath = argv[++index]
    else if (value === '--text') result.textPath = argv[++index]
    else if (value === '--snapshot-id') result.snapshotId = argv[++index]
    else if (value === '--pretty') result.pretty = true
    else if (value === '--require-pass') result.requirePass = true
    else throw inputError(`unknown argument: ${value}`)
  }
  if (!result.reportPath) throw inputError('--report is required')
  if (!result.textPath) throw inputError('--text is required')
  return result
}

/**
 * Фрагменты по персонажу из отчёта прогона.
 *
 * В отчёте фрагменты лежат внутри карточек, каждая — со своим окном; проекции
 * они нужны сгруппированными по персонажу.
 */
export function fragmentsFromReport(report, text) {
  const byCharacter = new Map()
  for (const entry of report.cards ?? []) {
    const characterKey = entry.card.characterKey
    const fragments = (entry.fragments ?? [])
      .filter(({ startOffset, endOffset }) =>
        Number.isSafeInteger(startOffset) && Number.isSafeInteger(endOffset))
      .map((fragment) => ({
        ...fragment,
        characterKey,
        paragraphIndex: fragment.paragraphIndex ?? 0,
        chapterIndex: fragment.chapterIndex ?? 0,
        // Цитата — это текст по смещениям, и другого источника у неё нет.
        quote: fragment.quote ?? text.slice(fragment.startOffset, fragment.endOffset)
      }))
    byCharacter.set(characterKey, fragments)
  }
  return byCharacter
}

export function runCanary({ report, text, snapshotId = randomUUID() }) {
  const cards = (report.cards ?? []).map(({ card }) => validateCharacterCard(card))
  if (!cards.length) throw inputError('report contains no cards')
  const textHash = createHash('sha256').update(text).digest('hex')
  // Целостность текста проверяется по хэшу, записанному в самой карточке, а не
  // по совпадению цитат: цитаты канарейка восстанавливает из этого же текста по
  // смещениям, и потому совпадают они всегда. Хэш — единственное независимое
  // свидетельство того, что текст тот самый, под который считались смещения.
  const foreign = cards.filter(({ source }) =>
    source.normalizedTextHash.replace(/^sha256:/, '') !== textHash)
  if (foreign.length) {
    return {
      pipelineId: BOOK_ANALYSIS_PIPELINE_CARDS,
      status: 'red',
      reason: 'normalized text does not match the hash the cards were built from',
      cardCount: cards.length,
      mismatchedCardCount: foreign.length,
      textHash,
      expectedTextHash: foreign[0].source.normalizedTextHash,
      validation: { valid: false, checks: { sourceHash: false }, errors: [] }
    }
  }
  const fragmentsByCharacter = fragmentsFromReport(report, text)
  const missing = [...fragmentsByCharacter.entries()]
    .filter(([, list]) => !list.length)
    .map(([characterKey]) => characterKey)
  const usable = cards.filter(({ characterKey }) =>
    (fragmentsByCharacter.get(characterKey) ?? []).length > 0)
  if (!usable.length) {
    return {
      pipelineId: BOOK_ANALYSIS_PIPELINE_CARDS,
      status: 'inconclusive',
      reason: 'report carries no fragment coordinates to project',
      cardCount: cards.length,
      charactersWithoutFragments: missing
    }
  }
  const projection = projectCardsToSnapshot({
    cards: usable,
    fragmentsByCharacter,
    textLength: text.length
  })
  const snapshot = cardSnapshotFor({ snapshotId, projection })
  const markup = assembleBookMarkupV3({
    snapshotId,
    textLength: text.length,
    entities: projection.entities,
    observations: projection.observations,
    characterProfiles: projection.characterProfiles,
    characterSelection: projection.characterSelection
  })
  const validation = validateBookMarkupV3({
    markup,
    snapshot,
    observations: projection.observations,
    normalizedText: text,
    normalizedTextHash: createHash('sha256').update(text).digest('hex')
  })
  return {
    pipelineId: BOOK_ANALYSIS_PIPELINE_CARDS,
    status: validation.valid ? 'green' : 'red',
    book: { title: report.title ?? '', textLength: text.length },
    cardCount: cards.length,
    projectedCardCount: usable.length,
    charactersWithoutFragments: missing,
    observationCount: projection.observations.length,
    markup: {
      characterCount: markup.characters.length,
      locationCount: markup.locations.length,
      traitCount: markup.characters.reduce((sum, { traits }) => sum + traits.length, 0),
      withAppearancePrompt: markup.characters
        .filter(({ creative }) => creative.appearancePrompt).length
    },
    validation: {
      valid: validation.valid,
      checks: validation.checks,
      errors: validation.errors.slice(0, 20)
    },
    // Стоимость конвейера в вызовах: инвентарь бесплатен, подтверждение — один
    // вызов на книгу, карточки — по вызову на персонажа.
    cost: {
      inventoryCalls: 0,
      rosterConfirmCalls: 1,
      cardCalls: (report.cards ?? []).length + (report.cardFailures ?? []).length,
      costEventStages: ['inventory', 'roster', 'card']
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2))
  const [report, text] = await Promise.all([
    readFile(options.reportPath, 'utf8').then(JSON.parse),
    readFile(options.textPath, 'utf8')
  ])
  const result = runCanary({ report, text, snapshotId: options.snapshotId })
  console.log(JSON.stringify(result, null, options.pretty ? 2 : 0))
  if (options.requirePass && result.status !== 'green') process.exitCode = 1
}
