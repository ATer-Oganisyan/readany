import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

test('public complete rejects provider truncation, frees capacity and allows explicit next request', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'narra-truncated-http-'))
  let calls = 0
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) {}
    calls++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{
      message: { role: 'assistant', content: calls === 1 ? 'Unfinished sentence because' : 'Complete answer.' },
      finish_reason: calls === 1 ? 'length' : 'stop',
    }] }))
  })
  let child; let closed = false; let childClosed
  try {
    const upstreamPort = await listen(upstream)
    const reservation = createServer()
    const port = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    child = spawn(process.execPath, ['index.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore',
      env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), GATEWAY_HOST: '127.0.0.1', DATA_DIR: directory,
        GATEWAY_TOKEN_SECRET: 'own-truncated-http-fixture-secret-00000',
        LLM_BASE_URL: `http://127.0.0.1:${upstreamPort}`, LLM_API_KEY: 'dummy-local', LLM_MODEL: 'fake',
        LLM_CONCURRENCY: '1', ALLOW_INSECURE_LLM_HTTP: 'true', LLM_INSECURE_HTTP_HOSTS: '127.0.0.1',
        COVER_JOB_WORKER_ENABLED: 'false', SCENE_JOB_WORKER_ENABLED: 'false' },
    })
    childClosed = new Promise(resolve => child.once('close', () => { closed = true; resolve() }))
    child.on('error', () => {}) // close still settles spawn errors
    const base = `http://127.0.0.1:${port}`
    const health = async () => (await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).json()).concurrency.llm
    const deadline = Date.now() + 6000
    for (;;) {
      assert.equal(closed, false, 'Gateway must remain alive')
      try { await health(); break } catch {
        if (Date.now() > deadline) throw new Error('Gateway startup deadline')
        await delay(20)
      }
    }
    const registration = await fetch(`${base}/v2/installations/register`, {
      method: 'POST', signal: AbortSignal.timeout(2000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: randomUUID(), installation_secret: 'a'.repeat(64) }),
    })
    assert.equal(registration.status, 201)
    const { token } = await registration.json()
    const send = () => fetch(`${base}/v2/ai/chat/complete`, {
      method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ purpose: 'character_chat', messages: [{ role: 'user', content: 'Own truncation fixture' }] }),
    })
    const failed = await send()
    assert.equal(failed.status, 502)
    const error = await failed.json()
    assert.equal(error.code, 'PARSE')
    assert.equal(error.text, undefined)
    assert.equal(calls, 1)
    assert.equal((await health()).active, 0)
    const retry = await send()
    assert.equal(retry.status, 200)
    assert.equal((await retry.json()).text, 'Complete answer.')
    assert.equal(calls, 2, 'Only explicit second request generates again')
    assert.equal((await health()).active, 0)
  } finally {
    let cleanupError
    if (child && !closed) {
      child.kill('SIGTERM')
      const force = setTimeout(() => child.kill('SIGKILL'), 1000)
      let deadline
      try {
        await Promise.race([childClosed, new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Child close unconfirmed; own data retained')), 3000)
        })])
      } catch (error) { cleanupError = error }
      finally { clearTimeout(force); clearTimeout(deadline) }
    }
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
    if (!child || closed) await rm(directory, { recursive: true, force: true })
    if (cleanupError) throw cleanupError
  }
})
