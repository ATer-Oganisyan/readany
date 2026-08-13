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
