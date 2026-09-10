import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_REQUEST_BYTES,
  ROSTER_CONFIRMATION_VERSION,
  applyRosterConfirmation,
  buildRosterConfirmationRequest,
  candidateGenderSignals,
  namePairSignal,
  rosterCandidatePairs,
  rosterForbiddenPairs,
  validateRosterConfirmation
} from '../analysis/book-roster-confirmation.mjs'

function candidate(overrides) {
  return {
    candidateKey: 'name:x',
    displayName: 'Имя',
    aliases: [],
    fullName: '',
    honorific: null,
    honorificGender: null,
    count: 10,
    chapterCount: 3,
    firstMentionTextOffset: 100,
    kindHint: 'person',
    tier: 'significant',
    speechAdjacencyRate: 0.3,
    dialogueDashRate: 0,
    honorificRate: 0,
    prepositionalRate: 0,
    ...overrides
  }
}

function fragmentsFor(entries) {
  return {
    characters: entries.map(([characterKey, paragraphIndexes]) => ({
      characterKey,
      fragments: paragraphIndexes.map((paragraphIndex) => ({
        fragmentId: `frag:${characterKey}:${paragraphIndex}`,
        paragraphIndex,
        quote: `Абзац ${paragraphIndex}.`,
        startOffset: paragraphIndex * 100
      }))
    }))
  }
}

const KITTY = candidate({ candidateKey: 'name:kitty', displayName: 'Kitty', count: 110 })
const CATHERINE = candidate({
  candidateKey: 'name:lady-catherine',
  displayName: 'Lady Catherine',
  honorific: 'lady',
  honorificGender: 'female',
  count: 542
})

test('name overlap signals mirror the global identity reconciliation rules', () => {
  assert.equal(
    namePairSignal(
      candidate({ displayName: 'Elizabeth Bennet' }),
      candidate({ displayName: 'Elizabeth' })
    ),
    'name_extension'
  )
  assert.equal(
    namePairSignal(
      candidate({ displayName: 'Mr Bennet' }),
      candidate({ displayName: 'Mrs Bennet' })
    ),
    'same_core_name'
  )
  assert.equal(
    namePairSignal(candidate({ displayName: 'Гленарван' }), candidate({ displayName: 'Паганель' })),
    null
  )
})

test('the lexicon contributes the pair token overlap cannot see', () => {
  const pairs = rosterCandidatePairs([KITTY, CATHERINE])
  assert.equal(pairs.length, 1)
  assert.deepEqual(pairs[0].signals, ['nickname_lexicon'])
  assert.equal(pairs[0].lexiconCanonical, 'catherine')
})

test('a gender collision forbids the merge outright', () => {
  const forbidden = rosterForbiddenPairs([
    candidate({ candidateKey: 'name:mr-bennet', displayName: 'Mr Bennet', honorificGender: 'male' }),
    candidate({ candidateKey: 'name:mrs-bennet', displayName: 'Mrs Bennet', honorificGender: 'female' })
  ])
  assert.equal(forbidden.length, 1)
  assert.equal(forbidden[0].reason, 'gender_conflict')
})

test('an ambiguous diminutive does not manufacture a gender collision', () => {
  // «Женя» — и Евгений, и Евгения. Лексикон в таком случае пола не даёт вовсе,
  // поэтому запрета не возникает: угадать пол здесь было бы хуже, чем не знать.
  const forbidden = rosterForbiddenPairs([
    candidate({ candidateKey: 'name:zhenya', displayName: 'Женя' }),
    candidate({ candidateKey: 'name:evgeniya', displayName: 'Евгения' })
  ])
  assert.deepEqual(forbidden, [])
  assert.equal(candidateGenderSignals(candidate({ displayName: 'Женя' })).size, 0)
  assert.deepEqual([...candidateGenderSignals(candidate({ displayName: 'Таня' }))], ['female'])
  // Обращение при том же имени пол уже даёт, и оно работает как обычно.
  assert.deepEqual(
    [...candidateGenderSignals(candidate({ displayName: 'Женя', honorificGender: 'male' }))],
    ['male']
  )
})

test('two characters who keep appearing in the same paragraph cannot be one person', () => {
  const forbidden = rosterForbiddenPairs(
    [
      candidate({ candidateKey: 'name:elinor', displayName: 'Elinor' }),
      candidate({ candidateKey: 'name:marianne', displayName: 'Marianne' })
    ],
    {
      fragments: fragmentsFor([
        ['name:elinor', [1, 2, 3, 4, 5]],
        ['name:marianne', [1, 2, 3, 6, 7]]
      ])
    }
  )
  assert.equal(forbidden.length, 1)
  assert.equal(forbidden[0].reason, 'co_mentioned_participants')
})

test('rare co-mention is not enough to forbid a merge', () => {
  const forbidden = rosterForbiddenPairs(
    [
      candidate({ candidateKey: 'name:eliza', displayName: 'Eliza' }),
      candidate({ candidateKey: 'name:lizzy', displayName: 'Lizzy' })
    ],
    {
      fragments: fragmentsFor([
        ['name:eliza', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
        ['name:lizzy', [1, 20, 21, 22, 23, 24, 25, 26, 27, 28]]
      ])
    }
  )
  assert.deepEqual(forbidden, [])
})

test('forbidden pairs never appear among candidate pairs', () => {
  const rows = [
    candidate({ candidateKey: 'name:mr-bennet', displayName: 'Mr Bennet', honorificGender: 'male' }),
    candidate({ candidateKey: 'name:mrs-bennet', displayName: 'Mrs Bennet', honorificGender: 'female' })
  ]
  const forbidden = rosterForbiddenPairs(rows)
  const pairs = rosterCandidatePairs(rows, { forbiddenPairs: forbidden })
  assert.deepEqual(pairs, [])
})

test('the request stays inside its byte budget and carries only known candidates', () => {
  const rows = Array.from({ length: 40 }, (_, index) => candidate({
    candidateKey: `name:c${index}`,
    displayName: `Персонаж ${index}`,
    count: 100 - index
  }))
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Книга',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'b'.repeat(64),
    candidates: rows,
    fragments: fragmentsFor(rows.map(({ candidateKey }, index) => [candidateKey, [index]]))
  })
  assert.equal(request.confirmationVersion, ROSTER_CONFIRMATION_VERSION)
  assert.ok(Buffer.byteLength(JSON.stringify(request)) <= MAX_REQUEST_BYTES)
  assert.equal(request.roster.length, 40)
  assert.equal(request.coMentionGuardApplied, true)
  // Кандидаты отсортированы по частоте: при упоре в потолок теряются редкие.
  assert.equal(request.roster[0].candidateKey, 'name:c0')
})

test('a single candidate gives no request: there is nothing to reconcile', () => {
  assert.equal(
    buildRosterConfirmationRequest({
      runId: 'run-1',
      bookEditionId: 'edition-1',
      title: 'Книга',
      candidates: [KITTY]
    }),
    null
  )
})

test('the validator accepts only merges the request actually offered', () => {
  const rows = [
    KITTY,
    CATHERINE,
    candidate({ candidateKey: 'name:darcy', displayName: 'Darcy', count: 400 })
  ]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Книга',
    candidates: rows
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: [
        { candidateKey: 'name:kitty', kind: 'person', canonicalName: 'Catherine Bennet' },
        { candidateKey: 'name:lady-catherine', kind: 'person' },
        { candidateKey: 'name:darcy', kind: 'person' },
        { candidateKey: 'name:unknown', kind: 'person' },
        { candidateKey: 'name:darcy', kind: 'place' }
      ],
      merges: [
        { leftKey: 'name:kitty', rightKey: 'name:darcy', basis: 'nickname' },
        { leftKey: 'name:kitty', rightKey: 'name:lady-catherine', basis: 'invented_basis' },
        { leftKey: 'name:kitty', rightKey: 'name:lady-catherine', basis: 'nickname' }
      ]
    }
  })
  assert.deepEqual(confirmation.acceptedMerges, [
    { leftKey: 'name:kitty', rightKey: 'name:lady-catherine', basis: 'nickname' }
  ])
  const reasons = confirmation.rejected.map(({ reason }) => reason)
  assert.ok(reasons.includes('not_a_candidate_pair'), JSON.stringify(reasons))
  assert.ok(reasons.includes('unknown_key_or_basis'), JSON.stringify(reasons))
  assert.ok(reasons.includes('unknown_key_or_kind'), JSON.stringify(reasons))
  // Повторная классификация того же ключа не переписывает первую.
  const darcy = confirmation.classifications.find((item) => item.candidateKey === 'name:darcy')
  assert.equal(darcy.kind, 'person')
})

test('a forbidden pair is refused even along a chain of allowed merges', () => {
  const rows = [
    candidate({ candidateKey: 'name:a', displayName: 'Mr Bennet', honorificGender: 'male' }),
    candidate({ candidateKey: 'name:b', displayName: 'Bennet' }),
    candidate({ candidateKey: 'name:c', displayName: 'Mrs Bennet', honorificGender: 'female' })
  ]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Книга',
    candidates: rows
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: rows.map(({ candidateKey }) => ({ candidateKey, kind: 'person' })),
      merges: [
        { leftKey: 'name:a', rightKey: 'name:b', basis: 'name_variant' },
        { leftKey: 'name:b', rightKey: 'name:c', basis: 'name_variant' }
      ]
    }
  })
  assert.equal(confirmation.acceptedMerges.length, 1)
  assert.ok(
    confirmation.rejected.some(({ reason }) => reason === 'forbidden_across_components'),
    JSON.stringify(confirmation.rejected)
  )
})

test('an unclassified candidate keeps the inventory hint instead of changing kind', () => {
  const rows = [KITTY, CATHERINE]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Книга',
    candidates: rows
  })
  const confirmation = validateRosterConfirmation({ request, response: {} })
  assert.equal(confirmation.classifications.length, 2)
  for (const item of confirmation.classifications) {
    assert.equal(item.kind, 'person')
    assert.equal(item.unconfirmed, true)
  }
})

test('applying the confirmation merges components and drops non-persons', () => {
  const rows = [
    candidate({ candidateKey: 'name:elizabeth', displayName: 'Elizabeth', count: 400 }),
    candidate({ candidateKey: 'name:lizzy', displayName: 'Lizzy', count: 100, firstMentionTextOffset: 900 }),
    candidate({ candidateKey: 'name:longbourn', displayName: 'Longbourn', count: 60, kindHint: 'place' })
  ]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Книга',
    candidates: rows
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: [
        { candidateKey: 'name:elizabeth', kind: 'person', canonicalName: 'Элизабет Беннет' },
        { candidateKey: 'name:lizzy', kind: 'person' },
        { candidateKey: 'name:longbourn', kind: 'place' }
      ],
      merges: [{ leftKey: 'name:elizabeth', rightKey: 'name:lizzy', basis: 'nickname' }]
    }
  })
  const roster = applyRosterConfirmation({ request, candidates: rows, confirmation })
  assert.equal(roster.length, 1)
  assert.equal(roster[0].canonicalName, 'Элизабет Беннет')
  assert.deepEqual(roster[0].candidateKeys, ['name:elizabeth', 'name:lizzy'])
  assert.equal(roster[0].mentionCount, 500)
  assert.equal(roster[0].firstMentionTextOffset, 100)
  assert.ok(roster[0].names.includes('Lizzy'))
  assert.equal(roster[0].tier, 'significant')
})

test('a null request validates to nothing rather than throwing', () => {
  assert.deepEqual(validateRosterConfirmation({ request: null, response: {} }), {
    classifications: [],
    acceptedMerges: [],
    rejected: []
  })
})
