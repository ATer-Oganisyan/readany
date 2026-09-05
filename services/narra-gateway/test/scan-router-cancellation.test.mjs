import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import express from 'express'
import { createInternalGenerationRouter } from '../internal-generation-service.mjs'
import { createGenerationServiceClient } from '../generation-service-client.mjs'

test('scan caller cancellation reaches the actual internal router service', { timeout: 5000 }, async () => {
  const token = 'own-fixture-token-not-a-secret-00000'
  let entered, aborted, calls = 0
  const started = new Promise(resolve => { entered = resolve })
  const cancelled = new Promise(resolve => { aborted = resolve })
  const app = express()
  app.use('/internal', createInternalGenerationRouter({ token,
    logger: { info() {}, error() {} },
    service: { async scanBookChunk(input, signal) {
      calls++
      assert.equal(input.idempotencyKey, 'own-run:scan:own-chunk:own-extractor')
      assert.equal(Object.hasOwn(input, 'signal'), false)
      entered()
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { aborted(); reject(signal.reason) }, { once: true })
      })
      assert.fail('cancelled generation must not finish')
    } }
  }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const client = createGenerationServiceClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`, token, production: false, timeoutMs: 2000
  })
  const controller = new AbortController()
  const pending = client.scanBookChunk({ runId: 'own-run', chunkId: 'own-chunk', extractorVersion: 'own-extractor' },
    { signal: controller.signal }).then(value => ({ value }), error => ({ error }))
  try {
    await started
    controller.abort(Object.assign(new Error('own lease lost'), { code: 'LEASE_LOST' }))
    const outcome = await pending
    assert.equal(outcome.error?.code, 'LEASE_LOST')
    await cancelled
    assert.equal(calls, 1)
  } finally {
    controller.abort()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await pending
  }
})
