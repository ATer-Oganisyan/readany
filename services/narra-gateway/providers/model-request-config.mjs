import { purposeChain } from './purpose-inheritance.mjs'

const PURPOSE_REQUEST_CONFIG = Object.freeze({
  assistant: Object.freeze({}),
  character_chat: Object.freeze({ temperature: 0.85 }),
  structured_task: Object.freeze({}),
  summary: Object.freeze({}),
  scenario: Object.freeze({}),
  memory: Object.freeze({})
})

// Optional sampling parameters are disabled for unknown provider/model pairs.
// Add a capability only after checking the provider's current documentation and
// verifying the exact request shape against that route.
export const MODEL_REQUEST_CAPABILITIES = Object.freeze({
  'giga:gpt-5.6-luna': Object.freeze({
    temperature: Object.freeze({
      min: 0,
      max: 2,
      requires: Object.freeze({ reasoning_effort: 'none' })
    })
  }),
  'litellm:openrouter/openai/gpt-5.6-luna': Object.freeze({
    temperature: Object.freeze({
      min: 0,
      max: 2,
      requires: Object.freeze({ reasoning_effort: 'none' })
    })
  })
})

// Задачи, ответ которых разбирается как JSON-объект, а не читается человеком.
// Для них формат — часть контракта, а не пожелание.
//
// Проверка идёт по цепочке наследования, как и выбор модели: назначение,
// унаследовавшее модель структурных задач, обязано унаследовать и её форму
// запроса. Пока проверка была прямой, `roster_confirm` уходил на ту же модель,
// но без `response_format` — и рассуждающая модель тратила на рассуждение весь
// потолок токенов, не закрыв JSON.
const JSON_OBJECT_PURPOSES = new Set(['structured_task'])

function expectsJsonObject(purpose) {
  return purposeChain(purpose).some((name) => JSON_OBJECT_PURPOSES.has(name))
}

/**
 * Отключение JSON-формата для провайдера, который его не принимает.
 *
 * Зеркало `*_OMIT_TEMPERATURE`: там же, где провайдер отвергает явную
 * температуру, он может отвергнуть и `response_format`. Ответ на это —
 * настройка, а не молчаливый отказ от формата: без неё непонятно, почему
 * запросы вдруг стали падать с 400.
 */
export function omitsJsonResponseFormat(providerName, env = process.env) {
  const raw = providerName === 'litellm'
    ? env.LITELLM_OMIT_JSON_RESPONSE_FORMAT
    : env.LLM_OMIT_JSON_RESPONSE_FORMAT
  return String(raw ?? '').trim().toLowerCase() === 'true'
}

/**
 * Форма запроса под конкретную пару провайдер/модель.
 *
 * `response_format` для структурных задач запрашивается по умолчанию, в
 * отличие от температуры, которую включает только явная запись о модели.
 * Причина в цене ошибки. Неподдержанный `response_format` — это 400: громко,
 * сразу и с подсказкой в логе. Незапрошенный — это reasoning-модель, которая
 * тратит весь `max_tokens` на рассуждение и возвращает пустой или обрезанный
 * `content`; вызов при этом «успешен», стоит денег и минуту времени, а
 * разбор падает на «LLM did not return a JSON object».
 *
 * Замер на deepseek-v4-flash с промптом карточки: без формата — 6367
 * reasoning-токенов и 58 секунд, с форматом — ноль и 2 секунды.
 */
export function requestOptionsForModel({ provider, model, purpose, env = process.env }) {
  const options = expectsJsonObject(purpose) && !omitsJsonResponseFormat(provider, env)
    ? { response_format: { type: 'json_object' } }
    : {}

  const desired = PURPOSE_REQUEST_CONFIG[purpose] || {}
  const capabilities = MODEL_REQUEST_CAPABILITIES[`${provider}:${model}`]
  if (desired.temperature === undefined || !capabilities?.temperature) return options

  const temperature = Number(desired.temperature)
  const supported = capabilities.temperature
  if (!Number.isFinite(temperature) || temperature < supported.min || temperature > supported.max) {
    return options
  }
  return { ...options, temperature, ...supported.requires }
}
