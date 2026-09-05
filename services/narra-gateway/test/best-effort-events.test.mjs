import assert from 'node:assert/strict'
import test from 'node:test'
import { createBestEffortEventWriter } from '../best-effort-events.mjs'
import { requestChat } from '../providers.mjs'
import { createWorkloadConcurrencyGate } from '../workload-concurrency.mjs'

test('stuck analytics stays bounded after timeout and recovers after actual settlement', async () => {
  let finish
  let calls = 0
  const writer = createBestEffortEventWriter({ timeoutMs: 10, maxPending: 1,
    append: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  assert.equal(await writer.write([{ event: 'first' }]), 'timeout')
  assert.equal(writer.status().pending, 1)
  const results = await Promise.all(Array.from({ length: 100 }, () => writer.write([])))
  assert.ok(results.every(result => result === 'skipped'))
  assert.equal(calls, 1)
  finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(writer.status().pending, 0)
  assert.equal(writer.status().persisted, 1)
  assert.equal(writer.status().skipped, 100)
})

test('sync throws and late rejection are contained without blocking or unhandled rejection', async () => {
  const failed = createBestEffortEventWriter({ append: () => { throw new Error('private detail') } })
  assert.equal(await failed.write([]), 'failed')
  assert.equal(failed.status().pending, 0)
  let reject
  const late = createBestEffortEventWriter({ timeoutMs: 10,
    append: () => new Promise((_resolve, fail) => { reject = fail }) })
  assert.equal(await late.write([]), 'timeout')
  reject(new Error('late private detail'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(late.status().pending, 0)
  assert.equal(late.status().failed, 1)
})

test('actual provider can start and finalize with stuck analytics and release its workload slot', async () => {
  const writer = createBestEffortEventWriter({ timeoutMs: 10, maxPending: 1, append: () => new Promise(() => {}) })
  const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 1 })
  const release = await gate.acquire()
  let fetchCalls = 0
  try {
    const response = await requestChat({ messages: [{ role: 'user', content: 'Own fixture' }],
      purpose: 'structured_task', stream: false,
      env: { LLM_ROUTE_DEFAULT: 'litellm', LITELLM_BASE_URL: 'http://127.0.0.1:1', LITELLM_API_KEY: 'dummy', LITELLM_MODEL: 'fixture' },
      onAttempt: attempt => writer.write([attempt]),
      fetchImpl: async () => { fetchCalls++; return new Response('{"choices":[{"message":{"content":"ok"}}]}') }
    })
    await response.response.text()
    await response.finalizeAttempt()
  } finally { release() }
  assert.equal(fetchCalls, 1)
  assert.equal(gate.status().active, 0)
  assert.equal(writer.status().pending, 1)
  assert.equal(writer.status().skipped, 1)
})

test('successful writes preserve exact batches; configuration fails closed', async () => {
  const batch = [{ event: 'example' }]
  const writer = createBestEffortEventWriter({ append: async events => assert.equal(events, batch) })
  assert.equal(await writer.write(batch), 'persisted')
  assert.deepEqual(writer.status(), { pending: 0, persisted: 1, failed: 0, timeout: 0, skipped: 0 })
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: NaN }, { maxPending: 0 }, { maxPending: 1.5 }]) {
    assert.throws(() => createBestEffortEventWriter({ append: async () => {}, ...options }))
  }
})
