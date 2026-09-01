function count(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function duration(value) {
  if (value == null) return null
  return Math.max(0, Math.round(count(value)))
}

export function createOperationalMetricsRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  return {
    async snapshot({ runtime, concurrency, buildVersion }) {
      const [
        generation,
        generationAges,
        analysis,
        analysisAges,
        privateRuns,
        postgres,
        workers,
        scenes,
        ttsJobs,
        ttsPublications,
        greetings
      ] =
        await Promise.all([
          pool.query(
            `SELECT job_type, status, coalesce(last_error_code, '') AS error_code,
                    count(*)::integer AS count,
                    count(*) FILTER (
                      WHERE status = 'queued' AND available_at <= now()
                        AND operator_pause_id IS NULL
                    )::integer AS claimable_now,
                    count(*) FILTER (WHERE operator_pause_id IS NOT NULL)::integer AS paused,
                    count(*) FILTER (
                      WHERE status = 'queued' AND available_at > now()
                        AND operator_pause_id IS NULL
                    )::integer AS future
             FROM generation_jobs
             GROUP BY job_type, status, coalesce(last_error_code, '')
             ORDER BY job_type, status, error_code`
          ),
          pool.query(
            `SELECT
               round(extract(epoch FROM (now() - min(created_at) FILTER (
                 WHERE status = 'queued' AND available_at <= now()
                   AND operator_pause_id IS NULL
               ))) * 1000)::bigint AS oldest_claimable_ms,
               round(extract(epoch FROM (now() - min(locked_at) FILTER (
                 WHERE status = 'running' AND locked_at IS NOT NULL
               ))) * 1000)::bigint
                 AS oldest_running_ms
             FROM generation_jobs`
          ),
          pool.query(
            `SELECT stage, status, coalesce(last_error_code, '') AS error_code,
                    count(*)::integer AS count
             FROM book_analysis_jobs
             GROUP BY stage, status, coalesce(last_error_code, '')
             ORDER BY stage, status, error_code`
          ),
          pool.query(
            `SELECT
               round(extract(epoch FROM (now() - min(locked_at) FILTER (
                 WHERE status = 'running' AND locked_at IS NOT NULL
               ))) * 1000)::bigint
                 AS oldest_running_ms,
               count(*) FILTER (WHERE status = 'running' AND lease_expires_at <= now())::integer
                 AS expired_leases
             FROM book_analysis_jobs`
          ),
          pool.query(
            `WITH latest AS (
               SELECT DISTINCT ON (run.book_edition_id)
                      run.id, run.status, run.updated_at
               FROM book_analysis_runs AS run
               JOIN book_editions AS edition ON edition.id = run.book_edition_id
               WHERE edition.scope = 'private'
               ORDER BY run.book_edition_id, run.run_sequence DESC, run.created_at DESC, run.id DESC
             )
             SELECT latest.status, count(*)::integer AS count,
                    count(*) FILTER (
                      WHERE latest.status IN ('queued', 'running')
                        AND latest.updated_at < now() - interval '15 minutes'
                    )::integer AS stale_active,
                    count(*) FILTER (
                      WHERE latest.status IN ('failed', 'cancelled')
                        AND publication.id IS NULL
                    )::integer AS terminal_without_publication
             FROM latest
             LEFT JOIN book_analysis_publications AS publication ON publication.run_id = latest.id
             GROUP BY latest.status ORDER BY latest.status`
          ),
          pool.query(
            `SELECT deadlocks::bigint AS deadlocks
             FROM pg_stat_database WHERE datname = current_database()`
          ),
          pool.query(
            `SELECT worker_type, build_version, state,
                    count(*)::integer AS count,
                    count(*) FILTER (
                      WHERE last_seen_at >= now() - interval '60 seconds'
                    )::integer AS active,
                    max(last_seen_at) AS last_seen_at
             FROM worker_heartbeats
             GROUP BY worker_type, build_version, state
             ORDER BY worker_type, build_version, state`
          ),
          pool.query(
            `SELECT count(*) FILTER (WHERE status = 'ready')::integer AS ready,
                    round(avg(extract(epoch FROM (updated_at - created_at)) * 1000)
                      FILTER (WHERE status = 'ready'))::bigint AS enqueue_to_ready_ms_avg,
                    round(avg(extract(epoch FROM (first_download_at - updated_at)) * 1000)
                      FILTER (WHERE first_download_at IS NOT NULL))::bigint
                      AS ready_to_download_ms_avg
             FROM generation_jobs WHERE job_type = 'scene_image'`
          ),
          pool.query(
            `SELECT status, count(*)::integer AS count
             FROM book_tts_markup_jobs GROUP BY status ORDER BY status`
          ),
          pool.query(
            'SELECT count(*)::integer AS publications FROM book_tts_markup_publications'
          ),
          pool.query(
            `SELECT status, coalesce(last_error_code, '') AS error_code,
                    count(*)::integer AS count
             FROM generation_jobs WHERE job_type = 'character_audio'
             GROUP BY status, coalesce(last_error_code, '')
             ORDER BY status, error_code`
          )
        ])
      return {
        buildVersion,
        generatedAt: new Date().toISOString(),
        generationJobs: generation.rows.map((row) => ({
          jobType: row.job_type,
          status: row.status,
          errorCode: row.error_code || undefined,
          count: count(row.count),
          claimableNow: count(row.claimable_now),
          paused: count(row.paused),
          future: count(row.future)
        })),
        generationQueue: {
          oldestClaimableAgeMs: duration(generationAges.rows[0]?.oldest_claimable_ms),
          oldestRunningAgeMs: duration(generationAges.rows[0]?.oldest_running_ms)
        },
        analysisJobs: analysis.rows.map((row) => ({
          stage: row.stage,
          status: row.status,
          errorCode: row.error_code || undefined,
          count: count(row.count)
        })),
        analysisQueue: {
          oldestRunningLeaseAgeMs: duration(analysisAges.rows[0]?.oldest_running_ms),
          expiredLeases: count(analysisAges.rows[0]?.expired_leases)
        },
        privateRuns: privateRuns.rows.map((row) => ({
          status: row.status,
          count: count(row.count),
          staleActive: count(row.stale_active),
          terminalWithoutPublication: count(row.terminal_without_publication)
        })),
        providers: runtime.providerFailures,
        speech: concurrency.speech,
        postgres: { deadlocks: count(postgres.rows[0]?.deadlocks) },
        workers: workers.rows.map((row) => ({
          workerType: row.worker_type,
          buildVersion: row.build_version,
          state: row.state,
          count: count(row.count),
          active: count(row.active),
          lastSeenAt: row.last_seen_at
        })),
        scenes: {
          ready: count(scenes.rows[0]?.ready),
          enqueueToReadyMsAverage: duration(scenes.rows[0]?.enqueue_to_ready_ms_avg),
          readyToDownloadMsAverage: duration(scenes.rows[0]?.ready_to_download_ms_avg)
        },
        ttsSidecar: {
          jobs: ttsJobs.rows.map((row) => ({
            status: row.status,
            count: count(row.count)
          })),
          publications: count(ttsPublications.rows[0]?.publications)
        },
        greetings: greetings.rows.map((row) => ({
          status: row.status,
          errorCode: row.error_code || undefined,
          count: count(row.count)
        }))
      }
    }
  }
}
