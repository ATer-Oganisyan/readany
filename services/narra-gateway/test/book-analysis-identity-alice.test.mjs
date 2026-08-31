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
  'alice-wonderland-pdnc-v1.json'
)

test('frozen Alice fixture has immutable PDNC full and major/intermediate denominators', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const significantIds = fixture.characters
    .filter(({ significant }) => significant)
    .map(({ id }) => id)
    .sort()

  assert.equal(fixture.id, 'alice-wonderland-pdnc-v1')
  assert.equal(fixture.source.repositoryCommit, '6fda0a78bda5e9da0854f7befb5dab268abefb7e')
  assert.equal(fixture.source.sourceSha256, '86e9d06d36e764c680c61833be8310609ad20edf10f66cf90d786cb2d11efb97')
  assert.equal(fixture.source.rawCharacterRows, 51)
  assert.equal(fixture.characters.length, 50)
  assert.deepEqual(significantIds, [
    'alice',
    'the_cat',
    'the_caterpillar',
    'the_dormouse',
    'the_duchess',
    'the_gryphon',
    'the_hatter',
    'the_king_of_hearts',
    'the_mock_turtle',
    'the_queen',
    'the_white_rabbit'
  ])
})

test('PDNC aliases and frozen article normalization do not add guessed aliases', async () => {
  const fixture = await loadIdentityFixture(fixturePath)

  assert.equal(fixture.aliases.get('bill'), 'bill_the_lizard')
  assert.equal(fixture.aliases.get('bill the lizard'), 'bill_the_lizard')
  assert.equal(fixture.aliases.get('canarie'), 'a_canary')
  assert.equal(fixture.aliases.get('the queen of hearts'), 'the_queen')
  assert.equal(fixture.aliases.get('the footman'), 'the_frog_footman')
  assert.equal(fixture.aliases.get('king'), 'the_king_of_hearts')
  assert.equal(fixture.aliases.get('queen'), 'the_queen')
  assert.equal(fixture.aliases.get('white rabbit'), 'the_white_rabbit')
  assert.equal(fixture.aliases.get('rabbit'), 'the_white_rabbit')
  assert.equal(fixture.aliases.get('cat'), 'the_cat')
  assert.equal(fixture.aliases.get('lizard'), undefined)
  assert.equal(fixture.aliases.get('conqueror'), undefined)
  assert.equal(fixture.aliases.get('sister'), undefined)
})

test('collision-free article normalization covers every mechanically allowed PDNC surface', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const expected = {
    cat: 'the_cat',
    caterpillar: 'the_caterpillar',
    cook: 'the_cook',
    dodo: 'the_dodo',
    dormouse: 'the_dormouse',
    duchess: 'the_duchess',
    executioner: 'the_executioner',
    gryphon: 'the_gryphon',
    hatter: 'the_hatter',
    'king of hearts': 'the_king_of_hearts',
    king: 'the_king_of_hearts',
    'mock turtle': 'the_mock_turtle',
    mouse: 'the_mouse',
    pigeon: 'the_pigeon',
    queen: 'the_queen',
    'queen of hearts': 'the_queen',
    'white rabbit': 'the_white_rabbit',
    rabbit: 'the_white_rabbit',
    canary: 'a_canary',
    farmer: 'a_farmer',
    'little bright eyed terrier': 'a_little_bright_eyed_terrier',
    'enormous puppy': 'an_enormous_puppy',
    'old crab': 'an_old_crab',
    baby: 'the_baby',
    duck: 'the_duck',
    eaglet: 'the_eaglet',
    'fish footman': 'the_fish_footman',
    'frog footman': 'the_frog_footman',
    footman: 'the_frog_footman',
    'little crocodile': 'the_little_crocodile',
    lory: 'the_lory',
    pope: 'the_pope',
    'young crab': 'the_young_crab'
  }

  assert.deepEqual(
    Object.fromEntries(Object.keys(expected).map((surface) => [
      surface,
      fixture.aliases.get(surface)
    ])),
    expected
  )
})

test('article-free canonical King, Queen, and White Rabbit receive strict TP credit', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: ['King', 'Queen', 'White Rabbit'].map((canonicalName, index) => ({
          entityKey: `article-free-${index + 1}`,
          canonicalName,
          aliases: [],
          resolutionStatus: 'confirmed',
          observationCount: 1
        }))
      }
    }
  })

  assert.equal(score.full.tp, 3)
  assert.equal(score.full.unmatchedRows, 0)
  assert.equal(score.significant.tp, 3)
  assert.deepEqual(
    score.classifications.matches.map(({ gold }) => gold.id),
    ['the_king_of_hearts', 'the_queen', 'the_white_rabbit']
  )
})

test('frozen Alice collision guards cover family, court, role, and generation conflicts', async () => {
  const fixture = await loadIdentityFixture(fixturePath)

  assert.deepEqual(
    fixture.collisionGuards.map(({ id, goldIds }) => ({ id, goldIds })),
    [
      {
        id: 'alice_family',
        goldIds: ['alice', 'alices_sister']
      },
      {
        id: 'hearts_court_titles',
        goldIds: ['the_king_of_hearts', 'the_queen', 'the_knave_of_hearts']
      },
      {
        id: 'footmen_roles',
        goldIds: ['the_fish_footman', 'the_frog_footman']
      },
      {
        id: 'crab_generations',
        goldIds: ['an_old_crab', 'the_young_crab']
      }
    ]
  )
})

test('canonical PDNC roster passes the strict significant identity gate', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const roster = fixture.characters.map(({ id, name }) => ({
    entityKey: id,
    canonicalName: name,
    aliases: [],
    resolutionStatus: 'confirmed',
    observationCount: 1
  }))
  const score = scoreFrozenIdentity({
    fixture,
    input: { schemaVersion: 1, final: { roster } }
  })

  assert.deepEqual(score.full, {
    tp: 50,
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
    tp: 11,
    fn: 0,
    duplicateRows: 0,
    mergeRows: 0,
    unmatchedRows: 0,
    predictionCount: 11,
    precision: 1,
    recall: 1,
    f1: 1
  })
  assert.equal(score.gate.passed, true)
})

test('King and Queen in one row are a critical MERGE with no TP credit', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [{
          entityKey: 'merged-court-rulers',
          canonicalName: 'The King Of Hearts',
          aliases: ['The Queen Of Hearts'],
          resolutionStatus: 'confirmed',
          observationCount: 20
        }]
      }
    }
  })

  assert.equal(score.full.tp, 0)
  assert.equal(score.full.mergeRows, 1)
  assert.equal(score.significant.tp, 0)
  assert.equal(score.significant.mergeRows, 1)
  assert.deepEqual(
    score.classifications.merges[0].matchedGold.map(({ id }) => id),
    ['the_king_of_hearts', 'the_queen']
  )
  assert.equal(score.gate.passed, false)
  assert.equal(score.gate.checks.criticalMerges, false)
})

test('separate Bill and Bill the Lizard rows score as one TP plus one duplicate', async () => {
  const fixture = await loadIdentityFixture(fixturePath)
  const score = scoreFrozenIdentity({
    fixture,
    input: {
      final: {
        roster: [
          {
            entityKey: 'bill-short',
            canonicalName: 'Bill',
            aliases: [],
            observationCount: 5
          },
          {
            entityKey: 'bill-lizard',
            canonicalName: 'Bill, The Lizard',
            aliases: [],
            observationCount: 10
          }
        ]
      }
    }
  })

  assert.equal(score.full.tp, 1)
  assert.equal(score.full.duplicateRows, 1)
  assert.equal(score.full.mergeRows, 0)
  assert.equal(score.full.duplicateRate, 0.5)
  assert.equal(score.classifications.duplicateGroups[0].gold.id, 'bill_the_lizard')
  assert.equal(score.classifications.duplicateGroups[0].anchor.canonicalName, 'Bill, The Lizard')
  assert.equal(score.classifications.duplicateGroups[0].duplicates[0].canonicalName, 'Bill')
})
