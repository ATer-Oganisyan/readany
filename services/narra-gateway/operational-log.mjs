const FIELD_NAME = /^[a-z][a-z0-9_.-]{0,63}$/

function cleanString(value, maxLength = 180) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function fieldValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    const cleaned = cleanString(value)
    return cleaned ? JSON.stringify(cleaned) : undefined
  }
  if (Array.isArray(value)) {
    const cleaned = value.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 32)
    return cleaned.length ? JSON.stringify(cleaned.join(', ')) : undefined
  }
  return undefined
}

export function formatOperationalLog(component, event, message, fields = {}) {
  const prefix = `[${cleanString(component, 48) || 'worker'}] ${cleanString(message, 240)}`
  const entries = [['event', event], ...Object.entries(fields)]
    .filter(([name]) => FIELD_NAME.test(name))
    .map(([name, value]) => [name, fieldValue(value)])
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
  return entries.length ? `${prefix} | ${entries.join(' | ')}` : prefix
}

export function createOperationalLogger({ component, logger = console }) {
  const emit = (level, event, message, fields) => {
    const write = typeof logger?.[level] === 'function'
      ? logger[level].bind(logger)
      : typeof logger?.log === 'function' ? logger.log.bind(logger) : null
    write?.(formatOperationalLog(component, event, message, fields))
  }
  return {
    info(event, message, fields) { emit('info', event, message, fields) },
    warn(event, message, fields) { emit('warn', event, message, fields) },
    error(event, message, fields) { emit('error', event, message, fields) }
  }
}
