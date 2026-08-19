import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  loadIdentityFixture,
  scoreFrozenIdentity
} from '../evaluation/score-frozen-identity.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const identityDirectory = path.join(directory, '..', 'evaluation', 'identity')

const books = [
  {
    slug: 'anne-green-gables',
    id: 'anne-green-gables-pdnc-v1',
    rawCount: 113,
    goldCount: 114,
    significantCount: 5,
    sourceSha256: '5496a76c9851f0da59c37eb4a495817850c64ff26c471bfea32a05ff09256156',
    significantIds: [
      'anne_shirley',
      'diana_barry',
      'marilla_cuthbert',
      'matthew_cuthbert',
      'rachel_lynde'
    ],
    merge: ['Anne Shirley', 'Diana Barry']
  },
  {
    slug: 'dorian-gray',
    id: 'dorian-gray-pdnc-v1',
    rawCount: 43,
    goldCount: 42,
    significantCount: 7,
    sourceSha256: '21175c017287db00f13e2fd62bdb0480a002dad7586e33b1f7c7b4e7ff485284',
    significantIds: [
      'basil_hallward',
      'duchess_of_monmouth',
      'james_vane',
      'lady_narborough',
      'lord_henry',
      'prince_charming',
      'sibyl_vane'
    ],
    merge: ['Prince Charming', 'James Vane']
  },
  {
    slug: 'invisible-man',
    id: 'invisible-man-pdnc-v1',
    rawCount: 31,
    goldCount: 29,
    significantCount: 10,
    sourceSha256: 'a74309c26cce93e12ac021995933e7493c0fb869afbf8b8b0a46d23b5044c149',
    significantIds: [
      'bunting',
      'colonel_adye',
      'cuss',
      'mr_hall',
      'mr_teddy_henfrey',
      'mr_thomas_marvel',
      'mrs_hall',
      'the_doctor',
      'the_invisible_man',
      'the_mariner'
    ],
    merge: ['The Invisible Man', 'Dr. Kemp']
  },
  {
    slug: 'sense-sensibility',
    id: 'sense-sensibility-pdnc-v1',
    rawCount: 24,
    goldCount: 22,
    significantCount: 12,
    sourceSha256: '958a873dd5e5522a985561c57224326e6054e4e9e14c58b1d30e4ceae2055727',
    significantIds: [
      'anne_steele',
      'charlotte',
      'colonel_brandon',
      'edward_ferrars',
      'elinor',
      'john_dashwood',
      'john_middleton',
      'lucy_steele',
      'marianne',
      'mr_willoughby',
      'mrs_dashwood',
      'mrs_jennings'
    ],
    merge: ['Edward Ferrars', 'Robert Ferrars']
  }
]

function fixturePath(slug) {
  return path.join(identityDirectory, `${slug}-pdnc-v1.json`)
}

test('stage-8 fixtures freeze raw PDNC and corrected major/intermediate denominators', async () => {
  for (const expected of books) {
    const fixture = await loadIdentityFixture(fixturePath(expected.slug))
    const significantIds = fixture.characters
      .filter(({ significant }) => significant)
      .map(({ id }) => id)
      .sort()

    assert.equal(fixture.id, expected.id, expected.slug)
    assert.equal(
      fixture.source.repositoryCommit,
      '6fda0a78bda5e9da0854f7befb5dab268abefb7e',
      expected.slug
    )
    assert.equal(fixture.source.sourceSha256, expected.sourceSha256, expected.slug)
    assert.equal(fixture.source.rawCharacterRows, expected.rawCount, expected.slug)
    assert.equal(fixture.source.correctedGoldCount, expected.goldCount, expected.slug)
    assert.equal(fixture.characters.length, expected.goldCount, expected.slug)
    assert.equal(significantIds.length, expected.significantCount, expected.slug)
    assert.deepEqual(significantIds, expected.significantIds, expected.slug)
  }
})

test('canonical corrected rosters pass strict full and significant identity gates', async () => {
  for (const expected of books) {
    const fixture = await loadIdentityFixture(fixturePath(expected.slug))
    const roster = fixture.characters.map(({ id, name }) => ({
      entityKey: id,
      canonicalName: name,
      aliases: [],
      resolutionStatus: 'confirmed',
      observationCount: 1
    }))
    const score = scoreFrozenIdentity({ fixture, input: { final: { roster } } })

    assert.equal(score.full.tp, expected.goldCount, expected.slug)
    assert.equal(score.full.fn, 0, expected.slug)
    assert.equal(score.full.fp, 0, expected.slug)
    assert.equal(score.full.precision, 1, expected.slug)
    assert.equal(score.full.recall, 1, expected.slug)
    assert.equal(score.full.f1, 1, expected.slug)
    assert.equal(score.significant.tp, expected.significantCount, expected.slug)
    assert.equal(score.significant.fn, 0, expected.slug)
    assert.equal(score.significant.precision, 1, expected.slug)
    assert.equal(score.significant.recall, 1, expected.slug)
    assert.equal(score.significant.f1, 1, expected.slug)
    assert.equal(score.gate.passed, true, expected.slug)
  }
})

test('blind Anne corrections keep the body title alias and split Josephine, Josie, and Gertie', async () => {
  const fixture = await loadIdentityFixture(fixturePath('anne-green-gables'))

  assert.equal(fixture.aliases.get('anne of green gables'), 'anne_shirley')
  assert.equal(fixture.aliases.get('aunt josephine'), 'aunt_josephine')
  assert.equal(fixture.aliases.get('josie'), 'josie_pye')
  assert.equal(fixture.aliases.get('josie pye'), 'josie_pye')
  assert.equal(fixture.aliases.get('gertie pye'), 'gertie_pye')
  assert.equal(fixture.aliases.get('doctor spencer'), 'doctor_spencer')
  assert.equal(fixture.aliases.get('dr spencer'), 'doctor_spencer')
  assert.equal(fixture.aliases.get('cuthbert'), undefined)
  assert.equal(
    fixture.source.corrections.find(({ id }) => id === 'anne_body_title_surface').action,
    'retain_alias_but_ignore_paratext_evidence'
  )
})

test('blind collision corrections keep ambiguous family surfaces out of global aliases', async () => {
  const dorian = await loadIdentityFixture(fixturePath('dorian-gray'))
  assert.equal(dorian.aliases.get('dorian gray'), 'prince_charming')
  assert.equal(dorian.aliases.get('vane'), undefined)
  assert.equal(dorian.extras.get('unknowable'), 'pdnc_unknowable')

  const invisible = await loadIdentityFixture(fixturePath('invisible-man'))
  assert.equal(invisible.aliases.get('invisible man'), 'the_invisible_man')
  assert.equal(invisible.aliases.get('griffin'), 'the_invisible_man')
  assert.equal(invisible.aliases.get('dr kemp'), 'the_doctor')
  assert.equal(invisible.extras.get('group'), 'pdnc_group')
  assert.equal(invisible.extras.get('unknowable'), 'pdnc_unknowable')

  const sense = await loadIdentityFixture(fixturePath('sense-sensibility'))
  assert.equal(sense.aliases.get('edward'), 'edward_ferrars')
  assert.equal(sense.aliases.get('robert'), 'robert_ferrars')
  assert.equal(sense.aliases.get('ferrars'), undefined)
  assert.equal(sense.aliases.get('mr ferrars'), undefined)
  assert.equal(sense.aliases.get('miss steele'), undefined)
  assert.equal(sense.aliases.get('man servant'), undefined)
})

test('a significant cross-identity row is a critical MERGE with no TP credit for every book', async () => {
  for (const expected of books) {
    const fixture = await loadIdentityFixture(fixturePath(expected.slug))
    const score = scoreFrozenIdentity({
      fixture,
      input: {
        final: {
          roster: [{
            entityKey: `${expected.slug}-critical-merge`,
            canonicalName: expected.merge[0],
            aliases: [expected.merge[1]],
            resolutionStatus: 'confirmed',
            observationCount: 10
          }]
        }
      }
    })

    assert.equal(score.full.tp, 0, expected.slug)
    assert.equal(score.full.mergeRows, 1, expected.slug)
    assert.equal(score.significant.tp, 0, expected.slug)
    assert.equal(score.significant.mergeRows, 1, expected.slug)
    assert.equal(score.gate.checks.criticalMerges, false, expected.slug)
    assert.equal(score.gate.passed, false, expected.slug)
  }
})
