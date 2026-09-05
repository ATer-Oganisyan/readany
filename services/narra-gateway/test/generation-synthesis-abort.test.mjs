import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createGenerationServiceClient } from '../generation-service-client.mjs'

const input = { runId: 'run', snapshotId: 'snapshot', entity: { entityKey: 'anna' }, synthesisVersion: 'v1' }

test('synthesis forwards cancellation without serializing the signal', async () => {
  const controller = new AbortController()
  let request
  const client = createGenerationServiceClient({
    baseUrl: 'http://127.0.0.1:8790', token: 'x'.repeat(32), production: false,
    fetchImpl: async (_url, options) => {
      request = options
      return new Response('{"result":{}}')
    }
  })
  await client.synthesizeCharacterProfile(input, { signal: controller.signal })
  controller.abort(new Error('lease lost'))
  assert.equal(request.signal.aborted, true)
  assert.equal(request.signal.reason, controller.signal.reason)
  assert.deepEqual(JSON.parse(request.body), { idempotencyKey: 'run:synthesize:snapshot:anna:v1', ...input })
})

test('already cancelled synthesis never invokes transport', async () => {
  const controller = new AbortController()
  controller.abort(new Error('lease lost'))
  let calls = 0
  const client = createGenerationServiceClient({
    baseUrl: 'http://127.0.0.1:8790', token: 'x'.repeat(32), production: false,
    fetchImpl: async () => { calls++; return new Response('{"result":{}}') }
  })
  await assert.rejects(client.synthesizeCharacterProfile(input, { signal: controller.signal }), /lease lost/)
  assert.equal(calls, 0)
})

test('lease cancellation closes a real pending HTTP response', { timeout: 5_000 }, async (t) => {
  let accept
  const accepted = new Promise((resolve) => { accept = resolve })
  let closed
  const responseClosed = new Promise((resolve) => { closed = resolve })
  const server = createServer((request, response) => {
    request.resume()
    response.on('close', closed)
    accept()
  })
  t.after(() => { server.closeAllConnections(); server.close() })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const controller = new AbortController()
  const client = createGenerationServiceClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    token: 'x'.repeat(32), production: false
  })
  const pending = client.synthesizeCharacterProfile(input, { signal: controller.signal })
  const rejected = assert.rejects(pending, /lease lost/)
  await accepted
  controller.abort(new Error('lease lost'))
  await rejected
  await responseClosed
})

test('lease cancellation interrupts a real partially received response body', { timeout: 5_000 }, async (t) => {
  let gotHeaders
  const headers = new Promise((resolve) => { gotHeaders = resolve })
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"result":')
  })
  t.after(() => { server.closeAllConnections(); server.close() })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const controller = new AbortController()
  const client = createGenerationServiceClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    token: 'x'.repeat(32), production: false,
    async fetchImpl(...args) {
      const response = await fetch(...args)
      gotHeaders()
      return response
    }
  })
  const pending = client.synthesizeCharacterProfile(input, { signal: controller.signal })
  const rejected = assert.rejects(pending)
  await headers
  controller.abort(Object.assign(new Error('lease lost'), { code: 'LEASE_LOST' }))
  await rejected
})
