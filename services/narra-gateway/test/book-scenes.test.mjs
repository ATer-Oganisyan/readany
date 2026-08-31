import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_MEDIA_LOOKAHEAD_FRACTION,
  BOOK_SCENE_INTERVAL_TEXT_LENGTH,
  BOOK_SCENE_POLICY_VERSION,
  bookMediaFrontier,
  bookScenePolicy,
  bookSceneSlotAt,
  bookSceneSlotsThrough
} from '../book-scenes.mjs'

test('scene policy is compact and deterministic for the whole markup', () => {
  assert.deepEqual(bookScenePolicy(25_000), {
    version: BOOK_SCENE_POLICY_VERSION,
    startTextOffset: 0,
    intervalTextLength: BOOK_SCENE_INTERVAL_TEXT_LENGTH
  })
  assert.deepEqual(bookScenePolicy(25_000), bookScenePolicy(25_000))
})

test('the same canonical text range always resolves to the same scene slot', () => {
  const policy = bookScenePolicy(25_000, { intervalTextLength: 6_000 })
  assert.deepEqual(bookSceneSlotAt(policy, 25_000, 0), {
    sceneKey: 'text-interval-v1:0',
    slotIndex: 0,
    anchorTextOffset: 3_000,
    excerptStartTextOffset: 0,
    excerptEndTextOffset: 6_000
  })
  assert.equal(bookSceneSlotAt(policy, 25_000, 5_999).slotIndex, 0)
  assert.equal(bookSceneSlotAt(policy, 25_000, 6_000).slotIndex, 1)
  assert.deepEqual(bookSceneSlotAt(policy, 25_000, 24_999), {
    sceneKey: 'text-interval-v1:4',
    slotIndex: 4,
    anchorTextOffset: 24_500,
    excerptStartTextOffset: 24_000,
    excerptEndTextOffset: 25_000
  })
})

test('private books keep a ten-percent media lead and catalog books prefetch all media', () => {
  assert.equal(BOOK_MEDIA_LOOKAHEAD_FRACTION, 0.1)
  assert.equal(bookMediaFrontier({ scope: 'private', textLength: 100_000, readerTextOffset: 0 }), 10_000)
  assert.equal(bookMediaFrontier({ scope: 'private', textLength: 100_000, readerTextOffset: 36_000 }), 46_000)
  assert.equal(bookMediaFrontier({ scope: 'private', textLength: 100_000, readerTextOffset: 96_000 }), 100_000)
  assert.equal(bookMediaFrontier({ scope: 'catalog', textLength: 100_000, readerTextOffset: 0 }), 100_000)
})

test('prefetch selects scene anchors inside the media frontier without per-place markup links', () => {
  const policy = bookScenePolicy(100_000, { intervalTextLength: 6_000 })
  assert.deepEqual(
    bookSceneSlotsThrough(policy, 100_000, 10_000).map(({ slotIndex, anchorTextOffset }) => ({
      slotIndex,
      anchorTextOffset
    })),
    [
      { slotIndex: 0, anchorTextOffset: 3_000 },
      { slotIndex: 1, anchorTextOffset: 9_000 }
    ]
  )
})
