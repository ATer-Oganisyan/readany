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
  req.once('aborted', () => controller.abort(new Error('client disconnected')))
  res.once('close', () => {
    if (!res.writableEnded) controller.abort(new Error('client disconnected'))
  })
  return controller.signal
}

export function withTimeout(signal, milliseconds) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds)
}

/**
 * Пауза, которую отменяет abort клиента: обычный setTimeout продолжает держать
 * очередь провайдера после того, как запрос уже никому не нужен.
 */
export async function abortableDelay(milliseconds, signal) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    if (signal) signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason || new Error('client disconnected'))
    }, { once: true })
  })
}

/**
 * Строгая последовательная очередь: провайдеры Kandinsky отвечают 429 на
 * параллельные запросы, поэтому вызовы выстраиваются в цепочку, а глубина
 * ожидания ограничена, чтобы очередь не росла бесконечно.
 */
export function createSerialQueue({ limit, onOverflow }) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer')
  let chain = Promise.resolve()
  let pending = 0
  return {
    get pending() {
      return pending
    },
    run(task, signal) {
      if (pending >= limit) throw onOverflow()
      pending += 1
      const run = chain
        .then(() => {
          if (signal?.aborted) throw signal.reason || new Error('client disconnected')
          return task()
        })
        .finally(() => { pending -= 1 })
      chain = run.catch(() => {})
      return run
    }
  }
}
