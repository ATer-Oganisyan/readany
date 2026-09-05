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

test('actual isolated gateway admits reserved chat, rejects overflow, handles faults and drains', { timeout: 30000 }, async () => {
  const result = await runMixedLoadSmoke()
  assert.equal(result.requests, 67)
  assert.deepEqual(result.checks.reservedInteractive, [200, 200])
  assert.equal(result.checks.invalidBodyStatus, 400)
  assert.equal(result.checks.mixedBackgroundCompleted, 14)
  assert.equal(result.outcomes[200], 42)
  assert.equal(result.outcomes[429], 1)
  assert.equal(result.outcomes[503] ?? result.outcomes[502], 1)
  assert.equal(result.outcomes.AbortError, 23)
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
