const SAFE_WORKER_TYPE = /^[a-z][a-z0-9-]{1,79}$/
const SAFE_STATE = /^[a-z][a-z0-9_-]{1,39}$/

export function createWorkerHeartbeat({
  pool,
  workerId,
  workerType,
  buildVersion = process.env.GATEWAY_BUILD_VERSION || 'development',
  intervalMs = 15_000,
  logger = console
}) {
  const heartbeatId = String(process.env.HOSTNAME || workerId || '').slice(0, 200)
  const type = String(workerType || '')
  const build = String(buildVersion || '').slice(0, 120)
  if (!pool || typeof pool.query !== 'function') throw new TypeError('a pg-compatible pool is required')
  if (!heartbeatId || !SAFE_WORKER_TYPE.test(type) || !build) {
    throw new TypeError('worker heartbeat identity is invalid')
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
    throw new RangeError('worker heartbeat interval must be between 1000 and 60000 ms')
  }
  let state = 'ready'
  let stopped = false
  let busy = false

  async function beat() {
    if (stopped || busy) return
    busy = true
    try {
      await pool.query(
        `INSERT INTO worker_heartbeats (
           worker_id, worker_type, build_version, state, started_at, last_seen_at
         ) VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (worker_id) DO UPDATE
         SET worker_type = EXCLUDED.worker_type,
             build_version = EXCLUDED.build_version,
             state = EXCLUDED.state,
             last_seen_at = now()`,
        [heartbeatId, type, build, state]
      )
    } catch (error) {
      logger.warn?.('[worker-heartbeat] update failed', {
        worker_type: type,
        error_code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
      })
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => void beat(), intervalMs)
  timer.unref?.()
  return {
    id: heartbeatId,
    async start() {
      await beat()
    },
    setState(value) {
      if (!SAFE_STATE.test(String(value))) throw new TypeError('worker heartbeat state is invalid')
      state = String(value)
    },
    stop() {
      stopped = true
      clearInterval(timer)
    }
  }
}
