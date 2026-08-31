import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  loadIdentityFixture,
  scoreFrozenIdentity
} from '../evaluation/score-frozen-identity.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(
  directory,
  '..',
  'evaluation',
  'identity',
  'little-women-litbank-chapter-one-v1.json'
)

const canonicalRoster = [
  'Jo',
  'Meg',
  'Amy',
  'Beth',
  'Marmee',
  'Father'
].map((canonicalName, index) => ({
  entityKey: `little-women-gold-${index + 1}`,
  canonicalName,
  aliases: [],
  resolutionStatus: 'confirmed',
  observationCount: 1
}))

test('frozen Little Women fixture keeps the exact LitBank Chapter I N=6 scope', async () => {
  const fixture = await loadIdentityFixture(fixturePath)

  assert.equal(fixture.id, 'little-women-litbank-chapter-one-v1')
  assert.equal(fixture.source.documentId, '514_little_women')
  assert.equal(fixture.source.textSha256, 'faddb22c433b8b9444077bd6c8131e3eb0b06fb45a4480f0a24b68a8a56d6d9c')
  assert.equal(fixture.source.annotationSha256, '1873c9a08e2c95d47072eb559ce76695fc56f5b3790f3a387ce7736404e7bad9')
  assert.deepEqual(fixture.source.targetClusterIds, [
    'Jo-1',
    'Meg-2',
    'Amy-3',
    'Beth-9',
    'Mother-8',
    'Father-7'
  ])
  assert.equal(fixture.characters.length, 6)
  assert.equal(fixture.characters.filter(({ significant }) => significant).length, 6)
  assert.equal(fixture.characters.reduce((sum, row) => sum + row.mentionCount, 0), 185)
  assert.deepEqual(
    Object.fromEntries(fixture.characters.map(({ id, mentionCount }) => [id, mentionCount])),
    { jo: 70, meg: 30, amy: 31, beth: 34, marmee: 10, father: 10 }
  )
})

test('fragment aliases, collective collisions, and hypothetical personas are frozen', async () => {
  const fixture = await loadIdentityFixture(fixturePath)

  assert.deepEqual(fixture.characterById.get('jo').aliases, [
    'Jo',
    'Josephine',
    'Poor Jo',
    'Fifteen-year-old Jo'
  ])
  assert.deepEqual(fixture.characterById.get('beth').aliases, [
    'Beth',
    'Elizabeth',
    'Little Miss Tranquility',
    "the 'Mouse'"
  ])
  assert.deepEqual(fixture.characterById.get('marmee').aliases, ['Marmee', 'Mother'])
  assert.deepEqual(fixture.characterById.get('father').aliases, ['Father', 'Papa'])
  assert.equal(fixture.aliases.get('miss march'), undefined)
  assert.equal(fixture.aliases.get('mrs march'), undefined)
  assert.equal(fixture.aliases.get('mr march'), undefined)
  assert.equal(fixture.extras.get('miss march'), 'miss_march_persona')
  assert.equal(fixture.extras.get('the four sisters'), 'march_sisters_collective')
  assert.deepEqual(
    fixture.collisionGuards.map(({ id, goldIds }) => ({ id, goldIds })),
    [
      {
        id: 'march_sisters_collective',
        goldIds: ['jo', 'meg', 'amy', 'beth']
      },
      {
        id: 'miss_march_persona',
        goldIds: ['jo', 'meg', 'amy', 'beth']
      }
    ]
  )
  assert.deepEqual(
    fixture.source.blockedPersonas.flatMap(({ surfaces }) => surfaces),
    ['Miss March', 'a girl', 'boy', 'a boy', 'a woman', 'a young lady']
  )
})

test('the canonical LitBank Chapter I roster passes full and significant identity gates', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: { schemaVersion: 1, final: { roster: canonicalRoster } }
  })

  assert.deepEqual(score.full, {
    tp: 6,
    fn: 0,
    duplicateRows: 0,
    mergeRows: 0,
    extraRows: 0,
    unmatchedRows: 0,
    fp: 0,
    duplicateRate: 0,
    precision: 1,
    recall: 1,
    f1: 1
  })
  assert.deepEqual(score.significant, {
    tp: 6,
    fn: 0,
    duplicateRows: 0,
    mergeRows: 0,
    unmatchedRows: 0,
    predictionCount: 6,
    precision: 1,
    recall: 1,
    f1: 1
  })
  assert.equal(score.gate.passed, true)
})

test('sister and parent collisions are critical merges with no TP credit', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [
          {
            entityKey: 'jo-merged-with-meg',
            canonicalName: 'Jo',
            aliases: ['Margaret'],
            resolutionStatus: 'confirmed',
            observationCount: 100
          },
          {
            entityKey: 'marmee-merged-with-father',
            canonicalName: 'Marmee',
            aliases: ['Papa'],
            resolutionStatus: 'confirmed',
            observationCount: 20
          },
          ...canonicalRoster.filter(({ canonicalName }) => ['Amy', 'Beth'].includes(canonicalName))
        ]
      }
    }
  })

  assert.equal(score.full.tp, 2)
  assert.equal(score.full.fn, 4)
  assert.equal(score.full.mergeRows, 2)
  assert.equal(score.significant.tp, 2)
  assert.equal(score.significant.mergeRows, 2)
  assert.deepEqual(
    score.classifications.merges.map(({ matchedGold }) =>
      matchedGold.map(({ id }) => id)
    ),
    [
      ['jo', 'meg'],
      ['father', 'marmee']
    ]
  )
  assert.equal(score.gate.passed, false)
  assert.equal(score.gate.checks.criticalMerges, false)
})

test('duplicates and blocked personas cannot borrow identity credit', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [
          ...canonicalRoster,
          {
            entityKey: 'jo-duplicate',
            canonicalName: 'Josephine',
            aliases: [],
            resolutionStatus: 'confirmed',
            observationCount: 1
          },
          {
            entityKey: 'miss-march-persona',
            canonicalName: 'Miss March',
            aliases: [],
            resolutionStatus: 'confirmed',
            observationCount: 1
          },
          {
            entityKey: 'sisters-collective',
            canonicalName: 'The four sisters',
            aliases: [],
            resolutionStatus: 'confirmed',
            observationCount: 1
          },
          {
            entityKey: 'boy-persona',
            canonicalName: 'A boy',
            aliases: [],
            resolutionStatus: 'confirmed',
            observationCount: 1
          }
        ]
      }
    }
  })

  assert.equal(score.full.tp, 6)
  assert.equal(score.full.duplicateRows, 1)
  assert.equal(score.full.extraRows, 3)
  assert.equal(score.significant.predictionCount, 7)
  assert.deepEqual(
    score.classifications.duplicateGroups.map(({ gold, duplicates }) =>
      [gold.id, duplicates.map(({ canonicalName }) => canonicalName)]
    ),
    [['jo', ['Josephine']]]
  )
  assert.deepEqual(
    score.classifications.extras.map(({ extra }) => extra.id).sort(),
    ['jo_gender_personas', 'march_sisters_collective', 'miss_march_persona']
  )
  assert.equal(score.gate.passed, false)
})

test('valid full-book surnamed identities stay out of the Chapter I denominator', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      characters: [
        { characterKey: 'jo-march', name: 'Jo March', aliases: [] },
        { characterKey: 'mrs-march', name: 'Mrs. March', aliases: [] },
        { characterKey: 'mr-march', name: 'Mr. March', aliases: [] }
      ]
    }
  })

  assert.equal(score.full.tp, 0)
  assert.equal(score.full.unmatchedRows, 3)
  assert.deepEqual(
    score.classifications.unmatched.map(({ row }) => row.canonicalName),
    ['Jo March', 'Mrs. March', 'Mr. March']
  )
})
