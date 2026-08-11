import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  createInternalGenerationRouter,
  createInternalGenerationService,
  requireGenerationServiceToken
} from '../internal-generation-service.mjs'

function memoryStorage(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([key, value]) => [key, {
    bytes: Buffer.from(value.bytes), mimeType: value.mimeType
  }]))
  return {
    objects,
    async getBytes({ objectKey }) {
      const value = objects.get(objectKey)
      if (!value) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
      return { ...value, bytes: Buffer.from(value.bytes), metadata: {} }
    },
    async putBytes({ objectKey, bytes, mimeType }) {
      const stored = Buffer.from(bytes)
      objects.set(objectKey, { bytes: stored, mimeType })
      return {
        objectKey,
        contentHash: createHash('sha256').update(stored).digest('hex'),
        mimeType,
        byteSize: stored.byteLength
      }
    }
  }
}

test('internal generation service extracts markup once and returns an idempotent cached result', async () => {
  const source = Buffer.from(`Анна вошла в комнату. ${'текст '.repeat(9_000)}В конце книги снова появилась Анна.`)
  const contentSha256 = createHash('sha256').update(source).digest('hex')
  const storage = memoryStorage({ source: { bytes: source, mimeType: 'text/plain' } })
  let chatCalls = 0
  let chatRequest
  const lines = []
  const service = createInternalGenerationService({
    storage,
    logger: { info(line) { lines.push(line) }, error(line) { lines.push(line) } },
    async completeChat(input) {
      chatCalls += 1
      chatRequest = input
      return JSON.stringify({ characters: [{
        name: 'Анна', fullName: 'Анна', aliases: [], gender: 'female',
        description: 'Главная героиня', appearancePrompt: 'portrait of Anna', greeting: 'Здравствуйте'
      }] })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  const request = {
    idempotencyKey: '11111111-1111-4111-8111-111111111111:book-markup:book-markup-v2',
    bookEditionId: '11111111-1111-4111-8111-111111111111',
    analysisVersion: 'book-markup-v2', scope: 'private', title: 'Книга', author: '',
    format: 'txt', contentSha256, objectKey: 'source', mimeType: 'text/plain', byteSize: source.byteLength
  }
  const first = await service.generateBookMarkup(request)
  const second = await service.generateBookMarkup(request)
  assert.deepEqual(second, first)
  assert.equal(chatCalls, 1)
  assert.equal(Object.hasOwn(chatRequest, 'temperature'), false)
  assert.equal(first.textLength, source.toString('utf8').length)
  assert.equal(first.characters[0].firstAppearanceTextOffset, 0)
  assert.equal(lines.filter((line) => line.includes('event="markup.chunk_selected"')).length, 3)
  assert.ok(lines.some((line) => line.includes('chunk="1/3"') && line.includes('section="начало"')))
  assert.ok(lines.some((line) => line.includes('event="markup.character_found"') && line.includes('character="Анна"')))
  assert.ok(lines.some((line) => line.includes('event="markup.cached"')))
  assert.ok(lines.some((line) => line.includes('event="markup.cache_hit"')))
})

test('internal generation service creates all three required bundle assets', async () => {
  const storage = memoryStorage()
  const lines = []
  const service = createInternalGenerationService({
    storage,
    logger: { info(line) { lines.push(line) }, error(line) { lines.push(line) } },
    async completeChat() { throw new Error('unused') },
    async generatePortrait() {
      return { bytes: Buffer.from('png'), mimeType: 'image/png', provider: 'gigachat-image' }
    },
    async synthesizeSpeech() {
      return { bytes: Buffer.from('wav'), mimeType: 'audio/wav', provider: 'salute-speech' }
    },
    async generateIdleAnimation() {
      return { bytes: Buffer.from('mp4'), mimeType: 'video/mp4', provider: 'local-ffmpeg' }
    }
  })
  const result = await service.generateCharacterBundle({
    idempotencyKey: '11111111-1111-4111-8111-111111111111:anna:character-bundle-v1',
    bookEditionId: '11111111-1111-4111-8111-111111111111', characterKey: 'anna',
    name: 'Анна', fullName: 'Анна', scope: 'private', bookTitle: 'Книга', bookAuthor: '',
    bundleVersion: 'character-bundle-v1',
    requiredMedia: ['primary_portrait', 'greeting_audio', 'idle_animation'],
    character: {
      characterKey: 'anna', name: 'Анна', fullName: 'Анна', aliases: [], gender: 'female',
      age: '', role: '', description: '', appearancePrompt: 'portrait', greeting: 'Привет', voice: 'Che',
      firstAppearanceTextOffset: 0, warmupTextOffset: 0
    }
  })
  assert.deepEqual(result.assets.map((asset) => asset.type), [
    'primary_portrait', 'greeting_audio', 'idle_animation'
  ])
  assert.deepEqual(result.assets.map((asset) => asset.mimeType), ['image/png', 'audio/wav', 'video/mp4'])
  assert.ok(lines.some((line) => line.includes('event="bundle.portrait_ready"') && line.includes('provider="gigachat-image"')))
  assert.ok(lines.some((line) => line.includes('event="bundle.audio_ready"') && line.includes('provider="salute-speech"')))
  assert.ok(lines.some((line) => line.includes('event="bundle.animation_ready"') && line.includes('provider="local-ffmpeg"')))
  assert.equal(lines.filter((line) => line.includes('event="bundle.asset_stored"')).length, 3)
  assert.ok(lines.some((line) => line.includes('event="bundle.cached"')))
})

test('internal service auth rejects public bearer tokens and accepts only its own token', () => {
  const token = 's'.repeat(48)
  const auth = requireGenerationServiceToken(token)
  let status
  let nextCalls = 0
  const response = {
    setHeader() {},
    status(value) { status = value; return this },
    json() { return this }
  }
  auth({ headers: { authorization: 'Bearer installation-token' } }, response, () => { nextCalls += 1 })
  assert.equal(status, 401)
  assert.equal(nextCalls, 0)
  auth({ headers: { authorization: `Bearer ${token}` } }, response, () => { nextCalls += 1 })
  assert.equal(nextCalls, 1)
})

test('internal router exposes both worker endpoints', () => {
  const router = createInternalGenerationRouter({
    token: 's'.repeat(48),
    service: {
      async generateBookMarkup() { return { ok: true } },
      async generateCharacterBundle() { return { ok: true } }
    }
  })
  const paths = router.stack.map((layer) => layer.route?.path).filter(Boolean)
  assert.deepEqual(paths, ['/v1/book-markup', '/v1/character-bundles'])
})
