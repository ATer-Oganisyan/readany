import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createWorkloadConcurrencyGate } from '../workload-concurrency.mjs'
import { createConcurrencyGate } from '../concurrency.mjs'
import { settleProviderResponse, validateChatCompletionPayload } from '../provider-response.mjs'
import { readBoundedBody } from '../safe-fetch.mjs'
import { createBestEffortGenerationCostRecorder } from '../generation-cost-recorder.mjs'

const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')
const start = source.indexOf('async function completeInternalChat(')
const end = source.indexOf('\nasync function generateInternalPortrait(', start)
assert.ok(start >= 0 && end > start)
const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

for (const mode of ['success', 'parse-error', 'request-error']) {
  test(`provider permit is released before hung accounting: ${mode}`, { timeout: 2000 }, async () => {
    const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 2 })
    const lifecycleGate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'internal lifecycle' })
    const consumed = deferred(), finalize = deferred(), ledgerEntered = deferred(), ledgerDone = deferred()
    const attempts = [{ attempt_id: randomUUID(), status: mode === 'success' ? 'completed' : 'failed' }]
    const upstreamError = Object.assign(new Error('fixture upstream error'), { attempts })
    let recordedInput, outcome = 'pending', releaseCount = 0, providerCalls = 0
    const acquire = gate.acquire.bind(gate)
    const observedGate = { acquire: async (...args) => {
      const release = await acquire(...args)
      return () => { releaseCount++; release() }
    } }
    const requestChat = async () => {
      providerCalls++
      if (mode === 'request-error') {
        consumed.resolve()
        await finalize.promise
        throw upstreamError
      }
      return {
        attempts,
        response: new Response(mode === 'parse-error' ? 'invalid json' : JSON.stringify({
          choices: [{ message: { content: 'fixture result' } }], usage: { total_tokens: 7 }
        })),
        finalizeAttempt: async () => { consumed.resolve(); await finalize.promise }
      }
    }
    const record = createBestEffortGenerationCostRecorder({
      getLedger: () => ({ record: async input => {
        recordedInput = input
        ledgerEntered.resolve()
        await ledgerDone.promise
        return { recorded: 1 }
      } })
    })
    // Execute the actual method without importing index (which starts a server).
    const execute = new Function('internalChatLifecycleGate', 'llmGate', 'randomUUID', 'requestChat', 'recordProviderAttemptMetric',
      'settleProviderResponse', 'readBoundedBody', 'LLM_RESPONSE_MAX_BYTES',
      'validateChatCompletionPayload', 'recordInternalGenerationCost',
      `${source.slice(start, end)}; return completeInternalChat;`)(lifecycleGate, observedGate, randomUUID,
      requestChat, () => {}, settleProviderResponse, readBoundedBody, 4096, validateChatCompletionPayload, record)
    const controller = new AbortController()
    const active = execute({ messages: [], signal: controller.signal, costContext: { operation: 'fixture' } })
      .then(value => { outcome = 'resolved'; return value }, error => { outcome = 'rejected'; return error })
    let waiter
    try {
      await consumed.promise
      assert.equal(gate.status().active, 1, 'consumption/finalization still owns the permit')
      waiter = gate.acquire().then(release => release())
      assert.equal(gate.status().waiting, 1)
      finalize.resolve()
      await ledgerEntered.promise
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(gate.status().waiting, 0, 'next provider request must be admitted despite hung ledger')
      assert.equal(gate.status().active, 0)
      assert.equal(releaseCount, 1)
      assert.equal(outcome, 'pending', 'accounting must remain awaited, not detached/skipped')
      controller.abort()
      assert.equal(outcome, 'pending')
      assert.deepEqual(recordedInput.attempts, attempts)
      assert.equal(lifecycleGate.status().active, 1, 'pending accounting retains lifecycle admission')
      await assert.rejects(execute({ messages: [] }), { code: 'RATE', status: 429 })
      assert.equal(providerCalls, 1, 'saturation must reject before another paid provider call')
      assert.equal(lifecycleGate.status().waiting, 0, 'lifecycle gate never queues')
    } finally {
      finalize.resolve()
      ledgerDone.resolve()
      await active
      await waiter
    }
    const result = await active
    assert.equal(releaseCount, 1)
    assert.equal(lifecycleGate.status().active, 0)
    // Both success and failure release admission, including rejected LLM admission.
    const admissionError = new Error('provider admission rejected')
    observedGate.acquire = async () => { throw admissionError }
    await assert.rejects(execute({ messages: [] }), error => error === admissionError)
    assert.equal(lifecycleGate.status().active, 0)
    assert.equal(providerCalls, 1)
    if (mode === 'success') assert.equal(result, 'fixture result')
    else if (mode === 'request-error') assert.equal(result, upstreamError)
    else assert.equal(result.code, 'PARSE')
  })
}
