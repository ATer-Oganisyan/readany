import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCoverJobStore } from '../cover-job-store.mjs'

const INSTALLATION_ID = '123e4567-e89b-42d3-a456-426614174000'
const OTHER_INSTALLATION_ID = '223e4567-e89b-42d3-a456-426614174000'
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000'
const OTHER_REQUEST_ID = '423e4567-e89b-42d3-a456-426614174000'

async function temporaryStore(options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'narra-cover-jobs-'))
  const store = createCoverJobStore({ dataDir, environment: 'test', ...options })
  await store.start()
  return { dataDir, store }
}

test('cover jobs survive restart and idempotency is scoped to one installation', async () => {
  let timestamp = Date.UTC(2026, 7, 12, 12)
  const options = { now: () => timestamp, resultTtlMs: 60_000 }
  const { dataDir, store } = await temporaryStore(options)
  let reservations = 0
  try {
    const first = await store.createOrGet({
      installationId: INSTALLATION_ID,
      requestId: REQUEST_ID,
      prompt: 'front cover',
      beforeCreate: async () => { reservations += 1 }
    })
    const repeated = await store.createOrGet({
      installationId: INSTALLATION_ID,
      requestId: REQUEST_ID,
      prompt: 'front cover',
      beforeCreate: async () => { reservations += 1 }
    })
    assert.equal(first.created, true)
    assert.equal(repeated.created, false)
    assert.equal(repeated.job.job_id, first.job.job_id)
    assert.equal(reservations, 1)
    await assert.rejects(
      store.createOrGet({
        installationId: INSTALLATION_ID,
        requestId: REQUEST_ID,
        prompt: 'different cover'
      }),
      (error) => error?.code === 'CONFLICT' && error?.status === 409
    )

    const running = await store.claimNext()
    assert.equal(running.job_id, first.job.job_id)
    assert.equal(running.status, 'running')
    assert.equal(running.attempt_count, 1)
    await store.stop()

    timestamp += 1_000
    const restarted = createCoverJobStore({ dataDir, environment: 'test', ...options })
    await restarted.start()
    try {
      const recovered = restarted.getForInstallation(first.job.job_id, INSTALLATION_ID)
      assert.equal(recovered.status, 'queued')
      assert.equal(recovered.attempt_count, 1)
      assert.equal(recovered.error_code, 'CANCELLED')
      assert.equal(restarted.getForInstallation(first.job.job_id, OTHER_INSTALLATION_ID), null)

      const afterRestart = await restarted.createOrGet({
        installationId: INSTALLATION_ID,
        requestId: REQUEST_ID,
        prompt: 'front cover',
        beforeCreate: async () => { reservations += 1 }
      })
      assert.equal(afterRestart.created, false)
      assert.equal(reservations, 1)
      const reclaimed = await restarted.claimNext()
      assert.equal(reclaimed.job_id, first.job.job_id)
      assert.equal(reclaimed.attempt_count, 2)
      const otherOwner = await restarted.createOrGet({
        installationId: OTHER_INSTALLATION_ID,
        requestId: REQUEST_ID,
        prompt: 'front cover'
      })
      assert.notEqual(otherOwner.job.job_id, first.job.job_id)
    } finally {
      await restarted.stop()
    }
  } finally {
    await store.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('completed result and acknowledgement are restricted to the owning installation', async () => {
  const { dataDir, store } = await temporaryStore()
  try {
    const created = await store.createOrGet({
      installationId: INSTALLATION_ID,
      requestId: REQUEST_ID,
      prompt: 'front cover'
    })
    await store.claimNext()
    const completed = await store.markCompleted(created.job.job_id, {
      image: Buffer.from('cover-bytes'),
      mimeType: 'image/jpeg',
      model: 'openai/gpt-image-2'
    })

    assert.equal(store.getForInstallation(completed.job_id, OTHER_INSTALLATION_ID), null)
    assert.equal(
      await store.readResult({ ...completed, installation_id: OTHER_INSTALLATION_ID }),
      null
    )
    assert.equal((await store.readResult(completed)).toString(), 'cover-bytes')
    assert.equal(await store.acknowledge(completed.job_id, OTHER_INSTALLATION_ID), false)
    assert.ok(store.getForInstallation(completed.job_id, INSTALLATION_ID))
    assert.equal(await store.acknowledge(completed.job_id, INSTALLATION_ID), true)
    assert.equal(store.getForInstallation(completed.job_id, INSTALLATION_ID), null)
    assert.equal(store.status().total, 0)
  } finally {
    await store.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('expired jobs are removed before the capacity check', async () => {
  let timestamp = Date.UTC(2026, 7, 12, 12)
  const { dataDir, store } = await temporaryStore({
    maxJobs: 1,
    resultTtlMs: 100,
    now: () => timestamp
  })
  try {
    const expired = await store.createOrGet({
      installationId: INSTALLATION_ID,
      requestId: REQUEST_ID,
      prompt: 'old cover'
    })
    timestamp += 101
    const replacement = await store.createOrGet({
      installationId: INSTALLATION_ID,
      requestId: OTHER_REQUEST_ID,
      prompt: 'new cover'
    })
    assert.equal(replacement.created, true)
    assert.equal(store.getForInstallation(expired.job.job_id, INSTALLATION_ID), null)
    assert.equal(store.status().total, 1)
  } finally {
    await store.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('completed result metadata is restart-safe and missing results are quarantined', async () => {
  const { dataDir, store } = await temporaryStore()
  let completed
  try {
    const created = await store.createOrGet({
      installationId: INSTALLATION_ID,
      requestId: REQUEST_ID,
      prompt: 'front cover'
    })
    await store.claimNext()
    completed = await store.markCompleted(created.job.job_id, {
      image: Buffer.from('durable-cover'),
      mimeType: 'image/jpeg'
    })
    await store.stop()

    const restarted = createCoverJobStore({ dataDir, environment: 'test' })
    await restarted.start()
    const loaded = restarted.getForInstallation(completed.job_id, INSTALLATION_ID)
    assert.equal(loaded.status, 'completed')
    assert.equal((await restarted.readResult(loaded)).toString(), 'durable-cover')
    await restarted.stop()

    await unlink(path.join(
      dataDir,
      'cover-jobs-test',
      'results',
      completed.result_file
    ))
    const withoutResult = createCoverJobStore({ dataDir, environment: 'test' })
    await withoutResult.start()
    try {
      assert.equal(withoutResult.status().total, 0)
      const quarantined = await readdir(path.join(dataDir, 'cover-jobs-test', 'quarantine'))
      assert.ok(quarantined.some((name) => name.includes(`${completed.job_id}.json`)))
    } finally {
      await withoutResult.stop()
    }
  } finally {
    await store.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
})
