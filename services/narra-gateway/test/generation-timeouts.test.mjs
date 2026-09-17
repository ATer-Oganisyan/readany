import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INTERNAL_GENERATION_TIMEOUT_MS,
  PORTRAIT_CASCADE_MAX_BUDGET_MS,
  PORTRAIT_CASCADE_RESERVE_MS,
  portraitCascadeBudgetMs
} from '../platform/generation-timeouts.mjs'

test('portrait cascade uses only the time left after queueing and reserves time for bundle completion', () => {
  assert.equal(
    PORTRAIT_CASCADE_MAX_BUDGET_MS + PORTRAIT_CASCADE_RESERVE_MS,
    INTERNAL_GENERATION_TIMEOUT_MS
  )
  assert.equal(portraitCascadeBudgetMs(10 * 60_000, 0), PORTRAIT_CASCADE_MAX_BUDGET_MS)
  assert.equal(portraitCascadeBudgetMs(5 * 60_000, 0), 3 * 60_000)
  assert.equal(portraitCascadeBudgetMs(5 * 60_000, 4 * 60_000), -60_000)
})
