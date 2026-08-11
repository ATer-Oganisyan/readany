import express from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { extractBookText, representativeTextSample } from './book-source-text.mjs'
import { REQUIRED_CHARACTER_MEDIA } from './book-markup.mjs'
import { isSupportedVoice } from './voices.mjs'

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const SHA256 = /^[0-9a-f]{64}$/
const SCOPES = new Set(['catalog', 'private'])

function invalid(message, code = 'VALIDATION') {
  throw Object.assign(new Error(message), { code, status: 400 })
}

function requiredString(value, name, max = 1_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(`${name}: invalid string`)
  return value.trim()
}

function identifier(value, name) {
  const result = requiredString(value, name, 128)
  if (!IDENTIFIER.test(result)) invalid(`${name}: invalid identifier`)
  return result
}

function exactKeys(value, allowed, name = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name}: expected object`)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${name}.${key}: unknown field`)
  }
  return value
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function notFound(error) {
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' ||
    error?.Code === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) invalid('LLM did not return a JSON object', 'GENERATION_RESULT_INVALID')
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value
  } catch (error) {
    invalid(`LLM returned invalid JSON: ${error.message}`, 'GENERATION_RESULT_INVALID')
  }
}

function characterKey(name, index) {
  const ascii = name.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  const suffix = sha256(`${name}:${index}`).slice(0, 10)
  return ascii ? `${ascii}-${suffix}` : `character-${suffix}`
}

function boundedStrings(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems)
}

function locateFirstAppearance(text, names) {
  const lower = text.toLocaleLowerCase('ru')
  let offset = -1
  for (const name of names) {
    if (name.length < 2) continue
    const candidate = lower.indexOf(name.toLocaleLowerCase('ru'))
    if (candidate >= 0 && (offset < 0 || candidate < offset)) offset = candidate
  }
  return offset
}

function normalizeCharacters(rawCharacters, text) {
  if (!Array.isArray(rawCharacters)) invalid('LLM result has no characters', 'GENERATION_RESULT_INVALID')
  const characters = []
  const usedKeys = new Set()
  for (const [index, raw] of rawCharacters.slice(0, 32).entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 160) : ''
    const fullName = typeof raw.fullName === 'string' ? raw.fullName.trim().slice(0, 240) : name
    if (!name || !fullName) continue
    const aliases = boundedStrings(raw.aliases, 10, 160)
    const firstAppearanceTextOffset = locateFirstAppearance(text, [fullName, name, ...aliases])
    if (firstAppearanceTextOffset < 0) continue
    let key = characterKey(fullName, index)
    while (usedKeys.has(key)) key = `${key.slice(0, 116)}-${characters.length}`
    usedKeys.add(key)
    const gender = ['male', 'female'].includes(raw.gender) ? raw.gender : 'unspecified'
    const voice = typeof raw.voice === 'string' && isSupportedVoice(raw.voice)
      ? raw.voice
      : gender === 'male' ? 'She' : gender === 'female' ? 'Che' : 'Erm'
    characters.push({
      characterKey: key,
      name,
      fullName,
      aliases,
      gender,
      age: typeof raw.age === 'string' ? raw.age.slice(0, 120) : '',
      role: typeof raw.role === 'string' ? raw.role.slice(0, 400) : '',
      description: typeof raw.description === 'string' ? raw.description.slice(0, 2_000) : '',
      appearancePrompt: typeof raw.appearancePrompt === 'string'
        ? raw.appearancePrompt.slice(0, 3_000)
        : `book character portrait of ${fullName}`,
      greeting: typeof raw.greeting === 'string' && raw.greeting.trim()
        ? raw.greeting.trim().slice(0, 2_000)
        : `Здравствуйте. Я ${name}.`,
      voice,
      firstAppearanceTextOffset,
      warmupTextOffset: Math.max(0, firstAppearanceTextOffset - Math.max(2_000, Math.round(text.length * 0.02)))
    })
  }
  characters.sort((left, right) =>
    left.firstAppearanceTextOffset - right.firstAppearanceTextOffset ||
    left.characterKey.localeCompare(right.characterKey)
  )
  if (!characters.length) invalid('LLM did not identify any character present in the text', 'GENERATION_RESULT_INVALID')
  return characters
}

function normalizeBookRequest(input) {
  const body = exactKeys(input, new Set([
    'idempotencyKey', 'bookEditionId', 'analysisVersion', 'scope', 'title', 'author',
    'format', 'contentSha256', 'objectKey', 'mimeType', 'byteSize'
  ]))
  const bookEditionId = identifier(body.bookEditionId, 'bookEditionId')
  const analysisVersion = identifier(body.analysisVersion, 'analysisVersion')
  const expectedKey = `${bookEditionId}:book-markup:${analysisVersion}`
  if (body.idempotencyKey !== expectedKey) invalid('idempotencyKey does not match the book request')
  if (!SCOPES.has(body.scope)) invalid('scope: invalid value')
  if (typeof body.contentSha256 !== 'string' || !SHA256.test(body.contentSha256)) invalid('contentSha256: invalid hash')
  if (!Number.isSafeInteger(body.byteSize) || body.byteSize < 1 || body.byteSize > 512 * 1024 * 1024) {
    invalid('byteSize: invalid value')
  }
  return {
    ...body,
    bookEditionId,
    analysisVersion,
    title: requiredString(body.title, 'title', 1_000),
    author: typeof body.author === 'string' ? body.author.trim().slice(0, 1_000) : '',
    format: requiredString(body.format, 'format', 32).toLowerCase(),
    objectKey: requiredString(body.objectKey, 'objectKey', 900),
    mimeType: requiredString(body.mimeType, 'mimeType', 200)
  }
}

function normalizeBundleRequest(input) {
  const body = exactKeys(input, new Set([
    'idempotencyKey', 'bookEditionId', 'characterKey', 'name', 'fullName', 'character',
    'scope', 'bookTitle', 'bookAuthor', 'bundleVersion', 'requiredMedia'
  ]))
  const bookEditionId = identifier(body.bookEditionId, 'bookEditionId')
  const characterKeyValue = identifier(body.characterKey, 'characterKey')
  const bundleVersion = identifier(body.bundleVersion, 'bundleVersion')
  const expectedKey = `${bookEditionId}:${characterKeyValue}:${bundleVersion}`
  if (body.idempotencyKey !== expectedKey) invalid('idempotencyKey does not match the bundle request')
  if (!SCOPES.has(body.scope)) invalid('scope: invalid value')
  if (!Array.isArray(body.requiredMedia) ||
      body.requiredMedia.length !== REQUIRED_CHARACTER_MEDIA.length ||
      REQUIRED_CHARACTER_MEDIA.some((type) => !body.requiredMedia.includes(type))) {
    invalid('requiredMedia must contain the complete character bundle contract')
  }
  exactKeys(body.character, new Set([
    'characterKey', 'name', 'fullName', 'aliases', 'gender', 'age', 'role', 'description',
    'appearancePrompt', 'greeting', 'voice', 'firstAppearanceTextOffset', 'warmupTextOffset'
  ]), 'character')
  return {
    ...body,
    bookEditionId,
    characterKey: characterKeyValue,
    bundleVersion,
    name: requiredString(body.name, 'name', 160),
    fullName: requiredString(body.fullName, 'fullName', 240),
    bookTitle: requiredString(body.bookTitle, 'bookTitle', 1_000),
    bookAuthor: typeof body.bookAuthor === 'string' ? body.bookAuthor.trim().slice(0, 1_000) : ''
  }
}

async function cached(storage, idempotencyKey, request, operation) {
  const cacheObjectKey = `generated/cache/${sha256(idempotencyKey)}.json`
  const requestHash = sha256(JSON.stringify(canonical(request)))
  try {
    const cachedObject = await storage.getBytes({ objectKey: cacheObjectKey, maxBytes: 2 * 1024 * 1024 })
    const document = JSON.parse(cachedObject.bytes.toString('utf8'))
    if (document.requestHash !== requestHash) {
      throw Object.assign(new Error('idempotency key was already used for a different request'), {
        code: 'IDEMPOTENCY_CONFLICT', status: 409
      })
    }
    return document.result
  } catch (error) {
    if (!notFound(error)) throw error
  }
  const result = await operation()
  await storage.putBytes({
    objectKey: cacheObjectKey,
    bytes: Buffer.from(JSON.stringify({ version: 1, requestHash, result })),
    mimeType: 'application/json'
  })
  return result
}

export function createInternalGenerationService({
  storage,
  completeChat,
  generatePortrait,
  synthesizeSpeech,
  generateIdleAnimation,
  maxBookBytes = 64 * 1024 * 1024
}) {
  if (!storage || !completeChat || !generatePortrait || !synthesizeSpeech || !generateIdleAnimation) {
    throw new TypeError('storage and all generation providers are required')
  }
  return {
    async generateBookMarkup(rawInput, signal) {
      const input = normalizeBookRequest(rawInput)
      return cached(storage, input.idempotencyKey, input, async () => {
        const stored = await storage.getBytes({ objectKey: input.objectKey, maxBytes: Math.min(maxBookBytes, 512 * 1024 * 1024) })
        if (stored.bytes.byteLength !== input.byteSize || sha256(stored.bytes) !== input.contentSha256) {
          throw Object.assign(new Error('stored book does not match its immutable metadata'), {
            code: 'BOOK_INTEGRITY', status: 409
          })
        }
        const text = await extractBookText({
          bytes: stored.bytes,
          format: input.format,
          mimeType: input.mimeType,
          signal
        })
        const sample = representativeTextSample(text)
        const response = await completeChat({
          messages: [
            {
              role: 'system',
              content: 'Ты анализируешь художественную книгу. Верни только JSON без markdown: {"characters":[{"name":"короткое имя","fullName":"полное имя","aliases":["варианты имени из текста"],"gender":"male|female|unspecified","age":"возраст или описание","role":"роль в книге","description":"характер и важные факты без спойлеров дальше представленного текста","appearancePrompt":"подробное безопасное описание внешности для книжного портрета без текста и логотипов","greeting":"короткая реплика персонажа читателю без спойлеров","voice":"код голоса: She для мужского, Che для женского, Erm если пол неясен"}]}. Выбери 1–12 наиболее важных персонажей. Имена и aliases должны дословно встречаться в тексте.'
            },
            {
              role: 'user',
              content: `Книга: ${input.title}\nАвтор: ${input.author || 'не указан'}\n\n${sample}`
            }
          ],
          temperature: 0.2,
          signal
        })
        const parsed = parseJsonObject(response)
        return { textLength: text.length, characters: normalizeCharacters(parsed.characters, text) }
      })
    },

    async generateCharacterBundle(rawInput, signal) {
      const input = normalizeBundleRequest(rawInput)
      return cached(storage, input.idempotencyKey, input, async () => {
        const character = input.character
        const portraitPrompt = [
          character.appearancePrompt || character.description || `book character ${input.fullName}`,
          `Character from the book “${input.bookTitle}”${input.bookAuthor ? ` by ${input.bookAuthor}` : ''}.`,
          'Single character, waist-up literary illustration, expressive face, neutral background, no typography, no watermark.'
        ].join(' ')
        const portrait = await generatePortrait(portraitPrompt.slice(0, 4_000), signal)
        const greeting = typeof character.greeting === 'string' && character.greeting.trim()
          ? character.greeting.trim().slice(0, 2_000)
          : `Здравствуйте. Я ${input.name}.`
        const voice = typeof character.voice === 'string' ? character.voice :
          character.gender === 'male' ? 'She' : character.gender === 'female' ? 'Che' : 'Erm'
        const [audio, animation] = await Promise.all([
          synthesizeSpeech(greeting, voice, signal),
          generateIdleAnimation(portrait.bytes, signal)
        ])
        const prefix = `generated/${input.scope}/${input.bookEditionId}/characters/${input.characterKey}/${input.bundleVersion}`
        const assets = await Promise.all([
          storage.putBytes({ objectKey: `${prefix}/primary-portrait.png`, bytes: portrait.bytes, mimeType: portrait.mimeType }),
          storage.putBytes({ objectKey: `${prefix}/greeting.wav`, bytes: audio.bytes, mimeType: audio.mimeType }),
          storage.putBytes({ objectKey: `${prefix}/idle-animation.mp4`, bytes: animation.bytes, mimeType: animation.mimeType })
        ])
        return {
          assets: REQUIRED_CHARACTER_MEDIA.map((type, index) => ({ type, ...assets[index] }))
        }
      })
    }
  }
}

export function requireGenerationServiceToken(token) {
  const expected = Buffer.from(String(token || '').trim())
  if (expected.byteLength < 32) throw new Error('GENERATOR_SERVICE_TOKEN must be at least 32 characters')
  return (req, res, next) => {
    const authorization = String(req.headers.authorization || '')
    const candidate = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
    if (candidate.byteLength !== expected.byteLength || !timingSafeEqual(candidate, expected)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="narra-internal"')
      return res.status(401).json({ error: 'service authentication required', code: 'AUTH' })
    }
    next()
  }
}

export function createInternalGenerationRouter({ token, service, logger = console }) {
  if (!service) throw new TypeError('internal generation service is required')
  const router = express.Router()
  router.use(requireGenerationServiceToken(token))
  router.use(express.json({ limit: '128kb' }))
  const endpoint = (operation) => async (req, res) => {
    const controller = new AbortController()
    const abort = () => controller.abort(new Error('internal generation client disconnected'))
    req.once('aborted', abort)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)])
    try {
      res.json({ result: await operation(req.body, signal) })
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 502
      const code = typeof error?.code === 'string' ? error.code : 'GENERATION_FAILED'
      logger.error?.('[internal-generation] request failed', { path: req.path, code })
      res.status(status).json({ error: error.message, code })
    } finally {
      req.removeListener('aborted', abort)
    }
  }
  router.post('/v1/book-markup', endpoint((body, signal) => service.generateBookMarkup(body, signal)))
  router.post('/v1/character-bundles', endpoint((body, signal) => service.generateCharacterBundle(body, signal)))
  return router
}
