import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRIVATE_LOOKAHEAD_CHAPTERS,
  SCENE_BUDGET_FIRST_WINDOW,
  SCENE_BUDGET_PER_WINDOW,
  cardWindowChapterFrontier,
  cardWindowSceneBudget,
  nextCardWindow,
  readerChapterIndex,
  remainingSceneBudget
} from '../analysis/book-card-window-schedule.mjs'
import { CARD_MEDIA_PRIORITY } from '../analysis/book-character-card.mjs'

/** Окно 0 покрывает две первые главы, дальше по одной — как в проде. */
function windows(statuses) {
  return statuses.map((status, index) => ({
    windowIndex: index,
    startOffset: index === 0 ? 0 : (index + 1) * 10_000,
    endOffset: (index + 2) * 10_000,
    chapterIndexes: index === 0 ? [0, 1] : [index + 1],
    priorityClass: index === 0 ? 'foreground' : 'background',
    status
  }))
}

test('a catalog book is prepared to its end regardless of any reader', () => {
  assert.equal(
    cardWindowChapterFrontier({ scope: 'catalog', windows: windows(['queued']) }),
    Number.POSITIVE_INFINITY
  )
})

test('a private book is prepared to the reader chapter plus two', () => {
  // Раньше это мерилось плоскими 10% текста: на книге в тысячу страниц — сто
  // страниц вперёд, на короткой — половина главы. Главы честнее.
  const list = windows(Array.from({ length: 8 }, () => 'queued'))
  assert.equal(
    cardWindowChapterFrontier({ scope: 'private', windows: list, readerTextOffset: 0 }),
    3
  )
  assert.equal(
    cardWindowChapterFrontier({ scope: 'private', windows: list, readerTextOffset: 35_000 }),
    5
  )
  assert.equal(PRIVATE_LOOKAHEAD_CHAPTERS, 2)
})

test('the reader chapter comes from the window chapters, not the window number', () => {
  // Окно 0 покрывает главы 0 и 1, поэтому читатель в его конце находится на
  // главе 1, а не 0 — иначе фронт ошибается ровно на эту главу.
  const list = windows(['ready', 'queued', 'queued'])
  assert.equal(readerChapterIndex(list, 0), 1)
  assert.equal(readerChapterIndex(list, 25_000), 2)
  assert.equal(readerChapterIndex(list, 999_999), 3)
})

test('the next window is the first unfinished one, at its own priority', () => {
  const next = nextCardWindow({
    windows: windows(['ready', 'queued', 'queued']),
    maxChapterIndex: Number.POSITIVE_INFINITY
  })
  assert.equal(next.windowIndex, 1)
  assert.equal(next.priorityClass, 'background')
  assert.equal(next.priority, CARD_MEDIA_PRIORITY.background)
})

test('the first window carries the foreground priority', () => {
  const next = nextCardWindow({
    windows: windows(['queued', 'queued']),
    maxChapterIndex: Number.POSITIVE_INFINITY
  })
  assert.equal(next.windowIndex, 0)
  assert.equal(next.priority, CARD_MEDIA_PRIORITY.foreground)
})

test('nothing is enqueued while a window is still in flight', () => {
  // Цепочка перестаёт быть цепочкой, если окно N+1 встаёт в очередь до того,
  // как закончилось окно N: очередь заполнится фоном одной книги.
  assert.equal(
    nextCardWindow({
      windows: windows(['running', 'queued']),
      maxChapterIndex: Number.POSITIVE_INFINITY
    }),
    null
  )
})

test('a queued window means not yet enqueued, and that is what gets enqueued', () => {
  // В схеме `queued` — «окно ещё не поставлено», `running` — «его карточки в
  // работе». Спутать их значит либо никогда не двигать цепочку, либо ставить
  // второе окно поверх первого.
  const next = nextCardWindow({
    windows: windows(['queued', 'queued']),
    maxChapterIndex: Number.POSITIVE_INFINITY
  })
  assert.equal(next.windowIndex, 0)
})

test('a window past the reader chapter frontier waits for the reader', () => {
  const list = windows(['ready', 'queued', 'queued'])
  // Окно 1 покрывает главу 2.
  assert.equal(nextCardWindow({ windows: list, maxChapterIndex: 1 }), null)
  assert.equal(nextCardWindow({ windows: list, maxChapterIndex: 2 }).windowIndex, 1)
})

test('a fully processed book enqueues nothing', () => {
  for (const statuses of [['ready', 'ready'], ['ready', 'cancelled']]) {
    assert.equal(
      nextCardWindow({
        windows: windows(statuses),
        maxChapterIndex: Number.POSITIVE_INFINITY
      }),
      null
    )
  }
})

test('the first window gets a larger scene budget than the background ones', () => {
  assert.equal(cardWindowSceneBudget(0), SCENE_BUDGET_FIRST_WINDOW)
  assert.equal(cardWindowSceneBudget(1), SCENE_BUDGET_PER_WINDOW)
  assert.equal(cardWindowSceneBudget(37), SCENE_BUDGET_PER_WINDOW)
  assert.ok(SCENE_BUDGET_FIRST_WINDOW > SCENE_BUDGET_PER_WINDOW)
})

test('an exhausted budget defers scenes instead of going negative', () => {
  assert.equal(remainingSceneBudget({ windowIndex: 0, alreadyQueued: 0 }), 12)
  assert.equal(remainingSceneBudget({ windowIndex: 0, alreadyQueued: 12 }), 0)
  assert.equal(remainingSceneBudget({ windowIndex: 0, alreadyQueued: 99 }), 0)
  assert.equal(remainingSceneBudget({ windowIndex: 3, alreadyQueued: 1 }), 3)
})

test('invalid schedule inputs are refused rather than silently defaulted', () => {
  assert.throws(() => cardWindowChapterFrontier({ scope: 'catalog', windows: [] }), {
    code: 'CARD_WINDOW_SCHEDULE_INVALID'
  })
  assert.throws(
    () => cardWindowChapterFrontier({ scope: 'shared', windows: windows(['queued']) }),
    { code: 'CARD_WINDOW_SCHEDULE_INVALID' }
  )
  assert.throws(
    () => cardWindowChapterFrontier({
      scope: 'private',
      windows: windows(['queued']),
      readerTextOffset: -1
    }),
    { code: 'CARD_WINDOW_SCHEDULE_INVALID' }
  )
  assert.throws(() => nextCardWindow({ windows: [], maxChapterIndex: 1 }), {
    code: 'CARD_WINDOW_SCHEDULE_INVALID'
  })
  assert.throws(
    () => nextCardWindow({ windows: windows(['queued']), maxChapterIndex: -1 }),
    { code: 'CARD_WINDOW_SCHEDULE_INVALID' }
  )
  assert.throws(() => cardWindowSceneBudget(-1), { code: 'CARD_WINDOW_SCHEDULE_INVALID' })
  assert.throws(() => remainingSceneBudget({ windowIndex: 0, alreadyQueued: -1 }), {
    code: 'CARD_WINDOW_SCHEDULE_INVALID'
  })
})
