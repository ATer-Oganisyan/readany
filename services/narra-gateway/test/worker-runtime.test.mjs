import assert from 'node:assert/strict'
import test from 'node:test'
import { CANONICAL_STAGES, parseAnalysisStages } from '../book-analysis-worker.mjs'
import { runWorkerLoop } from '../worker-runtime.mjs'

function silentLog() {
  const events = []
  const push = (event, message, fields) => events.push({ event, message, fields })
  return { events, info: push, warn: push, error: push }
}

test('an unset stage list selects the whole canonical pipeline', () => {
  assert.deepEqual(parseAnalysisStages(undefined), CANONICAL_STAGES)
  assert.deepEqual(parseAnalysisStages(''), CANONICAL_STAGES)
  assert.deepEqual(parseAnalysisStages('all'), CANONICAL_STAGES)
})

test('selected stages keep pipeline order regardless of argument order', () => {
  assert.deepEqual(parseAnalysisStages('publish,scan'), ['scan', 'publish'])
  assert.deepEqual(parseAnalysisStages('validate synthesize'), ['synthesize', 'validate'])
  assert.deepEqual(parseAnalysisStages('scan,scan'), ['scan'])
})

test('the external pipeline is selectable but never part of the canonical default', () => {
  assert.deepEqual(parseAnalysisStages('external'), ['external'])
  assert.ok(!CANONICAL_STAGES.includes('external'))
})

test('an unknown stage fails fast instead of silently idling', () => {
  assert.throws(() => parseAnalysisStages('publsh'), /unsupported analysis stage: publsh/)
})

test('the loop polls every slot and sleeps only when all of them are idle', async () => {
  const controller = new AbortController()
  const calls = []
  let remaining = 2
  const slot = (name, results) => ({
    name,
    workerId: name,
    worker: {
      async runOnce() {
        calls.push(name)
        return results.shift() ?? { status: 'idle' }
      }
    }
  })
  const slots = [
    slot('scan', [{ status: 'completed' }]),
    slot('publish', [{ status: 'completed' }])
  ]
  const log = silentLog()
  // Прерываемся на первом простое: к этому моменту оба слота уже опрошены.
  const originalInfo = log.info
  log.info = (...args) => {
    originalInfo(...args)
    if (--remaining <= 0) controller.abort()
  }
  await runWorkerLoop({
    slots,
    pollMs: 1,
    idleLogMs: 1,
    log,
    signal: controller.signal,
    workerId: 'test'
  })
  assert.deepEqual(calls.slice(0, 4), ['scan', 'publish', 'scan', 'publish'])
})

test('a failing slot is logged and does not stop the other stages', async () => {
  const controller = new AbortController()
  const seen = []
  const slots = [
    {
      name: 'scan',
      workerId: 'scan',
      worker: {
        async runOnce() {
          const error = new Error('queue down')
          error.code = 'ECONNREFUSED'
          throw error
        }
      }
    },
    {
      name: 'publish',
      workerId: 'publish',
      worker: {
        async runOnce() {
          seen.push('publish')
          controller.abort()
          return { status: 'idle' }
        }
      }
    }
  ]
  const log = silentLog()
  await runWorkerLoop({
    slots,
    pollMs: 1,
    idleLogMs: 0,
    log,
    signal: controller.signal,
    workerId: 'test'
  })
  assert.deepEqual(seen, ['publish'])
  const failure = log.events.find((entry) => entry.event === 'worker.queue_unavailable')
  assert.equal(failure.fields.stage, 'scan')
  assert.equal(failure.fields.error_code, 'ECONNREFUSED')
})

test('the loop refuses to start without a worker slot', async () => {
  await assert.rejects(
    () => runWorkerLoop({ slots: [], pollMs: 1, log: silentLog(), signal: new AbortController().signal }),
    /at least one worker slot is required/
  )
})
