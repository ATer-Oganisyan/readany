import { abortableDelay, createSerialQueue } from './concurrency.mjs'
import { httpErr } from './gateway-errors.mjs'
import { httpsRequest } from './http.mjs'
import { imageEmptyResultError, imageUpstreamError } from './image-policy.mjs'
import { shouldRetryKandinsky, shouldRetryKandinskyStatus } from './retry-policy.mjs'

// Стиль задаётся на клиенте (единая арт-дирекция), сервер не добавляет свой.
const STYLE_SUFFIX = ''

// подбираем поддерживаемое разрешение по ориентации
export function resolutionFor(width, height) {
  if (height > width * 1.15) return '768x1280'
  if (width > height * 1.15) return '1280x768'
  return '1024x1024'
}

/**
 * Kandinsky 6.0 (studio.kandinskylab.ai): create → poll → result.
 * Провайдер не терпит параллельных запросов, поэтому вызовы сериализуются
 * очередью, а лимит частоты ретраится.
 */
export function createKandinskyImageClient({
  token,
  host,
  insecure = false,
  queueLimit,
  imageTimeoutMs,
  requestTimeoutMs,
  attempts = 3,
  logger = console
}) {
  if (!host) throw new TypeError('Kandinsky host is required')
  const queue = createSerialQueue({
    limit: queueLimit,
    onOverflow: () => httpErr('RATE', 'Kandinsky: очередь переполнена')
  })
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

  async function generateOnce(prompt, width, height, signal) {
    const resolution = resolutionFor(width, height)
    const deadline = Date.now() + imageTimeoutMs
    const remaining = () => Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()))

    const runRes = await httpsRequest(`${host}/tasks/k6-image-t2i`, {
      method: 'POST',
      insecure,
      timeoutMs: remaining(),
      signal,
      headers: headers(),
      body: JSON.stringify({ params: { query: `${prompt}${STYLE_SUFFIX}`.slice(0, 950), resolution } })
    })
    if (runRes.status >= 400) {
      throw imageUpstreamError({
        provider: 'Kandinsky',
        phase: 'create',
        status: runRes.status,
        detail: runRes.body
      })
    }
    const taskId = JSON.parse(runRes.body).task_id
    if (!taskId) throw httpErr('UNKNOWN', 'Kandinsky: нет task_id')

    let done = false
    while (Date.now() < deadline) {
      await abortableDelay(4000, signal)
      let st
      try {
        st = await httpsRequest(`${host}/tasks/${taskId}`, {
          insecure,
          timeoutMs: 20000,
          signal,
          headers: headers()
        })
      } catch (error) {
        if (shouldRetryKandinskyStatus(error)) continue
        throw error
      }
      if (st.status >= 400) {
        const upstreamError = imageUpstreamError({
          provider: 'Kandinsky',
          phase: 'status',
          status: st.status,
          detail: st.body
        })
        if (['NETWORK', 'RATE'].includes(upstreamError.code)) continue
        throw upstreamError
      }
      const statusBody = JSON.parse(st.body)
      const status = String(statusBody.status || '').toLowerCase()
      if (status === 'done') {
        done = true
        break
      }
      if (status === 'failed' || status === 'error') {
        throw imageEmptyResultError({
          provider: 'Kandinsky',
          detail: statusBody.error || statusBody.detail || statusBody.message
        })
      }
    }
    if (!done) {
      throw httpErr('TIMEOUT', `Kandinsky: таймаут (${Math.round(imageTimeoutMs / 1000)}с)`)
    }

    const resImg = await httpsRequest(`${host}/tasks/${taskId}/result`, {
      insecure,
      timeoutMs: remaining(),
      signal,
      binary: true,
      headers: { Authorization: `Bearer ${token}` }
    })
    if (resImg.status >= 400) {
      throw imageUpstreamError({
        provider: 'Kandinsky',
        phase: 'result',
        status: resImg.status,
        detail: resImg.body
      })
    }
    if (!resImg.body?.length) throw imageEmptyResultError({ provider: 'Kandinsky' })
    return resImg.body.toString('base64')
  }

  async function withRetry(prompt, width, height, signal) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await generateOnce(prompt, width, height, signal)
      } catch (error) {
        if (shouldRetryKandinsky(error) && i < attempts - 1) {
          logger.error?.(`[kandinsky] временная ошибка ${error.code}, жду 20с (попытка ${i + 2}/${attempts})`)
          await abortableDelay(20000, signal)
          continue
        }
        throw error
      }
    }
  }

  return {
    generate(prompt, width = 768, height = 1024, signal) {
      return queue.run(() => withRetry(prompt, width, height, signal), signal)
    }
  }
}
