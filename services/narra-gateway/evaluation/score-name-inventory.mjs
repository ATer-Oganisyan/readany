/**
 * Оценка детерминированного инвентаря имён на frozen identity fixtures.
 *
 * Инвентарь не видит gold: он получает только текст книги. Оценка приводит его
 * ярус `roster` к той же компактной форме, которую `score-frozen-identity.mjs`
 * ждёт от опубликованного roster, и считает те же метрики. Это делает P1
 * измеримым до единого LLM-вызова: acceptance work order'а — significant
 * recall ≥ 0.90 и precision ≥ 0.80 *до* подтверждения roster.
 *
 * Дополнительно считается полнота на уровне упоминаний. Метрика по строкам
 * roster не отличает пропуск персонажа с 12 упоминаниями от пропуска
 * персонажа с 2400, а для приоритетов окон карточек это разные события.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildBookNameInventory,
  inventoryRoster,
  inventorySignificant
} from '../analysis/book-name-inventory.mjs'
import {
  defaultIdentityBookDirectory,
  listIdentityFixturePaths,
  loadIdentityBookText
} from './fetch-identity-books.mjs'
import { loadIdentityFixture, scoreFrozenIdentity } from './score-frozen-identity.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Кандидаты инвентаря в форме roster.
 *
 * В `aliases` попадают только имена, которые кандидат *утверждает* как свои
 * (форма с обращением, полное имя), но не падежные словоформы: словоформа —
 * артефакт матчинга, а не заявление об идентичности, и «Дарси» в строке
 * «Мисс Дарси» превратило бы её в merge двух gold-персонажей.
 */
export function inventoryRosterInput(inventory, { tier = 'significant' } = {}) {
  const selected = tier === 'roster' ? inventoryRoster(inventory) : inventorySignificant(inventory)
  return {
    roster: selected.map((candidate) => ({
      entityKey: candidate.candidateKey,
      canonicalName: candidate.displayName,
      aliases: [...new Set([
        ...candidate.aliases,
        ...(candidate.fullName ? [candidate.fullName] : [])
      ])].filter((alias) => normalizedName(alias) !== normalizedName(candidate.displayName)),
      observationCount: candidate.count
    }))
  }
}

/**
 * Полнота на уровне упоминаний. Три знаменателя отвечают на три разных
 * вопроса: сколько именной массы книги инвентарь объяснил, какую долю
 * gold-упоминаний он достал и та же доля по значимому ярусу.
 */
export function scoreInventoryMentions({ fixture, inventory, identityScore }) {
  const countByKey = new Map(
    (inventory.candidates ?? []).map((candidate) => [candidate.candidateKey, candidate.count])
  )
  const matches = identityScore.classifications.matches
  const explainedMentions = matches.reduce(
    (sum, { row }) => sum + (countByKey.get(row.entityKey) ?? 0),
    0
  )
  const goldById = new Map(fixture.characters.map((character) => [character.id, character]))
  const matchedGoldMentions = matches.reduce(
    (sum, { gold }) => sum + (goldById.get(gold.id)?.mentionCount ?? 0),
    0
  )
  const matchedSignificantMentions = matches
    .filter(({ gold }) => gold.significant)
    .reduce((sum, { gold }) => sum + (goldById.get(gold.id)?.mentionCount ?? 0), 0)
  const goldMentions = fixture.characters.reduce((sum, { mentionCount }) => sum + mentionCount, 0)
  const significantGoldMentions = fixture.characters
    .filter(({ significant }) => significant)
    .reduce((sum, { mentionCount }) => sum + mentionCount, 0)
  return {
    inventoryMentions: inventory.totalMentions,
    explainedMentions,
    explainedMentionShare: inventory.totalMentions > 0
      ? rounded(explainedMentions / inventory.totalMentions)
      : 0,
    goldMentions,
    goldMentionRecall: goldMentions > 0 ? rounded(matchedGoldMentions / goldMentions) : 0,
    significantGoldMentions,
    significantGoldMentionRecall: significantGoldMentions > 0
      ? rounded(matchedSignificantMentions / significantGoldMentions)
      : 0
  }
}

export async function scoreNameInventoryFixture({
  fixturePath,
  outputDirectory,
  allowFetch = false,
  inventoryOptions = {}
}) {
  const raw = JSON.parse(await readFile(fixturePath, 'utf8'))
  const fixture = await loadIdentityFixture(fixturePath)
  const book = await loadIdentityBookText({
    fixture: raw,
    outputDirectory,
    allowFetch
  })
  if (!book.text) {
    return { id: fixture.id, status: book.status, reason: book.reason ?? null }
  }
  const inventory = buildBookNameInventory({
    text: book.text,
    normalizedTextHash: book.textHash,
    ...inventoryOptions
  })
  const identityScore = scoreFrozenIdentity({
    fixture,
    input: inventoryRosterInput(inventory, { tier: 'significant' })
  })
  // Ярус roster оценивается отдельно: у него другая работа — не быть точным, а
  // не потерять никого до подтверждения.
  const backstopScore = scoreFrozenIdentity({
    fixture,
    input: inventoryRosterInput(inventory, { tier: 'roster' })
  })
  return {
    id: fixture.id,
    status: 'scored',
    textChars: book.text.length,
    textHash: book.textHash,
    matchesPinnedHash: book.pinnedTextHash ? book.pinnedTextHash === book.textHash : null,
    inventory: {
      inventoryVersion: inventory.inventoryVersion,
      candidateCount: inventory.candidates.length,
      chapterCount: inventory.chapterCount,
      ...inventory.thresholds
    },
    identity: identityScore,
    backstop: {
      rosterCount: backstopScore.input.rosterCount,
      significantRecall: backstopScore.significant.recall,
      fullRecall: backstopScore.full.recall,
      fullTp: backstopScore.full.tp,
      mergeRows: backstopScore.full.mergeRows
    },
    mentions: scoreInventoryMentions({ fixture, inventory, identityScore })
  }
}

function summaryRow(result) {
  if (result.status !== 'scored') {
    return { id: result.id, status: result.status, reason: result.reason }
  }
  const { significant, full, gate } = result.identity
  return {
    id: result.id,
    rows: result.identity.input.rosterCount,
    gold: result.identity.fixture.goldCount,
    significantGold: result.identity.fixture.significantCount,
    significantPrecision: significant.precision,
    significantRecall: significant.recall,
    anyGoldPrecision: full.precision,
    merges: full.mergeRows,
    duplicateRate: full.duplicateRate,
    mentionRecall: result.mentions.significantGoldMentionRecall,
    explained: result.mentions.explainedMentionShare,
    backstopRows: result.backstop.rosterCount,
    backstopSignificantRecall: result.backstop.significantRecall,
    frozenGate: gate.passed
  }
}

/**
 * Гейты P1 работ order'а: до подтверждения roster требуется significant recall
 * ≥ 0.90 и precision ≥ 0.80. Это слабее гейтов опубликованного roster, потому
 * что склейку вариантов и отсев мест делает следующая стадия.
 */
export const INVENTORY_GATES = Object.freeze({
  significantRecall: 0.9,
  anyGoldPrecision: 0.8,
  criticalMerges: 0
})

/**
 * Precision считается по совпадению с *любой* gold-идентичностью, а не только
 * со значимой. Причина в протоколах фикстур: у книг PDNC `significant` — это
 * поле Category в исходном корпусе (5–11 из 42–114 идентичностей), а не
 * частотный префикс, поэтому «доля моих строк, попавших в значимый ярус» имеет
 * потолок ниже 0.8 даже у безошибочного экстрактора. Полнота, наоборот, честно
 * считается по значимому ярусу: пропуск значимого персонажа — это дефект.
 */
export function inventoryGateChecks(result) {
  const { significant, full } = result.identity
  return {
    significantRecall: significant.recall >= INVENTORY_GATES.significantRecall,
    anyGoldPrecision: full.precision >= INVENTORY_GATES.anyGoldPrecision,
    criticalMerges: full.mergeRows <= INVENTORY_GATES.criticalMerges
  }
}

function parseArguments(argv) {
  const result = { pretty: false, fetch: false, requirePass: false, detail: 0, fixtures: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--pretty') result.pretty = true
    else if (value === '--fetch') result.fetch = true
    else if (value === '--require-pass') result.requirePass = true
    else if (value === '--detail') result.detail = Number(argv[++index] ?? 0)
    else if (value === '--fixture') result.fixtures.push(argv[++index])
    else throw Object.assign(new Error(`unknown argument: ${value}`), { code: 'INVALID_ARGUMENT' })
  }
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2))
  const outputDirectory = defaultIdentityBookDirectory()
  const fixturePaths = options.fixtures.length
    ? options.fixtures.map((value) => path.resolve(directory, value))
    : await listIdentityFixturePaths()
  const results = []
  for (const fixturePath of fixturePaths) {
    results.push(await scoreNameInventoryFixture({
      fixturePath,
      outputDirectory,
      allowFetch: options.fetch
    }))
  }
  const scored = results.filter(({ status }) => status === 'scored')
  const report = {
    outputDirectory,
    gates: INVENTORY_GATES,
    summary: results.map(summaryRow),
    scoredCount: scored.length,
    gatePassCount: scored.filter((result) =>
      Object.values(inventoryGateChecks(result)).every(Boolean)).length
  }
  if (options.detail > 0) {
    report.detail = scored.map((result) => ({
      id: result.id,
      unmatched: result.identity.classifications.unmatched.slice(0, options.detail),
      significantFn: result.identity.classifications.significantFn.slice(0, options.detail),
      duplicateGroups: result.identity.classifications.duplicateGroups.slice(0, options.detail),
      merges: result.identity.classifications.merges.slice(0, options.detail)
    }))
  }
  console.log(JSON.stringify(report, null, options.pretty ? 2 : 0))
  if (options.requirePass && report.gatePassCount !== report.scoredCount) {
    process.exitCode = 1
  }
}
