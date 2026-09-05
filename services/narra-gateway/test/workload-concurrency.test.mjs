import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkloadConcurrencyGate, chatWorkload } from '../workload-concurrency.mjs'
import { parseChatBody } from '../contracts.mjs'

test('background saturation preserves active and waiting capacity for interactive chat', async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 12, queueLimit: 16, name: 'llm' })
  const releases = []
  const controller = new AbortController()
  const queued = []
  try {
    for (let i = 0; i < 10; i++) releases.push(await gate.acquire(undefined, { workload: 'background' }))
    for (let i = 0; i < 12; i++) queued.push(gate.acquire(controller.signal, { workload: 'background' }).then(r => releases.push(r), () => {}))
    assert.equal(gate.status().active, 10)
    assert.equal(gate.status().waiting, 12)
    releases.push(await gate.acquire(undefined, { workload: 'interactive' }))
    releases.push(await gate.acquire(undefined, { workload: 'interactive' }))
    assert.equal(gate.status().active, 12)
  } finally {
    controller.abort(); await Promise.all(queued); releases.forEach(r => r())
  }
  assert.equal(gate.status().active, 0)
})

test('interactive saturation leaves a background slot and progress in both classes', async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 3, queueLimit: 6 })
  const a = await gate.acquire(undefined, { workload: 'interactive' })
  const b = await gate.acquire(undefined, { workload: 'interactive' })
  const c = await gate.acquire(undefined, { workload: 'background' })
  const order = []
  const i = gate.acquire(undefined, { workload: 'interactive' }).then(r => { order.push('interactive'); r() })
  const bg = gate.acquire(undefined, { workload: 'background' }).then(r => { order.push('background'); r() })
  c(); await bg
  assert.deepEqual(order, ['background'])
  a(); await i; b()
  assert.equal(gate.status().active, 0)
})

test('queued abort removes waiter; abort after dispatch retains active slot until release', async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 2 })
  const first = await gate.acquire()
  const cancelled = new AbortController()
  const wait = gate.acquire(cancelled.signal)
  cancelled.abort(new Error('stop'))
  await assert.rejects(wait, /stop/)
  assert.equal(gate.status().waiting, 0)
  const dispatched = new AbortController()
  const next = gate.acquire(dispatched.signal)
  first(); first(); dispatched.abort()
  const release = await next
  assert.equal(gate.status().active, 1)
  release(); release()
  assert.equal(gate.status().active, 0)
  await assert.rejects(gate.acquire(dispatched.signal))
})

test('queue reservations and overall queue cap reject overflow without leaking entries', async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 2, queueLimit: 4, interactiveQueueReserve: 2, backgroundQueueReserve: 1 })
  const controller = new AbortController()
  const releases = [await gate.acquire(), await gate.acquire(undefined, { workload: 'interactive' })]
  const pending = []
  for (const workload of ['background', 'background', 'interactive', 'interactive']) pending.push(gate.acquire(controller.signal, { workload }).catch(() => {}))
  assert.equal(gate.status().waiting, 4)
  for (const workload of ['background', 'interactive']) await assert.rejects(gate.acquire(undefined, { workload }), e => e.status === 429)
  controller.abort(); await Promise.all(pending); releases.forEach(r => r())
  assert.equal(gate.status().waiting, 0)
})

test('eligible round robin preserves FIFO within each class under mixed sustained work', async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 1, queueLimit: 100, interactiveQueueReserve: 0, backgroundQueueReserve: 0 })
  const first = await gate.acquire()
  const order = []
  const jobs = []
  for (let n = 0; n < 20; n++) for (const workload of ['background', 'interactive']) {
    jobs.push(gate.acquire(undefined, { workload }).then(async release => {
      assert.equal(gate.status().active, 1)
      order.push(`${workload}:${n}`)
      await Promise.resolve(); release(); release()
      assert.ok(gate.status().active <= 1)
    }))
  }
  first(); await Promise.all(jobs)
  assert.deepEqual(order, Array.from({ length: 20 }, (_, n) => [`interactive:${n}`, `background:${n}`]).flat())
  assert.equal(gate.status().active, 0)
})

test('small defaults and zero waiting capacity work; invalid configuration fails closed', async () => {
  for (const limit of [1, 2]) {
    const gate = createWorkloadConcurrencyGate({ limit, queueLimit: 0 })
    const release = await gate.acquire()
    await assert.rejects(gate.acquire(), e => e.status === 429)
    release()
  }
  for (const config of [
    { limit: 0 }, { limit: 1.5 }, { queueLimit: -1 }, { interactiveReserve: -1 },
    { backgroundReserve: NaN }, { interactiveReserve: 12 },
    { interactiveReserve: 7, backgroundReserve: 6 },
    { interactiveQueueReserve: 16 }, { interactiveQueueReserve: 10, backgroundQueueReserve: 8 }
  ]) assert.throws(() => createWorkloadConcurrencyGate({ limit: 12, queueLimit: 16, ...config }))
  await assert.rejects(createWorkloadConcurrencyGate({ limit: 1, queueLimit: 1 }).acquire(undefined, { workload: 'user' }), /unknown/)
})

test('validated conversational purpose, not claimed user origin or transport, selects reserve', () => {
  for (const stream of [false, true]) for (const purpose of ['assistant', 'character_chat', 'structured_task', 'summary', 'scenario', 'memory']) {
    const input = parseChatBody({ messages: [{ role: 'user', content: 'Hello' }], purpose, origin: 'user' }, { stream })
    assert.equal(chatWorkload(input), ['assistant', 'character_chat'].includes(purpose) ? 'interactive' : 'background')
  }
  assert.throws(() => parseChatBody({ messages: [], purpose: 'override' }))
})

test('100-request burst never exceeds shared 12-active/16-waiting limits and fully drains', async () => {
  const gate = createWorkloadConcurrencyGate({ limit: 12, queueLimit: 16 })
  let peak = 0
  let accepted = 0
  let rejected = 0
  const pending = Array.from({ length: 100 }, (_, index) => {
    const promise = gate.acquire(undefined, { workload: index % 2 ? 'interactive' : 'background' })
    const status = gate.status()
    peak = Math.max(peak, status.active)
    assert.ok(status.active <= 12)
    assert.ok(status.waiting <= 16)
    return promise.then(async release => {
      accepted++
      assert.ok(gate.status().active <= 12)
      await Promise.resolve()
      release()
    }, error => { assert.equal(error.status, 429); rejected++ })
  })
  await Promise.all(pending)
  assert.equal(peak, 12)
  assert.equal(accepted, 28)
  assert.equal(rejected, 72)
  assert.equal(gate.status().active, 0)
  assert.equal(gate.status().waiting, 0)
})
