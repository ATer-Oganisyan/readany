import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_CHARACTER_MEDIA } from '../book-markup.mjs'
import {
  createGenerationWorker,
  normalizeBookIdentityResult,
  normalizeBookMarkupResult,
  normalizeCharacterBundleInput,
  normalizeCharacterBundleResult,
  parseBookMarkupWorkerJobTypes
} from '../generation-worker.mjs'

const HASH = 'a'.repeat(64)
const silentLogger = { info() {}, warn() {}, error() {} }

test('book markup worker can be restricted to portrait jobs', () => {
  assert.deepEqual(
    parseBookMarkupWorkerJobTypes('character_portrait, character_portrait'),
    ['character_portrait']
  )
  assert.throws(
    () => parseBookMarkupWorkerJobTypes('character_portrait,book_identity'),
    /unsupported values/
  )
  assert.ok(parseBookMarkupWorkerJobTypes().includes('scene_image'))
})

function generatedAssets() {
  return REQUIRED_CHARACTER_MEDIA.map((type) => ({
    type,
    objectKey: `books/book-1/characters/anna/${type}`,
    contentHash: HASH,
    mimeType: type === 'primary_portrait' ? 'image/png' : 'application/octet-stream',
    byteSize: 100
  }))
}

test('worker publishes full markup and queues catalog character bundles', async () => {
  const ensured = []
  let published
  const repository = {
    async claimGenerationJob() {
      return { id: 'job-1', type: 'book_markup', bookEditionId: 'book-1', leaseToken: 'lease-1' }
    },
    async getBookMarkupInput() {
      return { scope: 'catalog', objectKey: 'books/book-1/source.epub', contentSha256: HASH }
    },
    async publishBookMarkup(job, markup) {
      published = { job, markup }
    },
    async ensureCharacterBundle(input) {
      ensured.push(input)
      return { status: 'queued' }
    },
    async failGenerationJob() {
      assert.fail('job must not fail')
    }
  }
  const generator = {
    async generateBookMarkup() {
      return {
        textLength: 200_000,
        characters: [
          {
            characterKey: 'anna',
            name: 'Anna',
            fullName: 'Anna Karenina',
            warmupTextOffset: 95_000,
            firstAppearanceTextOffset: 120_000
          },
          {
            characterKey: 'vronsky',
            name: 'Vronsky',
            fullName: 'Alexey Vronsky',
            warmupTextOffset: 110_000,
            firstAppearanceTextOffset: 135_000
          }
        ]
      }
    }
  }
  const worker = createGenerationWorker({
    repository,
    generator,
    workerId: 'worker-1',
    logger: { error: assert.fail }
  })
  assert.deepEqual(await worker.runOnce(), {
    status: 'completed',
    jobId: 'job-1',
    result: { characterCount: 2 }
  })
  assert.equal(published.markup.characters.length, 2)
  assert.deepEqual(ensured.map((entry) => entry.characterKey), ['anna', 'vronsky'])
})

test('private markup does not eagerly queue every character bundle', async () => {
  let ensureCount = 0
  const repository = {
    async claimGenerationJob() {
      return { id: 'job-2', type: 'book_markup', bookEditionId: 'book-2', leaseToken: 'lease-2' }
    },
    async getBookMarkupInput() {
      return { scope: 'private', objectKey: 'books/book-2/source.epub', contentSha256: HASH }
    },
    async publishBookMarkup() {},
    async ensureCharacterBundle() { ensureCount += 1 },
    async failGenerationJob() { assert.fail('job must not fail') }
  }
  const generator = {
    async generateBookMarkup() {
      return { textLength: 100, characters: [{
        characterKey: 'hero', name: 'Hero', fullName: 'The Hero',
        warmupTextOffset: 0, firstAppearanceTextOffset: 10
      }] }
    }
  }
  const worker = createGenerationWorker({ repository, generator, workerId: 'worker-1', logger: silentLogger })
  assert.equal((await worker.runOnce()).status, 'completed')
  assert.equal(ensureCount, 0)
})

test('worker publishes a character bundle only when all required media are present', async () => {
  let published
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-3', type: 'character_bundle', bookEditionId: 'book-1',
        characterKey: 'anna', leaseToken: 'lease-3'
      }
    },
    async getCharacterBundleInput() { return { characterKey: 'anna' } },
    async publishCharacterBundle(job, bundle) { published = { job, bundle } },
    async failGenerationJob() { assert.fail('job must not fail') }
  }
  const generator = {
    async generateCharacterBundle() { return { assets: generatedAssets() } }
  }
  const worker = createGenerationWorker({ repository, generator, workerId: 'worker-1', logger: silentLogger })
  assert.deepEqual(await worker.runOnce(), {
    status: 'completed', jobId: 'job-3', result: { assetCount: 3 }
  })
  assert.deepEqual(published.bundle.assets.map((asset) => asset.type), REQUIRED_CHARACTER_MEDIA)
})

test('worker publishes a portrait job without waiting for audio or animation', async () => {
  let requestedMedia
  let published
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-portrait', type: 'character_portrait', bookEditionId: 'book-1',
        characterKey: 'anna', leaseToken: 'lease-portrait',
        payload: { required_media: ['primary_portrait'] }
      }
    },
    async getCharacterBundleInput() { return { characterKey: 'anna' } },
    async publishCharacterBundle(job, bundle) { published = { job, bundle } },
    async failGenerationJob() { assert.fail('portrait job must not fail') }
  }
  const generator = {
    async generateCharacterBundle(_input, media) {
      requestedMedia = media
      return { assets: generatedAssets().filter((asset) => media.includes(asset.type)) }
    }
  }
  const worker = createGenerationWorker({ repository, generator, workerId: 'worker-1', logger: silentLogger })
  assert.deepEqual(await worker.runOnce(), {
    status: 'completed', jobId: 'job-portrait', result: { assetCount: 1 }
  })
  assert.deepEqual(requestedMedia, ['primary_portrait'])
  assert.deepEqual(published.bundle.assets.map((asset) => asset.type), ['primary_portrait'])
})

test('worker publishes a catalog cover into the durable repository', async () => {
  let published
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-cover', type: 'catalog_cover', bookEditionId: 'book-1',
        targetVersion: 'catalog-cover-v2-aaaa', leaseToken: 'lease-cover'
      }
    },
    async getCatalogCoverInput() {
      return { bookEditionId: 'book-1', title: 'Книга', scope: 'catalog' }
    },
    async publishCatalogCover(job, asset) { published = { job, asset } },
    async failGenerationJob() { assert.fail('cover job must not fail') }
  }
  const generator = {
    async generateCatalogCover() {
      return {
        asset: {
          objectKey: 'books/catalog/book-1/cover.png', contentHash: HASH,
          mimeType: 'image/png', byteSize: 100
        }
      }
    }
  }
  const worker = createGenerationWorker({ repository, generator, workerId: 'worker-1', logger: silentLogger })
  assert.deepEqual(await worker.runOnce(), {
    status: 'completed', jobId: 'job-cover', result: { assetCount: 1 }
  })
  assert.equal(published.asset.objectKey, 'books/catalog/book-1/cover.png')
})

test('worker generates and publishes a durable book scene', async () => {
  let generatorInput
  let published
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-scene', type: 'scene_image', bookEditionId: 'book-1',
        targetVersion: 'text-interval-v1:aaaa', leaseToken: 'lease-scene'
      }
    },
    async getBookSceneInput() {
      return {
        bookEditionId: 'book-1', sceneKey: 'text-interval-v1:2',
        excerptStartTextOffset: 12_000, excerptEndTextOffset: 18_000
      }
    },
    async publishBookScene(job, asset) { published = { job, asset } },
    async failGenerationJob() { assert.fail('scene job must not fail') }
  }
  const generator = {
    async generateBookScene(input) {
      generatorInput = input
      return {
        asset: {
          objectKey: 'generated/catalog/book-1/scenes/2.png',
          contentHash: HASH,
          mimeType: 'image/png',
          byteSize: 100
        }
      }
    }
  }
  const worker = createGenerationWorker({ repository, generator, workerId: 'worker-1', logger: silentLogger })

  assert.deepEqual(await worker.runOnce(), {
    status: 'completed', jobId: 'job-scene', result: { assetCount: 1 }
  })
  assert.equal(generatorInput.sceneKey, 'text-interval-v1:2')
  assert.equal(published.asset.objectKey, 'generated/catalog/book-1/scenes/2.png')
})

test('dedicated identity job publishes normalized display metadata', async () => {
  let published
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-identity', type: 'book_identity', bookEditionId: 'book-1',
        targetVersion: 'book-identity-v1-aaaa', leaseToken: 'lease-identity'
      }
    },
    async getBookIdentityInput() {
      return { bookEditionId: 'book-1', title: 'Мертвое озеро (Часть первая)' }
    },
    async publishBookIdentity(job, identity) { published = { job, identity } },
    async failGenerationJob() { assert.fail('identity job must not fail') }
  }
  const generator = {
    async generateBookIdentity() {
      return { title: 'Мертвое озеро', author: 'Николай Некрасов', source: 'llm' }
    }
  }
  const worker = createGenerationWorker({ repository, generator, workerId: 'identity-1', logger: silentLogger })
  assert.equal((await worker.runOnce()).status, 'completed')
  assert.deepEqual(published.identity, {
    title: 'Мертвое озеро', author: 'Николай Некрасов', source: 'llm'
  })
  assert.deepEqual(normalizeBookIdentityResult(published.identity), published.identity)
})

test('worker adapts legacy local profiles to the strict character bundle contract', async () => {
  let generatorInput
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-local', type: 'character_bundle', bookEditionId: 'book-local',
        characterKey: 'anna', leaseToken: 'lease-local'
      }
    },
    async getCharacterBundleInput() {
      return {
        bookEditionId: 'book-local',
        characterKey: 'anna',
        name: 'Анна',
        fullName: 'Анна Сергеевна',
        firstAppearanceTextOffset: 200_000,
        warmupTextOffset: 150_000,
        scope: 'private',
        bookTitle: 'Книга',
        bookAuthor: 'Автор',
        bundleVersion: 'character-bundle-v1',
        character: {
          clientCharacterId: 'анна',
          role: 'Героиня',
          gender: 'female',
          voice: 'unsupported',
          traits: ['смелая', 'наблюдательная'],
          speechStyle: 'говорит коротко',
          speechExamples: ['Пример исходного текста'],
          appearancePrompt: 'портрет Анны',
          passport: { age: 27, hair: 'тёмные волосы' },
          expression: 'спокойная',
          greeting: 'Здравствуйте',
          isNarrator: false,
          unlockProgress: 0.2
        }
      }
    },
    async publishCharacterBundle() {},
    async failGenerationJob() { assert.fail('job must not fail') }
  }
  const generator = {
    async generateCharacterBundle(input) {
      generatorInput = input
      return { assets: generatedAssets() }
    }
  }
  const worker = createGenerationWorker({ repository, generator, workerId: 'worker-1', logger: silentLogger })
  assert.equal((await worker.runOnce()).status, 'completed')
  assert.deepEqual(Object.keys(generatorInput.character), [
    'characterKey', 'name', 'fullName', 'aliases', 'gender', 'age', 'role', 'description',
    'appearancePrompt', 'greeting', 'voice', 'firstAppearanceTextOffset', 'warmupTextOffset'
  ])
  assert.equal(generatorInput.character.voice, 'Che')
  assert.equal(generatorInput.name, 'Анна')
  assert.equal(generatorInput.fullName, 'Анна Сергеевна')
  assert.equal(generatorInput.character.firstAppearanceTextOffset, 200_000)
  assert.equal(generatorInput.character.warmupTextOffset, 150_000)
  assert.match(generatorInput.character.description, /смелая/)
  assert.equal('clientCharacterId' in generatorInput.character, false)
  assert.equal('firstAppearanceTextOffset' in generatorInput, false)
})

test('worker adapts evidence-backed v3 profiles without losing creative media fields', async () => {
  let generatorInput
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-v3', type: 'character_bundle', bookEditionId: 'book-v3',
        characterKey: 'character:anna', leaseToken: 'lease-v3'
      }
    },
    async getCharacterBundleInput() {
      return {
        bookEditionId: 'book-v3', characterKey: 'character:anna',
        name: 'Анна', fullName: 'Анна Сергеевна', scope: 'private',
        bookTitle: 'Книга', bookAuthor: 'Автор', bundleVersion: 'character-bundle-v3',
        character: {
          characterKey: 'character:anna', aliases: ['Анна'],
          firstAppearanceTextOffset: 200, warmupTextOffset: 150,
          role: { value: 'Героиня', evidenceIds: ['role-1'], confidence: 0.9 },
          age: { value: '27 лет', evidenceIds: ['age-1'], confidence: 0.8 },
          gender: { value: 'female', evidenceIds: ['gender-1'], confidence: 0.9 },
          description: { value: 'Наблюдательная женщина', evidenceIds: ['desc-1'], confidence: 0.8 },
          traits: [{ value: 'смелая', evidenceIds: ['trait-1'], confidence: 0.8 }],
          speechStyle: { value: 'говорит коротко', evidenceIds: ['speech-1'], confidence: 0.8 },
          appearance: [{ value: 'тёмные волосы', evidenceIds: ['look-1'], confidence: 0.8 }],
          creative: {
            appearancePrompt: 'кинематографичный портрет Анны',
            greeting: 'Здравствуйте',
            voice: 'Che'
          }
        }
      }
    },
    async publishCharacterBundle() {},
    async failGenerationJob() { assert.fail('job must not fail') }
  }
  const worker = createGenerationWorker({
    repository,
    generator: {
      async generateCharacterBundle(input) {
        generatorInput = input
        return { assets: generatedAssets() }
      }
    },
    workerId: 'worker-v3',
    logger: silentLogger
  })

  assert.equal((await worker.runOnce()).status, 'completed')
  assert.equal(generatorInput.character.role, 'Героиня')
  assert.equal(generatorInput.character.gender, 'female')
  assert.equal(generatorInput.character.age, '27 лет')
  assert.equal(generatorInput.character.description, 'Наблюдательная женщина')
  assert.equal(generatorInput.character.appearancePrompt, 'кинематографичный портрет Анны')
  assert.equal(generatorInput.character.greeting, 'Здравствуйте')
  assert.equal(generatorInput.character.voice, 'Che')
})

test('worker replaces a supported but wrong-gender generated voice', () => {
  const normalized = normalizeCharacterBundleInput({
    bookEditionId: 'book-v3', characterKey: 'character:ivan',
    name: 'Иван', fullName: 'Иван Петрович', scope: 'private',
    bookTitle: 'Книга', bookAuthor: 'Автор', bundleVersion: 'character-bundle-v3',
    character: {
      characterKey: 'character:ivan', aliases: ['Иван'],
      firstAppearanceTextOffset: 200, warmupTextOffset: 150,
      gender: { value: 'male', evidenceIds: ['gender-1'], confidence: 0.9 },
      creative: { greeting: 'Здравствуйте', voice: 'Che' }
    }
  })

  assert.equal(normalized.character.gender, 'male')
  assert.equal(normalized.character.voice, 'She')
})

test('invalid generated media fails the leased job without partial publication', async () => {
  let failed
  let publishCount = 0
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-4', type: 'character_bundle', bookEditionId: 'book-1',
        characterKey: 'anna', leaseToken: 'lease-4'
      }
    },
    async getCharacterBundleInput() { return { characterKey: 'anna' } },
    async publishCharacterBundle() { publishCount += 1 },
    async failGenerationJob(job, code) { failed = { job, code } }
  }
  const generator = {
    async generateCharacterBundle() {
      return { assets: generatedAssets().slice(0, 1) }
    }
  }
  const worker = createGenerationWorker({
    repository,
    generator,
    workerId: 'worker-1',
    logger: { error() {} }
  })
  assert.deepEqual(await worker.runOnce(), {
    status: 'failed', jobId: 'job-4', errorCode: 'GENERATION_RESULT_INVALID'
  })
  assert.equal(publishCount, 0)
  assert.equal(failed.code, 'GENERATION_RESULT_INVALID')
})

test('normalizers reject duplicate characters and incomplete bundles', () => {
  const duplicate = {
    textLength: 10,
    characters: [
      { characterKey: 'hero', name: 'A', fullName: 'A', warmupTextOffset: 0, firstAppearanceTextOffset: 1 },
      { characterKey: 'hero', name: 'B', fullName: 'B', warmupTextOffset: 0, firstAppearanceTextOffset: 2 }
    ]
  }
  assert.throws(() => normalizeBookMarkupResult(duplicate), /duplicate character key/)
  assert.throws(
    () => normalizeBookMarkupResult({ characters: duplicate.characters }),
    /positive textLength/
  )
  assert.throws(
    () => normalizeBookMarkupResult({
      textLength: 1,
      characters: [{
        characterKey: 'late', name: 'Late', fullName: 'Late Hero',
        warmupTextOffset: 1, firstAppearanceTextOffset: 2
      }]
    }),
    /appears after textLength/
  )
  assert.throws(
    () => normalizeCharacterBundleResult({ assets: generatedAssets().slice(0, 2) }),
    /missing idle_animation/
  )
  assert.throws(
    () => normalizeCharacterBundleInput(null),
    /character bundle input must be an object/
  )
})

test('worker emits readable lifecycle logs for a completed book markup', async () => {
  const lines = []
  const repository = {
    async claimGenerationJob() {
      return {
        id: 'job-log-1', type: 'book_markup', bookEditionId: 'book-log-1',
        leaseToken: 'lease-log-1', attempts: 1
      }
    },
    async getBookMarkupInput() {
      return {
        scope: 'private', title: 'Анна Каренина', format: 'epub', byteSize: 1234,
        objectKey: 'books/book-log-1/source.epub', contentSha256: HASH
      }
    },
    async publishBookMarkup() {},
    async failGenerationJob() { assert.fail('job must not fail') }
  }
  const generator = {
    async generateBookMarkup() {
      return {
        textLength: 1000,
        characters: [{
          characterKey: 'anna', name: 'Анна', fullName: 'Анна Каренина',
          warmupTextOffset: 0, firstAppearanceTextOffset: 10
        }]
      }
    }
  }
  const worker = createGenerationWorker({
    repository,
    generator,
    workerId: 'worker-log-1',
    logger: {
      info(line) { lines.push(line) },
      error(line) { lines.push(line) }
    }
  })
  assert.equal((await worker.runOnce()).status, 'completed')
  assert.ok(lines.some((line) => line.includes('event="job.claimed"') && line.includes('attempt=1')))
  assert.ok(lines.some((line) => line.includes('event="markup.started"') && line.includes('book="Анна Каренина"')))
  assert.ok(lines.some((line) => line.includes('event="markup.generated"') && line.includes('characters="Анна"')))
  assert.ok(lines.some((line) => line.includes('event="markup.published"')))
  assert.ok(lines.some((line) => line.includes('event="job.completed"')))
})

test('worker distinguishes a scheduled retry from an exhausted failure', async () => {
  for (const [failureStatus, expectedEvent] of [
    ['queued', 'job.retry_scheduled'],
    ['failed', 'job.failed']
  ]) {
    const lines = []
    const repository = {
      async claimGenerationJob() {
        return {
          id: `job-${failureStatus}`, type: 'book_markup', bookEditionId: 'book-1',
          leaseToken: `lease-${failureStatus}`, attempts: 2
        }
      },
      async getBookMarkupInput() {
        return { scope: 'private', title: 'Книга', contentSha256: HASH }
      },
      async failGenerationJob() { return { status: failureStatus } }
    }
    const generator = {
      async generateBookMarkup() {
        throw Object.assign(new Error('provider unavailable'), { code: 'PROVIDER_UNAVAILABLE' })
      }
    }
    const worker = createGenerationWorker({
      repository,
      generator,
      workerId: 'worker-log-1',
      logger: {
        info(line) { lines.push(line) },
        warn(line) { lines.push(line) },
        error(line) { lines.push(line) }
      }
    })

    assert.equal((await worker.runOnce()).status, 'failed')
    assert.ok(lines.some((line) => line.includes(`event="${expectedEvent}"`)))
  }
})
