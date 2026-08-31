import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPersonalityCheckpoints,
  normalizePersonalityTimeline,
  overlayStablePersonalityTraits
} from '../progressive-personality.mjs'

function evidence(index, type = 'character_action') {
  return {
    id: `evidence-${index}`,
    type,
    fact: `Факт ${index}`,
    quote: `Герой совершает поступок ${index}.`,
    startOffset: index * 100,
    endOffset: index * 100 + 40,
    confidence: 0.9
  }
}

test('personality checkpoints follow accumulated evidence instead of wall time or book length', () => {
  const observations = [
    evidence(1),
    evidence(2, 'character_appearance'),
    evidence(3, 'character_dialogue'),
    evidence(4, 'character_role'),
    evidence(5, 'character_trait'),
    evidence(6),
    evidence(7),
    evidence(8),
    evidence(9)
  ]

  assert.deepEqual(
    buildPersonalityCheckpoints(observations).map((checkpoint) => ({
      cutoffTextOffset: checkpoint.cutoffTextOffset,
      evidenceIds: checkpoint.evidenceIds
    })),
    [
      { cutoffTextOffset: 140, evidenceIds: ['evidence-1'] },
      {
        cutoffTextOffset: 540,
        evidenceIds: ['evidence-1', 'evidence-3', 'evidence-5']
      },
      {
        cutoffTextOffset: 840,
        evidenceIds: [
          'evidence-1', 'evidence-3', 'evidence-5',
          'evidence-6', 'evidence-7', 'evidence-8'
        ]
      },
      {
        cutoffTextOffset: 940,
        evidenceIds: [
          'evidence-1', 'evidence-3', 'evidence-5',
          'evidence-6', 'evidence-7', 'evidence-8', 'evidence-9'
        ]
      }
    ]
  )
})

test('primary timeline accepts tentative traits but caps confidence and evidence at each cutoff', () => {
  const observations = [
    evidence(1),
    evidence(2),
    evidence(3)
  ]
  const checkpoints = buildPersonalityCheckpoints(observations)
  const timeline = normalizePersonalityTimeline({
    snapshots: [{
      cutoffTextOffset: 140,
      traits: [{ value: 'решительный', evidenceIds: ['evidence-1'], confidence: 0.96 }]
    }, {
      cutoffTextOffset: 340,
      traits: [{
        value: 'решительный',
        evidenceIds: ['evidence-1', 'evidence-3'],
        confidence: 0.97
      }]
    }]
  }, { checkpoints, evidence: observations })

  assert.deepEqual(timeline, [{
    cutoffTextOffset: 140,
    status: 'preliminary',
    traits: [{
      value: 'решительный',
      evidenceIds: ['evidence-1'],
      confidence: 0.65,
      evidenceLevel: 'single_scene'
    }]
  }, {
    cutoffTextOffset: 340,
    status: 'preliminary',
    traits: [{
      value: 'решительный',
      evidenceIds: ['evidence-1', 'evidence-3'],
      confidence: 0.82,
      evidenceLevel: 'repeated'
    }]
  }])
})

test('primary timeline rejects future evidence and malformed checkpoint sequences', () => {
  const observations = [evidence(1), evidence(2), evidence(3)]
  const checkpoints = buildPersonalityCheckpoints(observations)

  assert.throws(() => normalizePersonalityTimeline({
    snapshots: [{
      cutoffTextOffset: 140,
      traits: [{ value: 'смелый', evidenceIds: ['evidence-3'], confidence: 0.6 }]
    }, {
      cutoffTextOffset: 340,
      traits: []
    }]
  }, { checkpoints, evidence: observations }), /future or unknown evidence/i)

  assert.throws(() => normalizePersonalityTimeline({
    snapshots: [{ cutoffTextOffset: 340, traits: [] }]
  }, { checkpoints, evidence: observations }), /checkpoint sequence/i)
})

test('strict canonical traits are overlaid only after their evidence was read', () => {
  const observations = [evidence(1), evidence(2), evidence(3)]
  const checkpoints = buildPersonalityCheckpoints(observations)
  const preliminary = normalizePersonalityTimeline({
    snapshots: checkpoints.map(({ cutoffTextOffset }) => ({ cutoffTextOffset, traits: [] }))
  }, { checkpoints, evidence: observations })

  assert.deepEqual(overlayStablePersonalityTraits(preliminary, [{
    value: 'надёжный',
    evidenceIds: ['evidence-1', 'evidence-3'],
    confidence: 0.91
  }], observations), [{
    cutoffTextOffset: 140,
    status: 'insufficient_evidence',
    traits: []
  }, {
    cutoffTextOffset: 340,
    status: 'supported',
    traits: [{
      value: 'надёжный',
      evidenceIds: ['evidence-1', 'evidence-3'],
      confidence: 0.9,
      evidenceLevel: 'repeated'
    }]
  }])
})
