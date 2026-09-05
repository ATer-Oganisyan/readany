import assert from 'node:assert/strict'
import test from 'node:test'
import { createSseFrameRelay } from '../sse-frame-relay.mjs'
import { createSseUsageCollector } from '../analytics-properties.mjs'

function harness(options = {}) {
  const collector = createSseUsageCollector()
  const writes = []
  const relay = createSseFrameRelay({ validateFrame: frame => collector.push(frame),
    writeFrame: frame => writes.push(Buffer.from(frame)), ...options })
  return { relay, collector, writes, output: () => Buffer.concat(writes).toString('utf8') }
}
const token = 'data: {"choices":[{"delta":{"content":"Привет"}}]}\n\n'
const length = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'
const done = 'data: [DONE]\n\n'

test('does not forward a partial JSON frame; truncation error can start on a clean boundary', () => {
  const h = harness()
  h.relay.push(Buffer.from(token))
  assert.equal(h.output(), token, 'valid tokens stream before completion')
  h.relay.push(Buffer.from(length.slice(0, 28)))
  assert.equal(h.output(), token)
  assert.throws(() => h.relay.push(Buffer.from(length.slice(28) + done)), { code: 'PARSE', status: 502 })
  assert.equal(h.output(), token)
})

test('coalesced valid tokens are forwarded individually before invalid frame, never DONE', () => {
  const h = harness()
  assert.throws(() => h.relay.push(Buffer.from(token + token + length + done)), { code: 'PARSE' })
  assert.equal(h.writes.length, 2)
  assert.equal(h.output(), token + token)
})

test('preserves exact UTF8 and CRLF bytes even when every byte arrives separately', () => {
  const h = harness()
  const bytes = Buffer.from((token + done).replaceAll('\n', '\r\n'))
  for (const byte of bytes) h.relay.push(Buffer.from([byte]))
  h.relay.finish()
  h.collector.value()
  assert.deepEqual(Buffer.concat(h.writes), bytes)
  assert.equal(h.writes.length, 2)
})

test('oversized unfinished frame fails without writing its bytes', () => {
  const h = harness({ maxBufferedBytes: 32 })
  h.relay.push(Buffer.from('data: '))
  assert.throws(() => h.relay.push(Buffer.from('x'.repeat(27))), { code: 'PARSE', status: 502 })
  assert.equal(h.writes.length, 0)
})

test('EOF with an unfinished frame fails; clean EOF remains compatible', () => {
  const h = harness()
  h.relay.push(Buffer.from(token))
  h.relay.push(Buffer.from('data: {'))
  assert.throws(() => h.relay.finish(), { code: 'PARSE', status: 502 })
  assert.equal(h.output(), token)
  const clean = harness()
  clean.relay.push(Buffer.from(token + done))
  clean.relay.finish()
  clean.collector.value()
})

test('frame bound applies per event rather than to the whole coalesced response', () => {
  const h = harness({ maxBufferedBytes: Buffer.byteLength(token) })
  h.relay.push(Buffer.from(token.repeat(20) + done))
  h.relay.finish()
  h.collector.value()
  assert.equal(h.writes.length, 21)
  assert.equal(h.output(), token.repeat(20) + done)
})

test('validation failure permanently closes the relay, even if caller attempts to continue', () => {
  const h = harness()
  assert.throws(() => h.relay.push(Buffer.from(length)), { code: 'PARSE' })
  assert.throws(() => h.relay.push(Buffer.from(token + done)), { code: 'PARSE' })
  assert.throws(() => h.relay.finish(), { code: 'PARSE' })
  assert.equal(h.writes.length, 0)
})

test('harmless trailing newline is retained without accepting unfinished data', () => {
  const h = harness()
  h.relay.push(Buffer.from(token + done + '\n'))
  h.relay.finish()
  h.collector.value()
  assert.equal(h.output(), token + done + '\n')
})
