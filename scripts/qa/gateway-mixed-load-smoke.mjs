import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
async function until(check, label) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) { if (await check()) return; await sleep(20) }
  throw new Error(`Deadline: ${label}`)
}
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return Object.fromEntries([50, 95, 99].map(p => [`p${p}`, sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p / 100) - 1] * 100) / 100 : null]))
}

/** Isolated smoke only: no DB, workers, imports, speech, or production capacity claim. */
export async function runMixedLoadSmoke({ fixtureBodyDelayMs = 100, fixtureFairnessFailure = false, fixtureHoldBurst = false } = {}) {
  assert.ok(Number.isInteger(fixtureBodyDelayMs) && fixtureBodyDelayMs >= 0 && fixtureBodyDelayMs <= 1000)
  assert.equal(typeof fixtureFairnessFailure, 'boolean')
  assert.equal(typeof fixtureHoldBurst, 'boolean')
  const directory = await mkdtemp(join(tmpdir(), 'narra-mixed-load-'))
  const dataDir = join(directory, 'gateway-data')
  const id = randomUUID()
  const tokenSecret = randomUUID() + randomUUID()
  const observations = [], healthSamples = [], rssSamplesKiB = [], pending = [], controllers = []
  const held = new Map()
  let activeProvider = 0, peakProvider = 0, child, childError, poller, polling = false, logs = '', success = false
  const upstream = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return }
    let bytes = ''
    for await (const chunk of req) { bytes += chunk; if (bytes.length > 65536) { res.writeHead(413).end(); return } }
    const body = JSON.parse(bytes)
    const name = body.messages.find(message => message.role === 'user').content
    activeProvider++; peakProvider = Math.max(peakProvider, activeProvider)
    const timers = []
    res.once('close', () => { activeProvider--; held.delete(name); timers.forEach(clearTimeout) })
    held.set(name, res)
    if (name.startsWith('hold-') || (fixtureHoldBurst && name.startsWith('mixed-'))) return
    if (name === 'fault-503') { res.writeHead(503).end('local fixture unavailable'); return }
    if (name === 'stall-body') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); return }
    timers.push(setTimeout(() => {
      res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json' })
      res.flushHeaders()
      timers.push(setTimeout(() => {
        res.end(body.stream
          ? 'data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":null}]}\n\ndata: [DONE]\n\n'
          : JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }] }))
      }, fixtureBodyDelayMs))
    }, 20))
  })
  async function stopChild() {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return
    const closed = once(child, 'close')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
    let ultimate
    try { await Promise.race([closed, new Promise((_, reject) => { ultimate = setTimeout(() => reject(new Error('Gateway cleanup deadline exceeded')), 6000) })]) }
    finally { clearTimeout(timer); clearTimeout(ultimate) }
  }
  try {
    const upstreamPort = await listen(upstream)
    const reservation = createServer(); const port = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    const base = `http://127.0.0.1:${port}`
    child = spawn(process.execPath, ['index.mjs'], {
      cwd: join(root, 'services/narra-gateway'),
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', GATEWAY_HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir,
        GATEWAY_TOKEN_SECRET: tokenSecret, LLM_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
        LLM_API_KEY: 'local-fixture-only', LLM_MODEL: 'fixture', ALLOW_INSECURE_LLM_HTTP: 'true', LLM_INSECURE_HTTP_HOSTS: '127.0.0.1',
        LLM_CONCURRENCY: '12', LLM_QUEUE_LIMIT: '16', AI_LIMIT_PER_MINUTE: '1000',
        COVER_JOB_WORKER_ENABLED: 'false', SCENE_JOB_WORKER_ENABLED: 'false'
      }, stdio: ['ignore', 'pipe', 'pipe']
    })
    child.on('error', error => { childError = error })
    child.stdout.on('data', value => { logs = (logs + value).slice(-16000) })
    child.stderr.on('data', value => { logs = (logs + value).slice(-16000) })
    const health = async () => {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })
      assert.equal(response.status, 200)
      return (await response.json()).concurrency.llm
    }
    await until(async () => { if (childError) throw childError; if (child.exitCode !== null) throw new Error('Gateway exited during startup'); try { await health(); return true } catch { return false } }, 'startup')
    const registration = await fetch(`${base}/v2/installations/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({ installation_id: id, installation_secret: randomUUID() + randomUUID() })
    })
    assert.equal(registration.status, 201)
    const { token } = await registration.json()
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    function request(name, purpose = 'assistant', transport = 'complete') {
      const controller = new AbortController(); controllers.push(controller)
      const started = performance.now()
      const sample = { name, purpose, transport, status: null, ttfbMs: null, elapsedMs: null }
      const promise = fetch(`${base}/v2/ai/chat/${transport}`, {
        method: 'POST', headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        body: JSON.stringify({ messages: [{ role: 'user', content: name }], purpose, origin: 'user' })
      }).then(async response => { sample.status = response.status; sample.ttfbMs = performance.now() - started; await response.text() }, error => { sample.status = error.name })
        .catch(error => { sample.status = error.name })
        .finally(() => { sample.elapsedMs = performance.now() - started; observations.push(sample) })
      pending.push(promise); return { controller, promise, sample }
    }
    poller = setInterval(async () => {
      if (polling) return
      polling = true
      try {
        healthSamples.push({ atMs: Date.now(), ...await health() })
        const usage = await exec('ps', ['-o', 'rss=', '-p', String(child.pid)], { timeout: 1000 })
        const rss = Number(usage.stdout.trim()); if (Number.isFinite(rss)) rssSamplesKiB.push(rss)
      } catch { /* Sampling is diagnostic; final health assertions remain mandatory. */ }
      finally { polling = false }
    }, 50)
    // Saturation is deliberately deterministic; arrivals do not wait on completions.
    const background = Array.from({ length: 22 }, (_, index) => request(`hold-${index}`, 'structured_task', index % 2 ? 'stream' : 'complete'))
    await until(async () => { const state = await health(); return state.active === 10 && state.waiting === 12 }, 'background saturation')
    const overflow = request('overflow', 'summary'); await overflow.promise; assert.equal(overflow.sample.status, 429)
    const interactive = [request('reserved-complete'), request('reserved-stream', 'character_chat', 'stream')]
    await Promise.all(interactive.map(item => item.promise)); interactive.forEach(item => assert.equal(item.sample.status, 200))
    const invalid = await fetch(`${base}/v2/ai/chat/complete`, {
      method: 'POST', headers, body: JSON.stringify({ messages: [] }), signal: AbortSignal.timeout(2000)
    })
    assert.equal(invalid.status, 400); await invalid.text()
    const afterInvalid = await health(); assert.equal(afterInvalid.active, 10); assert.equal(afterInvalid.waiting, 12)
    background.forEach(item => item.controller.abort()); await Promise.all(background.map(item => item.promise))
    await until(async () => { const state = await health(); return state.active === 0 && state.waiting === 0 && activeProvider === 0 }, 'first drain')
    // Explicit fairness barrier, independent of machine speed and service timers.
    // Eleven foreground calls stay held, four more queue. Background must use
    // its reserve AND dispatch its next queued call while foreground stays held.
    const foregroundHeld = Array.from({ length: 11 }, (_, index) => request(`hold-fg-${index}`))
    await until(async () => (await health()).active === 11 && foregroundHeld.every(item => held.has(item.sample.name)), 'foreground held')
    const foregroundQueued = Array.from({ length: 4 }, (_, index) => request(`hold-fg-queued-${index}`))
    await until(async () => (await health()).waiting === 4, 'foreground queued')
    const firstBackground = request('hold-fairness-first', 'structured_task')
    await until(() => held.has(firstBackground.sample.name), 'background reserved admission')
    const nextBackground = request('hold-fairness-next', 'structured_task', 'stream')
    await until(async () => { const state = await health(); return state.active === 12 && state.waiting === 5 }, 'background queued beside foreground')
    held.get(firstBackground.sample.name).writeHead(fixtureFairnessFailure ? 503 : 200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }] }))
    await firstBackground.promise
    assert.equal(firstBackground.sample.status, 200, 'Reserved background must complete successfully')
    await until(() => held.has(nextBackground.sample.name), 'queued background dispatch while foreground held')
    assert.ok(foregroundHeld.every(item => held.has(item.sample.name)), 'Foreground barrier must remain held')
    assert.ok(foregroundQueued.every(item => !held.has(item.sample.name)), 'Foreground reserve must not be overfilled')
    held.get(nextBackground.sample.name).writeHead(200, { 'content-type': 'text/event-stream' }).end('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":null}]}\n\ndata: [DONE]\n\n')
    await nextBackground.promise
    assert.equal(nextBackground.sample.status, 200, 'Queued background must complete beside held foreground')
    // The client can consume EOF before the gateway's finally releases its
    // permit. Observe settlement, without releasing any foreground barrier.
    await until(async () => {
      assert.ok(foregroundHeld.every(item => held.has(item.sample.name)), 'Foreground barrier must remain held through settlement')
      assert.ok(foregroundQueued.every(item => !held.has(item.sample.name)), 'Foreground queue must remain blocked through settlement')
      const state = await health()
      return state.active === 11 && state.waiting === 4 && activeProvider === 11
    }, 'background permit settlement beside held foreground')
    const fairnessState = await health()
    assert.equal(fairnessState.active, 11); assert.equal(fairnessState.waiting, 4)
    const foreground = [...foregroundHeld, ...foregroundQueued]
    foreground.forEach(item => item.controller.abort()); await Promise.all(foreground.map(item => item.promise))
    await until(async () => { const state = await health(); return state.active === 0 && state.waiting === 0 && activeProvider === 0 }, 'fairness drain')
    const fault = request('fault-503'); await fault.promise; assert.ok([502, 503].includes(fault.sample.status))
    const stalled = request('stall-body'); await until(() => held.has('stall-body'), 'stalled upstream')
    stalled.controller.abort(); await stalled.promise
    assert.equal(stalled.sample.status, 'AbortError')
    await until(async () => { const state = await health(); return state.active === 0 && state.waiting === 0 && activeProvider === 0 }, 'fault drain')
    for (let index = 0; index < 40; index++) { request(`mixed-${index}`, index % 3 ? 'assistant' : 'structured_task', index % 2 ? 'stream' : 'complete'); await sleep(5) }
    let heldBurstRejected = null
    if (fixtureHoldBurst) {
      // No timer can free a slot until all forty arrivals are accounted for.
      await until(async () => {
        const state = await health()
        const completed = observations.filter(row => row.name.startsWith('mixed-'))
        assert.ok(completed.every(row => row.status === 429), 'Held burst cannot complete before release')
        heldBurstRejected = completed.length
        return state.active + state.waiting + completed.length === 40
      }, 'held burst arrivals accounted')
      assert.ok(heldBurstRejected >= 12, 'Forty held arrivals must exceed the 12 active + 16 queue hard cap')
      await until(() => {
        for (const [name, response] of held) {
          if (!name.startsWith('mixed-') || response.writableEnded) continue
          const stream = Number(name.slice(6)) % 2 === 1
          response.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' }).end(stream
            ? 'data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":null}]}\n\ndata: [DONE]\n\n'
            : JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }] }))
        }
        return observations.filter(row => row.name.startsWith('mixed-')).length === 40
      }, 'held burst completion')
    }
    await Promise.all(pending)
    await until(async () => { const state = await health(); return state.active === 0 && state.waiting === 0 && activeProvider === 0 }, 'final drain')
    assert.ok(peakProvider <= 12); assert.ok(healthSamples.every(sample => sample.active <= 12 && sample.waiting <= 16))
    assert.ok(observations.every(sample => [200, 429, 502, 503, 'AbortError'].includes(sample.status)), 'Unexpected request outcome')
    const mixedBackground = observations.filter(row => row.name.startsWith('mixed-') && row.purpose === 'structured_task')
    const mixed = observations.filter(row => row.name.startsWith('mixed-'))
    assert.equal(mixed.length, 40)
    assert.ok(mixed.every(row => [200, 429].includes(row.status)), 'Open burst may shed overload, not fail accepted work')
    assert.ok(mixedBackground.some(row => row.status === 200), 'Open burst must include completed background work')
    // Separate actual-method HTTP accounting regression: explicitly not real PG.
    const ledgerCheck = await exec(process.execPath, ['--test', 'services/narra-gateway/test/internal-lifecycle-metrics.test.mjs'], { cwd: root, env: { PATH: process.env.PATH }, timeout: 10000 })
    const sha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
    const report = {
      scope: 'credential-free HTTP concurrency smoke; NOT capacity or PG/S3 pipeline acceptance', sha,
      upstreamProfile: { headerDelayMs: 20, bodyDelayMs: fixtureBodyDelayMs, heldBurst: fixtureHoldBurst, faultStatus: 503 },
      requests: observations.length, outcomes: observations.reduce((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc }, {}),
      checks: { reservedInteractive: interactive.map(row => row.sample.status), invalidBodyStatus: invalid.status,
        backgroundFairness: { completed: 2, foregroundHeld: fairnessState.active, foregroundQueued: fairnessState.waiting },
        mixedBackgroundCompleted: mixedBackground.filter(row => row.status === 200).length,
        mixedBackgroundRejected: mixedBackground.filter(row => row.status === 429).length,
        openBurstCompleted: mixed.filter(row => row.status === 200).length,
        openBurstRejected: mixed.filter(row => row.status === 429).length, heldBurstRejected },
      latencyMs: Object.fromEntries(['stream', 'complete'].map(transport => {
        const rows = observations.filter(row => row.transport === transport && row.status === 200)
        return [transport, { ttfb: percentiles(rows.map(row => row.ttfbMs)), complete: percentiles(rows.map(row => row.elapsedMs)) }]
      })), peakProvider, peakQueueSampled: Math.max(0, ...healthSamples.map(row => row.waiting)),
      rssKiB: { samples: rssSamplesKiB.length, peak: Math.max(0, ...rssSamplesKiB) },
      final: await health(), ledgerBoundary: 'actual-method HTTP test PASS, controlled ledger (no PostgreSQL)',
      evidenceDirectory: directory
    }
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, healthSamples, rssSamplesKiB }), { mode: 0o600 })
    await writeFile(join(directory, 'ledger-test.txt'), ledgerCheck.stdout, { mode: 0o600 })
    success = true
    return report
  } catch (error) {
    await writeFile(join(directory, 'failure.txt'), String(error), { mode: 0o600 })
    await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, healthSamples, rssSamplesKiB }), { mode: 0o600 })
    error.message += `; evidence: ${directory}`
    throw error
  } finally {
    clearInterval(poller); controllers.forEach(controller => controller.abort())
    try { await stopChild() }
    finally {
      upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve))
      await Promise.allSettled(pending)
      await until(() => !polling, 'metric sampler cleanup')
      // Only this fresh child's credential data; retain nonsecret evidence.
      await rm(dataDir, { recursive: true, force: true })
      if (!success) await writeFile(join(directory, 'gateway-log.txt'), logs.replaceAll(tokenSecret, '[redacted]'), { mode: 0o600 })
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--run-smoke')) console.log(JSON.stringify(await runMixedLoadSmoke(), null, 2))
  else console.log('Dry run: node scripts/qa/gateway-mixed-load-smoke.mjs --run-smoke\nIsolated loopback child gateway + fake provider; no PG/S3, paid AI, or capacity claim.')
}
