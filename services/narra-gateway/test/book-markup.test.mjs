import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHARACTER_BUNDLE_VERSION,
  REQUIRED_CHARACTER_MEDIA,
  characterBundleIdempotencyKey,
  charactersDueForWarmup,
  ensureCharacterBundle,
  isCompleteCharacterBundle,
  normalizeCharacterAnchor,
  readerCharacterState,
  sectionAnchorForTextOffset
} from '../book-markup.mjs'

function readyBundle(characterKey = 'anna-karenina') {
  return {
    characterKey,
    status: 'ready',
    assets: REQUIRED_CHARACTER_MEDIA.map((type, index) => ({
      type,
      status: 'ready',
      assetId: `asset-${index + 1}`
    }))
  }
}

function memoryRepository() {
  const jobs = new Map()
  let sequence = 0
  return {
    jobs,
    async ensureCharacterBundle(spec) {
      const existing = jobs.get(spec.idempotencyKey)
      if (existing) return { ...existing, created: false }
      const created = {
        created: true,
        jobId: `job-${++sequence}`,
        status: 'queued',
        requiredMedia: spec.requiredMedia
      }
      jobs.set(spec.idempotencyKey, created)
      return created
    }
  }
}

test('markup anchors keep warmup and reader visibility independent', () => {
  const character = normalizeCharacterAnchor({
    characterKey: 'anna-karenina',
    warmupTextOffset: 95_000,
    firstAppearanceTextOffset: 120_000
  })
  assert.equal(readerCharacterState(character, readyBundle(), 100_000), 'hidden')
  assert.equal(readerCharacterState(character, readyBundle(), 120_000), 'ready')
  assert.equal(readerCharacterState(character, null, 120_000), 'preparing')
  assert.throws(
    () => normalizeCharacterAnchor({ ...character, warmupTextOffset: 130_000 }),
    /must not be after/
  )
})

test('section anchors prevent a small global offset mismatch from revealing a future character', () => {
  const anchor = sectionAnchorForTextOffset([
    { key: 'title', sourceIndex: 1, startOffset: 0, endOffset: 100 },
    { key: 'chapter-1', sourceIndex: 2, startOffset: 100, endOffset: 1_000 }
  ], 138)
  assert.deepEqual(anchor, {
    firstAppearanceSectionIndex: 2,
    firstAppearanceSectionKey: 'chapter-1',
    firstAppearanceSectionFraction: 38 / 900
  })
  const character = {
    characterKey: 'raskolnikov',
    warmupTextOffset: 0,
    firstAppearanceTextOffset: 138,
    ...anchor
  }
  assert.equal(readerCharacterState(character, readyBundle(), {
    textOffset: 333,
    sectionIndex: 0,
    sectionFraction: 0.9
  }), 'hidden')
  assert.equal(readerCharacterState(character, readyBundle(), {
    textOffset: 333,
    sectionIndex: 2,
    sectionFraction: anchor.firstAppearanceSectionFraction
  }), 'ready')
})

test('warmup selection uses markup text offsets and catches up after an offline gap', () => {
  const due = charactersDueForWarmup([
    { characterKey: 'late', warmupTextOffset: 150, firstAppearanceTextOffset: 180 },
    { characterKey: 'early', warmupTextOffset: 40, firstAppearanceTextOffset: 70 },
    { characterKey: 'middle', warmupTextOffset: 100, firstAppearanceTextOffset: 130 }
  ], 120)
  assert.deepEqual(due.map((character) => character.characterKey), ['early', 'middle'])
})

test('a ready character bundle is atomic and requires every media type', () => {
  assert.equal(isCompleteCharacterBundle(readyBundle()), true)
  const incomplete = readyBundle()
  incomplete.assets = incomplete.assets.filter((asset) => asset.type !== 'idle_animation')
  assert.equal(isCompleteCharacterBundle(incomplete), false)
  assert.equal(isCompleteCharacterBundle({ ...readyBundle(), status: 'running' }), false)
})

test('character bundle generation is idempotent under concurrent requests', async () => {
  const repository = memoryRepository()
  const request = {
    bookEditionId: 'book-42',
    characterKey: 'anna-karenina'
  }
  const results = await Promise.all(
    Array.from({ length: 32 }, () => ensureCharacterBundle(repository, request))
  )
  assert.equal(repository.jobs.size, 1)
  assert.equal(results.filter((result) => result.created).length, 1)
  assert.equal(new Set(results.map((result) => result.jobId)).size, 1)
  assert.equal(results[0].idempotencyKey, 'book-42:anna-karenina:character-bundle-v1')
  assert.deepEqual(results[0].requiredMedia, REQUIRED_CHARACTER_MEDIA)
})

test('a new bundle version has a separate idempotency key', async () => {
  const repository = memoryRepository()
  const base = { bookEditionId: 'book-42', characterKey: 'anna-karenina' }
  const first = await ensureCharacterBundle(repository, base)
  const second = await ensureCharacterBundle(repository, {
    ...base,
    bundleVersion: 'character-bundle-v2'
  })
  assert.notEqual(first.jobId, second.jobId)
  assert.equal(repository.jobs.size, 2)
  assert.equal(
    characterBundleIdempotencyKey(base),
    `book-42:anna-karenina:${CHARACTER_BUNDLE_VERSION}`
  )
})
