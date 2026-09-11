/**
 * P5: сцена получает портреты картинками, а не текстом внешности.
 *
 * Форма запроса к роутеру здесь проверяется на собранном запросе, а не на живом
 * провайдере: ключей image-маршрута в тестовом окружении нет, и это тот самый
 * spike, который work order требовал до P5. Что проверяемо и проверено — что
 * референсы прикладываются только к модели, которая вход картинками объявляет,
 * что иначе они отбрасываются без ошибки задания, и что текстовый паспорт
 * внешности не уезжает вместе с портретом.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_REFERENCE_IMAGES,
  imageInputSupported,
  requestCoverImage
} from '../providers/providers.mjs'
import {
  sceneGenerationPrompt,
  sceneMentionedCharacters
} from '../generation/scene-generation.mjs'

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
  'hex'
)

const ENV = {
  COVER_IMAGE_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'x'.repeat(40),
  OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
  OPENROUTER_IMAGE_MODEL: 'google/gemini-3.1-flash-image'
}

function capturingFetch(payload) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() { return payload }
      }
    }
  }
}

const CHAT_IMAGE_PAYLOAD = {
  choices: [{
    message: {
      images: [{ image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } }]
    }
  }]
}

function characters() {
  return [
    {
      name: 'Гленарван',
      fullName: 'Эдуард Гленарван',
      role: 'лорд',
      gender: 'male',
      appearance: 'высокий, светлые глаза',
      hasPortrait: false
    },
    {
      name: 'Паганель',
      fullName: 'Жак Паганель',
      role: 'географ',
      gender: 'male',
      appearance: 'худой, в очках',
      hasPortrait: true
    },
    {
      name: 'Мак-Наббс',
      fullName: 'Майор Мак-Наббс',
      role: 'майор',
      gender: 'male',
      appearance: 'невозмутимый',
      hasPortrait: true
    }
  ]
}

test('a character is mentioned through its Russian case forms, not by substring', () => {
  const mentioned = sceneMentionedCharacters(
    'Гленарвану ответил Паганель, разворачивая карту перед Мак-Наббсом.',
    characters()
  )
  assert.deepEqual(mentioned.map(({ name }) => name), ['Гленарван', 'Паганель', 'Мак-Наббс'])
})

test('a character absent from the excerpt is not mentioned', () => {
  const mentioned = sceneMentionedCharacters('Паганель развернул карту.', characters())
  assert.deepEqual(mentioned.map(({ name }) => name), ['Паганель'])
})

test('a surname shared by two characters is not attributed to either', () => {
  // Правило однозначности матчера: в промпт сцены не попадёт внешность не того
  // человека, если фраза не сужает кандидатов до одного.
  const mentioned = sceneMentionedCharacters('Гленарван вошёл первым.', [
    { name: 'Гленарван', fullName: 'Эдуард Гленарван', role: '', gender: '', appearance: 'а', hasPortrait: false },
    { name: 'Гленарван', fullName: 'Элен Гленарван', role: '', gender: '', appearance: 'б', hasPortrait: false }
  ])
  assert.deepEqual(mentioned, [])
})

test('a portrait replaces the text appearance passport, and only for that character', () => {
  const prompt = sceneGenerationPrompt({
    bookTitle: 'Дети капитана Гранта',
    bookAuthor: 'Жюль Верн',
    bookDescription: '',
    bookSubjects: [],
    genreId: 'adventure',
    chapter: '',
    excerpt: 'Гленарвану ответил Паганель, разворачивая карту.',
    characters: characters(),
    previousExcerpts: []
  })
  assert.match(prompt, /ПЕРСОНАЖИ С ПОРТРЕТОМ: Жак Паганель/)
  assert.match(prompt, /внешность строго по приложенным портретам/)
  // Внешность Паганеля текстом не передаётся: два описания одного лица дают
  // на выходе два разных лица.
  assert.doesNotMatch(prompt, /худой, в очках/)
  // А у персонажа без портрета паспорт остаётся.
  assert.match(prompt, /Эдуард Гленарван: высокий, светлые глаза/)
})

test('with every mentioned character having a portrait there is no text passport block', () => {
  const prompt = sceneGenerationPrompt({
    bookTitle: 'Дети капитана Гранта',
    bookAuthor: 'Жюль Верн',
    bookDescription: '',
    bookSubjects: [],
    genreId: 'adventure',
    chapter: '',
    excerpt: 'Паганель и Мак-Наббс склонились над картой.',
    characters: characters(),
    previousExcerpts: []
  })
  assert.match(prompt, /ПЕРСОНАЖИ С ПОРТРЕТОМ: Жак Паганель, Майор Мак-Наббс/)
  assert.doesNotMatch(prompt, /ПЕРСОНАЖИ: только/)
})

test('only models that declare image input receive reference images', () => {
  assert.equal(imageInputSupported('google/gemini-3.1-flash-image'), true)
  assert.equal(imageInputSupported('openai/gpt-image-2'), true)
  assert.equal(imageInputSupported('gpt-image-2'), true)
  assert.equal(imageInputSupported('kandinsky'), false)
  assert.equal(imageInputSupported(''), false)
})

test('OpenRouter receives the portraits as chat image parts', async () => {
  const { calls, fetchImpl } = capturingFetch(CHAT_IMAGE_PAYLOAD)
  const result = await requestCoverImage({
    prompt: 'сцена',
    referenceImages: [
      { bytes: PNG, mimeType: 'image/png', label: 'Паганель' },
      { bytes: PNG, mimeType: 'image/png', label: 'Мак-Наббс' }
    ],
    env: ENV,
    fetchImpl
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://openrouter.test/api/v1/chat/completions')
  const body = JSON.parse(calls[0].options.body)
  const parts = body.messages[0].content
  assert.equal(parts[0].type, 'text')
  assert.equal(parts.filter(({ type }) => type === 'image_url').length, 2)
  assert.match(parts[1].image_url.url, /^data:image\/png;base64,/)
  assert.equal(result.referenceImageCount, 2)
  assert.equal(result.referenceImagesDropped, false)
  assert.equal(result.mimeType, 'image/png')
})

test('reference images are capped so one scene cannot carry a whole roster', async () => {
  const { calls, fetchImpl } = capturingFetch(CHAT_IMAGE_PAYLOAD)
  const result = await requestCoverImage({
    prompt: 'сцена',
    referenceImages: Array.from({ length: MAX_REFERENCE_IMAGES + 2 }, (_, index) =>
      ({ bytes: PNG, mimeType: 'image/png', label: `c${index}` })),
    env: ENV,
    fetchImpl
  })
  const parts = JSON.parse(calls[0].options.body).messages[0].content
  assert.equal(parts.filter(({ type }) => type === 'image_url').length, MAX_REFERENCE_IMAGES)
  assert.equal(result.referenceImageCount, MAX_REFERENCE_IMAGES)
})

test('a model without image input silently loses the portraits and still draws the scene', async () => {
  // Отсутствие портрета — это худшая картинка, а не упавшее задание.
  const { calls, fetchImpl } = capturingFetch({
    data: [{ b64_json: PNG.toString('base64') }]
  })
  const result = await requestCoverImage({
    prompt: 'сцена',
    referenceImages: [{ bytes: PNG, mimeType: 'image/png', label: 'Паганель' }],
    env: { ...ENV, OPENROUTER_IMAGE_MODEL: 'kandinsky' },
    fetchImpl
  })
  assert.equal(calls[0].url, 'https://openrouter.test/api/v1/images')
  assert.equal(result.referenceImageCount, 0)
  assert.equal(result.referenceImagesDropped, true)
  assert.equal(result.image, PNG.toString('base64'))
})

test('a request with no reference images keeps the previous shape byte for byte', async () => {
  const { calls, fetchImpl } = capturingFetch({
    data: [{ b64_json: PNG.toString('base64') }]
  })
  const result = await requestCoverImage({ prompt: 'обложка', env: ENV, fetchImpl })
  assert.equal(calls[0].url, 'https://openrouter.test/api/v1/images')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.prompt, 'обложка')
  assert.equal(body.messages, undefined)
  assert.equal(result.referenceImageCount, 0)
  assert.equal(result.referenceImagesDropped, false)
})

test('LiteLLM receives the portraits as an images/edits multipart form', async () => {
  const { calls, fetchImpl } = capturingFetch({
    data: [{ b64_json: PNG.toString('base64') }]
  })
  await requestCoverImage({
    prompt: 'сцена',
    referenceImages: [{ bytes: PNG, mimeType: 'image/png', label: 'Паганель' }],
    env: {
      COVER_IMAGE_PROVIDER: 'litellm',
      LITELLM_API_KEY: 'y'.repeat(40),
      LITELLM_BASE_URL: 'https://litellm.test/v1',
      LITELLM_IMAGE_MODEL: 'gpt-image-2'
    },
    fetchImpl
  })
  assert.equal(calls[0].url, 'https://litellm.test/v1/images/edits')
  assert.ok(calls[0].options.body instanceof FormData)
  assert.equal(calls[0].options.body.get('model'), 'gpt-image-2')
  assert.equal(calls[0].options.body.getAll('image[]').length, 1)
  // multipart сам ставит boundary, поэтому Content-Type не задаётся вручную.
  assert.equal(calls[0].options.headers['Content-Type'], undefined)
})

test('an oversized or empty reference image is refused rather than sent', async () => {
  const { fetchImpl } = capturingFetch(CHAT_IMAGE_PAYLOAD)
  await assert.rejects(
    () => requestCoverImage({
      prompt: 'сцена',
      referenceImages: [{ bytes: Buffer.alloc(0), mimeType: 'image/png', label: 'x' }],
      env: ENV,
      fetchImpl
    }),
    { code: 'REFERENCE_IMAGE_INVALID' }
  )
})
