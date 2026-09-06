const CLASSES = ['interactive', 'background']

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`)
  return value
}

export function chatWorkload(input) {
  // Only validated conversational purposes receive the reserve. Client origin
  // is analytics metadata, never an admission privilege.
  return input.purpose === 'assistant' || input.purpose === 'character_chat' ? 'interactive' : 'background'
}

export function createWorkloadConcurrencyGate({
  limit, queueLimit, name = 'LLM',
  interactiveReserve = limit >= 2 ? Math.min(2, limit - 1) : 0,
  backgroundReserve = limit >= 2 ? 1 : 0,
  interactiveQueueReserve = queueLimit >= 2 ? Math.min(4, queueLimit - 1) : 0,
  backgroundQueueReserve = queueLimit >= 2 ? 1 : 0
}) {
  integer(limit, 'limit', 1); integer(queueLimit, 'queueLimit')
  for (const [key, value] of Object.entries({ interactiveReserve, backgroundReserve, interactiveQueueReserve, backgroundQueueReserve })) integer(value, key)
  if (interactiveReserve + backgroundReserve > limit || interactiveReserve >= limit || backgroundReserve >= limit) throw new Error('active reservations must leave both workloads eligible')
  if (interactiveQueueReserve + backgroundQueueReserve > queueLimit || (queueLimit > 0 && (interactiveQueueReserve >= queueLimit || backgroundQueueReserve >= queueLimit))) throw new Error('queue reservations must leave both workloads eligible')
  const active = { interactive: 0, background: 0 }
  const queues = { interactive: [], background: [] }
  const caps = { interactive: limit - backgroundReserve, background: limit - interactiveReserve }
  const queueCaps = { interactive: queueLimit - backgroundQueueReserve, background: queueLimit - interactiveQueueReserve }
  let nextClass = 0
  const totalActive = () => active.interactive + active.background
  const totalWaiting = () => queues.interactive.length + queues.background.length

  function grant(workload) {
    active[workload]++
    let released = false
    return () => {
      if (released) return
      released = true
      active[workload]--
      dispatch()
    }
  }
  function dispatch() {
    while (totalActive() < limit) {
      let selected = -1
      for (let offset = 0; offset < CLASSES.length; offset++) {
        const index = (nextClass + offset) % CLASSES.length
        const workload = CLASSES[index]
        if (queues[workload].length && active[workload] < caps[workload]) { selected = index; break }
      }
      if (selected < 0) return
      const workload = CLASSES[selected]
      const entry = queues[workload].shift()
      entry.cleanup()
      nextClass = (selected + 1) % CLASSES.length
      entry.resolve(grant(workload))
    }
  }
  return {
    async acquire(signal, { workload = 'background' } = {}) {
      if (!CLASSES.includes(workload)) throw new Error('unknown workload')
      if (signal?.aborted) throw signal.reason || new Error(`${name}: aborted`)
      dispatch()
      if (!queues[workload].length && totalActive() < limit && active[workload] < caps[workload]) return grant(workload)
      if (totalWaiting() >= queueLimit || queues[workload].length >= queueCaps[workload]) throw Object.assign(new Error(`${name}: очередь переполнена`), { code: 'RATE', status: 429 })
      return new Promise((resolve, reject) => {
        const entry = { resolve, cleanup: () => signal?.removeEventListener('abort', abort) }
        const abort = () => {
          const index = queues[workload].indexOf(entry)
          if (index < 0) return
          queues[workload].splice(index, 1)
          entry.cleanup()
          reject(signal.reason || new Error(`${name}: aborted`))
          dispatch()
        }
        signal?.addEventListener('abort', abort, { once: true })
        queues[workload].push(entry)
        dispatch()
      })
    },
    status() {
      return {
        active: totalActive(), waiting: totalWaiting(), limit, queue_limit: queueLimit,
        workloads: Object.fromEntries(CLASSES.map(workload => [workload, {
          active: active[workload], waiting: queues[workload].length,
          active_limit: caps[workload], queue_limit: queueCaps[workload]
        }]))
      }
    }
  }
}
