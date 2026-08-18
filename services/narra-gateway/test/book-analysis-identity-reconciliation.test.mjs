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

test('identity reconciliation offers a near-spelling name only for adjudication', () => {
  const sybil = character(1, 'Sybil')
  const sibyl = character(2, 'Sibyl Vane')
  const request = requestFor(
    [sybil, sibyl],
    [observation(1, 'Sybil'), observation(2, 'Sibyl Vane')]
  )
  assert.deepEqual(request.candidatePairs, [{
    leftEntityKey: sybil.entityKey,
    rightEntityKey: sibyl.entityKey,
    signals: ['near_spelling_given_name']
  }])
})

test('identity reconciliation prioritizes letter and signature evidence', () => {
  const signer = character(1, 'M. Vale')
  signer.evidenceIds = ['evidence:01', 'evidence:03']
  const titled = character(2, 'Mrs. Vale')
  titled.evidenceIds = ['evidence:02', 'evidence:04']
  const observations = [
    observation(1, 'M. Vale', 'M. Vale discusses Alice and Jane.'),
    observation(2, 'Mrs. Vale', 'Mrs. Vale appears with Alice.'),
    {
      ...observation(3, 'M. Vale', 'M. Vale is the signer of the letter.'),
      evidence: {
        quote: 'Yours sincerely, M. VALE.', startOffset: 300, endOffset: 325
      }
    },
    {
      ...observation(4, 'Mrs. Vale', 'Alice has not answered Mrs. Vale\'s long letter.'),
      evidence: {
        quote: "Alice had not answered Mrs. Vale's long letter.",
        startOffset: 400,
        endOffset: 448
      }
    }
  ]
  const request = requestFor([signer, titled], observations)
  const byName = new Map(request.roster.map((item) => [item.names[0], item]))
  assert.equal(byName.get('M. Vale').evidence[0].id, 'evidence:03')
  assert.equal(byName.get('Mrs. Vale').evidence[0].id, 'evidence:04')
})

test('identity reconciliation offers a direct descriptor self-reference as persona only', () => {
  const voice = character(1, 'the Voice')
  const griffin = character(2, 'Griffin')
  griffin.aliases = ['The Invisible Man']
  const observations = [
    {
      ...observation(1, 'the Voice', 'The Voice identifies itself and asks Marvel to help it.'),
      evidence: {
        quote: "said the Voice. I'm an invisible man. You have to be my helper.",
        startOffset: 100,
        endOffset: 163
      }
    },
    observation(2, 'Griffin')
  ]
  const request = requestFor([voice, griffin], observations)
  assert.deepEqual(request.candidatePairs, [{
    leftEntityKey: voice.entityKey,
    rightEntityKey: griffin.entityKey,
    signals: ['persona_self_reference']
  }])
})

test('identity reconciliation bounds an oversized roster to candidate-pair participants', () => {
  const count = BOOK_IDENTITY_RECONCILIATION_LIMITS.maxCharacterEntities + 1
  const entities = Array.from({ length: count }, (_, index) => character(index + 1, `Name ${index}`))
  const observations = Array.from(
    { length: count },
    (_, index) => observation(index + 1, `Name ${index}`)
  )
  const request = requestFor(entities, observations)
  assert.ok(request)
  assert.ok(request.roster.length <= BOOK_IDENTITY_RECONCILIATION_LIMITS.maxCharacterEntities)
  const rosterKeys = new Set(request.roster.map(({ entityKey }) => entityKey))
  assert.ok(request.candidatePairs.every(({ leftEntityKey, rightEntityKey }) =>
    rosterKeys.has(leftEntityKey) && rosterKeys.has(rightEntityKey)
  ))
})

test('identity reconciliation skips an oversized roster without candidate pairs', () => {
  const count = BOOK_IDENTITY_RECONCILIATION_LIMITS.maxCharacterEntities + 1
  const entities = Array.from({ length: count }, (_, index) =>
    character(index + 1, `Person${String(index).padStart(3, '0').split('').map((value) =>
      value.repeat(4)
    ).join('')}`)
  )
  const observations = Array.from(
    { length: count },
    (_, index) => observation(
      index + 1,
      `Person${String(index).padStart(3, '0').split('').map((value) => value.repeat(4)).join('')}`
    )
  )
  assert.equal(requestFor(entities, observations), null)
})
