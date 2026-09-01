import assert from 'node:assert/strict'
import test from 'node:test'
import { createBestEffortGenerationCostRecorder } from '../generation-cost-recorder.mjs'

test('cost recording is skipped when context is absent', async () => {
  let calls = 0
  const record = createBestEffortGenerationCostRecorder({
    getLedger: () => ({ async record() { calls += 1 } })
  })

  assert.deepEqual(await record({ requestId: 'request-1' }), {
    recorded: 0,
    skipped: 'context_missing'
  })
  assert.equal(calls, 0)
})

test('cost ledger failures never fail the generation request', async () => {
  const warnings = []
  const record = createBestEffortGenerationCostRecorder({
    getLedger: () => ({
      async record() {
        throw Object.assign(new Error('database is unavailable'), { code: 'NETWORK' })
      }
    }),
    logger: { warn(message, fields) { warnings.push({ message, fields }) } }
  })

  assert.deepEqual(await record({ context: { operation: 'test' }, requestId: 'request-2' }), {
    recorded: 0,
    skipped: 'record_failed'
  })
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].fields.error_code, 'NETWORK')
})

test('successful cost records are returned unchanged', async () => {
  const record = createBestEffortGenerationCostRecorder({
    getLedger: () => ({ async record() { return { recorded: 2 } } })
  })

  assert.deepEqual(await record({ context: { operation: 'test' } }), { recorded: 2 })
})
