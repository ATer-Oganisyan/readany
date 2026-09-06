import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once, getEventListeners } from 'node:events'
import { PassThrough } from 'node:stream'
import { S3Client } from '@aws-sdk/client-s3'
import { createBookObjectStorage } from '../book-object-storage.mjs'

for (const phase of ['preaborted', 'headers', 'body']) {
  test(`AWS range read cancellation: ${phase}`, { timeout: 5000 }, async () => {
    let enter, bodyReady, closed, calls = 0
    const entered = new Promise(resolve => { enter = resolve })
    const ready = new Promise(resolve => { bodyReady = resolve })
    const disconnected = new Promise(resolve => { closed = resolve })
    const server = createServer((req, res) => {
      calls++
      assert.equal(req.headers.range, 'bytes=0-7')
      res.once('close', closed)
      enter()
      if (phase === 'preaborted') res.end('12345678')
      if (phase === 'body') {
        res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-length': '8', 'content-range': 'bytes 0-7/8' })
        res.write('123')
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const sdk = new S3Client({ region: 'us-east-1', endpoint: `http://127.0.0.1:${server.address().port}`,
      forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: 'own-fixture', secretAccessKey: 'own-fixture' } })
    const storage = createBookObjectStorage({ bucket: 'own-fixture', client: {
      async send(...args) { const response = await sdk.send(...args); bodyReady(); return response }
    } })
    const controller = new AbortController()
    const reason = Object.assign(new Error('own lease lost'), { code: 'LEASE_LOST' })
    if (phase === 'preaborted') controller.abort(reason)
    const pending = storage.getBytesRange({ objectKey: 'own/chunk', startByte: 0, endByteExclusive: 8,
      maxBytes: 8, signal: controller.signal }).then(value => ({ value }), error => ({ error }))
    let deadline
    try {
      if (phase === 'headers') await entered
      if (phase === 'body') await ready
      controller.abort(reason)
      const outcome = await Promise.race([pending, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('range cancellation did not settle')), 500)
      })])
      assert.equal(outcome.error, reason)
      if (phase === 'preaborted') assert.equal(calls, 0)
      else { await disconnected; assert.equal(calls, 1) }
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    } finally {
      clearTimeout(deadline)
      sdk.destroy()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      await pending
    }
  })
}

test('range byte ceiling destroys the active stream and removes its abort listener', async () => {
  const body = new PassThrough()
  const controller = new AbortController()
  const storage = createBookObjectStorage({ bucket: 'own-fixture', client: { async send() { return { Body: body } } } })
  const pending = storage.getBytesRange({ objectKey: 'own/chunk', startByte: 0, endByteExclusive: 8,
    maxBytes: 8, signal: controller.signal })
  const rejected = assert.rejects(pending, error => error.code === 'VALIDATION')
  body.write('123456789')
  await rejected
  assert.equal(body.destroyed, true)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

test('successful range and wrong-length range both clean up cancellation listeners', async () => {
  for (const bytes of ['12345678', '123']) {
    const controller = new AbortController()
    const storage = createBookObjectStorage({ bucket: 'own-fixture', client: {
      async send() { return { Body: Buffer.from(bytes) } }
    } })
    const pending = storage.getBytesRange({ objectKey: 'own/chunk', startByte: 0, endByteExclusive: 8,
      maxBytes: 8, signal: controller.signal })
    if (bytes.length === 8) assert.equal((await pending).bytes.toString(), bytes)
    else await assert.rejects(pending, { code: 'STORAGE_RANGE_INTEGRITY' })
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  }
})
