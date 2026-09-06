export function createConcurrencyGate({ limit, queueLimit, name }) {
  let active = 0
  const waiting = []

  function releaseNext() {
    const next = waiting.shift()
    if (next) next.resolve(next.release)
    else active = Math.max(0, active - 1)
  }

  function releaseFactory() {
    let released = false
    return () => {
      if (released) return
      released = true
      releaseNext()
    }
  }

  return {
    async acquire(signal) {
      if (signal?.aborted) throw signal.reason || new Error(`${name}: aborted`)
      if (active < limit) {
        active += 1
        return releaseFactory()
      }
      if (waiting.length >= queueLimit) {
        const error = new Error(`${name}: очередь переполнена`)
        error.code = 'RATE'
        error.status = 429
        throw error
      }
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject, release: releaseFactory() }
        const abort = () => {
          const index = waiting.indexOf(entry)
          if (index >= 0) waiting.splice(index, 1)
          reject(signal.reason || new Error(`${name}: aborted`))
        }
        if (signal) signal.addEventListener('abort', abort, { once: true })
        entry.resolve = (release) => {
          if (signal) signal.removeEventListener('abort', abort)
          resolve(release)
        }
        waiting.push(entry)
      })
    },
    status() { return { active, waiting: waiting.length, limit, queue_limit: queueLimit } }
  }
}

export function requestAbortSignal(req, res) {
  const controller = new AbortController()
  const cleanup = () => {
    req.removeListener('aborted', abort)
    res.removeListener('close', close)
    res.removeListener('finish', cleanup)
  }
  const abort = () => { controller.abort(new Error('client disconnected')); cleanup() }
  const close = () => { if (!res.writableEnded) abort(); else cleanup() }
  req.once('aborted', abort)
  res.once('close', close)
  res.once('finish', cleanup)
  if (req.aborted || (res.destroyed && !res.writableEnded)) abort()
  return controller.signal
}

// Unlike AbortSignal.timeout, this scope can dispose its timer and parent
// listener immediately when an operation completes or admission succeeds.
export function createDeadlineSignal(signal, milliseconds, message = 'Превышено время ожидания запроса') {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) throw new TypeError('deadline must be a positive integer')
  const controller = new AbortController()
  let timer
  const dispose = () => { clearTimeout(timer); signal?.removeEventListener('abort', parentAbort) }
  const abort = reason => { controller.abort(reason); dispose() }
  const parentAbort = () => abort(signal.reason || new Error('client disconnected'))
  if (signal?.aborted) parentAbort()
  else {
    signal?.addEventListener('abort', parentAbort, { once: true })
    timer = setTimeout(() => abort(Object.assign(new Error(message), { code: 'TIMEOUT', status: 504 })), milliseconds)
    timer.unref?.()
  }
  return { signal: controller.signal, dispose }
}

export async function acquireWithDeadline(gate, signal, options, milliseconds) {
  const deadline = createDeadlineSignal(signal, milliseconds, 'Превышено время ожидания в очереди генерации')
  try { return await gate.acquire(deadline.signal, options) }
  finally { deadline.dispose() }
}

export function withTimeout(signal, milliseconds) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds)
}
