import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkerHeartbeat } from '../worker-heartbeat.mjs'

test('worker heartbeat publishes only safe identity, type, build and state', async () => {
  const previousHostname = process.env.HOSTNAME
  process.env.HOSTNAME = 'container-id'
  const calls = []
  const heartbeat = createWorkerHeartbeat({
    pool: { query: async (...args) => { calls.push(args); return { rows: [] } } },
    workerId: 'fallback',
    workerType: 'book-scene',
    buildVersion: 'sha-123',
    intervalMs: 60_000
  })
  try {
    await heartbeat.start()
    assert.equal(heartbeat.id, 'container-id')
    assert.match(calls[0][0], /INSERT INTO worker_heartbeats/)
    assert.deepEqual(calls[0][1], ['container-id', 'book-scene', 'sha-123', 'ready'])
  } finally {
    heartbeat.stop()
    if (previousHostname === undefined) delete process.env.HOSTNAME
    else process.env.HOSTNAME = previousHostname
  }
})

test('worker heartbeat rejects unsafe types and states', () => {
  const pool = { query: async () => ({ rows: [] }) }
  assert.throws(() => createWorkerHeartbeat({ pool, workerId: 'id', workerType: '../secret' }))
  const heartbeat = createWorkerHeartbeat({ pool, workerId: 'id', workerType: 'book-media' })
  try {
    assert.throws(() => heartbeat.setState('bad state'))
  } finally {
    heartbeat.stop()
  }
})
