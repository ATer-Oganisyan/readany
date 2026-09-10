import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_CANDIDATE_PAIRS,
  MAX_REQUEST_BYTES,
  ROSTER_CONFIRMATION_VERSION,
  ROSTER_CANDIDATE_KINDS,
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

test('a single candidate is still asked about: classification is not a heuristic', () => {
  // Сливать при одном кандидате не с чем, но классифицировать надо: `kindHint`
  // — эвристика, и на «По дороге шла Анна. Корзину несла Анна.» она даёт
  // `unknown`. Раньше запрос тут не собирался вовсе, и единственный герой окна
  // оставался без карточки; довериться подсказке значило бы выдать карточку
  // месту.
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Книга',
    candidates: [KITTY]
  })
  assert.equal(request.roster.length, 1)
  assert.deepEqual(request.candidatePairs, [])
  assert.deepEqual(request.forbiddenPairs, [])
})

test('no candidates at all still gives no request', () => {
  assert.equal(
    buildRosterConfirmationRequest({
      runId: 'run-1',
      bookEditionId: 'edition-1',
      title: 'Книга',
      candidates: []
    }),
    null
  )
})

test('a merge is impossible when the request offered no pairs', () => {
  // Пустой список пар не «разрешает всё», а запрещает всё: слияние принимается
  // только по паре из запроса.
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Книга',
    candidates: [KITTY]
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: [{ candidateKey: KITTY.candidateKey, kind: 'person', canonicalName: 'Китти' }],
      merges: [{ leftKey: KITTY.candidateKey, rightKey: 'name:someone', basis: 'name_variant' }]
    }
  })
  assert.deepEqual(confirmation.acceptedMerges, [])
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

test('an adjacent full name becomes a candidate pair that token overlap cannot see', () => {
  // «Евгений» и «Онегин» — одно лицо, но общей основы у форм нет: ни
  // перекрытие токенов, ни лексикон уменьшительных такую пару не находят.
  // Находит её соседство имён в тексте.
  const pairs = rosterCandidatePairs([
    candidate({
      candidateKey: 'name:onegin',
      displayName: 'Онегин',
      count: 92,
      adjacentNames: [{ candidateKey: 'name:evgeniy', count: 1 }]
    }),
    candidate({
      candidateKey: 'name:evgeniy',
      displayName: 'Евгений',
      count: 49,
      adjacentNames: [{ candidateKey: 'name:onegin', count: 6 }]
    })
  ])
  assert.equal(pairs.length, 1)
  assert.deepEqual(pairs[0].signals, ['adjacent_full_name'])
  assert.equal(pairs[0].adjacentCount, 6)
})

test('a single accidental adjacency is not enough for a pair', () => {
  const pairs = rosterCandidatePairs([
    candidate({
      candidateKey: 'name:olga',
      displayName: 'Ольга',
      adjacentNames: [{ candidateKey: 'name:larin', count: 1 }]
    }),
    candidate({
      candidateKey: 'name:larin',
      displayName: 'Ларин',
      adjacentNames: [{ candidateKey: 'name:olga', count: 1 }]
    })
  ])
  assert.deepEqual(pairs, [])
})

test('adjacency never overrides a forbidden pair', () => {
  const rows = [
    candidate({
      candidateKey: 'name:mr-bennet',
      displayName: 'Mr Bennet',
      honorificGender: 'male',
      adjacentNames: [{ candidateKey: 'name:mrs-bennet', count: 9 }]
    }),
    candidate({
      candidateKey: 'name:mrs-bennet',
      displayName: 'Mrs Bennet',
      honorificGender: 'female',
      adjacentNames: [{ candidateKey: 'name:mr-bennet', count: 9 }]
    })
  ]
  const forbidden = rosterForbiddenPairs(rows)
  assert.equal(forbidden.length, 1)
  assert.deepEqual(rosterCandidatePairs(rows, { forbiddenPairs: forbidden }), [])
})

test('pairs invisible to token overlap are kept when the pair budget is hit', () => {
  // Порядок важен: при упоре в потолок терять надо пары, которые видит и
  // перекрытие токенов, а не единственный источник для этой пары.
  const overlapping = Array.from({ length: MAX_CANDIDATE_PAIRS }, (_, index) => candidate({
    candidateKey: `name:shared${index}`,
    displayName: `Shared${index} Bennet`
  }))
  const pairs = rosterCandidatePairs([
    ...overlapping,
    candidate({
      candidateKey: 'name:onegin',
      displayName: 'Онегин',
      adjacentNames: [{ candidateKey: 'name:evgeniy', count: 6 }]
    }),
    candidate({ candidateKey: 'name:evgeniy', displayName: 'Евгений' })
  ])
  assert.equal(pairs.length, MAX_CANDIDATE_PAIRS)
  assert.ok(
    pairs.some((pair) => pair.signals.includes('adjacent_full_name')),
    'пара по соседству вытеснена парами перекрытия'
  )
})

test('candidates the model gave one canonical name become one character', () => {
  // Найдено третьей книгой бенчмарка: на «Преступлении и наказании» модель
  // назвала «Родион Романович Раскольников» четырёх разных кандидатов, а пары
  // между ними в запрос не попали — их не породил генератор. В ростер ушли
  // четыре дубля, каждый со своей карточкой, своим портретом и своим слотом
  // публикации. Одинаковое каноническое имя — это заявление модели о
  // тождестве, и оно объединяет так же, как явное слияние.
  const candidates = [
    candidate({ candidateKey: 'name:raskolnikov', displayName: 'Раскольников', count: 767 }),
    candidate({ candidateKey: 'name:rodion-romanych', displayName: 'Родион Романыч', count: 265 }),
    candidate({ candidateKey: 'name:romanovich', displayName: 'Романович', count: 39 })
  ]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Преступление и наказание',
    author: 'Фёдор Достоевский',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    candidates
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: candidates.map(({ candidateKey }) => ({
        candidateKey,
        kind: 'person',
        canonicalName: 'Родион Романович Раскольников'
      })),
      merges: []
    }
  })

  assert.equal(confirmation.acceptedMerges.length, 2)
  assert.ok(confirmation.acceptedMerges.every(({ basis }) => basis === 'name_variant'))
  const roster = applyRosterConfirmation({ request, candidates, confirmation })
  assert.equal(roster.length, 1)
  assert.equal(roster[0].canonicalName, 'Родион Романович Раскольников')
  assert.equal(roster[0].mentionCount, 767 + 265 + 39)
})

test('one canonical name does not merge two people the rules keep apart', () => {
  // Защита, из-за которой правило безопасно: запрет сильнее имени. Мужа и жену
  // модель вправе назвать одинаково — «Свидригайловы», — и слить их всё равно
  // нельзя.
  const candidates = [
    candidate({
      candidateKey: 'name:arkadiy',
      displayName: 'Аркадий Иванович Свидригайлов',
      honorificGender: 'male',
      count: 204
    }),
    candidate({
      candidateKey: 'name:marfa',
      displayName: 'Марфа Петровна Свидригайлова',
      honorificGender: 'female',
      count: 161
    })
  ]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Преступление и наказание',
    author: 'Фёдор Достоевский',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    candidates
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: candidates.map(({ candidateKey }) => ({
        candidateKey,
        kind: 'person',
        canonicalName: 'Свидригайлов'
      })),
      merges: []
    }
  })

  assert.deepEqual(confirmation.acceptedMerges, [])
  assert.ok(confirmation.rejected.some(({ reason }) =>
    reason === 'same_canonical_name_but_gender_conflict'))
  assert.equal(applyRosterConfirmation({ request, candidates, confirmation }).length, 2)
})

test('one canonical name given to a place does not pull it into a character', () => {
  const candidates = [
    candidate({ candidateKey: 'name:sonya', displayName: 'Соня', count: 268 }),
    candidate({ candidateKey: 'name:sennaya', displayName: 'Сенная', count: 17, kindHint: 'place' })
  ]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Преступление и наказание',
    author: 'Фёдор Достоевский',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    candidates
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: [
        { candidateKey: 'name:sonya', kind: 'person', canonicalName: 'Соня Мармеладова' },
        { candidateKey: 'name:sennaya', kind: 'place', canonicalName: 'Соня Мармеладова' }
      ],
      merges: []
    }
  })

  assert.deepEqual(confirmation.acceptedMerges, [])
  const roster = applyRosterConfirmation({ request, candidates, confirmation })
  assert.deepEqual(roster.map(({ canonicalName }) => canonicalName), ['Соня Мармеладова'])
  assert.equal(roster[0].mentionCount, 268)
})

test('a surname and a name-patronymic of one person merge despite sharing paragraphs', () => {
  // Запрет по со-упоминанию ложен именно здесь: «Раскольников» и «Родион
  // Романыч» стоят в одних абзацах потому, что это один человек, а не два
  // участника. Общего токена у них нет, генератор пар их не видит, и
  // единственное свидетельство тождества — одинаковое каноническое имя.
  const candidates = [
    candidate({ candidateKey: 'name:raskolnikov', displayName: 'Раскольников', count: 767 }),
    candidate({ candidateKey: 'name:rodion-romanych', displayName: 'Родион Романыч', count: 265 })
  ]
  const shared = [1, 2, 3, 4, 5, 6, 7, 8]
  const fragments = fragmentsFor([
    ['name:raskolnikov', shared],
    ['name:rodion-romanych', shared]
  ])
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Преступление и наказание',
    author: 'Фёдор Достоевский',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    candidates,
    fragments
  })
  // Со-упоминание действительно запрещает пару — и это остаётся правдой.
  assert.ok(request.forbiddenPairs.some(({ reason }) => reason === 'co_mentioned_participants'))

  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: candidates.map(({ candidateKey }) => ({
        candidateKey,
        kind: 'person',
        canonicalName: 'Родион Романович Раскольников'
      })),
      merges: []
    }
  })
  assert.equal(confirmation.acceptedMerges.length, 1)
  assert.equal(applyRosterConfirmation({ request, candidates, confirmation }).length, 1)
})

test('an explicit merge on a co-mentioned pair is still refused', () => {
  // Перебивает запрет только одноимённость, и только по со-упоминанию. Явное
  // слияние по запрещённой паре остаётся невозможным: модель не должна
  // изобретать связи там, где правила сказали «нет».
  const candidates = [
    candidate({ candidateKey: 'name:elinor', displayName: 'Elinor', count: 100 }),
    candidate({ candidateKey: 'name:marianne', displayName: 'Marianne', count: 90 })
  ]
  const shared = [1, 2, 3, 4, 5, 6]
  const request = buildRosterConfirmationRequest({
    runId: 'run-1',
    bookEditionId: 'edition-1',
    title: 'Sense and Sensibility',
    author: 'Jane Austen',
    inventoryVersion: 'name-inventory-v1',
    normalizedTextHash: 'a'.repeat(64),
    candidates,
    fragments: fragmentsFor([['name:elinor', shared], ['name:marianne', shared]])
  })
  const confirmation = validateRosterConfirmation({
    request,
    response: {
      classifications: candidates.map(({ candidateKey, displayName }) => ({
        candidateKey,
        kind: 'person',
        canonicalName: displayName
      })),
      merges: [{ leftKey: 'name:elinor', rightKey: 'name:marianne', basis: 'name_variant' }]
    }
  })
  assert.deepEqual(confirmation.acceptedMerges, [])
  assert.equal(applyRosterConfirmation({ request, candidates, confirmation }).length, 2)
})

test('names that stand next to each other survive the co-mention veto', () => {
  // «Обломов» и «Илья» стоят в одних абзацах постоянно — это обычный русский
  // приём, когда одного человека называют то по имени, то по фамилии. Запрет
  // по со-упоминанию держал ровно ту пару, которую надо было слить: до модели
  // она не доходила, и «Обломов» с «Ильёй» остались двумя людьми, а «Штольц» с
  // «Андреем» — ещё двумя.
  const rows = [
    candidate({
      candidateKey: 'name:oblomov',
      displayName: 'Обломов',
      count: 1185,
      adjacentNames: [{ candidateKey: 'name:ilya', count: 2 }]
    }),
    candidate({
      candidateKey: 'name:ilya',
      displayName: 'Илья',
      count: 318,
      adjacentNames: [{ candidateKey: 'name:oblomov', count: 2 }]
    })
  ]
  const fragments = fragmentsFor([
    ['name:oblomov', [1, 2, 3, 4, 5]],
    ['name:ilya', [1, 2, 3, 6, 7]]
  ])
  assert.deepEqual(rosterForbiddenPairs(rows, { fragments }), [])
  const pairs = rosterCandidatePairs(rows, { forbiddenPairs: [] })
  assert.equal(pairs.length, 1)
  assert.ok(pairs[0].signals.includes('adjacent_full_name'))

  // Двое участников сцены рядом не стоят, и запрет для них остаётся.
  const apart = rows.map((row) => ({ ...row, adjacentNames: [] }))
  assert.equal(rosterForbiddenPairs(apart, { fragments })[0].reason, 'co_mentioned_participants')
})

test('adjacency does not reconcile a gender conflict', () => {
  // Со-упоминание говорит о ролях в сцене, и соседство его перевешивает.
  // Коллизия пола — о доказательствах, и лишний повод их не примиряет.
  const rows = [
    candidate({
      candidateKey: 'name:mr-bennet',
      displayName: 'Mr Bennet',
      honorificGender: 'male',
      adjacentNames: [{ candidateKey: 'name:mrs-bennet', count: 9 }]
    }),
    candidate({
      candidateKey: 'name:mrs-bennet',
      displayName: 'Mrs Bennet',
      honorificGender: 'female',
      adjacentNames: [{ candidateKey: 'name:mr-bennet', count: 9 }]
    })
  ]
  assert.equal(rosterForbiddenPairs(rows)[0].reason, 'gender_conflict')
})

test('a named-but-absent person is not a character and gets no card', () => {
  // Байрон, Цицерон и Пушкин — люди, и как `person` они получали карточку
  // наравне с Печориным, хотя в книге не действуют, а помянуты для сравнения.
  assert.ok(ROSTER_CANDIDATE_KINDS.includes('mentioned'))
  const candidates = [
    candidate({ candidateKey: 'name:pechorin', displayName: 'Печорин' }),
    candidate({ candidateKey: 'name:bayron', displayName: 'Байрон' })
  ]
  const roster = applyRosterConfirmation({
    request: { roster: candidates.map(({ candidateKey }) => ({ candidateKey })) },
    candidates,
    confirmation: {
      acceptedMerges: [],
      classifications: [
        { candidateKey: 'name:pechorin', kind: 'person', canonicalName: 'Печорин' },
        { candidateKey: 'name:bayron', kind: 'mentioned', canonicalName: 'Байрон' }
      ]
    }
  })
  assert.deepEqual(roster.map(({ canonicalName }) => canonicalName), ['Печорин'])
})

test('a full Russian name said once is enough to pair the surname with the patronymic', () => {
  // «Григорием Александровичем Печориным» сказано ровно один раз на весь
  // роман, а порог соседства требует двух: Печорин и «Григорий Александрович»
  // так и остались двумя людьми — 79 упоминаний и 58. Имя с отчеством рядом с
  // голой фамилией — это не случайное соседство, а полный формат имени.
  const pairs = rosterCandidatePairs([
    candidate({
      candidateKey: 'name:pechorin',
      displayName: 'Печорин',
      count: 79,
      adjacentNames: []
    }),
    candidate({
      candidateKey: 'name:grigoriy-aleksandrovich',
      displayName: 'Григорий Александрович',
      count: 58,
      adjacentNames: [{ candidateKey: 'name:pechorin', count: 1 }]
    })
  ])
  assert.equal(pairs.length, 1)
  assert.ok(pairs[0].signals.includes('adjacent_full_name'))
})

test('a single adjacency between two bare names is still not enough', () => {
  // Послабление узкое: «Ольга» и «Ларин» рядом один раз — по-прежнему ничего.
  const pairs = rosterCandidatePairs([
    candidate({
      candidateKey: 'name:olga',
      displayName: 'Ольга',
      adjacentNames: [{ candidateKey: 'name:larin', count: 1 }]
    }),
    candidate({
      candidateKey: 'name:larin',
      displayName: 'Ларин',
      adjacentNames: [{ candidateKey: 'name:olga', count: 1 }]
    })
  ])
  assert.deepEqual(pairs, [])
})

test('two patronymic forms are not a full name, so one adjacency proves nothing', () => {
  // Полный формат — это имя с отчеством плюс фамилия. «Иван Иванович» рядом с
  // «Петром Петровичем» — двое собеседников, а не один человек.
  const pairs = rosterCandidatePairs([
    candidate({
      candidateKey: 'name:ivan-ivanovich',
      displayName: 'Иван Иванович',
      adjacentNames: [{ candidateKey: 'name:petr-petrovich', count: 1 }]
    }),
    candidate({
      candidateKey: 'name:petr-petrovich',
      displayName: 'Пётр Петрович',
      adjacentNames: [{ candidateKey: 'name:ivan-ivanovich', count: 1 }]
    })
  ])
  assert.deepEqual(pairs, [])
})
