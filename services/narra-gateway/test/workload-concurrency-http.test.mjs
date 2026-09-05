import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, description) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(15)
  }
  throw new Error(`Timed out: ${description}`)
}
async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

test('real gateway HTTP: background saturation preserves both chat transports and cancellation drains', { timeout: 25000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'narra-http-workload-'))
  const requests = new Map()
  let activeUpstream = 0
  let peakUpstream = 0
  const upstream = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions')
    const bytes = []
    for await (const chunk of req) bytes.push(chunk)
    const input = JSON.parse(Buffer.concat(bytes))
    const id = input.messages.find(message => message.role === 'user').content
    activeUpstream++
    peakUpstream = Math.max(peakUpstream, activeUpstream)
    res.once('close', () => activeUpstream--)
    requests.set(id, { res, input })
    // Deliberately hold headers/body: the real gateway must retain its slot.
  })
  let child
  let logs = ''
  const cancellations = []
  const pending = []
  try {
    const upstreamPort = await listen(upstream)
    const reservation = createServer()
    const port = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    const base = `http://127.0.0.1:${port}`
    // Whitelist, not process.env spread: never inherit DB URLs, AI credentials,
    // analytics sinks, object storage, NODE_OPTIONS or developer .env files.
    child = spawn(process.execPath, ['index.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), GATEWAY_HOST: '127.0.0.1', DATA_DIR: dataDir,
        GATEWAY_TOKEN_SECRET: 'isolated-http-test-token-secret-32-characters',
        LLM_BASE_URL: `http://127.0.0.1:${upstreamPort}`, LLM_API_KEY: 'dummy-local-only', LLM_MODEL: 'fake',
        ALLOW_INSECURE_LLM_HTTP: 'true', LLM_INSECURE_HTTP_HOSTS: '127.0.0.1',
        LLM_CONCURRENCY: '12', LLM_QUEUE_LIMIT: '16', AI_LIMIT_PER_MINUTE: '100',
        COVER_JOB_WORKER_ENABLED: 'false', SCENE_JOB_WORKER_ENABLED: 'false'
      }, stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', bytes => { logs += bytes })
    child.stderr.on('data', bytes => { logs += bytes })
    const health = async () => {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })
      return (await response.json()).concurrency.llm
    }
    await until(async () => {
      if (child.exitCode !== null) throw new Error(`Gateway exited: ${logs}`)
      try { await health(); return true } catch { return false }
    }, 'gateway startup')
    const registration = await fetch(`${base}/v2/installations/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: randomUUID(), installation_secret: 'a'.repeat(64) })
    })
    assert.equal(registration.status, 201)
    const { token } = await registration.json()
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
    function start(id, purpose, transport = 'complete') {
      const controller = new AbortController()
      cancellations.push(controller)
      const promise = fetch(`${base}/v2/ai/chat/${transport}`, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({ messages: [{ role: 'user', content: id }], purpose, origin: 'user' })
      }).then(async response => ({ status: response.status, text: await response.text() }), error => ({ aborted: error.name }))
      pending.push(promise)
      return promise
    }
    for (let i = 0; i < 22; i++) start(`background-${i}`, 'structured_task', i % 2 ? 'stream' : 'complete')
    await until(async () => {
      const state = await health()
      return state.active === 10 && state.waiting === 12
    }, 'background active10/waiting12 across both routes')
    await until(() => activeUpstream === 10, 'ten admitted background requests reach upstream')
    assert.equal((await start('overflow', 'summary')).status, 429)

    const stream = start('interactive-stream', 'character_chat', 'stream')
    const complete = start('interactive-complete', 'assistant')
    await until(() => requests.has('interactive-stream') && requests.has('interactive-complete'), 'both interactive reserves reach real upstream')
    const full = await health()
    assert.equal(full.active, 12)
    assert.equal(full.waiting, 12)
    for (const transport of ['stream', 'complete']) {
      const invalid = await fetch(`${base}/v2/ai/chat/${transport}`, {
        method: 'POST', headers, body: JSON.stringify({ purpose: 'invalid', messages: [] })
      })
      assert.equal(invalid.status, 400)
      await invalid.text()
      assert.deepEqual(await health(), full, 'invalid body must not join a saturated queue')
    }
    const streaming = requests.get('interactive-stream').res
    streaming.writeHead(200, { 'content-type': 'text/event-stream' })
    streaming.end('data: {"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\ndata: [DONE]\n\n')
    const completed = requests.get('interactive-complete').res
    completed.writeHead(200, { 'content-type': 'application/json' })
    completed.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }] }))
    assert.equal((await stream).status, 200)
    assert.equal((await complete).status, 200)
    cancellations.forEach(controller => controller.abort())
    await Promise.all(pending)
    await until(async () => {
      const state = await health()
      return state.active === 0 && state.waiting === 0 && activeUpstream === 0
    }, 'disconnect cancellation drains queued and active requests')
    assert.equal(peakUpstream, 12)
  } catch (error) {
    error.message += `\nGateway log (isolated dummy credentials only):\n${logs.slice(-5000)}`
    throw error
  } finally {
    cancellations.forEach(controller => controller.abort())
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const force = setTimeout(() => child.kill('SIGKILL'), 2000)
      await exited
      clearTimeout(force)
    }
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
    await Promise.all(pending)
    await rm(dataDir, { recursive: true, force: true })
  }
})
