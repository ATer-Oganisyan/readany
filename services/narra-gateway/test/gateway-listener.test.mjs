import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { listenGateway } from '../gateway-listener.mjs'

for (const host of ['127.0.0.1', ' 127.0.0.1 ']) {
  test(`explicit host binds only loopback and serves HTTP: ${JSON.stringify(host)}`, async () => {
    const app = express()
    app.get('/health', (_req, res) => res.json({ ok: true }))
    const server = listenGateway(app, 0, undefined, { GATEWAY_HOST: host })
    try {
      await once(server, 'listening')
      assert.equal(server.address().address, '127.0.0.1')
      const response = await fetch(`http://127.0.0.1:${server.address().port}/health`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { ok: true })
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })
}
test('unset host retains Node deployment wildcard binding', async () => {
  const server = listenGateway(express(), 0, undefined, {})
  try {
    await once(server, 'listening')
    assert.ok(['::', '0.0.0.0'].includes(server.address().address))
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
