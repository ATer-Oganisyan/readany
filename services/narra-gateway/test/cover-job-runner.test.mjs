import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCoverJobRunner } from '../cover-job-runner.mjs'
import { createCoverJobStore } from '../cover-job-store.mjs'

const INSTALLATION_ID = '123e4567-e89b-42d3-a456-426614174000'
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000'

async function runnerFixture(generate) {
  let timestamp = Date.UTC(2026, 7, 12, 12)
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'narra-cover-runner-'))
  const store = createCoverJobStore({
    dataDir,
    environment: 'test',
    now: () => timestamp
  })
  await store.start()
  const created = await store.createOrGet({
    installationId: INSTALLATION_ID,
    requestId: REQUEST_ID,
    prompt: 'front cover'
  })
  const runner = createCoverJobRunner({
    store,
    generate,
    maxAttempts: 3,
    retryDelaysMs: [50, 100],
    attemptTimeoutMs: 1_000,
    now: () => timestamp
  })
  return {
    dataDir,
    store,
    runner,
    jobId: created.job.job_id,
    advance(milliseconds) { timestamp += milliseconds }
  }
}

test('cover runner persists a transient retry and later completes the same job', async () => {
  let calls = 0
  const fixture = await runnerFixture(async () => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('connection reset'), { code: 'NETWORK' })
    return {
      image: Buffer.from('generated-cover').toString('base64'),
      mimeType: 'image/jpeg',
      model: 'google/gemini-2.5-flash-image'
    }
  })
  try {
    assert.equal(await fixture.runner.runOnce(), true)
    let job = fixture.store.getForInstallation(fixture.jobId, INSTALLATION_ID)
    assert.equal(job.status, 'retry_wait')
    assert.equal(job.attempt_count, 1)
    assert.equal(job.error_code, 'NETWORK')
    assert.equal(await fixture.runner.runOnce(), false)

    fixture.advance(50)
    assert.equal(await fixture.runner.runOnce(), true)
    job = fixture.store.getForInstallation(fixture.jobId, INSTALLATION_ID)
    assert.equal(job.status, 'completed')
    assert.equal(job.attempt_count, 2)
    assert.equal(job.model, 'google/gemini-2.5-flash-image')
    assert.equal((await fixture.store.readResult(job)).toString(), 'generated-cover')
    assert.equal(calls, 2)
  } finally {
    await fixture.runner.stop()
    await fixture.store.stop()
    await rm(fixture.dataDir, { recursive: true, force: true })
  }
})

test('cover runner does not retry a terminal moderation failure', async () => {
  let calls = 0
  const fixture = await runnerFixture(async () => {
    calls += 1
    throw Object.assign(new Error('content blocked'), { code: 'CENSOR' })
  })
  try {
    assert.equal(await fixture.runner.runOnce(), true)
    const job = fixture.store.getForInstallation(fixture.jobId, INSTALLATION_ID)
    assert.equal(job.status, 'failed')
    assert.equal(job.attempt_count, 1)
    assert.equal(job.error_code, 'CENSOR')
    assert.equal(await fixture.runner.runOnce(), false)
    assert.equal(calls, 1)
  } finally {
    await fixture.runner.stop()
    await fixture.store.stop()
    await rm(fixture.dataDir, { recursive: true, force: true })
  }
})

test('cover runner treats a raw timeout as retryable', async () => {
  const fixture = await runnerFixture(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  })
  try {
    assert.equal(await fixture.runner.runOnce(), true)
    const job = fixture.store.getForInstallation(fixture.jobId, INSTALLATION_ID)
    assert.equal(job.status, 'retry_wait')
    assert.equal(job.error_code, 'TIMEOUT')
  } finally {
    await fixture.runner.stop()
    await fixture.store.stop()
    await rm(fixture.dataDir, { recursive: true, force: true })
  }
})
