import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createWorkloadConcurrencyGate } from '../workload-concurrency.mjs'
import { settleProviderResponse } from '../provider-response.mjs'
import { createSseUsageCollector } from '../analytics-properties.mjs'
import { createSseFrameRelay } from '../sse-frame-relay.mjs'

const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')
const start = source.indexOf("app.post('/v2/ai/chat/stream',")
const end = source.indexOf('\n// --- Чат: обычный ответ', start)
assert.ok(start >= 0 && end > start)
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

for (const mode of ['success', 'error']) {
  test(`public stream releases provider capacity before stalled terminal analytics: ${mode}`, { timeout: 2000 }, async () => {
    const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 2 })
    let releaseCalls = 0
    const observedGate = {
      async acquire(...args) {
        const release = await gate.acquire(...args)
        return () => { releaseCalls++; release() }
      }
    }
    const finalizing = deferred(), finalized = deferred()
    const analyticsEntered = deferred(), analyticsDone = deferred()
    let handler, ended = false, admitted = false, terminalEvent
    const output = []
    const res = {
      headersSent: false,
      setHeader() {},
      write(chunk) { this.headersSent = true; output.push(String(chunk)) },
      end() { ended = true },
      status() { return this },
      json(value) { output.push(JSON.stringify(value)); ended = true }
    }
    const deps = {
      app: { post(_path, ...handlers) { handler = handlers.at(-1) } },
      aiLimit: null, aiDailyLimit: null, express: { json: () => null },
      requestAbortSignal: () => new AbortController().signal,
      parseChatBody: value => value,
      acquireWithDeadline: (target, signal, options) => target.acquire(signal, options),
      llmGate: observedGate, chatWorkload: () => 'interactive', LLM_QUEUE_TIMEOUT_MS: 1000,
      withChatCompliance: messages => messages, randomUUID: () => 'own-request',
      appendInternalEvent: async (_req, event) => {
        if (!['ai_request_completed', 'ai_request_failed'].includes(event)) return
        terminalEvent = event
        analyticsEntered.resolve()
        await analyticsDone.promise
      },
      requestChat: async () => ({
        provider: 'fixture', model: 'fixture',
        response: new Response(mode === 'success'
          ? 'data: {"choices":[{"delta":{"content":"Own fixture"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
          : 'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\ndata: {"choices":[{"finish_reason":"length"}]}\n\n'),
        finalizeAttempt: async () => { finalizing.resolve(); await finalized.promise }
      }),
      recordProviderAttemptMetric() {}, providerAttemptProperties: () => ({}),
      analyticsRoute: () => 'fixture', completionProperties: value => value,
      settleProviderResponse, createSseUsageCollector, createSseFrameRelay,
      LLM_RESPONSE_MAX_BYTES: 4096
    }
    new Function(...Object.keys(deps), source.slice(start, end))(...Object.values(deps))
    const active = handler({ body: { messages: [], purpose: 'character_chat', origin: 'user' } }, res)
    let waiter
    try {
      await finalizing.promise
      assert.equal(gate.status().active, 1, 'provider finalization still owns capacity')
      assert.equal(releaseCalls, 0)
      waiter = gate.acquire(undefined, { workload: 'interactive' }).then(release => { admitted = true; release() })
      assert.equal(gate.status().waiting, 1)
      finalized.resolve()
      await analyticsEntered.promise
      // Drain admission continuations, not wall-clock delays or polling.
      for (let index = 0; index < 8; index++) await Promise.resolve()
      assert.equal(terminalEvent, mode === 'success' ? 'ai_request_completed' : 'ai_request_failed')
      assert.equal(gate.status().active, 0, 'terminal analytics must not retain provider capacity')
      assert.equal(gate.status().waiting, 0)
      assert.equal(admitted, true, 'queued request must enter before terminal analytics settles')
      assert.equal(releaseCalls, 1)
      if (mode === 'success') assert.equal(ended, true)
    } finally {
      finalized.resolve()
      analyticsDone.resolve()
      await active
      await waiter
    }
    assert.equal(ended, true)
    if (mode === 'error') assert.ok(output.join('').includes('event: error'))
    assert.equal(gate.status().active, 0)
    assert.equal(releaseCalls, 1, 'finally must not call the underlying release twice')
  })
}
