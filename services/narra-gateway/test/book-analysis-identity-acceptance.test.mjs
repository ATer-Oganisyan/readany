import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  extractCompactRoster,
  loadIdentityFixture,
  scoreFrozenIdentity
} from '../evaluation/score-frozen-identity.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const v22RosterPath = path.join(
  directory,
  'fixtures',
  'pride-prejudice-v22-identity-roster.json'
)

test('frozen Pride and Prejudice fixture has immutable full and significant denominators', async () => {
  const fixture = await loadIdentityFixture()
  assert.equal(fixture.characters.length, 38)
  assert.equal(fixture.characters.filter(({ significant }) => significant).length, 18)
  assert.equal(
    fixture.characters.reduce((sum, { mentionCount }) => sum + mentionCount, 0),
    16_419
  )
})

test('scores the strict corrected v22 roster without manual matching', async () => {
  const [fixture, input] = await Promise.all([
    loadIdentityFixture(),
    readFile(v22RosterPath, 'utf8').then(JSON.parse)
  ])
  const score = scoreFrozenIdentity({ fixture, input })

  assert.deepEqual(score.full, {
    tp: 34,
    fn: 4,
    duplicateRows: 11,
    mergeRows: 1,
    extraRows: 5,
    unmatchedRows: 0,
    fp: 17,
    duplicateRate: 0.215686,
    precision: 0.666667,
    recall: 0.894737,
    f1: 0.764045
  })
  assert.deepEqual(score.significant, {
    tp: 18,
    fn: 0,
    duplicateRows: 9,
    mergeRows: 1,
    unmatchedRows: 0,
    predictionCount: 28,
    precision: 0.642857,
    recall: 1,
    f1: 0.782609
  })
  assert.equal(score.gate.passed, false)
  assert.deepEqual(score.gate.checks, {
    precision: false,
    recall: true,
    f1: false,
    criticalMerges: false,
    duplicateRate: false
  })

  assert.deepEqual(
    score.classifications.merges.map(({ row, matchedGold }) => ({
      canonicalName: row.canonicalName,
      goldIds: matchedGold.map(({ id }) => id)
    })),
    [{
      canonicalName: 'Mr. Darcy',
      goldIds: ['fitzwilliam_darcy', 'georgiana_darcy']
    }]
  )
  assert.deepEqual(
    score.classifications.fn.map(({ id }) => id).sort(),
    ['captain_carter', 'haggerston', 'mary_king', 'mr_dawson']
  )
  assert.deepEqual(
    score.classifications.duplicateGroups.map(({ gold, duplicates }) =>
      [gold.id, duplicates.length]
    ),
    [
      ['catherine_bennet', 1],
      ['charles_bingley', 1],
      ['charlotte_lucas', 2],
      ['george_wickham', 1],
      ['jane_bennet', 1],
      ['lydia_bennet', 1],
      ['maria_lucas', 1],
      ['mary_bennet', 1],
      ['mrs_gardiner', 1],
      ['sir_william_lucas', 1]
    ]
  )
  assert.deepEqual(
    score.classifications.extras.map(({ extra }) => extra.id).sort(),
    [
      'gardiners_collective',
      'ladies_of_longbourn',
      'mrs_annesley',
      'mrs_long',
      'mrs_nichols'
    ]
  )
})

test('reads local markup lab final.roster and publication export shapes', () => {
  const finalRoster = extractCompactRoster({
    schemaVersion: 1,
    final: {
      roster: [
        {
          entityKey: 'elizabeth',
          canonicalName: 'Elizabeth',
          aliases: ['Lizzy'],
          resolutionStatus: 'confirmed',
          observationCount: 10,
          evidence: []
        },
        {
          entityKey: 'weak-candidate',
          canonicalName: 'A weak candidate',
          aliases: [],
          resolutionStatus: 'candidate',
          observationCount: 1,
          evidence: []
        }
      ]
    }
  })
  const publicationRoster = extractCompactRoster({
    publication: {
      data: {
        markup: {
          characters: [{
            characterKey: 'elizabeth',
            name: 'Elizabeth',
            aliases: ['Lizzy'],
            identityEvidenceIds: ['evidence-1']
          }]
        }
      }
    }
  })
  assert.deepEqual(finalRoster[0], {
    entityKey: 'elizabeth',
    canonicalName: 'Elizabeth',
    aliases: ['Lizzy'],
    resolutionStatus: 'confirmed',
    observationCount: 10
  })
  assert.equal(finalRoster.length, 1)
  assert.equal(publicationRoster[0].observationCount, 1)
})

test('a merge receives no TP even when both gold identities have no other row', async () => {
  const fixture = await loadIdentityFixture()
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [{
          entityKey: 'hurst-mixed',
          canonicalName: 'Mrs. Hurst',
          aliases: ['Mr. Hurst'],
          observationCount: 16
        }]
      }
    }
  })
  assert.equal(score.full.tp, 0)
  assert.equal(score.full.mergeRows, 1)
  assert.ok(score.classifications.fn.some(({ id }) => id === 'mrs_hurst'))
  assert.ok(score.classifications.fn.some(({ id }) => id === 'mr_hurst'))
})

test('an unknown generated canonical cannot borrow TP from one known alias', async () => {
  const fixture = await loadIdentityFixture()
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [{
          entityKey: 'other-aunt',
          canonicalName: "Mrs. Gardiner's other aunt",
          aliases: ['Mrs. Gardiner'],
          observationCount: 29
        }]
      }
    }
  })
  assert.equal(score.full.tp, 0)
  assert.equal(score.full.unmatchedRows, 1)
  assert.equal(score.classifications.unmatched[0].reason, 'canonical_name_not_frozen_for_matched_identity')
  assert.ok(score.classifications.fn.some(({ id }) => id === 'mrs_gardiner'))
})
