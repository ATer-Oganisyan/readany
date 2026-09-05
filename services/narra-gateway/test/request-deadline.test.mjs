import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter, getEventListeners } from 'node:events'
import { createDeadlineSignal, acquireWithDeadline, requestAbortSignal } from '../concurrency.mjs'
import { createWorkloadConcurrencyGate } from '../workload-concurrency.mjs'
import { parseEnvInt } from '../env.mjs'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('deadline returns typed 504 and removes parent listener', async () => {
  const parent = new AbortController()
  const scope = createDeadlineSignal(parent.signal, 10)
  assert.equal(getEventListeners(parent.signal, 'abort').length, 1)
  await delay(25)
  assert.equal(scope.signal.reason.code, 'TIMEOUT')
  assert.equal(scope.signal.reason.status, 504)
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0)
  scope.dispose()
})

test('disposed deadline cannot cancel completed/admitted work later', async () => {
  const parent = new AbortController()
  const scope = createDeadlineSignal(parent.signal, 10)
  scope.dispose(); scope.dispose(); parent.abort()
  await delay(25)
  assert.equal(scope.signal.aborted, false)
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0)
  const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 2 })
  const control = new AbortController()
  const release = await acquireWithDeadline(gate, control.signal, { workload: 'background' }, 10)
  assert.equal(getEventListeners(control.signal, 'abort').length, 0)
  await delay(25)
  assert.equal(gate.status().active, 1)
  release(); assert.equal(gate.status().active, 0)
})

test('pre-aborted request never enters gate and preserves cancellation reason', async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 2 })
  const parent = new AbortController(); const reason = new Error('fixture disconnected'); parent.abort(reason)
  await assert.rejects(acquireWithDeadline(gate, parent.signal, {}, 10), error => error === reason)
  assert.equal(gate.status().active, 0); assert.equal(gate.status().waiting, 0)
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0)
})

test('request completion removes listeners without treating normal close as cancellation', () => {
  const req = new EventEmitter(); const res = new EventEmitter()
  const signal = requestAbortSignal(req, res)
  res.writableEnded = true; res.emit('finish'); res.emit('close')
  assert.equal(signal.aborted, false)
  assert.equal(req.listenerCount('aborted'), 0)
  assert.equal(res.listenerCount('close'), 0)
  assert.equal(res.listenerCount('finish'), 0)
})

test('early request abort disposes all HTTP listeners', () => {
  const req = new EventEmitter(); const res = new EventEmitter()
  const signal = requestAbortSignal(req, res)
  req.emit('aborted')
  assert.equal(signal.aborted, true)
  assert.equal(req.listenerCount('aborted'), 0)
  assert.equal(res.listenerCount('close'), 0)
  assert.equal(res.listenerCount('finish'), 0)
})

test('queue SLA configuration rejects invalid and out-of-range values', () => {
  assert.equal(parseEnvInt({}, 'LLM_QUEUE_TIMEOUT_MS', 30000, 120000), 30000)
  for (const value of ['0', '-1', '1.5', '120001', 'NaN']) {
    assert.throws(() => parseEnvInt({ LLM_QUEUE_TIMEOUT_MS: value }, 'LLM_QUEUE_TIMEOUT_MS', 30000, 120000), /between 1 and 120000/)
  }
})
