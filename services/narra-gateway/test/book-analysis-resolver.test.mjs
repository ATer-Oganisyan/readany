import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBookAnalysisEntities } from '../book-analysis-resolver.mjs'

function observation({
  id,
  key = id,
  type = 'character_mention',
  kind = 'character',
  candidate,
  related = [],
  confidence = 0.9,
  startOffset = 0
}) {
  const quote = `${candidate} появился`
  return {
    id,
    observationKey: key,
    type,
    entityKind: kind,
    entityCandidate: candidate,
    relatedEntityCandidates: related,
    fact: `Факт о ${candidate}`,
    evidence: {
      quote,
      startOffset,
      endOffset: startOffset + quote.length,
      chapterKey: 'chapter-1'
    },
    confidence
  }
}

test('resolver merges normalized names and explicit aliases over the complete evidence set', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'character_alias',
      candidate: 'Анна Сергеевна',
      related: ['Анна', 'Аня'],
      confidence: 0.96,
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'character_action',
      candidate: 'анна',
      confidence: 0.91,
      startOffset: 500
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'character_dialogue',
      candidate: 'Аня',
      confidence: 0.88,
      startOffset: 900
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444444',
      type: 'location',
      kind: 'location',
      candidate: 'Москва',
      startOffset: 1_200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 2)
  assert.deepEqual(result[0].canonicalName, 'Анна Сергеевна')
  assert.deepEqual(result[0].aliases, ['Анна', 'Аня'])
  assert.equal(result[0].resolutionStatus, 'confirmed')
  assert.deepEqual(result[0].evidenceIds, observations.slice(0, 3).map(({ id }) => id))
  assert.equal(result[0].data.observationCount, 3)
  assert.equal(result[1].entityKind, 'location')
})

test('resolver leaves ambiguous aliases separate instead of merging two people', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111112',
      type: 'character_alias',
      candidate: 'Анна',
      related: ['госпожа'],
      startOffset: 10
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222223',
      type: 'character_alias',
      candidate: 'Мария',
      related: ['госпожа'],
      startOffset: 20
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333334',
      candidate: 'госпожа',
      startOffset: 30
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 3)
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), ['Анна', 'Мария', 'госпожа'])
})

test('resolver keeps weak one-off character references as candidates', () => {
  const result = resolveBookAnalysisEntities({
    observations: [observation({
      id: '11111111-1111-4111-8111-111111111113',
      candidate: 'Она',
      confidence: 0.99
    })]
  })
  assert.equal(result[0].resolutionStatus, 'candidate')
})

test('resolver keeps a one-off proper-name mention as a candidate until character behaviour corroborates it', () => {
  const mention = resolveBookAnalysisEntities({
    observations: [observation({
      id: '11111111-1111-4111-8111-111111111130',
      candidate: 'Гете',
      confidence: 0.99
    })]
  })
  const dialogue = resolveBookAnalysisEntities({
    observations: [observation({
      id: '22222222-2222-4222-8222-222222222240',
      type: 'character_dialogue',
      candidate: 'Мария',
      confidence: 0.99
    })]
  })
  assert.equal(mention[0].resolutionStatus, 'candidate')
  assert.equal(dialogue[0].resolutionStatus, 'confirmed')
})

test('resolver keeps composite and collective labels out of character synthesis', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111131',
      type: 'character_action',
      candidate: 'Ромео и Бенволио',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222241',
      type: 'character_action',
      candidate: 'Конная армия',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333351',
      type: 'character_dialogue',
      candidate: 'Конная армия',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ resolutionStatus }) => resolutionStatus), [
    'candidate', 'candidate'
  ])
})

test('resolver merges a leading title with the same named character', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111132',
      type: 'character_action',
      candidate: 'Салтан',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222242',
      candidate: 'царь Салтан',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Салтан')
  assert.deepEqual(result[0].aliases, ['царь Салтан'])
})

test('resolver recognizes a proper name after a lowercase leading title', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111134',
      type: 'character_action',
      candidate: 'царь Салтан',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222244',
      candidate: 'царь Салтан',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result[0].resolutionStatus, 'confirmed')
})

test('resolver does not confirm generated descriptions merely because they start uppercase', () => {
  const candidates = [
    'Мертвая лягушка',
    'Капитан дальнего плавания',
    'Механический толстяк',
    'Неустановленный голос',
    'Газовые бронеавтомобили',
    'Две девки-прислужницы',
    'Будочники',
    'Писари',
    'Взводные'
  ]
  const observations = candidates.flatMap((candidate, index) => [
    observation({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      type: 'character_action', candidate, startOffset: index * 100
    }),
    observation({
      id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
      type: 'character_dialogue', candidate, startOffset: index * 100 + 10
    })
  ])
  const result = resolveBookAnalysisEntities({ observations })
  assert.ok(result.every(({ resolutionStatus }) => resolutionStatus === 'candidate'))
})

test('resolver binds relationship participants to character entity keys including candidates', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111133',
      type: 'character_action',
      candidate: 'Анна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222243',
      candidate: 'муж Анны',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333353',
      type: 'relationship',
      kind: 'relationship',
      candidate: 'брак Анны',
      related: ['Анна', 'муж Анны'],
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  const characters = result.filter(({ entityKind }) => entityKind === 'character')
  const relationship = result.find(({ entityKind }) => entityKind === 'relationship')
  assert.deepEqual(relationship.data.relatedCharacterEntityKeys, characters.map(({ entityKey }) => entityKey))
  assert.deepEqual(relationship.data.unresolvedRelatedEntityCandidates, [])
})

test('resolver merges one unambiguous chain of full-name fragments', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111115',
      candidate: 'Раскольников',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222225',
      candidate: 'Родион Раскольников',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333335',
      candidate: 'Родион Романович Раскольников',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444445',
      candidate: 'Родион Романович',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Родион Романович Раскольников')
  assert.deepEqual(result[0].aliases, [
    'Раскольников', 'Родион Раскольников', 'Родион Романович'
  ])
  assert.deepEqual(result[0].evidenceIds, observations.map(({ id }) => id))
})

test('resolver does not merge an ambiguous surname into two full names', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111116',
      candidate: 'Иванов',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222226',
      candidate: 'Петр Иванов',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333336',
      candidate: 'Сергей Иванов',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Иванов', 'Петр Иванов', 'Сергей Иванов'
  ])
})

test('resolver does not infer that one given name is a unique full-name alias', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111118',
      candidate: 'Анна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222228',
      candidate: 'Анна Сергеевна',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна', 'Анна Сергеевна'
  ])
})

test('resolver keeps repeated descriptive character labels out of synthesis', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111117',
      candidate: 'молодой человек',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222227',
      candidate: 'молодой человек',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].resolutionStatus, 'candidate')
})

test('resolver keeps capitalized descriptive phrases out of synthesis', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111119',
      candidate: 'Пьяная девушка',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222229',
      candidate: 'Пьяная девушка',
      type: 'character_action',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333339',
      candidate: 'Невеста Свидригайлова',
      confidence: 0.99,
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ resolutionStatus }) => resolutionStatus), [
    'candidate', 'candidate'
  ])
})

test('resolver merges a full name through a unique patronymic and nickname bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111120',
      candidate: 'Авдотья Романовна Раскольникова',
      related: ['Дуня'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222230',
      candidate: 'Авдотья Романовна',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333340',
      candidate: 'Авдотья Романовна Дуня',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444450',
      candidate: 'Дуня',
      related: ['Авдотья Романовна'],
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Авдотья Романовна Раскольникова')
  assert.deepEqual(result[0].aliases, [
    'Авдотья Романовна', 'Авдотья Романовна Дуня', 'Дуня'
  ])
})

test('resolver uses a Russian patronymic composite as a nickname bridge without related links', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111124',
      candidate: 'Авдотья Романовна Раскольникова',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222234',
      candidate: 'Авдотья Романовна',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333344',
      candidate: 'Авдотья Романовна Дуня',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444454',
      candidate: 'Дуня',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Авдотья Романовна Раскольникова')
  assert.deepEqual(result[0].aliases, [
    'Авдотья Романовна', 'Авдотья Романовна Дуня', 'Дуня'
  ])
})

test('resolver merges a Russian ya-name with its echka diminutive', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111126',
      candidate: 'Дуня',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222236',
      candidate: 'Дунечка',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Дунечка')
  assert.deepEqual(result[0].aliases, ['Дуня'])
})

test('resolver does not merge unrelated diminutives without the exact ya-echka form', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111127',
      candidate: 'Анна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222237',
      candidate: 'Анечка',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333347',
      candidate: 'Манечка',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна', 'Анечка', 'Манечка'
  ])
})

test('resolver merges the same three-part full name in a different token order', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111128',
      candidate: 'Родион Романович Раскольников',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222238',
      candidate: 'Раскольников Родион Романович',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Родион Романович Раскольников')
  assert.deepEqual(result[0].aliases, ['Раскольников Родион Романович'])
})

test('resolver does not merge partially overlapping or two-part reordered names', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111129',
      candidate: 'Анна Мария Иванова',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222239',
      candidate: 'Мария Анна Петрова',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333349',
      candidate: 'Иван Иванов',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444459',
      candidate: 'Иванов Иван',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна Мария Иванова', 'Мария Анна Петрова', 'Иван Иванов', 'Иванов Иван'
  ])
})

test('resolver does not treat a regular surname after a patronymic as a nickname bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111125',
      candidate: 'Анна Сергеевна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222235',
      candidate: 'Анна Сергеевна Иванова',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333345',
      candidate: 'Иванова',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444455',
      candidate: 'Анна Сергеевна Петрова',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName, aliases }) => ({ canonicalName, aliases })), [
    { canonicalName: 'Анна Сергеевна', aliases: [] },
    { canonicalName: 'Анна Сергеевна Иванова', aliases: ['Иванова'] },
    { canonicalName: 'Анна Сергеевна Петрова', aliases: [] }
  ])
})

test('resolver does not treat one-way related mentions as aliases', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111122',
      candidate: 'Лизавета',
      related: ['Алена Ивановна'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222232',
      candidate: 'Алена Ивановна',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Лизавета', 'Алена Ивановна'
  ])
})

test('resolver does not merge reciprocal mentions without a composite name bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111123',
      candidate: 'Анна Сергеевна',
      related: ['Борис Иванович'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222233',
      candidate: 'Борис Иванович',
      related: ['Анна Сергеевна'],
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна Сергеевна', 'Борис Иванович'
  ])
})

test('resolver merges a unique surname after joining colloquial patronymic variants', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111121',
      candidate: 'Андрей Семеныч Лебезятников',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222231',
      candidate: 'Андрей Семенович Лебезятников',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333341',
      candidate: 'Лебезятников',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Андрей Семенович Лебезятников')
  assert.deepEqual(result[0].aliases, ['Андрей Семеныч Лебезятников', 'Лебезятников'])
})

test('resolver output is stable regardless of scan completion order', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111114',
      type: 'character_alias',
      candidate: 'Борис Иванович',
      related: ['Борис'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222224',
      candidate: 'Борис',
      startOffset: 200
    })
  ]
  const forward = resolveBookAnalysisEntities({ observations })
  const reverse = resolveBookAnalysisEntities({ observations: [...observations].reverse() })
  assert.deepEqual(reverse, forward)
})
