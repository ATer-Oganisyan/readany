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
    idempotencyKey: '11111111-1111-4111-8111-111111111111:character:anna:character-bundle-v3',
    bookEditionId: '11111111-1111-4111-8111-111111111111', characterKey: 'character:anna',
    name: 'Анна', fullName: 'Анна', scope: 'private', bookTitle: 'Книга', bookAuthor: '',
    bundleVersion: 'character-bundle-v3',
    requiredMedia: ['primary_portrait', 'greeting_audio', 'idle_animation'],
    character: {
      characterKey: 'character:anna', name: 'Анна', fullName: 'Анна', aliases: [], gender: 'female',
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

test('internal generation service gives the provider exactly one scan chunk', async () => {
  const storage = memoryStorage()
  let chatRequest
  const contextText = ' Анна вошла в комнату. '
  const service = createInternalGenerationService({
    storage,
    logger: { info() {}, error() {} },
    async completeChat(input) {
      chatRequest = input
      const startOffset = contextText.indexOf('Анна')
      const quote = 'Анна вошла в комнату.'
      return JSON.stringify({
        observations: [{
          type: 'character_action',
          entityKind: 'character',
          entityCandidate: 'Анна',
          relatedEntityCandidates: [],
          fact: 'Анна вошла в комнату',
          evidence: { quote, startOffset, endOffset: startOffset + quote.length },
          confidence: 0.95
        }]
      })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  const result = await service.scanBookChunk({
    idempotencyKey: 'run-1:scan:chunk-1:book-scan-v1',
    runId: 'run-1',
    chunkId: 'chunk-1',
    extractorVersion: 'book-scan-v1',
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    contextText,
    coreLocalStartOffset: 1,
    coreLocalEndOffset: contextText.length - 1
  })
  assert.equal(result.observations.length, 1)
  assert.equal(Object.hasOwn(chatRequest, 'temperature'), false)
  assert.equal(chatRequest.messages.length, 2)
  assert.ok(chatRequest.messages[0].content.includes(
    'только если evidence.startOffset находится внутри CORE_LOCAL_RANGE'
  ))
  assert.ok(chatRequest.messages[0].content.includes(
    'текст за пределами диапазона используй только как контекст'
  ))
  assert.ok(chatRequest.messages[0].content.includes(
    'Последовательно просмотри весь CORE_LOCAL_RANGE от начала до конца'
  ))
  assert.ok(chatRequest.messages[1].content.includes(contextText))
  assert.ok(chatRequest.messages[1].content.includes(
    `CORE_LOCAL_RANGE: 1-${contextText.length - 1}`
  ))
  assert.equal(chatRequest.messages[1].content.includes('objectKey'), false)
  assert.equal(chatRequest.messages[1].content.includes('normalized'), false)
})

test('internal generation service repairs wrong offsets for one exact quote match', async () => {
  const storage = memoryStorage()
  const contextText = ' Анна вошла в комнату. '
  const quote = 'Анна вошла в комнату.'
  const service = createInternalGenerationService({
    storage,
    logger: { info() {}, error() {} },
    async completeChat() {
      return JSON.stringify({ observations: [{
        type: 'character_action',
        entityKind: 'character',
        entityCandidate: 'Анна',
        relatedEntityCandidates: [],
        fact: 'Анна вошла в комнату',
        evidence: { quote, startOffset: 0, endOffset: quote.length },
        confidence: 0.95
      }] })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  const result = await service.scanBookChunk({
    idempotencyKey: 'run-repair:scan:chunk-repair:book-scan-v1',
    runId: 'run-repair',
    chunkId: 'chunk-repair',
    extractorVersion: 'book-scan-v1',
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    contextText,
    coreLocalStartOffset: 1,
    coreLocalEndOffset: contextText.length - 1
  })
  assert.deepEqual(result.observations[0].evidence, {
    quote,
    startOffset: contextText.indexOf(quote),
    endOffset: contextText.indexOf(quote) + quote.length
  })
})

test('internal generation service drops an author copied only from front matter', async () => {
  const storage = memoryStorage()
  const contextText = 'Медный всадник\nАлександр Пушкин'
  const quote = 'Александр Пушкин'
  const startOffset = contextText.indexOf(quote)
  const service = createInternalGenerationService({
    storage,
    logger: { info() {}, warn() {}, error() {} },
    async completeChat() {
      return JSON.stringify({ observations: [{
        type: 'character_mention',
        entityKind: 'character',
        entityCandidate: 'Александр Пушкин',
        relatedEntityCandidates: [],
        fact: 'На титульной странице указан Александр Пушкин',
        evidence: { quote, startOffset, endOffset: startOffset + quote.length },
        confidence: 1
      }] })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })

  await assert.rejects(() => service.scanBookChunk({
    idempotencyKey: 'run-author:scan:chunk-author:book-scan-v5',
    runId: 'run-author',
    chunkId: 'chunk-author',
    extractorVersion: 'book-scan-v5',
    bookTitle: 'Медный всадник',
    bookAuthor: 'Александр Пушкин',
    contextText,
    coreLocalStartOffset: 0,
    coreLocalEndOffset: contextText.length
  }), (error) => error.code === 'EVIDENCE_MISMATCH')
})

test('internal generation service rejects a relationship without character observations for every participant', async () => {
  const storage = memoryStorage()
  const contextText = 'Евгений думает: И в нём Парашу успокою'
  const quote = 'И в нём Парашу успокою'
  const startOffset = contextText.indexOf(quote)
  const service = createInternalGenerationService({
    storage,
    logger: { info() {}, warn() {}, error() {} },
    async completeChat() {
      return JSON.stringify({ observations: [{
        type: 'relationship',
        entityKind: 'relationship',
        entityCandidate: 'Евгений и Параша',
        relatedEntityCandidates: ['Евгений', 'Параша'],
        fact: 'Евгений хочет успокоить Парашу',
        evidence: { quote, startOffset, endOffset: startOffset + quote.length },
        confidence: 0.98
      }] })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })

  await assert.rejects(() => service.scanBookChunk({
    idempotencyKey: 'run-relation:scan:chunk-relation:book-scan-v5',
    runId: 'run-relation',
    chunkId: 'chunk-relation',
    extractorVersion: 'book-scan-v5',
    bookTitle: 'Медный всадник',
    bookAuthor: 'Александр Пушкин',
    contextText,
    coreLocalStartOffset: 0,
    coreLocalEndOffset: contextText.length
  }), (error) => error.code === 'GENERATION_RESULT_INVALID')
})

test('internal generation service keeps grounded observations and drops invented evidence', async () => {
  const storage = memoryStorage()
  const lines = []
  let chatCalls = 0
  const contextText = 'ПРЕФИКС Анна вошла в комнату. ХВОСТ'
  const quote = 'Анна вошла в комнату.'
  const service = createInternalGenerationService({
    storage,
    logger: {
      info(line) { lines.push(line) },
      warn(line) { lines.push(line) },
      error(line) { lines.push(line) }
    },
    async completeChat() {
      chatCalls += 1
      return JSON.stringify({ observations: [{
        type: 'character_action',
        entityKind: 'character',
        entityCandidate: 'Анна',
        relatedEntityCandidates: [],
        fact: 'Анна вошла в комнату',
        evidence: { quote, startOffset: 0, endOffset: quote.length },
        confidence: 0.95
      }, {
        type: 'character_action',
        entityKind: 'character',
        entityCandidate: 'Анна',
        relatedEntityCandidates: [],
        fact: 'Анна убежала',
        evidence: { quote: 'Анна убежала.', startOffset: 0, endOffset: 14 },
        confidence: 0.8
      }, {
        type: 'unknown_fact',
        entityKind: 'character',
        entityCandidate: 'Анна',
        relatedEntityCandidates: [],
        fact: 'Неподдерживаемый тип',
        evidence: { quote, startOffset: 7, endOffset: 7 + quote.length },
        confidence: 0.7
      }] })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  const request = {
    idempotencyKey: 'run-mixed:scan:chunk-mixed:book-scan-v4',
    runId: 'run-mixed',
    chunkId: 'chunk-mixed',
    extractorVersion: 'book-scan-v4',
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    contextText,
    coreLocalStartOffset: 7,
    coreLocalEndOffset: contextText.length
  }
  const first = await service.scanBookChunk(request)
  const second = await service.scanBookChunk(request)
  assert.deepEqual(second, first)
  assert.equal(chatCalls, 1)
  assert.equal(first.observations.length, 1)
  assert.deepEqual(first.observations[0].evidence, {
    quote,
    startOffset: contextText.indexOf(quote),
    endOffset: contextText.indexOf(quote) + quote.length
  })
  assert.ok(lines.some((line) =>
    line.includes('event="scan.llm_completed"') &&
    line.includes('provider_observation_count=3') &&
    line.includes('accepted_observation_count=1') &&
    line.includes('repaired_observation_count=1') &&
    line.includes('dropped_observation_count=2')
  ))
  assert.equal(lines.some((line) => line.includes('Анна убежала')), false)
})

test('internal generation service rejects offset repair for an ambiguous exact quote', async () => {
  const storage = memoryStorage()
  const contextText = 'Анна вошла. Потом Анна вошла.'
  const quote = 'Анна вошла.'
  const service = createInternalGenerationService({
    storage,
    logger: { info() {}, error() {} },
    async completeChat() {
      return JSON.stringify({ observations: [{
        type: 'character_action',
        entityKind: 'character',
        entityCandidate: 'Анна',
        relatedEntityCandidates: [],
        fact: 'Анна вошла',
        evidence: { quote, startOffset: 1, endOffset: quote.length + 1 },
        confidence: 0.9
      }] })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  await assert.rejects(() => service.scanBookChunk({
    idempotencyKey: 'run-ambiguous:scan:chunk-ambiguous:book-scan-v1',
    runId: 'run-ambiguous',
    chunkId: 'chunk-ambiguous',
    extractorVersion: 'book-scan-v1',
    bookTitle: 'Книга',
    bookAuthor: '',
    contextText,
    coreLocalStartOffset: 0,
    coreLocalEndOffset: contextText.length
  }), (error) => error.code === 'EVIDENCE_MISMATCH')
  assert.equal(storage.objects.size, 0)
})

test('internal generation service does not cache an ungrounded scan result', async () => {
  const storage = memoryStorage()
  let chatCalls = 0
  const lines = []
  const contextText = ' Анна вошла. '
  const service = createInternalGenerationService({
    storage,
    logger: {
      info(line) { lines.push(line) },
      warn(line) { lines.push(line) },
      error(line) { lines.push(line) }
    },
    async completeChat() {
      chatCalls += 1
      return JSON.stringify({ observations: [{
        type: 'character_action',
        entityKind: 'character',
        entityCandidate: 'Анна',
        relatedEntityCandidates: [],
        fact: 'Анна убежала',
        evidence: { quote: 'Анна убежала.', startOffset: 1, endOffset: 5 },
        confidence: 0.9
      }] })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  const request = {
    idempotencyKey: 'run-2:scan:chunk-2:book-scan-v1',
    runId: 'run-2',
    chunkId: 'chunk-2',
    extractorVersion: 'book-scan-v1',
    bookTitle: 'Книга',
    bookAuthor: '',
    contextText,
    coreLocalStartOffset: 1,
    coreLocalEndOffset: contextText.length - 1
  }
  await assert.rejects(() => service.scanBookChunk(request), (error) =>
    error.code === 'EVIDENCE_MISMATCH'
  )
  await assert.rejects(() => service.scanBookChunk(request), (error) =>
    error.code === 'EVIDENCE_MISMATCH'
  )
  assert.equal(chatCalls, 2)
  assert.equal(storage.objects.size, 0)
  assert.equal(lines.filter((line) => line.includes('event="scan.llm_rejected"')).length, 2)
  assert.ok(lines.every((line) => !line.includes('Анна убежала')))
})

test('internal generation service builds a grounded profile for one resolved character', async () => {
  const storage = memoryStorage()
  let chatCalls = 0
  let chatRequest
  const service = createInternalGenerationService({
    storage,
    logger: { info() {}, error() {} },
    async completeChat(input) {
      chatCalls += 1
      chatRequest = input
      return JSON.stringify({
        role: {
          value: 'Врач',
          evidenceIds: ['22222222-2222-4222-8222-222222222222'],
          confidence: 0.96
        },
        creative: { greeting: 'Здравствуйте.', appearancePrompt: 'Портрет Анны', voice: 'Che' }
      })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  const request = {
    idempotencyKey: 'run-1:synthesize:snapshot-1:character:anna:character-profile-v2',
    runId: 'run-1',
    snapshotId: 'snapshot-1',
    synthesisVersion: 'character-profile-v2',
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    textLength: 1_000,
    entity: {
      entityKey: 'character:anna',
      entityKind: 'character',
      canonicalName: 'Анна',
      aliases: ['Аня'],
      resolutionStatus: 'confirmed',
      confidence: 0.95,
      evidenceIds: ['22222222-2222-4222-8222-222222222222'],
      data: { firstEvidenceStartOffset: 100 }
    },
    evidence: [{
      id: '22222222-2222-4222-8222-222222222222',
      type: 'character_role',
      fact: 'Анна работает врачом',
      quote: 'Анна — врач',
      startOffset: 100,
      endOffset: 111,
      confidence: 0.96
    }]
  }
  const first = await service.synthesizeCharacterProfile(request)
  const second = await service.synthesizeCharacterProfile(request)
  assert.deepEqual(second, first)
  assert.equal(chatCalls, 1)
  assert.equal(Object.hasOwn(chatRequest, 'temperature'), false)
  assert.equal(first.profile.characterKey, 'character:anna')
  assert.equal(first.profile.name, 'Анна')
  assert.equal(first.profile.role.value, 'Врач')
  assert.deepEqual(first.profile.role.evidenceIds, request.entity.evidenceIds)
})

test('internal generation service keeps compatible profile claims and drops only incompatible ones', async () => {
  const storage = memoryStorage()
  const lines = []
  let chatCalls = 0
  const roleEvidenceId = '22222222-2222-4222-8222-222222222223'
  const actionEvidenceId = '33333333-3333-4333-8333-333333333334'
  const service = createInternalGenerationService({
    storage,
    logger: {
      info(line) { lines.push(line) },
      warn(line) { lines.push(line) },
      error(line) { lines.push(line) }
    },
    async completeChat() {
      chatCalls += 1
      return JSON.stringify({
        role: {
          value: 'Врач',
          evidenceIds: [roleEvidenceId],
          confidence: 0.96
        },
        traits: [{
          value: 'Смелая',
          evidenceIds: [actionEvidenceId],
          confidence: 0.8
        }, {
          value: 'Несуществующее доказательство',
          evidenceIds: ['44444444-4444-4444-8444-444444444445'],
          confidence: 0.7
        }],
        appearance: [{ value: '', evidenceIds: [roleEvidenceId], confidence: 0.4 }],
        creative: { greeting: 'Здравствуйте.', appearancePrompt: 'Портрет Анны', voice: 'Che' }
      })
    },
    async generatePortrait() { throw new Error('unused') },
    async synthesizeSpeech() { throw new Error('unused') },
    async generateIdleAnimation() { throw new Error('unused') }
  })
  const request = {
    idempotencyKey: 'run-2:synthesize:snapshot-2:character:anna:character-profile-v2',
    runId: 'run-2',
    snapshotId: 'snapshot-2',
    synthesisVersion: 'character-profile-v2',
    bookTitle: 'Книга',
    bookAuthor: 'Автор',
    textLength: 1_000,
    entity: {
      entityKey: 'character:anna',
      entityKind: 'character',
      canonicalName: 'Анна',
      aliases: [],
      resolutionStatus: 'confirmed',
      confidence: 0.95,
      evidenceIds: [roleEvidenceId, actionEvidenceId],
      data: { firstEvidenceStartOffset: 100 }
    },
    evidence: [{
      id: roleEvidenceId,
      type: 'character_role',
      fact: 'Анна работает врачом',
      quote: 'Анна — врач',
      startOffset: 100,
      endOffset: 111,
      confidence: 0.96
    }, {
      id: actionEvidenceId,
      type: 'character_action',
      fact: 'Анна вошла',
      quote: 'Анна вошла',
      startOffset: 200,
      endOffset: 211,
      confidence: 0.9
    }]
  }
  const first = await service.synthesizeCharacterProfile(request)
  const second = await service.synthesizeCharacterProfile(request)
  assert.deepEqual(second, first)
  assert.equal(chatCalls, 1)
  assert.equal(first.profile.role.value, 'Врач')
  assert.deepEqual(first.profile.traits, [])
  assert.deepEqual(first.profile.appearance, [])
  assert.equal(first.profile.creative.voice, 'Che')
  assert.ok(lines.some((line) =>
    line.includes('event="synthesis.character_completed"') &&
    line.includes('provider_claim_count=4') &&
    line.includes('accepted_claim_count=1') &&
    line.includes('dropped_claim_count=3')
  ))
  assert.equal(lines.some((line) => line.includes('Смелая')), false)
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

test('internal router exposes all worker endpoints', () => {
  const router = createInternalGenerationRouter({
    token: 's'.repeat(48),
    service: {
      async generateBookMarkup() { return { ok: true } },
      async generateCharacterBundle() { return { ok: true } },
      async scanBookChunk() { return { observations: [] } },
      async synthesizeCharacterProfile() { return { profile: {} } }
    }
  })
  const paths = router.stack.map((layer) => layer.route?.path).filter(Boolean)
  assert.deepEqual(paths, [
    '/v1/book-markup',
    '/v1/character-bundles',
    '/v1/book-analysis/scan-chunk',
    '/v1/book-analysis/synthesize-character'
  ])
})
