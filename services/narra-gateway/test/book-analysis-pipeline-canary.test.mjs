/**
 * Канарейка P7: зелёный ответ означает, что v3 из карточек прошёл Validate.
 *
 * Тест кормит канарейку отчётом той формы, которую пишет
 * `evaluation/run-card-pipeline.mjs`, и проверяет два разных исхода: зелёный на
 * согласованных данных и красный на подменённом тексте. Второе важнее: если
 * канарейка зеленеет на несовпадающем тексте, она не канарейка.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  fragmentsFromReport,
  runCanary
} from '../scripts/qa/book-analysis-pipeline-canary.mjs'
import { validateCharacterCard } from '../analysis/book-character-card-contract.mjs'
import {
  BOOK_ANALYSIS_PIPELINE_CARDS,
  BOOK_ANALYSIS_PIPELINE_IDS,
  getBookAnalysisPipeline,
  normalizeBookAnalysisPipelineId
} from '../analysis/book-analysis-pipeline.mjs'

const PARAGRAPHS = [
  'Элизабет Беннет жила в Лонгборне с четырьмя сёстрами и не искала общества.',
  'Элизабет заметила, что гость наблюдает за нею внимательно, и промолчала.',
  `${'ровный текст. '.repeat(200)}`,
  'Элизабет снова заметила ту же привычку и опять ничего не сказала.'
]
const TEXT = PARAGRAPHS.join('\n\n')
const TEXT_HASH = createHash('sha256').update(TEXT).digest('hex')

function fragment(index) {
  const needle = PARAGRAPHS[index]
  const startOffset = TEXT.indexOf(needle)
  return {
    fragmentId: `frag:char:elizabeth:${index}`,
    characterKey: 'char:elizabeth',
    startOffset,
    endOffset: startOffset + needle.length,
    chapterIndex: 0
  }
}

function report() {
  const fragments = [fragment(0), fragment(1), fragment(3)]
  const ids = fragments.map(({ fragmentId }) => fragmentId)
  const card = validateCharacterCard({
    contractVersion: 'character-card-v1',
    characterKey: 'char:elizabeth',
    name: 'Элизабет',
    fullName: 'Элизабет Беннет',
    aliases: [],
    firstMentionTextOffset: fragments[0].startOffset,
    cardWindow: { startOffset: 0, endOffset: TEXT.length, chapterIndexes: [0, 1] },
    mentionCount: 3,
    mentionCountInWindow: 3,
    traits: [{ value: 'наблюдательная', fragmentIds: [ids[1], ids[2]], confidence: 0.9 }],
    bio: { value: 'Элизабет живёт в Лонгборне с сёстрами.', fragmentIds: [ids[0]] },
    role: { value: 'вторая из пяти дочерей', fragmentIds: [ids[0]] },
    locations: [{ value: 'Лонгборн', fragmentIds: [ids[0]] }],
    appearancePrompt: 'тёмные живые глаза',
    gender: 'female',
    age: 'около двадцати',
    greeting: 'Здравствуйте. Я Элизабет.',
    source: {
      // Настоящий хэш текста: канарейка проверяет целостность именно им.
      normalizedTextHash: TEXT_HASH,
      inventoryVersion: 'name-inventory-v1',
      fragmentSetHash: 'b'.repeat(64),
      promptVersion: 'character-card-prompt-v1'
    },
    createdAt: '2026-09-10T10:00:00Z'
  })
  return {
    title: 'Гордость и предубеждение',
    textLength: TEXT.length,
    cards: [{ card, fragments }],
    cardFailures: []
  }
}

test('the cards pipeline is a first-class pipeline id next to narra and external', () => {
  assert.ok(BOOK_ANALYSIS_PIPELINE_IDS.includes(BOOK_ANALYSIS_PIPELINE_CARDS))
  assert.equal(normalizeBookAnalysisPipelineId('cards'), 'cards')
  const strategy = getBookAnalysisPipeline(BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(strategy.analysisVersion, 'book-markup-v3')
  assert.equal(strategy.scanScope, 'none')
})

test('the cards pipeline refuses scan jobs loudly instead of stalling a run silently', () => {
  // Тихо вернуть пустой список хуже: прогон встал бы навсегда без строки в логе.
  const strategy = getBookAnalysisPipeline(BOOK_ANALYSIS_PIPELINE_CARDS)
  for (const method of ['createScanJobs', 'reconcileIdentities', 'synthesizeCharacter']) {
    assert.throws(() => strategy[method]({}), { code: 'PIPELINE_STAGE_FLOW_UNWIRED' }, method)
  }
})

test('the canary is green when the cards assemble into a markup that Validate accepts', () => {
  const result = runCanary({ report: report(), text: TEXT })
  assert.equal(result.status, 'green', JSON.stringify(result.validation?.errors))
  assert.equal(result.pipelineId, 'cards')
  assert.equal(result.validation.valid, true)
  assert.equal(result.markup.characterCount, 1)
  assert.equal(result.markup.traitCount, 1)
  assert.equal(result.markup.withAppearancePrompt, 1)
  assert.deepEqual(result.charactersWithoutFragments, [])
})

test('the canary is red when the text is not the one the cards were built from', () => {
  // Если канарейка зеленеет на подменённом тексте, она не канарейка. Поймать
  // подмену совпадением цитат нельзя: канарейка их из этого же текста и
  // достаёт. Ловит независимое свидетельство — хэш в самой карточке.
  const result = runCanary({ report: report(), text: TEXT.replace('Лонгборне', 'Незерфилде') })
  assert.equal(result.status, 'red')
  assert.equal(result.validation.valid, false)
  assert.equal(result.mismatchedCardCount, 1)
  assert.match(result.reason, /does not match the hash/)
})

test('a single changed character anywhere in the book turns the canary red', () => {
  const result = runCanary({ report: report(), text: `${TEXT} ` })
  assert.equal(result.status, 'red')
  assert.equal(result.validation.checks.sourceHash, false)
})

test('the canary reports the call cost of the run it inspected', () => {
  const result = runCanary({ report: report(), text: TEXT })
  assert.equal(result.cost.inventoryCalls, 0)
  assert.equal(result.cost.rosterConfirmCalls, 1)
  assert.equal(result.cost.cardCalls, 1)
  assert.deepEqual(result.cost.costEventStages, ['inventory', 'roster', 'card'])
})

test('a report with no fragment coordinates is inconclusive, not green', () => {
  const source = report()
  const result = runCanary({
    report: { ...source, cards: [{ card: source.cards[0].card }] },
    text: TEXT
  })
  assert.equal(result.status, 'inconclusive')
  assert.deepEqual(result.charactersWithoutFragments, ['char:elizabeth'])
})

test('quotes are recovered from the text by the fragment offsets', () => {
  const byCharacter = fragmentsFromReport(report(), TEXT)
  for (const fragment of byCharacter.get('char:elizabeth')) {
    assert.equal(fragment.quote, TEXT.slice(fragment.startOffset, fragment.endOffset))
  }
})

test('a report with no cards at all is refused rather than reported green', () => {
  assert.throws(() => runCanary({ report: { cards: [] }, text: TEXT }), {
    code: 'CANARY_INPUT_INVALID'
  })
})
