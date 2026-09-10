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

function boundedProviderDetail(value) {
  return String(value || '')
    .replace(/("prompt"\s*:\s*")[^"]*(")/giu, '$1[redacted]$2')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_000)
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

export function simplifiedScenePrompt(value) {
  const prompt = String(value || '').replace(/\s+/gu, ' ').trim()
  const actionAt = prompt.indexOf('ДЕЙСТВИЕ — ГЛАВНОЕ:')
  const action = actionAt >= 0 ? prompt.slice(actionAt) : prompt
  return [
    action.slice(0, 600),
    'Атмосферная книжная иллюстрация одного действия, без коллажа, текста, букв, цифр, логотипов и водяных знаков.'
  ].filter(Boolean).join(' ').slice(0, 750)
}

export function imageUpstreamError({ provider, phase, status = 0, detail = '' }) {
  const text = String(detail || '').slice(0, 4_000)
  let error
  if (status === 422 || status === 451 || MODERATION_PATTERN.test(text)) {
    error = providerError('CENSOR', provider, phase, status)
  } else if (status === 401 || status === 403) {
    error = providerError('AUTH', provider, phase, status)
  } else if (status === 408) {
    error = providerError('TIMEOUT', provider, phase, status)
  } else if (status === 429) {
    error = providerError('RATE', provider, phase, status)
  } else if (status >= 400 && status < 500) {
    error = providerError('VALIDATION', provider, phase, status)
  } else if (status >= 500) {
    error = providerError('NETWORK', provider, phase, status)
  } else {
    error = providerError('UNKNOWN', provider, phase, status)
  }
  error.providerDetail = boundedProviderDetail(text)
  return error
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
