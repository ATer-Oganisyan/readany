import { createPostgresPoolFromEnv } from './postgres-runtime.mjs'

const workerId = String(process.env.HOSTNAME || '')
const workerType = String(process.env.WORKER_TYPE || '')
const buildVersion = String(process.env.GATEWAY_BUILD_VERSION || '')
let pool
try {
  if (!workerId || !workerType || !buildVersion) throw new Error('worker health identity is missing')
  process.kill(1, 0)
  pool = await createPostgresPoolFromEnv({ ...process.env, DATABASE_POOL_MAX: '1' })
  const result = await pool.query(
    `SELECT 1 FROM worker_heartbeats
     WHERE worker_id = $1 AND worker_type = $2 AND build_version = $3
       AND last_seen_at >= now() - interval '60 seconds'`,
    [workerId, workerType, buildVersion]
  )
  if (!result.rows[0]) process.exitCode = 1
} catch {
  process.exitCode = 1
} finally {
  await pool?.end().catch(() => {})
}
