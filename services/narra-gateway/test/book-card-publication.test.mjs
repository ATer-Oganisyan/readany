/**
 * Публикация карточек проходит ту же проверку, что и разметка narra.
 *
 * Здесь работают настоящие `assembleBookMarkupV3` и `validateBookMarkupV3` — не
 * их копии и не «формат совпадает». Конвейер карточек публикует книгу читателю,
 * и ослабить проверку под него значило бы перестать что-либо проверять.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { validateCharacterCard } from '../analysis/book-character-card-contract.mjs'
import { buildCardPublication } from '../analysis/book-card-publication.mjs'
import { createCardPublicationRunner } from '../analysis/book-card-publication-runner.mjs'

const SILENT = { info() {}, warn() {}, error() {}, debug() {} }

function buildBook() {
  const paragraphs = [
    'Элизабет Беннет жила в Лонгборне с четырьмя сёстрами и не искала общества.',
    'Элизабет заметила, что гость наблюдает за нею внимательно, и промолчала.',
    'Джейн Беннет была старшей и самой кроткой из сестёр Лонгборна.',
    `${'ровный текст. '.repeat(300)}`,
    'Элизабет снова заметила ту же привычку и опять ничего не сказала.',
    'Джейн Беннет улыбнулась и заговорила о погоде, как всегда.'
  ]
  const text = paragraphs.join('\n\n')
  const fragmentAt = (characterKey, index, needle) => {
    const startOffset = text.indexOf(needle)
    assert.ok(startOffset >= 0)
    return {
      fragmentId: `frag:${characterKey}:${index}`,
      characterKey,
      paragraphIndex: index,
      chapterIndex: 0,
      startOffset,
      endOffset: startOffset + needle.length,
      quote: needle
    }
  }
  return {
    text,
    hash: createHash('sha256').update(text).digest('hex'),
    fragments: new Map([
      ['char:elizabeth', [
        fragmentAt('char:elizabeth', 0, paragraphs[0]),
        fragmentAt('char:elizabeth', 1, paragraphs[1]),
        fragmentAt('char:elizabeth', 4, paragraphs[4])
      ]],
      ['char:jane', [
        fragmentAt('char:jane', 2, paragraphs[2]),
        fragmentAt('char:jane', 5, paragraphs[5])
      ]]
    ])
  }
}

function card({ characterKey, name, fullName, fragments, trait, role }) {
  const ids = fragments.map(({ fragmentId }) => fragmentId)
  return validateCharacterCard({
    contractVersion: 'character-card-v1',
    characterKey,
    name,
    fullName,
    aliases: [],
    firstMentionTextOffset: fragments[0].startOffset,
    cardWindow: { startOffset: 0, endOffset: 6_000, chapterIndexes: [0, 1] },
    mentionCount: fragments.length,
    mentionCountInWindow: fragments.length,
    traits: [{ value: trait, fragmentIds: ids.slice(0, 2), confidence: 0.9 }],
    bio: { value: `${name} появляется в этой книге и действует.`, fragmentIds: [ids[0]] },
    role: { value: role, fragmentIds: [ids[0]] },
    locations: [{ value: 'Лонгборн', fragmentIds: [ids[0]] }],
    appearancePrompt: `внешность ${name}`,
    gender: 'female',
    age: 'около двадцати',
    greeting: `Здравствуйте. Я ${name}.`,
    source: {
      normalizedTextHash: 'a'.repeat(64),
      inventoryVersion: 'name-inventory-v1',
      fragmentSetHash: 'b'.repeat(64),
      promptVersion: 'character-card-prompt-v1'
    },
    createdAt: '2026-09-10T10:00:00Z'
  })
}

function scenario() {
  const book = buildBook()
  return {
    book,
    cards: [
      card({
        characterKey: 'char:elizabeth',
        name: 'Элизабет',
        fullName: 'Элизабет Беннет',
        fragments: book.fragments.get('char:elizabeth'),
        trait: 'наблюдательная',
        role: 'вторая из пяти дочерей'
      }),
      card({
        characterKey: 'char:jane',
        name: 'Джейн',
        fullName: 'Джейн Беннет',
        fragments: book.fragments.get('char:jane'),
        trait: 'кроткая',
        role: 'старшая из сестёр'
      })
    ]
  }
}

test('разметка из карточек проходит настоящий Validate', () => {
  const { book, cards } = scenario()
  const built = buildCardPublication({
    cards,
    fragmentsByCharacter: book.fragments,
    normalizedText: book.text,
    normalizedTextHash: book.hash
  })
  assert.equal(built.validation.valid, true, JSON.stringify(built.validation.errors))
  assert.equal(built.markup.characters.length, 2)
  assert.equal(built.markup.textLength, book.text.length)
  // Публикация обязана быть связана со своим снимком и своим текстом: именно
  // это проверяет Validate у narra, и карточки не исключение.
  assert.equal(built.bindings.snapshotContentHash, built.snapshot.contentHash)
  assert.equal(built.bindings.normalizedTextHash, book.hash)
  assert.equal(built.bindings.markupContentHash, built.markupContentHash)
  // Приветствие и промпт внешности — единственное, ради чего у карточки есть
  // творческие поля; в разметке они обязаны дожить до читателя.
  const elizabeth = built.markup.characters.find(({ name }) => name === 'Элизабет')
  assert.equal(elizabeth.creative.greeting, 'Здравствуйте. Я Элизабет.')
  assert.equal(elizabeth.creative.appearancePrompt, 'внешность Элизабет')
  assert.ok(elizabeth.warmupTextOffset <= elizabeth.firstAppearanceTextOffset)
})

test('персонаж без фрагментов пропускается, а не роняет публикацию книги', () => {
  const { book, cards } = scenario()
  const orphan = card({
    characterKey: 'char:mary',
    name: 'Мэри',
    fullName: 'Мэри Беннет',
    fragments: book.fragments.get('char:jane'),
    trait: 'книжная',
    role: 'средняя из сестёр'
  })
  const built = buildCardPublication({
    cards: [...cards, { ...orphan, characterKey: 'char:mary' }],
    fragmentsByCharacter: book.fragments,
    normalizedText: book.text,
    normalizedTextHash: book.hash
  })
  assert.equal(built.validation.valid, true)
  assert.deepEqual(built.skippedCharacterKeys, ['char:mary'])
  assert.equal(built.markup.characters.length, 2)
})

test('текст, не совпавший со своим хэшем, до публикации не доходит', () => {
  const { book, cards } = scenario()
  assert.throws(
    () => buildCardPublication({
      cards,
      fragmentsByCharacter: book.fragments,
      normalizedText: `${book.text} ещё слово`,
      normalizedTextHash: book.hash
    }),
    { code: 'CARD_PUBLICATION_TEXT_MISMATCH' }
  )
})

function runnerFor({ book, cards, publish = async () => ({ published: true, publicationId: 'p1', revision: 1, characterCount: 2 }) }) {
  const calls = []
  const repository = {
    async getCardPublicationInput({ runId }) {
      calls.push(['input', runId])
      return {
        runId,
        bookEditionId: 'edition-1',
        normalizedTextObjectKey: 'normalized/book.txt',
        normalizedTextHash: book.hash,
        textLength: book.text.length,
        cards,
        fragments: [...book.fragments.values()].flat()
      }
    },
    async publishCardsMarkup(input) {
      calls.push(['publish', input])
      return publish(input)
    }
  }
  const storage = {
    async getBytes() { return { bytes: Buffer.from(book.text, 'utf8') } }
  }
  return {
    calls,
    runner: createCardPublicationRunner({ repository, storage, logger: SILENT })
  }
}

test('раннер публикует собранную разметку и отдаёт результат записи', async () => {
  const { book, cards } = scenario()
  const { runner, calls } = runnerFor({ book, cards })

  const result = await runner.publish({ runId: 'run-1' })

  assert.equal(result.published, true)
  const [, published] = calls.find(([kind]) => kind === 'publish')
  assert.equal(published.runId, 'run-1')
  assert.equal(published.bookEditionId, 'edition-1')
  assert.equal(published.validation.valid, true)
  assert.equal(published.markup.characters.length, 2)
})

test('прогон без карточек не публикуется и хранилище не читает', async () => {
  const { book } = scenario()
  const { runner, calls } = runnerFor({ book, cards: [] })

  assert.deepEqual(await runner.publish({ runId: 'run-1' }), {
    published: false,
    reason: 'no_cards'
  })
  assert.equal(calls.some(([kind]) => kind === 'publish'), false)
})
