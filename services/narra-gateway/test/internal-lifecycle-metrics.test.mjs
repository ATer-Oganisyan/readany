import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import express from 'express'
import { requireOperatorAuth } from '../security.mjs'
import { createConcurrencyGate } from '../concurrency.mjs'
import { createWorkloadConcurrencyGate } from '../workload-concurrency.mjs'
import { settleProviderResponse, validateChatCompletionPayload } from '../provider-response.mjs'
import { readBoundedBody } from '../safe-fetch.mjs'

const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('operator-only lifecycle counters follow awaited accounting and sample after slow metrics SQL', { timeout: 5000 }, async () => {
  const app = express()
  const token = randomUUID()
  const lifecycle = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'lifecycle' })
  const llm = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 1 })
  const idle = createConcurrencyGate({ limit: 1, queueLimit: 0 })
  const entered = deferred(), ledger = deferred(), snapshotEntered = deferred(), snapshotDone = deferred()
  let providerCalls = 0, records = 0, holdSnapshot = false, snapshots = 0
  const repository = { snapshot: async () => {
    snapshots++
    if (holdSnapshot) { snapshotEntered.resolve(); await snapshotDone.promise }
    return { fixture: true }
  } }
  const dependencies = {
    app, requireOperatorAuth, INSTALLATION_OPERATOR_TOKEN: token, operationalMetricsRepository: repository,
    operationalRuntimeMetrics: () => ({}), llmGate: llm, speechGate: idle, imageGate: idle, coverGate: idle, importGate: idle,
    internalChatLifecycleGate: { acquire: lifecycle.acquire, status: () => ({ ...lifecycle.status(), privateRequestId: 'MUST_NOT_ESCAPE' }) },
    BUILD_VERSION: 'fixture', randomUUID, recordProviderAttemptMetric: () => {},
    requestChat: async () => { providerCalls++; return { response: new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })), finalizeAttempt: async () => {}, attempts: [] } },
    settleProviderResponse, readBoundedBody, LLM_RESPONSE_MAX_BYTES: 4096, validateChatCompletionPayload,
    recordInternalGenerationCost: async () => { entered.resolve(); await ledger.promise; records++ },
    llmRouteReadiness: () => ({ ready: true, purposes: {} }), LLM_API_KEY: '', KANDINSKY_TOKEN: '', ANALYTICS_ENV: 'test',
    SALUTE_KEY: '', SBER_CA_VERIFIED: false, bookMarkupRepository: null, bookObjectStorage: null,
    internalGenerationService: null, BOOK_BACKEND_REQUIRED: false, TEXT_LLM_TRANSPORT_SECURE: true,
    LITELLM_TRANSPORT_SECURE: true, ALLOW_INSECURE_LLM_HTTP: false, LLM_BASE_URL: '', LLM_TRANSPORT_SECURE: true,
    LITELLM_BASE_URL: '', VIDEO_BASE_URL: '', VIDEO_TRANSPORT_SECURE: true, ALLOW_INSECURE_VIDEO_HTTP: false,
    BOOK_ANALYSIS_SCAN_POLICY: {}, eventStore: { status: () => ({}) }, installationRegistry: { status: () => ({}) },
    coverJobStore: { status: () => ({}) }, coverJobRunner: { status: () => ({}) }, sceneJobStore: { status: () => ({}) }, sceneJobRunner: { status: () => ({}) }
  }
  const code = section('async function completeInternalChat(', '\nasync function generateInternalPortrait(') +
    section("app.get('/health'", "app.get('/ready'") +
    section('const operatorAuth = requireOperatorAuth(', "app.get('/v2/admin/installations/") + ';return completeInternalChat'
  const execute = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  const headers = { authorization: `Bearer ${token}` }
  let active
  try {
    const unauthorized = await fetch(`${url}/v2/admin/metrics`)
    assert.equal(unauthorized.status, 401); assert.equal(snapshots, 0)
    const wrongToken = await fetch(`${url}/v2/admin/metrics`, { headers: { authorization: 'Bearer wrong-fixture-token' } })
    assert.equal(wrongToken.status, 401); assert.equal(snapshots, 0)
    active = execute({ messages: [] }); await entered.promise
    assert.equal(llm.status().active, 0)
    const response = await fetch(`${url}/v2/admin/metrics`, { headers })
    assert.equal(response.status, 200)
    const metrics = await response.json()
    assert.deepEqual(metrics.internalChatLifecycle, { active: 1, waiting: 0, limit: 1, queue_limit: 0 })
    assert.ok(!JSON.stringify(metrics).includes('MUST_NOT_ESCAPE'))
    const health = await (await fetch(`${url}/health`)).json()
    assert.equal(health.concurrency.llm.active, 0)
    assert.deepEqual(Object.keys(health.concurrency).sort(), ['cover', 'image', 'import', 'llm', 'speech'])
    assert.ok(!Object.hasOwn(health, 'internalChatLifecycle'))
    assert.ok(!JSON.stringify(health).includes('MUST_NOT_ESCAPE'))
    await assert.rejects(execute({ messages: [] }), { status: 429, code: 'RATE' })
    assert.equal(providerCalls, 1); assert.equal(records, 0)
    holdSnapshot = true
    const pending = fetch(`${url}/v2/admin/metrics`, { headers }); await snapshotEntered.promise
    ledger.resolve(); assert.equal(await active, 'ok'); assert.equal(records, 1)
    snapshotDone.resolve()
    assert.deepEqual((await (await pending).json()).internalChatLifecycle, { active: 0, waiting: 0, limit: 1, queue_limit: 0 })
  } finally {
    ledger.resolve(); snapshotDone.resolve(); await active
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
})
