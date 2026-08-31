import assert from 'node:assert/strict'
import test from 'node:test'
import { kandinskyImageTimeoutMs, kandinskyRequestTimeoutMs } from '../image-timeouts.mjs'

test('Kandinsky image polling allows normal jobs to run longer than the old 120 second limit', () => {
  assert.equal(kandinskyImageTimeoutMs({}), 300_000)
  assert.equal(kandinskyImageTimeoutMs({ KANDINSKY_IMAGE_TIMEOUT_MS: '420000' }), 420_000)
})

test('Kandinsky image timeout rejects unsafe or unbounded overrides', () => {
  assert.throws(() => kandinskyImageTimeoutMs({ KANDINSKY_IMAGE_TIMEOUT_MS: '119999' }))
  assert.throws(() => kandinskyImageTimeoutMs({ KANDINSKY_IMAGE_TIMEOUT_MS: '900001' }))
})

test('individual Kandinsky create and result requests tolerate a slow provider response', () => {
  assert.equal(kandinskyRequestTimeoutMs({}), 120_000)
  assert.equal(kandinskyRequestTimeoutMs({ KANDINSKY_REQUEST_TIMEOUT_MS: '180000' }), 180_000)
})

test('Kandinsky request timeout rejects unsafe or unbounded overrides', () => {
  assert.throws(() => kandinskyRequestTimeoutMs({ KANDINSKY_REQUEST_TIMEOUT_MS: '29999' }))
  assert.throws(() => kandinskyRequestTimeoutMs({ KANDINSKY_REQUEST_TIMEOUT_MS: '300001' }))
})
