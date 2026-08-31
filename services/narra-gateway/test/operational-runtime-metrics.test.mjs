import assert from 'node:assert/strict'
import test from 'node:test'
import {
  operationalRuntimeMetrics,
  recordProviderFailure,
  resetOperationalRuntimeMetricsForTests
} from '../operational-runtime-metrics.mjs'

test('runtime provider metrics aggregate only bounded safe categories', () => {
  resetOperationalRuntimeMetricsForTests()
  recordProviderFailure('salutespeech', '429')
  recordProviderFailure('salutespeech', '429')
  recordProviderFailure('bad/provider', 'private detail')
  assert.deepEqual(operationalRuntimeMetrics(), {
    providerFailures: [
      { provider: 'salutespeech', category: '429', count: 2 },
      { provider: 'unknown', category: 'other', count: 1 }
    ]
  })
})
