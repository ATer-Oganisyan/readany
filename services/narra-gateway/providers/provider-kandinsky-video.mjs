import { abortableDelay, createSerialQueue, withTimeout } from '../platform/concurrency.mjs'
import { httpErr } from '../platform/gateway-errors.mjs'
import { imageUpstreamError } from './image-policy.mjs'
import { videoRetryDelay } from './retry-policy.mjs'

const TASK_DEADLINE_MS = 480_000

/**
 * Kandinsky video API: GigaAvatar (портрет + аудио → говорящее видео) и
 * idle-анимация портрета. Видеосервер отвечает 429 LIMIT_EXHAUSTED на
 * параллельные запросы, поэтому здесь та же сериализация, что у картинок,
 * но с более длинными паузами: занятый GPU-слот освобождается минутами.
 */
export function createKandinskyVideoClient({
  token,
  baseUrl,
  queueLimit,
  attempts = 3,
  logger = console
}) {
  const queue = createSerialQueue({
    limit: queueLimit,
    onOverflow: () => httpErr('RATE', 'Видео: очередь переполнена')
  })

  async function taskRaw(taskType, params, signal) {
    if (!baseUrl) throw httpErr('NO_KEY', 'Видео: VIDEO_BASE_URL не задан')
    const create = await fetch(`${baseUrl}/tasks/${taskType}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ censor: true, params }),
      signal: withTimeout(signal, 30_000)
    })
    if (!create.ok) {
      const detail = await create.text().catch(() => '')
      throw imageUpstreamError({
        provider: 'Kandinsky video',
        phase: 'create',
        status: create.status,
        detail
      })
    }
    const { task_id: taskId } = await create.json()
    if (!taskId) throw httpErr('UNKNOWN', 'Видео: сервер не вернул task_id')

    const deadline = Date.now() + TASK_DEADLINE_MS
    while (Date.now() < deadline) {
      await abortableDelay(5000, signal)
      const st = await fetch(`${baseUrl}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: withTimeout(signal, 20_000)
      })
      if (!st.ok) continue
      const body = await st.json()
      const status = String(body.status || '').toLowerCase()
      if (status === 'done') {
        const result = await fetch(`${baseUrl}/tasks/${taskId}/result`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: withTimeout(signal, 60_000)
        })
        if (!result.ok) {
          const detail = await result.text().catch(() => '')
          throw imageUpstreamError({
            provider: 'Kandinsky video',
            phase: 'result',
            status: result.status,
            detail
          })
        }
        return Buffer.from(await result.arrayBuffer()).toString('base64')
      }
      if (status === 'failed' || status === 'error') {
        throw imageUpstreamError({
          provider: 'Kandinsky video',
          phase: 'status',
          detail: body.error || body.detail || body.message
        })
      }
    }
    logger.error?.(`[video] ${taskType} таймаут 480с`)
    throw httpErr('TIMEOUT', 'Видео: таймаут (8 мин)')
  }

  async function taskWithRetry(taskType, params, signal) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await taskRaw(taskType, params, signal)
      } catch (error) {
        const wait = videoRetryDelay(error)
        if (wait && i < attempts - 1) {
          // 'concurrent' — заняты все GPU-слоты, освободятся через минуты; 'rate' — секунды
          logger.error?.(`[video] лимит (${wait === 45_000 ? 'слоты заняты' : 'частота'}), жду ${wait / 1000}с (${i + 2}/${attempts})`)
          await abortableDelay(wait, signal)
          continue
        }
        throw error
      }
    }
  }

  const task = (taskType, params, signal) =>
    queue.run(() => taskWithRetry(taskType, params, signal), signal)

  return {
    // говорящая голова: портрет + аудио (с ретраем)
    gigaAvatar(image, audio, query, signal) {
      return task('giga_avatar', {
        query: query || 'talking character portrait, front view, natural facial motion, subtle head movement',
        image,
        audio
      }, signal)
    },
    // idle-анимация портрета (без звука). Бьютификатор отключён — он падает на воркере.
    animatePortrait(image, query, quality, signal) {
      return task(quality === 'hd' ? 'k5-i2v-hd' : 'k5-i2v-lite', {
        query: query || 'he stays still, only blinks slowly and breathes subtly, locked camera, fixed framing, no zoom',
        image,
        beautificator: 'disabled'
      }, signal)
    }
  }
}
