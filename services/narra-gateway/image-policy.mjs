const MODERATION_PATTERN =
  /(?:censor|moderation|safety|unsafe|blocked|bad[_ -]?\w*lemmas|ценз|запрещ|небезопас)/i

function providerError(code, provider, phase, status) {
  const error = new Error(
    `${provider}: ${code === 'CENSOR' ? 'запрос или результат отклонён политикой безопасности' : `ошибка ${phase}${status ? ` (${status})` : ''}`}`
  )
  error.code = code
  error.phase = phase
  error.status = status || undefined
  return error
}

export function simplifiedPortraitPrompt(value) {
  const prompt = String(value || '')
  const bookMetadata = prompt.indexOf('Character from the book')
  const appearance = (bookMetadata >= 0 ? prompt.slice(0, bookMetadata) : prompt)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 650)
  return [
    appearance || 'Fictional adult literary character',
    'Single fictional adult, waist-up painted portrait, neutral background, no typography, no watermark.'
  ].join('. ').slice(0, 900)
}

export function imageUpstreamError({ provider, phase, status = 0, detail = '' }) {
  const text = String(detail || '').slice(0, 4_000)
  if (status === 422 || status === 451 || MODERATION_PATTERN.test(text)) {
    return providerError('CENSOR', provider, phase, status)
  }
  if (status === 401 || status === 403) return providerError('AUTH', provider, phase, status)
  if (status === 408) return providerError('TIMEOUT', provider, phase, status)
  if (status === 429) return providerError('RATE', provider, phase, status)
  if (status >= 400 && status < 500) return providerError('VALIDATION', provider, phase, status)
  if (status >= 500) return providerError('NETWORK', provider, phase, status)
  return providerError('UNKNOWN', provider, phase, status)
}

export function imageEmptyResultError({ provider, detail = '' }) {
  return imageUpstreamError({
    provider,
    phase: 'result',
    status: 502,
    detail
  })
}

export function shouldFallbackAfterImageError(error) {
  return new Set(['AUTH', 'NO_KEY', 'NETWORK', 'RATE', 'TIMEOUT']).has(error?.code)
}
