import assert from 'node:assert/strict'
import test from 'node:test'
import { selectCharacterSynthesisEvidence } from '../book-analysis-synthesis.mjs'

function observation(index, type = 'character_action') {
  return {
    id: `observation-${String(index).padStart(4, '0')}`,
    type,
    fact: `Факт ${index}`,
    evidence: {
      quote: `Цитата ${index}`,
      startOffset: index * 100,
      endOffset: index * 100 + 10,
      chapterKey: `chapter-${Math.floor(index / 50)}`
    },
    confidence: 0.9
  }
}

test('character synthesis evidence stays bounded but spans the whole book and all fact types', () => {
  const observations = Array.from({ length: 600 }, (_, index) => observation(index))
  observations[25] = observation(25, 'character_role')
  observations[260] = observation(260, 'character_trait')
  observations[590] = observation(590, 'character_dialogue')
  const selected = selectCharacterSynthesisEvidence(observations, {
    maxItems: 40,
    maxBytes: 12_000
  })
  assert.ok(selected.length <= 40)
  assert.ok(Buffer.byteLength(JSON.stringify(selected), 'utf8') <= 12_000)
  assert.ok(selected.some(({ evidence }) => evidence.startOffset < 5_000))
  assert.ok(selected.some(({ evidence }) => evidence.startOffset > 55_000))
  assert.deepEqual(
    new Set(selected.map(({ type }) => type)),
    new Set(['character_action', 'character_role', 'character_trait', 'character_dialogue'])
  )
  assert.deepEqual(
    selectCharacterSynthesisEvidence([...observations].reverse(), {
      maxItems: 40,
      maxBytes: 12_000
    }).map(({ id }) => id),
    selected.map(({ id }) => id)
  )
})
