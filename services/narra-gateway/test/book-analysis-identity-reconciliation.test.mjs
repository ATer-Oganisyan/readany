import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_IDENTITY_RECONCILIATION_LIMITS,
  buildBookIdentityReconciliationRequest,
  validateBookIdentityMerges
} from '../book-analysis-identity-reconciliation.mjs'

function character(index, name) {
  const id = String(index).padStart(2, '0')
  return {
    entityKey: `character:${id}`,
    entityKind: 'character',
    canonicalName: name,
    aliases: [],
    resolutionStatus: 'confirmed',
    confidence: 0.9,
    evidenceIds: [`evidence:${id}`],
    data: { observationCount: 1 }
  }
}

function observation(index, candidate, fact = `${candidate} appears`) {
  const id = String(index).padStart(2, '0')
  return {
    id: `evidence:${id}`,
    type: 'character_mention',
    entityCandidate: candidate,
    relatedEntityCandidates: [],
    fact,
    evidence: {
      quote: `${candidate} appears in the room.`,
      startOffset: index * 100,
      endOffset: index * 100 + candidate.length + 21
    }
  }
}

function requestFor(entities, observations) {
  return buildBookIdentityReconciliationRequest({
    runId: 'run-1',
    bookEditionId: 'book-1',
    pipelineVersion: 'book-analysis-v25',
    reconciliationVersion: 'character-identity-v6',
    observationSetHash: 'a'.repeat(64),
    title: 'Book',
    author: 'Author',
    entities,
    observations
  })
}

test('identity reconciliation request is bounded, stable and exposes relationship guards', () => {
  const alice = character(1, 'Alice')
  const aliceSmith = character(2, 'Alice Smith')
  const jane = character(3, 'Jane')
  const relationship = {
    entityKey: 'relationship:01',
    entityKind: 'relationship',
    canonicalName: 'Alice speaks to Lizzy',
    aliases: [],
    resolutionStatus: 'confirmed',
    confidence: 0.9,
    evidenceIds: ['relationship:evidence'],
    data: { relatedCharacterEntityKeys: [alice.entityKey, jane.entityKey] }
  }
  const observations = [
    observation(1, 'Alice'), observation(2, 'Alice Smith'), observation(3, 'Jane')
  ]
  const first = requestFor([relationship, jane, aliceSmith, alice], [...observations].reverse())
  const second = requestFor([alice, aliceSmith, jane, relationship], observations)
  assert.deepEqual(first, second)
  assert.deepEqual(first.forbiddenPairs, [{
    leftEntityKey: 'character:01',
    rightEntityKey: 'character:03',
    reason: 'relationship_participants'
  }])
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <=
    BOOK_IDENTITY_RECONCILIATION_LIMITS.maxRequestBytes)
})

test('identity reconciliation accepts grounded edges and blocks unknown or forbidden merges', () => {
  const alice = character(1, 'Elizabeth')
  const lizzy = character(2, 'Lizzy')
  const jane = character(3, 'Jane')
  const relationship = {
    entityKey: 'relationship:01',
    entityKind: 'relationship',
    canonicalName: 'Elizabeth and Jane are sisters',
    aliases: [],
    resolutionStatus: 'confirmed',
    confidence: 0.9,
    evidenceIds: ['relationship:evidence'],
    data: { relatedCharacterEntityKeys: [alice.entityKey, jane.entityKey] }
  }
  const aliasObservation = {
    ...observation(4, 'Elizabeth'),
    type: 'character_alias',
    relatedEntityCandidates: ['Lizzy']
  }
  const request = requestFor(
    [alice, lizzy, jane, relationship],
    [
      observation(1, 'Elizabeth'), observation(2, 'Lizzy'), observation(3, 'Jane'),
      aliasObservation
    ]
  )
  assert.ok(request.candidatePairs.some(({ leftEntityKey, rightEntityKey }) =>
    new Set([leftEntityKey, rightEntityKey]).has(alice.entityKey) &&
    new Set([leftEntityKey, rightEntityKey]).has(lizzy.entityKey)
  ))
  const result = validateBookIdentityMerges({
    request,
    proposedMerges: [
      {
        leftEntityKey: alice.entityKey,
        rightEntityKey: lizzy.entityKey,
        basis: 'nickname',
        evidenceIds: ['evidence:01', 'evidence:02']
      },
      {
        leftEntityKey: lizzy.entityKey,
        rightEntityKey: jane.entityKey,
        basis: 'name_variant',
        evidenceIds: ['evidence:02', 'evidence:03']
      },
      {
        leftEntityKey: alice.entityKey,
        rightEntityKey: 'character:unknown',
        basis: 'name_variant',
        evidenceIds: ['evidence:01']
      }
    ]
  })
  assert.deepEqual(result, [{
    leftEntityKey: alice.entityKey,
    rightEntityKey: lizzy.entityKey,
    basis: 'nickname',
    evidenceIds: ['evidence:01', 'evidence:02']
  }])
})

test('identity reconciliation forbids incompatible genders before generation', () => {
  const colonel = character(1, 'Colonel Forster')
  const wife = character(2, 'Mrs. Forster')
  const alice = character(3, 'Alice')
  const aliceSmith = character(4, 'Alice Smith')
  const observations = [
    observation(1, 'Colonel Forster', 'male'),
    observation(2, 'Mrs. Forster', 'female'),
    observation(3, 'Alice'),
    observation(4, 'Alice Smith')
  ]
  const request = requestFor([colonel, wife, alice, aliceSmith], observations)
  assert.ok(request)
  assert.ok(request.forbiddenPairs.some(({ leftEntityKey, rightEntityKey, reason }) =>
    new Set([leftEntityKey, rightEntityKey]).has(colonel.entityKey) &&
    new Set([leftEntityKey, rightEntityKey]).has(wife.entityKey) &&
    reason === 'gender_conflict'
  ))
  assert.equal(request.candidatePairs.some(({ leftEntityKey, rightEntityKey }) =>
    new Set([leftEntityKey, rightEntityKey]).has(colonel.entityKey) &&
    new Set([leftEntityKey, rightEntityKey]).has(wife.entityKey)
  ), false)
  assert.deepEqual(validateBookIdentityMerges({
    request,
    proposedMerges: [{
      leftEntityKey: colonel.entityKey,
      rightEntityKey: wife.entityKey,
      basis: 'married_name',
      evidenceIds: ['evidence:01', 'evidence:02']
    }]
  }), [])
})

test('identity reconciliation safely skips rosters above the hard limit', () => {
  const count = BOOK_IDENTITY_RECONCILIATION_LIMITS.maxCharacterEntities + 1
  const entities = Array.from({ length: count }, (_, index) => character(index + 1, `Name ${index}`))
  const observations = Array.from(
    { length: count },
    (_, index) => observation(index + 1, `Name ${index}`)
  )
  assert.equal(requestFor(entities, observations), null)
})
