import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookAnalysisSynthesizeWorker } from '../book-analysis-synthesize-worker.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function runPendingInputScenario(t, renewalError) {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const inputRequested = deferred()
  const pendingInput = deferred()
  const calls = { renew: 0, generate: 0, commit: 0 }
  const job = {
    id: 'own-job', runId: 'own-run', stage: 'synthesize',
    shardKey: 'character:anna', leaseToken: '11111111-1111-4111-8111-111111111111'
  }
  const worker = createBookAnalysisSynthesizeWorker({
    workerId: 'old-worker', leaseSeconds: 30, leaseRenewMs: 1_000,
    logger: { info() {}, error() {} },
    repository: {
      async claimAnalysisJob() { return job },
      getSynthesizeInput() {
        inputRequested.resolve()
        return pendingInput.promise
      },
      async renewAnalysisJobLease() { calls.renew++; throw renewalError },
      async completeCharacterSynthesis() {
        calls.commit++
        return { artifactId: 'own-artifact', stage: 'synthesize' }
      },
      async failAnalysisJob() {
        // A reclaimed job cannot be failed by its previous owner either.
        throw Object.assign(new Error('replacement owns the job'), { code: 'LEASE_LOST' })
      }
    },
    generator: {
      async synthesizeCharacterProfile() {
        calls.generate++
        return { profile: { creative: {} } }
      }
    }
  })
  const settled = worker.runOnce().then(
    (result) => ({ result }), (error) => ({ error })
  )
  await inputRequested.promise
  t.mock.timers.tick(1_000)
  // Drain promise continuations from the asynchronous renewal rejection.
  for (let index = 0; index < 8; index++) await Promise.resolve()
  assert.equal(calls.renew, 1)
  pendingInput.resolve({
    mode: 'character_profile', runId: 'own-run', title: 'Своя книга', textLength: 20,
    snapshot: { id: 'own-snapshot' },
    entity: {
      entityKey: 'character:anna', entityKind: 'character', canonicalName: 'Анна',
      aliases: [], resolutionStatus: 'confirmed', confidence: 1, data: {}
    },
    observations: [{
      id: 'own-observation', type: 'character_action', fact: 'Анна читала.',
      evidence: { quote: 'Анна читала.', startOffset: 0, endOffset: 12 }, confidence: 1
    }]
  })
  const outcome = await settled
  t.mock.timers.tick(5_000)
  assert.equal(calls.renew, 1, 'settled worker must remove its heartbeat')
  return { calls, outcome }
}

test('confirmed lease loss during pending input prevents generation and commit', async (t) => {
  const { calls, outcome } = await runPendingInputScenario(t,
    Object.assign(new Error('replacement owns the job'), { code: 'LEASE_LOST' }))
  assert.equal(calls.generate, 0, 'stale worker must not start a new model request')
  assert.equal(calls.commit, 0, 'stale worker must not attempt completion')
  assert.notEqual(outcome.result?.status, 'completed')
})

test('temporary renewal failure does not cancel healthy synthesis', async (t) => {
  const { calls, outcome } = await runPendingInputScenario(t,
    Object.assign(new Error('temporary connection failure'), { code: 'ECONNRESET' }))
  assert.equal(calls.generate, 1)
  assert.equal(calls.commit, 1)
  assert.equal(outcome.result?.status, 'completed')
  assert.equal(outcome.error, undefined)
})

for (const transportOutcome of ['late success', 'AbortError']) {
test(`lease loss aborts pending generation (${transportOutcome}) without failing the new owner`, async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const started = deferred()
  const generated = deferred()
  let signal
  let commits = 0
  let failures = 0
  const worker = createBookAnalysisSynthesizeWorker({
    workerId: 'old-worker', leaseSeconds: 30, leaseRenewMs: 1_000,
    logger: { info() {}, error() {} },
    repository: {
      async claimAnalysisJob() { return { id: 'own-job', runId: 'own-run' } },
      async getSynthesizeInput() {
        return {
          mode: 'character_profile', runId: 'own-run', snapshot: { id: 'own-snapshot' },
          entity: { entityKey: 'anna', aliases: [], data: {} }, observations: []
        }
      },
      async renewAnalysisJobLease() {
        throw Object.assign(new Error('lease replaced'), { code: 'LEASE_LOST' })
      },
      async completeCharacterSynthesis() { commits++; return {} },
      async failAnalysisJob() { failures++; return { status: 'queued' } }
    },
    generator: {
      synthesizeCharacterProfile(_input, options) {
        signal = options?.signal
        started.resolve()
        // Deliberately ignore cancellation: a late successful transport must not commit.
        return generated.promise
      }
    }
  })
  const run = worker.runOnce()
  await started.promise
  t.mock.timers.tick(1_000)
  for (let index = 0; index < 8; index++) await Promise.resolve()
  // Settle before assertions so a regression cannot leave this fixture pending.
  if (transportOutcome === 'AbortError') {
    generated.reject(new DOMException('The operation was aborted.', 'AbortError'))
  } else {
    generated.resolve({ profile: {} })
  }
  const result = await run
  assert.equal(signal?.aborted, true)
  assert.equal(signal.reason.code, 'LEASE_LOST')
  assert.equal(commits, 0)
  assert.equal(failures, 0)
  assert.equal(result.errorCode, 'LEASE_LOST')
})
}

test('a pending lease renewal does not overlap subsequent heartbeat ticks', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const inputStarted = deferred()
  const input = deferred()
  const renewal = deferred()
  let renewals = 0
  const worker = createBookAnalysisSynthesizeWorker({
    workerId: 'own-worker', leaseSeconds: 30, leaseRenewMs: 1_000,
    logger: { info() {}, error() {} },
    repository: {
      async claimAnalysisJob() { return { id: 'own-job', runId: 'own-run' } },
      getSynthesizeInput() { inputStarted.resolve(); return input.promise },
      renewAnalysisJobLease() { renewals++; return renewal.promise },
      async completeCharacterSynthesis() { return {} },
      async failAnalysisJob() { throw new Error('unexpected failure') }
    },
    generator: { async synthesizeCharacterProfile() { return { profile: {} } } }
  })
  const run = worker.runOnce()
  await inputStarted.promise
  t.mock.timers.tick(1_000)
  await Promise.resolve()
  t.mock.timers.tick(4_000)
  await Promise.resolve()
  const pendingRenewalCalls = renewals
  renewal.resolve()
  for (let index = 0; index < 8; index++) await Promise.resolve()
  t.mock.timers.tick(1_000)
  await Promise.resolve()
  input.resolve({
    mode: 'character_profile', runId: 'own-run', snapshot: { id: 'own-snapshot' },
    entity: { entityKey: 'anna', aliases: [], data: {} }, observations: []
  })
  await run
  assert.equal(pendingRenewalCalls, 1)
  assert.equal(renewals, 2, 'renewal resumes once the previous attempt settles')
  t.mock.timers.tick(5_000)
  await Promise.resolve()
  assert.equal(renewals, 2, 'worker removes heartbeat after completion')
})
