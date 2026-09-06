import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createBookCatalogRouter } from '../book-catalog-api.mjs'
import { createConcurrencyGate } from '../concurrency.mjs'
import { createBookUploadByteBudget } from '../book-upload-admission.mjs'
import { createInstallationRegistry } from '../installation-registry.mjs'

const SUBJECT = '123e4567-e89b-42d3-a456-426614174000'
const BOOK = '123e4567-e89b-42d3-a456-426614174001'
const tick = () => new Promise((resolve) => setImmediate(resolve))

// Execute the real Express route, including express.raw, against Node streams.
// No socket/server is needed; readCalls detects allocation before admission.
function request(router, { bytes = Buffer.from('book'), length = bytes.length, stalled = false, chunked = false } = {}) {
  let readCalls = 0
  const req = new Readable({ read() {
    readCalls += 1
    if (!stalled) { this.push(bytes); this.push(null) }
  } })
  req.headers = { 'content-type': 'text/plain', ...(chunked
    ? { 'transfer-encoding': 'chunked' }
    : { 'content-length': String(length) }) }
  req.params = { bookEditionId: BOOK }
  req.installation = { sub: SUBJECT }
  req.method = 'PUT'
  const res = new EventEmitter()
  res.statusCode = 200
  res.headers = {}
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value }
  res.status = (value) => { res.statusCode = value; return res }
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })
  res.json = (body) => {
    if (res.writableEnded) return res
    res.body = body
    res.writableEnded = true
    res.emit('finish')
    resolveDone(res)
    return res
  }
  const handlers = router.stack.find((layer) => layer.route?.path === '/:bookEditionId/source').route.stack
  let index = 0
  function next(error) {
    if (res.writableEnded || res.destroyed) return
    if (error) return res.status(error.status || 500).json({ code: error.code, error: error.message })
    const handler = handlers[index++]?.handle
    if (!handler) return res.status(500).json({ error: 'route did not respond' })
    try { Promise.resolve(handler(req, res, next)).catch(next) } catch (error) { next(error) }
  }
  next()
  return { req, res, done, get readCalls() { return readCalls } }
}

function fixture({ allowed = true, gate, limits = [], timeoutMs, storageWait, maxBytes = 16 } = {}) {
  const calls = []
  const edition = {
    id: BOOK, scope: 'private', title: 'Test', author: 'Test', format: 'txt',
    contentSha256: 'a'.repeat(64), sourceStorage: 'temporary', status: 'registered'
  }
  const repository = {
    async listCatalogBooks() {}, async resolveBook() {},
    async getReaderBookManifest() {}, async advanceReaderPosition() {},
    async canUploadPrivateBookSource(input) { calls.push(['authorize', input]); return allowed },
    async beginPrivateBookUpload(input) {
      calls.push(['prepare', input])
      return allowed ? { edition, uploadRequired: true, file: { ...input, contentSha256: input.contentSha256 } } : null
    },
    async completePrivateBookUpload() { calls.push(['complete']); return edition }
  }
  const storage = { async putBytes(input) {
    calls.push(['storage', input])
    await storageWait
    input.signal?.throwIfAborted()
    return { contentHash: input.bytes.length ? calls.find(([key]) => key === 'prepare')[1].contentSha256 : '', byteSize: input.bytes.length }
  } }
  const analysisRepository = { async ensureAnalysisRun() { return {
    run: { id: BOOK, stage: 'prepare', status: 'queued' },
    prepareJob: { id: BOOK, status: 'queued' }, created: true
  } } }
  const router = createBookCatalogRouter({ repository, analysisRepository, storage, uploadMaxBytes: maxBytes,
    uploadGate: gate, uploadLimits: limits, uploadTimeoutMs: timeoutMs })
  return { router, calls }
}

test('foreign/private-inaccessible source is rejected before parser, gate and quota', async () => {
  let quotas = 0
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 1, name: 'test upload' })
  const { router, calls } = fixture({ allowed: false, gate, limits: [(_req, _res, next) => { quotas += 1; next() }] })
  const upload = request(router)
  assert.equal((await upload.done).statusCode, 404)
  assert.equal(upload.readCalls, 0)
  assert.equal(quotas, 0)
  assert.equal(gate.status().active, 0)
  assert.deepEqual(calls, [['authorize', { subjectId: SUBJECT, bookEditionId: BOOK }]])
})

test('source admission fails closed without configured shared import gate', async () => {
  const { router } = fixture()
  const upload = request(router)
  assert.equal((await upload.done).statusCode, 503)
  assert.equal(upload.readCalls, 0)
})

test('concurrent uploads share bounded slots; queued/rejected requests do not read their bodies', async () => {
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 1, name: 'test upload' })
  let finishStorage
  const storageWait = new Promise((resolve) => { finishStorage = resolve })
  const { router, calls } = fixture({ gate, storageWait })
  const first = request(router)
  let second
  let third
  try {
    await tick()
    assert.equal(calls.filter(([key]) => key === 'storage').length, 1)
    assert.equal(gate.status().active, 1)
    second = request(router)
    third = request(router)
    await tick()
    assert.equal(second.readCalls, 0)
    assert.equal((await third.done).statusCode, 429)
    assert.equal(third.readCalls, 0)
    assert.equal(gate.status().waiting, 1)
    second.req.emit('aborted')
    await tick()
    assert.equal(gate.status().waiting, 0)
    finishStorage()
    assert.equal((await first.done).statusCode, 202)
    assert.equal(gate.status().active, 0)
    assert.equal(first.req.listenerCount('aborted'), 0)
    assert.equal(first.res.listenerCount('close'), 0)
  } finally {
    finishStorage()
    for (const item of [first, second, third]) item?.req.destroy()
  }
})

test('oversized length and quota rejection happen before raw body allocation', async () => {
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 1, name: 'test upload' })
  let quotas = 0
  const { router } = fixture({ gate, limits: [(_req, res) => { quotas += 1; res.status(429).json({ code: 'RATE' }) }] })
  const oversized = request(router, { length: 17 })
  assert.equal((await oversized.done).statusCode, 413)
  assert.equal(oversized.readCalls, 0)
  assert.equal(quotas, 0)
  const overBudget = request(router)
  assert.equal((await overBudget.done).statusCode, 429)
  assert.equal(overBudget.readCalls, 0)
  assert.equal(quotas, 1)
  assert.equal(gate.status().active, 0)
})

test('parser failure and client close/error/abort all release the active slot', async () => {
  for (const event of ['parser', 'close', 'error', 'aborted']) {
    const gate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'test upload' })
    const { router } = fixture({ gate })
    const upload = request(router, event === 'parser'
      ? { bytes: Buffer.alloc(17), length: 16 }
      : { stalled: true })
    await tick()
    if (event === 'parser') assert.equal((await upload.done).statusCode, 413)
    else {
      assert.equal(gate.status().active, 1)
      if (event === 'close') upload.res.emit('close')
      else upload.req.emit(event, new Error('test disconnect'))
      assert.equal(upload.req.bookUploadSignal.aborted, true)
    }
    assert.equal(gate.status().active, 0, event)
    upload.req.destroy()
  }
})

test('stalled source body has a deadline and cannot retain a slot indefinitely', async () => {
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'test upload' })
  const { router } = fixture({ gate, timeoutMs: 20 })
  const upload = request(router, { stalled: true })
  const keepAlive = setTimeout(() => {}, 500)
  try {
    assert.equal((await upload.done).statusCode, 408)
    assert.equal(upload.req.bookUploadSignal.aborted, true)
    assert.equal(gate.status().active, 0)
  } finally { clearTimeout(keepAlive); upload.req.destroy() }
})

test('disconnect cancels object storage and never publishes the abandoned upload', async () => {
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'test upload' })
  let finishStorage
  const storageWait = new Promise((resolve) => { finishStorage = resolve })
  const { router, calls } = fixture({ gate, storageWait })
  const upload = request(router)
  await tick()
  const storageInput = calls.find(([key]) => key === 'storage')[1]
  assert.equal(storageInput.signal.aborted, false)
  upload.res.emit('close')
  assert.equal(storageInput.signal.aborted, true)
  assert.equal(gate.status().active, 0)
  finishStorage()
  await tick()
  assert.equal(calls.some(([key]) => key === 'complete'), false)
})

test('late quota completion cannot start parsing after client disconnect', async () => {
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'test upload' })
  let continueQuota
  let byteReservations = 0
  const { router } = fixture({ gate, limits: [
    (_req, _res, next) => { continueQuota = next },
    (_req, _res, next) => { byteReservations += 1; next() }
  ] })
  const upload = request(router)
  await tick()
  assert.equal(byteReservations, 0)
  assert.equal(typeof continueQuota, 'function')
  upload.res.emit('close')
  continueQuota()
  await tick()
  assert.equal(byteReservations, 0)
  assert.equal(upload.readCalls, 0)
  assert.equal(gate.status().active, 0)
  upload.req.destroy()
})

test('real byte journal charges seven small uploads by Content-Length, not the 50 MiB cap', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'narra-upload-budget-'))
  const registry = createInstallationRegistry({ dataDir, environment: 'test' })
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'test upload' })
  const budget = 25 * 1024 * 1024
  try {
    await registry.start()
    await registry.register({ installationId: SUBJECT, refreshSecretHash: 'a'.repeat(43) })
    const quota = createBookUploadByteBudget({ registry, perInstallationLimit: budget, globalLimit: budget })
    const { router } = fixture({ gate, maxBytes: 50 * 1024 * 1024, limits: [quota] })
    for (let index = 0; index < 7; index += 1) {
      const upload = request(router, { bytes: Buffer.alloc(4096) })
      assert.equal((await upload.done).statusCode, 202)
    }
    const rest = await registry.reserve({ installationId: SUBJECT, metric: 'import_bytes',
      amount: budget - 7 * 4096, perInstallationLimit: budget, globalLimit: budget })
    assert.equal(rest.ok, true)
    assert.equal(rest.installationRemaining, 0)
    const rejected = request(router)
    assert.equal((await rejected.done).statusCode, 429)
    assert.equal(rejected.readCalls, 0)
    assert.equal(gate.status().active, 0)
  } finally {
    await registry.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('empty declared source fails before quota, while chunked sources reserve the bounded maximum', async () => {
  const gate = createConcurrencyGate({ limit: 1, queueLimit: 0, name: 'test upload' })
  const amounts = []
  const { router } = fixture({ gate, limits: [(req, _res, next) => {
    amounts.push(req.bookUploadBudgetBytes)
    next()
  }] })
  const empty = request(router, { length: 0, bytes: Buffer.alloc(0) })
  assert.equal((await empty.done).statusCode, 400)
  assert.equal(empty.readCalls, 0)
  assert.deepEqual(amounts, [])
  const chunked = request(router, { chunked: true })
  assert.equal((await chunked.done).statusCode, 202)
  assert.deepEqual(amounts, [16])
  const oversized = request(router, { chunked: true, bytes: Buffer.alloc(17) })
  assert.equal((await oversized.done).statusCode, 413)
  assert.equal(gate.status().active, 0)
})
