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
  'siddhartha-bookcoref-v1.json'
)

const canonicalRoster = [
  'Siddhartha',
  'Govinda',
  'Young Siddhartha',
  'Gotama',
  'Kamala',
  "Siddhartha's Father",
  'The Samanas',
  'Kamaswami',
  'Vasudeva'
].map((canonicalName, index) => ({
  entityKey: `gold-${index + 1}`,
  canonicalName,
  aliases: [],
  resolutionStatus: 'confirmed',
  observationCount: 1
}))

test('frozen Siddhartha fixture has immutable BOOKCOREF denominators and importance flags', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const significantIds = fixture.characters
    .filter(({ significant }) => significant)
    .map(({ id }) => id)
    .sort()

  assert.equal(fixture.id, 'siddhartha-bookcoref-v1')
  assert.equal(fixture.source.documentId, 'siddhartha_2500')
  assert.equal(fixture.characters.length, 9)
  assert.equal(fixture.characters.reduce((sum, row) => sum + row.mentionCount, 0), 4_933)
  assert.deepEqual(significantIds, [
    'gotama',
    'govinda',
    'kamala',
    'kamaswami',
    'siddhartha',
    'siddharthas_father',
    'vasudeva',
    'young_siddhartha'
  ])
})

test('source-only aliases keep the two Siddharthas distinct and freeze ambiguous wording as a guard', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const youngSiddhartha = fixture.characterById.get('young_siddhartha')

  assert.deepEqual(youngSiddhartha.aliases, [
    'Young Siddhartha',
    "Siddhartha's son"
  ])
  assert.equal(fixture.aliases.get('the young siddhartha'), undefined)
  assert.equal(fixture.aliases.get('samana'), undefined)
  assert.equal(fixture.aliases.get('brahman'), undefined)
  assert.deepEqual(fixture.collisionGuards, [{
    id: 'siddhartha_generation',
    surfaces: ['young Siddhartha', 'the young Siddhartha'],
    goldIds: ['siddhartha', 'young_siddhartha'],
    reason: 'The same generational wording refers to the protagonist early in the book and to his son later; it must not be used as an unconditional global alias.'
  }])
})

test('canonical BOOKCOREF roster passes the strict significant identity gate', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: { schemaVersion: 1, final: { roster: canonicalRoster } }
  })

  assert.deepEqual(score.full, {
    tp: 9,
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
    tp: 8,
    fn: 0,
    duplicateRows: 0,
    mergeRows: 0,
    unmatchedRows: 0,
    predictionCount: 8,
    precision: 1,
    recall: 1,
    f1: 1
  })
  assert.equal(score.gate.passed, true)
})

test('an explicit protagonist and son collision is a critical MERGE with no TP credit', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [
          {
            entityKey: 'siddhartha-merged-with-son',
            canonicalName: 'Siddhartha',
            aliases: ["Siddhartha's son"],
            resolutionStatus: 'confirmed',
            observationCount: 400
          },
          ...canonicalRoster.filter(({ canonicalName }) => [
            'Govinda',
            'Gotama',
            'Kamala',
            "Siddhartha's Father",
            'Kamaswami',
            'Vasudeva'
          ].includes(canonicalName))
        ]
      }
    }
  })

  assert.deepEqual(score.full, {
    tp: 6,
    fn: 3,
    duplicateRows: 0,
    mergeRows: 1,
    extraRows: 0,
    unmatchedRows: 0,
    fp: 1,
    duplicateRate: 0,
    precision: 0.857143,
    recall: 0.666667,
    f1: 0.75
  })
  assert.deepEqual(score.significant, {
    tp: 6,
    fn: 2,
    duplicateRows: 0,
    mergeRows: 1,
    unmatchedRows: 0,
    predictionCount: 7,
    precision: 0.857143,
    recall: 0.75,
    f1: 0.8
  })
  assert.deepEqual(
    score.classifications.merges[0].matchedGold.map(({ id }) => id),
    ['siddhartha', 'young_siddhartha']
  )
  assert.deepEqual(
    score.classifications.fn.map(({ id }) => id).sort(),
    ['siddhartha', 'the_samanas', 'young_siddhartha']
  )
  assert.equal(score.gate.passed, false)
  assert.equal(score.gate.checks.criticalMerges, false)
})

test('generic Samana and Brahman roles cannot borrow group or father identity credit', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [
          {
            entityKey: 'protagonist-with-role',
            canonicalName: 'Siddhartha',
            aliases: ['Samana'],
            observationCount: 100
          },
          {
            entityKey: 'generic-samana',
            canonicalName: 'Samana',
            aliases: [],
            observationCount: 3
          },
          {
            entityKey: 'generic-brahman',
            canonicalName: 'Brahman',
            aliases: [],
            observationCount: 3
          }
        ]
      }
    }
  })

  assert.equal(score.full.tp, 1)
  assert.equal(score.full.mergeRows, 0)
  assert.equal(score.full.unmatchedRows, 2)
  assert.deepEqual(
    score.classifications.unmatched.map(({ row }) => row.canonicalName),
    ['Samana', 'Brahman']
  )
  assert.ok(score.classifications.fn.some(({ id }) => id === 'the_samanas'))
  assert.ok(score.classifications.fn.some(({ id }) => id === 'siddharthas_father'))
})
