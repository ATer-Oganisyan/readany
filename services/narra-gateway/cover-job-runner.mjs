const RETRYABLE = new Set(['RATE', 'NETWORK', 'TIMEOUT'])

function errorCode(error) {
  if (typeof error?.code === 'string') return error.code
  if (error?.name === 'TimeoutError') return 'TIMEOUT'
  if (error?.name === 'AbortError') return 'CANCELLED'
  return 'NETWORK'
}

function cancellationError() {
  return Object.assign(new Error('Cover worker stopped'), { code: 'CANCELLED' })
}

export function createCoverJobRunner({
  store,
  generate,
  enabled = true,
  concurrency = 2,
  maxAttempts = 3,
  retryDelaysMs = [30_000, 2 * 60_000],
  attemptTimeoutMs = 30 * 60_000,
  idlePollMs = 1_000,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  const active = new Map()
  let started = false
  let stopping = false
  let timer = null
  let pumping = false

  function schedule(delay = 0) {
    if (!started || stopping || timer) return
    timer = setTimer(() => {
      timer = null
      void pump().catch((error) => console.error('[cover-jobs] worker pump failed:', error))
    }, Math.max(0, delay))
    timer?.unref?.()
  }

  function retryDelay(attemptCount) {
    if (!retryDelaysMs.length) return 0
    return retryDelaysMs[Math.min(attemptCount - 1, retryDelaysMs.length - 1)]
  }

  async function execute(job) {
    const controller = new AbortController()
    const timeoutSignal = AbortSignal.timeout(attemptTimeoutMs)
    const signal = AbortSignal.any([controller.signal, timeoutSignal])
    const promise = (async () => {
      try {
        const generated = await generate({
          prompt: job.prompt,
          requestId: job.request_id,
          signal
        })
        const bytes = Buffer.from(generated.image, 'base64')
        await store.markCompleted(job.job_id, {
          image: bytes,
          mimeType: generated.mimeType,
          model: generated.model
        })
      } catch (error) {
        const code = stopping ? 'CANCELLED' : errorCode(error)
        const message = error?.message || String(error)
        if (code === 'CANCELLED' || (RETRYABLE.has(code) && job.attempt_count < maxAttempts)) {
          const delay = code === 'CANCELLED'
            ? 0
            : retryDelay(job.attempt_count)
          await store.markRetry(job.job_id, {
            code,
            message,
            nextAttemptAt: now() + delay
          })
        } else {
          await store.markFailed(job.job_id, { code, message })
        }
      }
    })().finally(() => {
      active.delete(job.job_id)
      schedule(0)
    })
    active.set(job.job_id, { controller, promise })
    return promise
  }

  async function runOnce() {
    if (!enabled) return false
    const job = await store.claimNext()
    if (!job) return false
    await execute(job)
    return true
  }

  async function pump() {
    if (!started || stopping || pumping || !enabled) return
    pumping = true
    try {
      while (active.size < concurrency) {
        const job = await store.claimNext()
        if (!job) break
        void execute(job)
      }
      if (active.size === 0) {
        const next = store.nextRunnableAt()
        schedule(next === null ? idlePollMs : Math.max(0, next - now()))
      }
    } finally {
      pumping = false
    }
  }

  function notify() {
    schedule(0)
  }

  function start() {
    if (started) return
    started = true
    stopping = false
    if (enabled) schedule(0)
  }

  async function stop() {
    if (!started) return
    stopping = true
    started = false
    if (timer) clearTimer(timer)
    timer = null
    for (const { controller } of active.values()) controller.abort(cancellationError())
    await Promise.allSettled([...active.values()].map(({ promise }) => promise))
    stopping = false
  }

  function status() {
    return { enabled, active: active.size, concurrency, max_attempts: maxAttempts }
  }

  return { start, stop, notify, runOnce, status }
}
