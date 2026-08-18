import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadFrozenIdentityInput,
  parseBookIdentityReplayArgs,
  replayBookIdentity,
  scopeFrozenIdentityInput,
  summarizeAppliedIdentityMerges
} from '../book-analysis-identity-replay.mjs'

const RUN_ID = '7cd33c59-cde5-4c1a-a610-83f09fd61acf'
const SNAPSHOT_ID = '335177b3-ae1d-45b2-b6b2-d8c584678bae'
const BOOK_ID = '52f7054a-d32a-4f1b-8bc8-ce088717659b'
const OBSERVATION_HASH = '8ab8d9d718472c0a33051dd79629251e528acefb63818f6104fa42910823a2d0'

function observation(index, candidate) {
  return {
    id: `evidence:${index}`,
    observationKey: `observation:${index}`,
    type: 'character_mention',
    entityKind: 'character',
    entityCandidate: candidate,
    relatedEntityCandidates: [],
    fact: `${candidate} appears.`,
    evidence: {
      quote: `${candidate} appears in the room.`,
      startOffset: index * 100,
      endOffset: index * 100 + candidate.length + 21,
      chapterKey: 'chapter-1'
    },
    confidence: 0.99,
    data: {}
  }
}

function entity(key, name, evidenceIds) {
  return {
    entityKey: key,
    entityKind: 'character',
    canonicalName: name,
    aliases: [],
    resolutionStatus: 'confirmed',
    confidence: 0.99,
    evidenceIds,
    data: { observationCount: evidenceIds.length }
  }
}

test('identity replay CLI requires an exact run and frozen observation hash', () => {
  assert.deepEqual(parseBookIdentityReplayArgs([
    '--run-id', RUN_ID,
    '--expected-observation-set-hash', OBSERVATION_HASH
  ]), {
    help: false,
    runId: RUN_ID,
    expectedObservationSetHash: OBSERVATION_HASH,
    generate: false,
    fixturePath: null,
    requirePass: false,
    pretty: false,
    scope: null
  })
  assert.throws(
    () => parseBookIdentityReplayArgs(['--run-id', RUN_ID]),
    (error) => error.code === 'INVALID_ARGUMENT' &&
      error.message.includes('--expected-observation-set-hash')
  )
})

test('identity replay CLI keeps frozen scoring opt-in and requires a fixture for the gate', () => {
  const common = [
    '--run-id', RUN_ID,
    '--expected-observation-set-hash', OBSERVATION_HASH
  ]
  assert.deepEqual(parseBookIdentityReplayArgs([
    ...common,
    '--fixture', 'evaluation/identity/example.json',
    '--require-pass',
    '--pretty'
  ]), {
    help: false,
    runId: RUN_ID,
    expectedObservationSetHash: OBSERVATION_HASH,
    generate: false,
    fixturePath: 'evaluation/identity/example.json',
    requirePass: true,
    pretty: true,
    scope: null
  })
  assert.throws(
    () => parseBookIdentityReplayArgs([...common, '--require-pass']),
    { code: 'INVALID_ARGUMENT', message: '--require-pass requires --fixture' }
  )
})

test('identity replay scopes frozen observations only for deterministic evaluation', () => {
  const common = [
    '--run-id', RUN_ID,
    '--expected-observation-set-hash', OBSERVATION_HASH,
    '--start-offset', '100',
    '--end-offset', '200'
  ]
  assert.deepEqual(parseBookIdentityReplayArgs(common).scope, {
    startOffset: 100,
    endOffset: 200
  })
  assert.throws(
    () => parseBookIdentityReplayArgs([...common, '--generate']),
    { code: 'INVALID_ARGUMENT', message: 'offset-scoped replay cannot use --generate' }
  )
  const input = { observations: [
    observation(1, 'Jane Doe'),
    observation(2, 'John Doe'),
    observation(3, 'Mary Doe')
  ] }
  const scoped = scopeFrozenIdentityInput(input, { startOffset: 100, endOffset: 200 })
  assert.equal(scoped.observations.length, 1)
  assert.equal(scoped.observations[0].entityCandidate, 'Jane Doe')
  assert.equal(scoped.evaluationScope.sourceObservationCount, 3)
})

test('frozen input loader uses a read-only transaction and rejects hash drift', async () => {
  const calls = []
  const client = {
    async query(sql) {
      calls.push(sql)
      if (sql.includes('SELECT run.id AS run_id')) {
        return { rows: [{
          run_id: RUN_ID,
          observation_set_hash: 'f'.repeat(64),
          observation_ids: ['00000000-0000-4000-8000-000000000001']
        }] }
      }
      return { rows: [] }
    },
    release() {}
  }
  const pool = { async connect() { return client } }
  await assert.rejects(
    loadFrozenIdentityInput(pool, {
      runId: RUN_ID,
      expectedObservationSetHash: OBSERVATION_HASH
    }),
    (error) => error.code === 'OBSERVATION_SET_HASH_MISMATCH'
  )
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls.at(-1), 'ROLLBACK')
  assert.equal(calls.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/iu.test(sql)), false)
})

test('identity replay without generation emits a stable compact resolver roster', async () => {
  const input = {
    runId: RUN_ID,
    bookEditionId: BOOK_ID,
    sourcePipelineVersion: 'book-analysis-v22',
    promptVersion: 'book-scan-v14',
    title: 'Test book',
    author: 'Test author',
    snapshotId: SNAPSHOT_ID,
    snapshotVersion: 1,
    observationSetHash: OBSERVATION_HASH,
    observations: [observation(1, 'Jane Doe'), observation(2, 'John Doe')]
  }
  const first = await replayBookIdentity({ input })
  const second = await replayBookIdentity({ input })
  assert.deepEqual(first, second)
  assert.equal(first.reconciliation.generated, false)
  assert.equal(first.reconciliation.proposedCount, 0)
  assert.equal(first.reconciliation.workerAcceptedCount, 0)
  assert.equal(first.provisional.characterCount, 2)
  assert.equal(first.final.characterCount, 2)
  assert.deepEqual(first.final.roster.map(({ canonicalName }) => canonicalName), [
    'Jane Doe', 'John Doe'
  ])
  assert.ok(first.provisional.roster.every(({ evidence }) => evidence.length === 1))
})

test('identity replay reports a worker-accepted merge blocked by resolver safety', async () => {
  const input = {
    runId: RUN_ID,
    bookEditionId: BOOK_ID,
    sourcePipelineVersion: 'book-analysis-v22',
    promptVersion: 'book-scan-v14',
    title: 'Test book',
    author: 'Test author',
    snapshotId: SNAPSHOT_ID,
    snapshotVersion: 1,
    observationSetHash: OBSERVATION_HASH,
    observations: [observation(1, 'Jane Doe'), observation(2, 'John Doe')]
  }
  const generator = {
    async reconcileBookCharacterIdentities(request) {
      const [pair] = request.candidatePairs
      const left = request.roster.find(({ entityKey }) => entityKey === pair.leftEntityKey)
      const right = request.roster.find(({ entityKey }) => entityKey === pair.rightEntityKey)
      return { merges: [{
        ...pair,
        basis: 'name_variant',
        evidenceIds: [left.evidence[0].id, right.evidence[0].id]
      }] }
    }
  }
  const result = await replayBookIdentity({ input, generator })
  assert.equal(result.reconciliation.proposedCount, 1)
  assert.equal(result.reconciliation.workerAcceptedCount, 1)
  assert.equal(result.reconciliation.appliedCount, 0)
  assert.equal(result.reconciliation.blockedCount, 1)
  assert.equal(result.reconciliation.pairs[0].status, 'blocked')
  assert.equal(result.final.characterCount, 2)
})

test('applied merge summary distinguishes resolver guards from worker acceptance', () => {
  const provisional = [
    entity('character:1', 'Jane', ['evidence:1']),
    entity('character:2', 'Jane Bennet', ['evidence:2']),
    entity('character:3', 'Elizabeth Bennet', ['evidence:3'])
  ]
  const final = [
    entity('character:12', 'Jane', ['evidence:1', 'evidence:2']),
    entity('character:3', 'Elizabeth Bennet', ['evidence:3'])
  ]
  const result = summarizeAppliedIdentityMerges({
    provisional,
    final,
    acceptedMerges: [
      {
        leftEntityKey: 'character:1',
        rightEntityKey: 'character:2',
        basis: 'name_variant',
        evidenceIds: ['evidence:1', 'evidence:2']
      },
      {
        leftEntityKey: 'character:2',
        rightEntityKey: 'character:3',
        basis: 'name_variant',
        evidenceIds: ['evidence:2', 'evidence:3']
      }
    ]
  })
  assert.deepEqual(result.map(({ applied }) => applied), [true, false])
})
