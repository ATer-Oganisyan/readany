import assert from 'node:assert/strict'
import test from 'node:test'
import { createOperationalMetricsRepository } from '../operational-metrics-repository.mjs'

test('operator metrics expose aggregate queue, worker, latency and sidecar state only', async () => {
  const pool = {
    async query(sql) {
      const source = String(sql)
      if (source.includes('FROM generation_jobs') && source.includes('GROUP BY job_type')) {
        return { rows: [{
          job_type: 'scene_image', status: 'queued', error_code: '', count: 4,
          claimable_now: 1, paused: 2, future: 1
        }] }
      }
      if (source.includes('FROM generation_jobs') && source.includes('oldest_claimable_ms')) {
        return { rows: [{ oldest_claimable_ms: 42_000, oldest_running_ms: 7_000 }] }
      }
      if (source.includes('FROM book_analysis_jobs')) {
        if (source.includes('oldest_running_ms')) {
          return { rows: [{ oldest_running_ms: 12_000, expired_leases: 1 }] }
        }
        return { rows: [{ stage: 'scan', status: 'failed', error_code: 'TIMEOUT', count: 2 }] }
      }
      if (source.includes('WITH latest AS')) {
        return { rows: [{
          status: 'cancelled', count: 3, stale_active: 0, terminal_without_publication: 3
        }] }
      }
      if (source.includes('pg_stat_database')) return { rows: [{ deadlocks: 5 }] }
      if (source.includes('FROM worker_heartbeats')) {
        return { rows: [{
          worker_type: 'book-scene', build_version: 'sha', state: 'ready',
          count: 1, active: 1, last_seen_at: '2026-08-31T20:00:00Z'
        }] }
      }
      if (source.includes("job_type = 'scene_image'")) {
        return { rows: [{
          ready: 8, enqueue_to_ready_ms_avg: 120_000, ready_to_download_ms_avg: 3_000
        }] }
      }
      if (source.includes('FROM book_tts_markup_jobs')) {
        return { rows: [{ status: 'ready', count: 7 }] }
      }
      if (source.includes('FROM book_tts_markup_publications')) {
        return { rows: [{ publications: 6 }] }
      }
      if (source.includes("job_type = 'character_audio'")) {
        return { rows: [{ status: 'failed', error_code: 'RATE', count: 2 }] }
      }
      throw new Error('unexpected metrics query')
    }
  }
  const snapshot = await createOperationalMetricsRepository(pool).snapshot({
    runtime: { providerFailures: [{ provider: 'salutespeech', category: '429', count: 2 }] },
    concurrency: { speech: { active: 2, waiting: 1, limit: 5, queue_limit: 16 } },
    buildVersion: 'sha'
  })
  assert.deepEqual(snapshot.generationJobs[0], {
    jobType: 'scene_image', status: 'queued', errorCode: undefined,
    count: 4, claimableNow: 1, paused: 2, future: 1
  })
  assert.deepEqual(snapshot.providers, [
    { provider: 'salutespeech', category: '429', count: 2 }
  ])
  assert.deepEqual(snapshot.generationQueue, {
    oldestClaimableAgeMs: 42_000,
    oldestRunningAgeMs: 7_000
  })
  assert.deepEqual(snapshot.analysisQueue, {
    oldestRunningLeaseAgeMs: 12_000,
    expiredLeases: 1
  })
  assert.equal(snapshot.privateRuns[0].terminalWithoutPublication, 3)
  assert.deepEqual(snapshot.scenes, {
    ready: 8,
    enqueueToReadyMsAverage: 120_000,
    readyToDownloadMsAverage: 3_000
  })
  assert.equal(snapshot.postgres.deadlocks, 5)
  assert.equal(snapshot.workers[0].active, 1)
  assert.equal(snapshot.ttsSidecar.publications, 6)
  assert.deepEqual(snapshot.greetings[0], {
    status: 'failed', errorCode: 'RATE', count: 2
  })
  assert.equal(JSON.stringify(snapshot).includes('book text'), false)
})
