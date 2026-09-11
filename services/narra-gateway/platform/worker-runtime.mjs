import { createOperationalLogger } from './operational-log.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from '../db/postgres-runtime.mjs'
import { createWorkerHeartbeat } from './worker-heartbeat.mjs'

export function createShutdownSignal() {
  const controller = new AbortController()
  process.once('SIGTERM', () => controller.abort())
  process.once('SIGINT', () => controller.abort())
  return controller.signal
}

export function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

function errorCodeOf(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

/**
 * Опрашивает несколько воркеров в одном процессе: каждый цикл проходит по всем
 * слотам и засыпает только тогда, когда ни один из них не взял задание.
 * Воркеры обязаны возвращать `{ status: 'idle' | 'completed' | 'failed' }`.
 */
export async function runWorkerLoop({
  slots,
  pollMs,
  idleLogMs,
  log,
  signal,
  workerId,
  queueLabel = 'заданий'
}) {
  if (!Array.isArray(slots) || !slots.length) throw new TypeError('at least one worker slot is required')
  let lastIdleLogAt = 0
  while (!signal.aborted) {
    let progressed = false
    for (const slot of slots) {
      if (signal.aborted) break
      try {
        const result = await slot.worker.runOnce()
        if (result.status !== 'idle') progressed = true
      } catch (error) {
        log.error('worker.queue_unavailable', `Очередь ${queueLabel} временно недоступна`, {
          worker: slot.workerId || workerId,
          stage: slot.name ?? null,
          error_code: errorCodeOf(error)
        })
      }
    }
    if (progressed) continue
    if (idleLogMs && Date.now() - lastIdleLogAt >= idleLogMs) {
      log.info('worker.idle', `Очередь ${queueLabel} пуста`, { worker: workerId })
      lastIdleLogAt = Date.now()
    }
    await delay(pollMs, signal)
  }
}

/**
 * Поднимает общее окружение воркера — пул, миграции, heartbeat, логгер — и
 * гарантированно закрывает его. `run` получает `{ pool, log, signal, heartbeat }`.
 */
export async function withWorkerRuntime(
  { component, workerType, workerId, migrate = true, heartbeat: heartbeatEnabled = true },
  run
) {
  const log = createOperationalLogger({ component })
  const signal = createShutdownSignal()
  const pool = await createPostgresPoolFromEnv(process.env)
  let heartbeat
  try {
    if (migrate) await runBookMarkupMigrations(pool)
    if (heartbeatEnabled) {
      heartbeat = createWorkerHeartbeat({
        pool,
        workerId,
        workerType: process.env.WORKER_TYPE || workerType,
        logger: log
      })
      await heartbeat.start()
    }
    await run({ pool, log, signal, heartbeat })
  } finally {
    heartbeat?.stop()
    await pool.end()
    log.info('worker.stopped', `Воркер ${component} остановлен`, { worker: workerId })
  }
}
