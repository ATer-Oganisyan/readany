import assert from 'node:assert/strict'
import test from 'node:test'
import { assessBookAnalysisCoverage } from '../book-analysis-quality.mjs'

function observation({ offset, kind = 'character', type = 'character_mention' }) {
  return {
    entityKind: kind,
    type,
    evidence: { startOffset: offset, endOffset: offset + 8 }
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
