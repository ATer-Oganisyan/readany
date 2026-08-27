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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseEnvUuidList(env, name) {
  const raw = String(env[name] ?? '').trim()
  if (!raw) return undefined
  const values = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))]
  if (!values.length || values.some((value) => !UUID.test(value))) {
    throw new Error(`${name} must be a comma-separated list of UUIDs`)
  }
  return values
}
