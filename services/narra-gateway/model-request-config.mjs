const PURPOSE_REQUEST_CONFIG = Object.freeze({
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

export function requestOptionsForModel({ provider, model, purpose }) {
  const desired = PURPOSE_REQUEST_CONFIG[purpose] || {}
  const capabilities = MODEL_REQUEST_CAPABILITIES[`${provider}:${model}`]
  if (desired.temperature === undefined || !capabilities?.temperature) return {}

  const temperature = Number(desired.temperature)
  const supported = capabilities.temperature
  if (!Number.isFinite(temperature) || temperature < supported.min || temperature > supported.max) {
    return {}
  }
  return { temperature, ...supported.requires }
}
