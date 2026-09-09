import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadIdentityFixture, scoreFrozenIdentity } from '../evaluation/score-frozen-identity.mjs'
import {
  cardWindow,
  isLanguageLeak,
  loadCardFixture,
  scoreCharacterCards
} from '../evaluation/score-character-cards.mjs'
import { rosterFromManifest } from '../evaluation/fetch-catalog-roster.mjs'
import {
  JUDGE_PROMPT_VERSION,
  buildJudgeTasks,
  loadAppearanceBioFixture,
  scoreJudgeVerdicts
} from '../evaluation/judge-character-cards.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const evaluation = path.join(directory, '..', 'evaluation')

const BOOKS = {
  onegin: {
    identity: path.join(evaluation, 'identity', 'evgeniy-onegin-ru-v1.json'),
    cards: path.join(evaluation, 'cards', 'evgeniy-onegin-ru-card-v1.json'),
    roster: path.join(directory, 'fixtures', 'evgeniy-onegin-v3-catalog-roster.json'),
    appearanceBio: path.join(evaluation, 'cards', 'evgeniy-onegin-ru-appearance-bio-v1.json'),
    verdicts: path.join(directory, 'fixtures', 'evgeniy-onegin-v3-judge-verdicts.json')
  },
  grant: {
    identity: path.join(evaluation, 'identity', 'deti-kapitana-granta-ru-v1.json'),
    cards: path.join(evaluation, 'cards', 'deti-kapitana-granta-ru-card-v1.json'),
    roster: path.join(directory, 'fixtures', 'deti-kapitana-granta-v3-catalog-roster.json'),
    appearanceBio: path.join(evaluation, 'cards', 'deti-kapitana-granta-ru-appearance-bio-v1.json'),
    verdicts: path.join(directory, 'fixtures', 'deti-kapitana-granta-v3-judge-verdicts.json')
  }
}

async function load(slug) {
  const paths = BOOKS[slug]
  const [identity, cards, rawIdentity, roster] = await Promise.all([
    loadIdentityFixture(paths.identity),
    loadCardFixture(paths.cards),
    readFile(paths.identity, 'utf8').then(JSON.parse),
    readFile(paths.roster, 'utf8').then(JSON.parse)
  ])
  return { identity, cards, rawIdentity, roster }
}

test('frozen Onegin fixture keeps its immutable denominators', async () => {
  const fixture = await loadIdentityFixture(BOOKS.onegin.identity)
  assert.equal(fixture.characters.length, 26)
  assert.equal(fixture.characters.filter(({ significant }) => significant).length, 13)
  assert.equal(
    fixture.characters.reduce((sum, { mentionCount }) => sum + mentionCount, 0),
    413
  )
})

test('frozen Captain Grant fixture keeps its immutable denominators', async () => {
  const fixture = await loadIdentityFixture(BOOKS.grant.identity)
  assert.equal(fixture.characters.length, 26)
  assert.equal(fixture.characters.filter(({ significant }) => significant).length, 15)
  assert.equal(
    fixture.characters.reduce((sum, { mentionCount }) => sum + mentionCount, 0),
    5641
  )
})

test('book-markup-v3 Onegin roster scores at its recorded baseline', async () => {
  const { identity, roster } = await load('onegin')
  const score = scoreFrozenIdentity({ fixture: identity, input: roster })

  assert.deepEqual(score.significant, {
    tp: 11,
    fn: 2,
    duplicateRows: 0,
    mergeRows: 0,
    unmatchedRows: 3,
    predictionCount: 14,
    precision: 0.785714,
    recall: 0.846154,
    f1: 0.814815
  })
  assert.equal(score.full.duplicateRows, 0)
  assert.equal(score.full.mergeRows, 0)
  assert.equal(score.gate.passed, false)
  assert.deepEqual(
    score.classifications.significantFn.map(({ name }) => name),
    ['Дмитрий Ларин', 'Княжна Алина']
  )
})

test('book-markup-v3 Captain Grant roster splits four identities into eight rows', async () => {
  const { identity, roster } = await load('grant')
  const score = scoreFrozenIdentity({ fixture: identity, input: roster })

  assert.deepEqual(score.significant, {
    tp: 14,
    fn: 1,
    duplicateRows: 4,
    mergeRows: 0,
    unmatchedRows: 0,
    predictionCount: 18,
    precision: 0.777778,
    recall: 0.933333,
    f1: 0.848485
  })
  assert.equal(score.full.duplicateRate, 0.2)
  assert.equal(score.gate.checks.duplicateRate, false)
  assert.deepEqual(
    score.classifications.duplicateGroups.map(({ gold }) => gold.id).sort(),
    ['harry_grant', 'helena_glenarvan', 'macnabbs', 'mary_grant']
  )
})

test('D1 card window ends at the chapter after the first mention', async () => {
  const fixture = await loadCardFixture(BOOKS.onegin.cards)
  // Ленский появляется в главе 2 (21479..36479), окно закрывается концом главы 3.
  assert.deepEqual(cardWindow(fixture.chapters, 23716), {
    startOffset: 0,
    endOffset: 54698,
    chapterIndexes: [1, 2]
  })
  // Первое упоминание до первой главы прижимается к главе 1.
  assert.equal(cardWindow(fixture.chapters, 0).chapterIndexes[0], 0)
  // Персонаж последней главы не выходит за конец книги.
  const last = fixture.chapters.at(-1)
  assert.equal(cardWindow(fixture.chapters, last.startOffset + 1).endOffset, last.endOffset)
})

test('trait language leaks are detected only for Latin-only values', () => {
  assert.equal(isLanguageLeak('obedient', 'ru'), true)
  assert.equal(isLanguageLeak('послушная', 'ru'), false)
  assert.equal(isLanguageLeak('денди (dandy)', 'ru'), false)
  assert.equal(isLanguageLeak('obedient', 'en'), false)
})

test('Onegin cards score at their recorded baseline', async () => {
  const { cards, rawIdentity, roster } = await load('onegin')
  const report = scoreCharacterCards({ fixture: cards, identityFixture: rawIdentity, input: roster })

  assert.deepEqual(report.metrics, {
    nonCharacterRows: 3,
    genderAccuracy: 0.882353,
    fullNameCoverage: 0,
    appearanceCoverage: 0.529412,
    traitsInRange: 0.411765,
    traitLanguagePurity: 0.941176,
    spoilerViolations: 0
  })
  assert.deepEqual(
    report.findings.genderMismatches.map(({ id }) => id),
    ['kharlikov', 'gvozdin']
  )
  assert.deepEqual(report.findings.traitLeaks.map(({ trait }) => trait), [
    'obedient',
    'flirtatious',
    'cheerful'
  ])
  assert.equal(report.gate.passed, false)
})

test('Captain Grant cards leak three facts from beyond their own window', async () => {
  const { cards, rawIdentity, roster } = await load('grant')
  const report = scoreCharacterCards({ fixture: cards, identityFixture: rawIdentity, input: roster })

  assert.equal(report.metrics.spoilerViolations, 3)
  assert.deepEqual(
    report.findings.spoilerViolations.map(({ spoiler }) => spoiler).sort(),
    ['ayrton_is_ben_joyce', 'grant_found_on_tabor', 'paganel_maori_tattoo']
  )
  for (const violation of report.findings.spoilerViolations) {
    assert.ok(violation.revealedAtOffset > violation.window.endOffset)
  }
  assert.equal(report.metrics.nonCharacterRows, 5)
  assert.equal(report.metrics.fullNameCoverage, 0)
  assert.equal(report.gate.passed, false)
})

test('rosterFromManifest keeps the reader-visible surface only', () => {
  const roster = rosterFromManifest({
    book: { book_edition_id: 'book-1', title: 'Тест' },
    run_id: 'run-1',
    characters: [{
      character_key: 'character:1',
      name: 'Онегин',
      full_name: '',
      first_appearance_text_offset: 937,
      state: 'preparing',
      profile: { gender: 'male', traits: ['гордый'] },
      bundle: { assets: [{ type: 'primary_portrait' }, { type: 'greeting_audio' }] }
    }]
  })

  assert.equal(roster.characters.length, 1)
  assert.deepEqual(roster.characters[0], {
    entityKey: 'character:1',
    canonicalName: 'Онегин',
    fullName: null,
    aliases: [],
    firstAppearanceTextOffset: 937,
    state: 'preparing',
    profile: { gender: 'male', traits: ['гордый'] },
    assetTypes: ['primary_portrait', 'greeting_audio']
  })
})

test('judge tasks cover every roster row that maps to a main character', async () => {
  const [fixture, rawIdentity, roster] = await Promise.all([
    loadAppearanceBioFixture(BOOKS.grant.appearanceBio),
    readFile(BOOKS.grant.identity, 'utf8').then(JSON.parse),
    readFile(BOOKS.grant.roster, 'utf8').then(JSON.parse)
  ])
  const tasks = buildJudgeTasks({ fixture, identityFixture: rawIdentity, input: roster })

  // Nine main characters, but twelve rows: four of them are halves of split identities.
  assert.equal(tasks.length, 12)
  assert.equal(new Set(tasks.map(({ goldId }) => goldId)).size, 9)
  assert.equal(tasks.filter(({ goldId }) => goldId === 'macnabbs').length, 2)
  for (const task of tasks) {
    assert.equal(task.promptVersion, JUDGE_PROMPT_VERSION)
    assert.equal(task.messages.length, 2)
    assert.match(task.messages[1].content, /ЭТАЛОН — ВНЕШНОСТЬ/)
    assert.match(task.messages[1].content, /КАРТОЧКА ИЗ ПРОДУКТА/)
  }
})

test('Onegin appearance holds up while biography does not', async () => {
  const [fixture, verdicts] = await Promise.all([
    loadAppearanceBioFixture(BOOKS.onegin.appearanceBio),
    readFile(BOOKS.onegin.verdicts, 'utf8').then(JSON.parse)
  ])
  const report = scoreJudgeVerdicts({ fixture, verdicts })

  assert.deepEqual(report.metrics, {
    judgedCharacters: 5,
    judgedRows: 5,
    appearanceCoreCoverage: 0.888889,
    appearanceMajorContradictions: 0,
    appearanceInventionRate: 0,
    portraitUsableRate: 1,
    portraitScoredRows: 3,
    bioCoreCoverage: 0.342857,
    bioMajorContradictions: 0,
    bioInventionRate: 0
  })
  assert.equal(report.gate.checks.appearanceCoreCoverage, true)
  assert.equal(report.gate.checks.bioCoreCoverage, false)
  assert.equal(report.gate.passed, false)
})

test('Captain Grant appearance contradicts the text on five main characters', async () => {
  const [fixture, verdicts] = await Promise.all([
    loadAppearanceBioFixture(BOOKS.grant.appearanceBio),
    readFile(BOOKS.grant.verdicts, 'utf8').then(JSON.parse)
  ])
  const report = scoreJudgeVerdicts({ fixture, verdicts })

  assert.equal(report.metrics.appearanceCoreCoverage, 0.416667)
  assert.equal(report.metrics.appearanceMajorContradictions, 5)
  assert.equal(report.metrics.portraitUsableRate, 0.272727)
  assert.equal(report.metrics.bioCoreCoverage, 0.457143)
  assert.equal(report.gate.passed, false)

  const byId = new Map(report.characters.map((entry) => [entry.goldId, entry]))
  // Талькав — самый подробный портрет книги и полностью потерянный в карточке.
  assert.equal(byId.get('thalcave').appearance.coverage, 0)
  // Джон Манглс получил приметы Гленарвана.
  assert.equal(byId.get('john_mangles').appearance.majorContradictions, 1)
  assert.equal(byId.get('john_mangles').appearance.coverage, null)
  // Расщепление Мери Грант: портрет в одной строке, верный возраст — тоже, но в разных.
  assert.deepEqual(byId.get('mary_grant').rows, ['Мери Грант', 'Мисс Грант'])
  assert.equal(byId.get('mary_grant').appearance.coverage, 1)
  assert.equal(byId.get('mary_grant').appearance.majorContradictions, 1)
})

test('a character the book never describes is not counted against the portrait rate', async () => {
  const [fixture, verdicts] = await Promise.all([
    loadAppearanceBioFixture(BOOKS.onegin.appearanceBio),
    readFile(BOOKS.onegin.verdicts, 'utf8').then(JSON.parse)
  ])
  const report = scoreJudgeVerdicts({ fixture, verdicts })
  const larina = report.characters.find(({ goldId }) => goldId === 'praskovya_larina')

  assert.equal(larina.appearance.portraitScored, false)
  assert.equal(larina.appearance.portraitUsable, false)
  assert.equal(report.metrics.portraitUsableRate, 1)
  assert.equal(report.metrics.portraitScoredRows, 3)
})

test('scoreJudgeVerdicts rejects a verdict for an unknown character', async () => {
  const fixture = await loadAppearanceBioFixture(BOOKS.onegin.appearanceBio)
  assert.throws(
    () => scoreJudgeVerdicts({
      fixture,
      verdicts: [{
        goldId: 'no_such_character',
        rowName: 'X',
        verdict: {
          appearance: { coveredFactIds: [], contradictions: [], unsupportedClaims: [], score: 0 },
          biography: { coveredFactIds: [], contradictions: [], unsupportedClaims: [], score: 0 }
        }
      }]
    }),
    /unknown gold id/
  )
})
