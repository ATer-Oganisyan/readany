import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createInternalGenerationRouter } from '../internal-generation-service.mjs'
import { createWorkloadConcurrencyGate } from '../workload-concurrency.mjs'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(10) }
  throw new Error('Condition did not settle')
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }

test('actual public routes time out queued requests without provider calls or releasing active work', { timeout: 15000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'narra-queue-deadline-'))
  const seen = []; const controllers = []; const pending = []
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) {} // Own synthetic input; hold the response.
    seen.push(res)
  })
  let child
  try {
    const upstreamPort = await listen(upstream)
    const reservation = createServer(); const port = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    child = spawn(process.execPath, ['index.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore',
      env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), GATEWAY_HOST: '127.0.0.1', DATA_DIR: dataDir,
        GATEWAY_TOKEN_SECRET: 'synthetic-queue-deadline-secret-000000',
        LLM_BASE_URL: `http://127.0.0.1:${upstreamPort}`, LLM_API_KEY: 'dummy-local-only', LLM_MODEL: 'fake',
        ALLOW_INSECURE_LLM_HTTP: 'true', LLM_INSECURE_HTTP_HOSTS: '127.0.0.1',
        LLM_CONCURRENCY: '1', LLM_QUEUE_LIMIT: '2', LLM_QUEUE_TIMEOUT_MS: '80',
        COVER_JOB_WORKER_ENABLED: 'false', SCENE_JOB_WORKER_ENABLED: 'false' }
    })
    const base = `http://127.0.0.1:${port}`
    const health = async () => (await (await fetch(`${base}/health`)).json()).concurrency.llm
    await until(async () => { assert.equal(child.exitCode, null); try { await health(); return true } catch { return false } })
    const registered = await fetch(`${base}/v2/installations/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: randomUUID(), installation_secret: 'a'.repeat(64) }) })
    const { token } = await registered.json()
    const start = transport => {
      const controller = new AbortController(); controllers.push(controller)
      const result = fetch(`${base}/v2/ai/chat/${transport}`, { method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'structured_task', messages: [{ role: 'user', content: 'own deadline fixture' }] })
      }).then(async response => ({ status: response.status, body: await response.json() }), () => ({ aborted: true }))
      pending.push(result); return result
    }
    const active = start('complete'); await until(() => seen.length === 1)
    for (const transport of ['complete', 'stream']) {
      const response = await Promise.race([start(transport), delay(700).then(() => ({ timedOut: true }))])
      assert.equal(response.status, 504, `${transport} queue must have a server deadline`)
      assert.equal(response.body.code, 'TIMEOUT')
      assert.equal(seen.length, 1, 'expired waiter must never call provider')
      const state = await health(); assert.equal(state.active, 1); assert.equal(state.waiting, 0)
    }
    seen[0].writeHead(200, { 'content-type': 'application/json' })
    seen[0].end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'finished' }, finish_reason: 'stop' }] }))
    assert.equal((await active).status, 200, 'admitted operation survives its old queue deadline')
    await until(async () => (await health()).active === 0)
  } finally {
    controllers.forEach(controller => controller.abort())
    if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 1500); await exited; clearTimeout(force) }
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve))
    await Promise.all(pending); await rm(dataDir, { recursive: true, force: true })
  }
})

test('actual internal router abandons queued work when completed POST client disconnects', { timeout: 5000 }, async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 2 })
  const release = await gate.acquire()
  let signal; let providerCalls = 0
  const token = 'synthetic-internal-deadline-token-00000'
  const app = express()
  app.use(createInternalGenerationRouter({ token, logger: { error() {} }, service: {
    async generateBookIdentity(_body, requestSignal) {
      signal = requestSignal
      const done = await gate.acquire(signal)
      try { providerCalls++; return { fixture: true } } finally { done() }
    }
  } }))
  const server = createServer(app); const port = await listen(server)
  const req = request(`http://127.0.0.1:${port}/v1/book-identities`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  req.on('error', () => {}); req.end('{}')
  try {
    await until(() => gate.status().waiting === 1)
    req.destroy(); await delay(50)
    assert.equal(signal.aborted, true)
    assert.equal(gate.status().waiting, 0)
    assert.equal(gate.status().active, 1)
    assert.equal(providerCalls, 0)
  } finally {
    req.destroy(); release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
})
