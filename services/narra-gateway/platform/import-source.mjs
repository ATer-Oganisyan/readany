import { fetchWithRedirectPolicy } from './safe-fetch.mjs'

export const IMPORT_SOURCE_HOSTS = new Set([
  'archiveofourown.org',
  'www.archiveofourown.org',
  'download.archiveofourown.org',
  'ficbook.net',
  'www.ficbook.net',
  'm.ficbook.net',
  'assets.teinon.net'
])

const RETRYABLE_SOURCE_STATUSES = new Set([403, 429, 500, 502, 503, 504])

function sourceHeaders(url) {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/epub+zip,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Referer: `${url.protocol}//${url.hostname}/`
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('Загрузка отменена'))
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason || new Error('Загрузка отменена'))
    }, { once: true })
  })
}

export async function fetchImportSource(
  input,
  { fetchImpl = fetch, lookupImpl, delayImpl = delay, signal } = {}
) {
  let url
  try {
    url = input instanceof URL ? input : new URL(String(input))
  } catch {
    throw Object.assign(new Error('Некорректный URL источника'), { status: 400, code: 'VALIDATION' })
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchWithRedirectPolicy(url, {
      allowedHosts: IMPORT_SOURCE_HOSTS,
      headers: sourceHeaders(url),
      fetchImpl,
      ...(lookupImpl ? { lookupImpl } : {}),
      signal
    })
    if (response.ok || !RETRYABLE_SOURCE_STATUSES.has(response.status) || attempt === 2) {
      return response
    }
    await response.body?.cancel().catch(() => {})
    await delayImpl(4_000 * (attempt + 1), signal)
  }
  throw Object.assign(new Error('Источник не ответил'), { status: 502, code: 'NETWORK' })
}

export function importSourceFailure(upstreamStatus) {
  if (upstreamStatus === 403 || upstreamStatus === 429) {
    return { status: 429, code: 'RATE' }
  }
  if (upstreamStatus === 404) {
    return { status: 404, code: 'NOT_FOUND' }
  }
  return { status: 502, code: 'NETWORK' }
}
