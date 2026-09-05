import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runMixedLoadSmoke } from './gateway-mixed-load-smoke.mjs'

test('default invocation is a dry run', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/qa/gateway-mixed-load-smoke.mjs'], { timeout: 2000 })
  assert.match(stdout, /^Dry run:/)
  assert.doesNotMatch(stdout, /evidenceDirectory/)
})

test('held burst proves overload before release independently of slow provider and arrival timing', { timeout: 30000 }, async () => {
  const result = await runMixedLoadSmoke({ fixtureBodyDelayMs: 600, fixtureHoldBurst: true })
  assert.ok(result.checks.heldBurstRejected >= 12)
  assert.equal(result.checks.openBurstRejected, result.checks.heldBurstRejected)
  assert.equal(result.checks.openBurstCompleted + result.checks.openBurstRejected, 40)
  assert.deepEqual(result.checks.backgroundFairness, { completed: 2, foregroundHeld: 11, foregroundQueued: 4 })
  assert.equal(result.final.active, 0)
  assert.equal(result.final.waiting, 0)
})

test('actual isolated gateway admits reserved chat, rejects overflow, handles faults and drains', { timeout: 30000 }, async () => {
  const result = await runMixedLoadSmoke()
  assert.equal(result.requests, 84)
  assert.deepEqual(result.checks.reservedInteractive, [200, 200])
  assert.equal(result.checks.invalidBodyStatus, 400)
  assert.deepEqual(result.checks.backgroundFairness, { completed: 2, foregroundHeld: 11, foregroundQueued: 4 })
  assert.ok(result.checks.mixedBackgroundCompleted > 0)
  assert.equal(result.checks.mixedBackgroundCompleted + result.checks.mixedBackgroundRejected, 14)
  assert.equal(result.checks.openBurstCompleted + result.checks.openBurstRejected, 40)
  assert.equal(result.outcomes[200], 4 + result.checks.openBurstCompleted)
  assert.equal(result.outcomes[429], 1 + result.checks.openBurstRejected)
  assert.equal(result.outcomes[503] ?? result.outcomes[502], 1)
  assert.equal(result.outcomes.AbortError, 38)
  assert.equal(result.peakProvider, 12)
  assert.ok(result.peakQueueSampled <= 16)
  assert.equal(result.final.active, 0)
  assert.equal(result.final.waiting, 0)
  assert.ok(result.rssKiB.samples > 0)
  assert.match(result.ledgerBoundary, /no PostgreSQL/)
  assert.match(result.scope, /NOT capacity/)
  await assert.rejects(access(join(result.evidenceDirectory, 'gateway-data')), { code: 'ENOENT' })
  const evidence = JSON.parse(await readFile(join(result.evidenceDirectory, 'report.json'), 'utf8'))
  assert.deepEqual(evidence.checks, result.checks)
  assert.equal((await stat(join(result.evidenceDirectory, 'report.json'))).mode & 0o777, 0o600)
})

test('broken reserved background completion fails the actual HTTP fairness gate and retains evidence', { timeout: 30000 }, async () => {
  let failure
  await assert.rejects(runMixedLoadSmoke({ fixtureFairnessFailure: true }), error => {
    failure = error
    return /Reserved background must complete successfully/.test(error.message)
  })
  const directory = failure.message.match(/; evidence: (.+)$/)[1]
  const evidence = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8'))
  assert.ok(evidence.observations.some(row => row.name === 'hold-fairness-first' && [502, 503].includes(row.status)))
  await assert.rejects(access(join(directory, 'gateway-data')), { code: 'ENOENT' })
})
