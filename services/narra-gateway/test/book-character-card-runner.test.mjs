import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createCharacterCardRunner } from '../analysis/book-character-card-runner.mjs'
import { CARD_MEDIA_PRIORITY } from '../analysis/book-character-card.mjs'

const silentLogger = { info() {}, warn() {}, error() {} }

const TEXT = [
  'Элизабет Беннет жила в Лонгборне с четырьмя сёстрами.',
  'Элизабет заметила, что гость наблюдает за нею внимательно.',
  `${'ровный текст. '.repeat(400)}`,
  'Элизабет снова заметила эту привычку и промолчала.'
].join('\n\n')
const TEXT_BYTES = Buffer.from(TEXT, 'utf8')
const TEXT_HASH = createHash('sha256').update(TEXT_BYTES).digest('hex')

function fragmentAt(index, needle) {
  const startOffset = TEXT.indexOf(needle)
  return {
    fragmentId: `frag:char:elizabeth:${index}`,
    characterKey: 'char:elizabeth',
    paragraphIndex: index,
    chapterIndex: 0,
    startOffset,
    endOffset: startOffset + needle.length,
    mentionCount: 1
  }
}

const FRAGMENTS = [
  fragmentAt(0, 'Элизабет Беннет жила в Лонгборне с четырьмя сёстрами.'),
  fragmentAt(1, 'Элизабет заметила, что гость наблюдает за нею внимательно.'),
  fragmentAt(3, 'Элизабет снова заметила эту привычку и промолчала.')
]

function harness({ generatorResult, generatorError, storageBytes = TEXT_BYTES, input = {} } = {}) {
  const calls = { advanced: [], requests: [], published: [] }
  const repository = {
    async getCharacterCardInput() {
      return {
        runId: 'run-1',
        bookEditionId: 'edition-1',
        characterKey: 'char:elizabeth',
        windowIndex: 0,
        title: 'Гордость и предубеждение',
        author: 'Джейн Остин',
        language: 'ru',
        textLength: TEXT.length,
        normalizedTextObjectKey: 'analysis/run-1/normalized-text-v2.txt',
        normalizedTextHash: TEXT_HASH,
        inventoryVersion: 'name-inventory-v1',
        cardRevision: 1,
        window: { startOffset: 0, endOffset: TEXT.length, chapterIndexes: [0, 1] },
        character: {
          canonicalName: 'Элизабет',
          names: ['Элизабет', 'Лиззи'],
          mentionCount: 2_476,
          firstMentionTextOffset: FRAGMENTS[0].startOffset
        },
        fragments: FRAGMENTS,
        ...input
      }
    },
    async publishCharacterCard(job, payload) {
      calls.published.push(payload)
      return { status: 'published', cardId: 'card-1' }
    },
    async advanceCardWindows(input) {
      calls.advanced.push(input)
      return { closed: [0], enqueued: { windowIndex: 1, created: 2 } }
    }
  }
  const storage = {
    async getBytes() { return { bytes: storageBytes, mimeType: 'text/plain' } }
  }
  const generator = {
    async generateCharacterCard(request) {
      calls.requests.push(request)
      if (generatorError) throw generatorError
      return generatorResult ?? {
        card: {
          name: 'Элизабет',
          fullName: 'Элизабет Беннет',
          aliases: ['Лиззи'],
          role: { value: 'вторая из пяти дочерей', fragmentIds: [FRAGMENTS[0].fragmentId] },
          bio: {
            value: 'Элизабет живёт в Лонгборне с сёстрами.',
            fragmentIds: [FRAGMENTS[0].fragmentId]
          },
          traits: [{
            value: 'наблюдательная',
            fragmentIds: [FRAGMENTS[1].fragmentId, FRAGMENTS[2].fragmentId],
            confidence: 0.9
          }],
          locations: [{ value: 'Лонгборн', fragmentIds: [FRAGMENTS[0].fragmentId] }],
          appearancePrompt: 'тёмные живые глаза',
          gender: 'female',
          age: 'около двадцати',
          greeting: 'Здравствуйте. Я Элизабет.'
        }
      }
    }
  }
  const runner = createCharacterCardRunner({
    repository,
    storage,
    generator,
    now: () => '2026-09-10T10:00:00Z',
    logger: silentLogger
  })
  return { runner, calls }
}

const JOB = { id: 'job-1', bookEditionId: 'edition-1', characterKey: 'char:elizabeth', leaseToken: 'lease-1' }

test('the runner rebuilds quotes from the normalized text and publishes the card', async () => {
  const { runner, calls } = harness()
  const result = await runner.run(JOB)
  assert.equal(result.characterKey, 'char:elizabeth')
  assert.equal(result.traitCount, 1)
  assert.equal(result.bioSource, 'model')

  // Цитаты не читаются из базы: они вырезаны из текста по тем же смещениям.
  const [request] = calls.requests
  assert.equal(request.fragments.length, 3)
  assert.equal(
    request.fragments[0].quote,
    'Элизабет Беннет жила в Лонгборне с четырьмя сёстрами.'
  )
  const [published] = calls.published
  assert.equal(published.characterKey, 'char:elizabeth')
  assert.equal(published.cardRevision, 1)
  assert.equal(published.normalizedTextHash, TEXT_HASH)
  assert.equal(published.card.contractVersion, 'character-card-v1')
  assert.equal(published.card.source.fragmentSetHash, published.fragmentSetHash)
  assert.match(published.fragmentSetHash, /^[0-9a-f]{64}$/)
  // Карточка закончена — цепочка окон должна пойти дальше. Исключать из счёта
  // нечего: задание уже готово, и окно считает его закрытым само.
  assert.deepEqual(calls.advanced, [
    { runId: 'run-1', bookEditionId: 'edition-1', failingJobId: null }
  ])
})


test('a normalized text that does not match its hash stops the job', async () => {
  const { runner, calls } = harness({ storageBytes: Buffer.from('другой текст', 'utf8') })
  await assert.rejects(() => runner.run(JOB), { code: 'CARD_TEXT_INTEGRITY' })
  assert.equal(calls.requests.length, 0, 'модель не должна вызываться на несовпавшем тексте')
  assert.equal(calls.published.length, 0)
})

test('the runner reports the extractive fallback when the model gives no bio', async () => {
  const { runner, calls } = harness({
    generatorResult: { card: { gender: 'female', traits: [] } }
  })
  const result = await runner.run(JOB)
  assert.equal(result.bioSource, 'extractive')
  assert.match(calls.published[0].card.bio.value, /^Элизабет Беннет жила в Лонгборне/)
})

test('a card that fails the contract is never published', async () => {
  const { runner, calls } = harness({
    generatorResult: {
      card: {
        gender: 'female',
        traits: [],
        // Строка вместо утверждения: контракт обязан это отвергнуть.
        bio: 'Элизабет живёт в Лонгборне.'
      }
    },
    input: { fragments: [{ ...FRAGMENTS[0], endOffset: FRAGMENTS[0].startOffset + 3 }] }
  })
  await assert.rejects(() => runner.run(JOB))
  assert.equal(calls.published.length, 0)
})

test('the runner declares the job type it serves', () => {
  const { runner } = harness()
  assert.equal(runner.jobType, 'character_card')
})

test('the runner refuses to be built without its dependencies', () => {
  assert.throws(() => createCharacterCardRunner({ repository: {}, storage: {} }), TypeError)
  assert.throws(() => createCharacterCardRunner({ repository: {}, generator: {} }), TypeError)
})

test('the runner takes the media priority from the window class, not the queue order', async () => {
  const foreground = harness({ input: { priorityClass: 'foreground' } })
  const first = await foreground.runner.run(JOB)
  assert.equal(first.mediaPriority, CARD_MEDIA_PRIORITY.foreground)
  assert.equal(foreground.calls.published[0].mediaPriority, CARD_MEDIA_PRIORITY.foreground)

  const background = harness({ input: { priorityClass: 'background' } })
  const second = await background.runner.run(JOB)
  assert.equal(second.mediaPriority, CARD_MEDIA_PRIORITY.background)
  assert.ok(first.mediaPriority > second.mediaPriority)
})

test('a window with no priority class does not get the foreground priority', async () => {
  const { runner, calls } = harness({ input: { priorityClass: undefined } })
  await runner.run(JOB)
  assert.equal(calls.published[0].mediaPriority, CARD_MEDIA_PRIORITY.background)
})

test('the runner moves the window chain on, so the book does not stop after its first chapters', () => {
  // Цепочку окон в проде не двигал никто: `advanceCardWindows` жил только в
  // тестах. Окно закрывается, когда его карточки кончились, и закрыть его
  // может лишь тот, кто закончил последнюю, — воркер карточки.
  assert.throws(
    () => createCharacterCardRunner({
      repository: { async getCharacterCardInput() {}, async publishCharacterCard() {} },
      storage: {},
      generator: {}
    }),
    /advance card windows/
  )
})

test('a failed card still moves the window chain on', async () => {
  // Пока цепочку двигала только успешная карточка, одна упавшая
  // останавливала книгу навсегда: окно оставалось `running`, следующее не
  // ставил никто. «Обломов» встал так на восемнадцати готовых карточках
  // второго окна — последняя в нём не собралась.
  const { runner, calls } = harness({
    generatorError: Object.assign(new Error('модель не ответила'), { code: 'TIMEOUT' })
  })
  await assert.rejects(() => runner.run(JOB))
  // Своё задание передаётся как падающее и потому исключается из счёта
  // незавершённых: воркер пометит его провалившимся только после возврата
  // отсюда, и без этого окно, где оно было последним, осталось бы `running`
  // навсегда — то есть правка «двигать по завершению» ничего бы не изменила.
  assert.deepEqual(calls.advanced, [
    { runId: 'run-1', bookEditionId: 'edition-1', failingJobId: JOB.id }
  ])
  assert.deepEqual(calls.published, [])
})
