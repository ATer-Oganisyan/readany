export function parseEnvInt(env, name, fallback, max) {
  const value = Number(env[name] || fallback)
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`)
  }
  return value
}

export function parseEnvBool(env, name, fallback = false) {
  const value = String(env[name] ?? fallback).trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}
