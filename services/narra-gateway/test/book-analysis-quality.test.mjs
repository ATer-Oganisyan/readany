import assert from 'node:assert/strict'
import test from 'node:test'
import { assessBookAnalysisCoverage } from '../book-analysis-quality.mjs'

function observation({
  id,
  offset,
  kind = 'character',
  type = 'character_mention',
  candidate = 'Анна',
  related = [],
  quote = candidate
}) {
  return {
    id: id ?? `observation-${offset}`,
    entityKind: kind,
    type,
    entityCandidate: candidate,
    relatedEntityCandidates: related,
    evidence: { quote, startOffset: offset, endOffset: offset + quote.length }
  }
}

test('coverage rejects the partial Medny Horseman result concentrated at the beginning', () => {
  const result = assessBookAnalysisCoverage({
    textLength: 15_805,
    observations: [
      observation({ offset: 178, kind: 'location', type: 'location' }),
      observation({ offset: 214, kind: 'event', type: 'event' }),
      observation({ offset: 273, kind: 'event', type: 'event' })
    ],
    entities: [
      { entityKind: 'location', resolutionStatus: 'confirmed' },
      { entityKind: 'event', resolutionStatus: 'confirmed' },
      { entityKind: 'event', resolutionStatus: 'confirmed' }
    ]
  })

  assert.equal(result.valid, false)
  assert.deepEqual(result.errorCodes, [
    'ANALYSIS_TEXT_COVERAGE_INCOMPLETE',
    'ANALYSIS_CHARACTERS_MISSING'
  ])
  assert.equal(result.coveredBandCount, 1)
  assert.equal(result.requiredBandCount, 3)
})

test('coverage accepts grounded character evidence distributed through a book', () => {
  const result = assessBookAnalysisCoverage({
    textLength: 15_805,
    observations: [
      observation({ offset: 200 }),
      observation({ offset: 4_300 }),
      observation({ offset: 8_500 }),
      observation({ offset: 12_700 })
    ],
    entities: [{ entityKind: 'character', resolutionStatus: 'confirmed' }]
  })

  assert.equal(result.valid, true)
  assert.deepEqual(result.errorCodes, [])
  assert.equal(result.coveredBandCount, 4)
  assert.equal(result.requiredBandCount, 3)
})

test('coverage requires at least one confirmed character for the character product', () => {
  const result = assessBookAnalysisCoverage({
    textLength: 3_000,
    observations: [observation({ offset: 500, kind: 'event', type: 'event' })],
    entities: [{ entityKind: 'event', resolutionStatus: 'confirmed' }]
  })

  assert.equal(result.valid, false)
  assert.deepEqual(result.errorCodes, ['ANALYSIS_CHARACTERS_MISSING'])
})

test('coverage rejects an author copied only from front matter as a character', () => {
  const result = assessBookAnalysisCoverage({
    textLength: 3_000,
    author: 'Александр Пушкин',
    observations: [observation({
      id: 'author-evidence',
      offset: 32,
      candidate: 'Александр Пушкин',
      quote: 'Александр Пушкин'
    })],
    entities: [{
      entityKind: 'character',
      canonicalName: 'Александр Пушкин',
      aliases: [],
      resolutionStatus: 'confirmed',
      evidenceIds: ['author-evidence']
    }]
  })

  assert.equal(result.valid, false)
  assert.deepEqual(result.errorCodes, [
    'ANALYSIS_CHARACTERS_MISSING',
    'ANALYSIS_METADATA_CHARACTER'
  ])
})

test('coverage reports an unresolved relationship participant without rejecting the whole book', () => {
  const result = assessBookAnalysisCoverage({
    textLength: 3_000,
    observations: [
      observation({ id: 'evgeny', offset: 500, candidate: 'Евгений' }),
      observation({
        id: 'relationship',
        offset: 900,
        kind: 'relationship',
        type: 'relationship',
        candidate: 'Евгений и Параша',
        related: ['Евгений', 'Параша'],
        quote: 'И в нём Парашу успокою'
      })
    ],
    entities: [{
      entityKind: 'character',
      canonicalName: 'Евгений',
      aliases: [],
      resolutionStatus: 'confirmed',
      evidenceIds: ['evgeny']
    }]
  })

  assert.equal(result.valid, true)
  assert.deepEqual(result.errorCodes, [])
  assert.deepEqual(result.missingRelationshipCharacters, ['Параша'])
})

test('coverage accepts a grounded relationship participant resolved as a candidate character', () => {
  const result = assessBookAnalysisCoverage({
    textLength: 3_000,
    observations: [
      observation({ id: 'anna', offset: 500, candidate: 'Анна' }),
      observation({ id: 'husband', offset: 700, candidate: 'муж Анны' }),
      observation({
        id: 'relationship',
        offset: 900,
        kind: 'relationship',
        type: 'relationship',
        candidate: 'брак Анны',
        related: ['Анна', 'муж Анны'],
        quote: 'Анна говорила о муже'
      })
    ],
    entities: [
      {
        entityKind: 'character', canonicalName: 'Анна', aliases: [],
        resolutionStatus: 'confirmed', evidenceIds: ['anna'], data: { candidateKeys: ['анна'] }
      },
      {
        entityKind: 'character', canonicalName: 'муж Анны', aliases: [],
        resolutionStatus: 'candidate', evidenceIds: ['husband'], data: { candidateKeys: ['муж анны'] }
      }
    ]
  })
  assert.equal(result.valid, true)
  assert.deepEqual(result.missingRelationshipCharacters, [])
})

test('coverage uses resolved candidate keys instead of exact display-name equality', () => {
  const result = assessBookAnalysisCoverage({
    textLength: 3_000,
    observations: [
      observation({ id: 'saltan', offset: 500, candidate: 'Салтан' }),
      observation({
        id: 'relationship',
        offset: 900,
        kind: 'relationship',
        type: 'relationship',
        candidate: 'Салтан и Гвидон',
        related: ['царь Салтан'],
        quote: 'Царь Салтан зовёт гостей'
      })
    ],
    entities: [{
      entityKind: 'character', canonicalName: 'Салтан', aliases: [],
      resolutionStatus: 'confirmed', evidenceIds: ['saltan'],
      data: { candidateKeys: ['салтан', 'царь салтан'] }
    }]
  })
  assert.equal(result.valid, true)
  assert.deepEqual(result.missingRelationshipCharacters, [])
})
