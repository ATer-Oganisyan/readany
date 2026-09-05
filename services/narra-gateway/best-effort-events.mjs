// Product analytics must not hold a chat slot indefinitely. Timed-out writes
// may still finish; retain their slots until settlement rather than enqueueing
// unlimited writes behind a stuck filesystem operation.
export function createBestEffortEventWriter({ append, timeoutMs = 100, maxPending = 32 }) {
  if (typeof append !== 'function') throw new TypeError('append is required')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new RangeError('invalid event timeout')
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1024) throw new RangeError('invalid event pending cap')
  let pending = 0
  const counts = { persisted: 0, failed: 0, timeout: 0, skipped: 0 }
  return {
    status: () => ({ pending, ...counts }),
    async write(events) {
      if (pending >= maxPending) { counts.skipped++; return 'skipped' }
      pending++
      let timer
      const work = Promise.resolve().then(() => append(events)).then(
        () => { counts.persisted++; return 'persisted' },
        () => { counts.failed++; return 'failed' }
      ).finally(() => { pending-- })
      try {
        return await Promise.race([
          work,
          new Promise(resolve => {
            timer = setTimeout(() => { counts.timeout++; resolve('timeout') }, timeoutMs)
          })
        ])
      } finally { clearTimeout(timer) }
    }
  }
}
