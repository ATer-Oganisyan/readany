const MIN_KANDINSKY_IMAGE_TIMEOUT_MS = 120_000
const MAX_KANDINSKY_IMAGE_TIMEOUT_MS = 900_000
const DEFAULT_KANDINSKY_IMAGE_TIMEOUT_MS = 300_000
const MIN_KANDINSKY_REQUEST_TIMEOUT_MS = 30_000
const MAX_KANDINSKY_REQUEST_TIMEOUT_MS = 300_000
const DEFAULT_KANDINSKY_REQUEST_TIMEOUT_MS = 120_000

export function kandinskyImageTimeoutMs(env = process.env) {
  const raw = String(env.KANDINSKY_IMAGE_TIMEOUT_MS || DEFAULT_KANDINSKY_IMAGE_TIMEOUT_MS).trim()
  const value = Number(raw)
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_KANDINSKY_IMAGE_TIMEOUT_MS ||
    value > MAX_KANDINSKY_IMAGE_TIMEOUT_MS
  ) {
    throw new Error('KANDINSKY_IMAGE_TIMEOUT_MS must be an integer between 120000 and 900000')
  }
  return value
}

export function kandinskyRequestTimeoutMs(env = process.env) {
  const raw = String(env.KANDINSKY_REQUEST_TIMEOUT_MS || DEFAULT_KANDINSKY_REQUEST_TIMEOUT_MS).trim()
  const value = Number(raw)
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_KANDINSKY_REQUEST_TIMEOUT_MS ||
    value > MAX_KANDINSKY_REQUEST_TIMEOUT_MS
  ) {
    throw new Error('KANDINSKY_REQUEST_TIMEOUT_MS must be an integer between 30000 and 300000')
  }
  return value
}
