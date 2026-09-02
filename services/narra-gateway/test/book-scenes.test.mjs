import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_MEDIA_LOOKAHEAD_FRACTION,
  BOOK_READER_SCENE_CONTEXT_TEXT_LENGTH,
  BOOK_READER_SCENE_VERSION,
  BOOK_SCENE_INTERVAL_TEXT_LENGTH,
  BOOK_SCENE_POLICY_VERSION,
  bookMediaFrontier,
  bookReaderSceneAt,
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
    excerptStartTextOffset: 2_501,
    excerptEndTextOffset: 3_001
  })
  assert.equal(bookSceneSlotAt(policy, 25_000, 5_999).slotIndex, 0)
  assert.equal(bookSceneSlotAt(policy, 25_000, 6_000).slotIndex, 1)
  assert.deepEqual(bookSceneSlotAt(policy, 25_000, 24_999), {
    sceneKey: 'text-interval-v1:4',
    slotIndex: 4,
    anchorTextOffset: 24_500,
    excerptStartTextOffset: 24_001,
    excerptEndTextOffset: 24_501
  })
  assert.equal(
    bookSceneSlotAt(policy, 25_000, 6_000).excerptEndTextOffset,
    bookSceneSlotAt(policy, 25_000, 6_000).anchorTextOffset + 1
  )
})

test('every reader card gets context immediately before its own text position', () => {
  const first = bookReaderSceneAt(25_000, 8_000)
  const second = bookReaderSceneAt(25_000, 10_500)

  assert.deepEqual(first, {
    policyVersion: BOOK_READER_SCENE_VERSION,
    sceneKey: 'reader-card-v1:8000',
    slotIndex: 33_000,
    anchorTextOffset: 8_000,
    excerptStartTextOffset: 7_501,
    excerptEndTextOffset: 8_001
  })
  assert.equal(first.excerptEndTextOffset - first.excerptStartTextOffset, BOOK_READER_SCENE_CONTEXT_TEXT_LENGTH)
  assert.equal(second.sceneKey, 'reader-card-v1:10500')
  assert.equal(second.excerptStartTextOffset, 10_001)
  assert.notEqual(first.sceneKey, second.sceneKey)
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
