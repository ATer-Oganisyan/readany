import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createGenerationServiceClient } from '../generation-service-client.mjs'

test('scan rejects an already lost lease before HTTP dispatch', async () => {
  let calls = 0
  const client = createGenerationServiceClient({ baseUrl: 'http://127.0.0.1:1',
    token: 'own-fixture-token-not-a-secret-00000', production: false,
    fetchImpl: async () => { calls++; return new Response('{"observations":[]}') } })
  const reason = Object.assign(new Error('own lease lost'), { code: 'LEASE_LOST' })
  await assert.rejects(client.scanBookChunk({}, { signal: AbortSignal.abort(reason) }), error => error === reason)
  assert.equal(calls, 0)
})

test('scan cancellation closes a real loopback HTTP response with a pending JSON body', { timeout: 5000 }, async () => {
  let headersReady, responseClosed
  const headers = new Promise(resolve => { headersReady = resolve })
  const closed = new Promise(resolve => { responseClosed = resolve })
  let calls = 0, transportSignal
  const server = createServer(async (req, res) => {
    for await (const _ of req) {}
    calls++
    res.on('close', responseClosed)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"result":')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const client = createGenerationServiceClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`, production: false,
    token: 'own-fixture-token-not-a-secret-00000', timeoutMs: 2000,
    fetchImpl: async (...args) => {
      transportSignal = args[1].signal
      const response = await fetch(...args)
      headersReady()
      return response
    }
  })
  const controller = new AbortController()
  const pending = client.scanBookChunk({ runId: 'own-run', chunkId: 'own-chunk' }, { signal: controller.signal })
    .then(value => ({ value }), error => ({ error }))
  try {
    await headers
    controller.abort(Object.assign(new Error('lease replaced'), { code: 'LEASE_LOST' }))
    assert.equal(transportSignal.aborted, true, 'caller cancellation must reach the active fetch')
    const outcome = await pending
    assert.ok(outcome.error, 'partial JSON must never succeed')
    assert.ok(outcome.error.name === 'AbortError' || outcome.error.code === 'LEASE_LOST')
    await closed
    assert.equal(calls, 1, 'cancellation must not retry')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await pending
  }
})
