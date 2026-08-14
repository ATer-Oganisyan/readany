export function shouldRetryKandinsky(error) {
  return error?.code === 'RATE' || error?.code === 'NETWORK'
}

export function shouldRetryKandinskyStatus(error) {
  return error?.code === 'TIMEOUT' || error?.code === 'NETWORK'
}

export function videoRetryDelay(error) {
  const message = String(error?.message || '')
  const retryable = error?.code === 'RATE' || /LIMIT_EXHAUSTED|429/.test(message)
  if (!retryable) return 0
  return /concurrent/.test(message) ? 45_000 : 10_000
}
