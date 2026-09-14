/**
 * P7: v3 собирается из карточек и проходит существующий Validate.
 *
 * Проверка идёт настоящим `validateBookMarkupV3` и настоящим
 * `assembleBookMarkupV3` — не их копией и не утверждением «формат совпадает».
 * Смысл ровно в этом: если проекция врёт, падает здесь, а не у потребителя
 * через месяц.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleBookMarkupV3 } from '../analysis/book-analysis-assembler.mjs'
import { validateBookMarkupV3 } from '../analysis/book-analysis-validator.mjs'
import { validateCharacterCard } from '../analysis/book-character-card-contract.mjs'
import {
  CARD_MARKUP_PROJECTION_VERSION,
  cardSnapshotFor,
  projectCardsToSnapshot
} from '../analysis/book-card-markup-projection.mjs'
import { createHash } from 'node:crypto'

const SNAPSHOT_ID = '335177b3-ae1d-45b2-b6b2-d8c584678bae'

/**
 * Текст строится так, чтобы фрагменты были его дословными подстроками: Validate
 * сверяет каждую цитату с нормализованным текстом по смещениям.
 */
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
    assert.ok(startOffset >= 0, `фрагмент не найден в тексте: ${needle}`)
    return {
      fragmentId: `frag:${characterKey}:${index}`,
      characterKey,
      paragraphIndex: index,
      chapterIndex: 0,
      startOffset,
      endOffset: startOffset + needle.length,
      quote: needle,
      mentionOffsets: [startOffset]
    }
  }
  return {
    text,
    fragments: {
      'char:elizabeth': [
        fragmentAt('char:elizabeth', 0, paragraphs[0]),
        fragmentAt('char:elizabeth', 1, paragraphs[1]),
        fragmentAt('char:elizabeth', 4, paragraphs[4])
      ],
      'char:jane': [
        fragmentAt('char:jane', 2, paragraphs[2]),
        fragmentAt('char:jane', 5, paragraphs[5])
      ]
    }
  }
}

function card({ characterKey, name, fullName, fragments, traits, role, gender = 'female' }) {
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
    traits: traits.map((value) => ({ value, fragmentIds: ids.slice(0, 2), confidence: 0.9 })),
    bio: { value: `${name} появляется в этой книге и действует.`, fragmentIds: [ids[0]] },
    role: role ? { value: role, fragmentIds: [ids[0]] } : null,
    locations: [{ value: 'Лонгборн', fragmentIds: [ids[0]] }],
    appearancePrompt: `внешность ${name}`,
    gender,
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
  const cards = [
    card({
      characterKey: 'char:elizabeth',
      name: 'Элизабет',
      fullName: 'Элизабет Беннет',
      fragments: book.fragments['char:elizabeth'],
      traits: ['наблюдательная'],
      role: 'вторая из пяти дочерей'
    }),
    card({
      characterKey: 'char:jane',
      name: 'Джейн',
      fullName: 'Джейн Беннет',
      fragments: book.fragments['char:jane'],
      traits: ['кроткая'],
      role: 'старшая из сестёр'
    })
  ]
  const projection = projectCardsToSnapshot({
    cards,
    fragmentsByCharacter: book.fragments,
    textLength: book.text.length
  })
  const snapshot = cardSnapshotFor({ snapshotId: SNAPSHOT_ID, projection })
  const markup = assembleBookMarkupV3({
    snapshotId: SNAPSHOT_ID,
    textLength: book.text.length,
    entities: projection.entities,
    observations: projection.observations,
    characterProfiles: projection.characterProfiles,
    characterSelection: projection.characterSelection
  })
  return { book, cards, projection, snapshot, markup }
}

test('the projection turns cards into a v3 markup that the real assembler accepts', () => {
  const { markup, projection } = scenario()
  assert.equal(projection.projectionVersion, CARD_MARKUP_PROJECTION_VERSION)
  assert.equal(markup.analysisVersion, 'book-markup-v3')
  assert.equal(markup.schemaVersion, 3)
  assert.deepEqual(
    markup.characters.map(({ characterKey }) => characterKey).sort(),
    ['char:elizabeth', 'char:jane']
  )
  const elizabeth = markup.characters.find(({ name }) => name === 'Элизабет')
  assert.equal(elizabeth.role.value, 'вторая из пяти дочерей')
  assert.deepEqual(elizabeth.traits.map(({ value }) => value), ['наблюдательная'])
  assert.equal(elizabeth.creative.appearancePrompt, 'внешность Элизабет')
  assert.equal(elizabeth.creative.greeting, 'Здравствуйте. Я Элизабет.')
})

test('the assembled markup passes the existing Validate unchanged', () => {
  const { book, snapshot, markup, projection } = scenario()
  const report = validateBookMarkupV3({
    markup,
    snapshot,
    observations: projection.observations,
    normalizedText: book.text,
    normalizedTextHash: createHash('sha256').update(book.text).digest('hex')
  })
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 1))
  assert.equal(report.valid, true)
  for (const [check, passed] of Object.entries(report.checks)) {
    assert.equal(passed, true, `проверка ${check} не прошла`)
  }
})

test('every projected observation quote matches the text at its own offsets', () => {
  // Это и есть причина, по которой конвейеру карточек не нужен свой Validate:
  // фрагмент изначально был evidence в том же смысле.
  const { book, projection } = scenario()
  for (const observation of projection.observations) {
    assert.equal(
      book.text.slice(observation.evidence.startOffset, observation.evidence.endOffset),
      observation.evidence.quote,
      `наблюдение ${observation.id} не совпало с текстом`
    )
  }
})

test('one fragment cited by two different claims becomes two typed observations', () => {
  // Тип наблюдения — утверждение о том, чем служит цитата, а не свойство
  // абзаца: Validate требует character_role под ролью и поведенческий тип под
  // чертой, и один и тот же абзац может служить и тем, и другим.
  const { projection } = scenario()
  const first = projection.observations.filter(({ id }) =>
    id.startsWith('frag:char:elizabeth:0:'))
  const types = first.map(({ type }) => type).sort()
  assert.ok(types.includes('character_role'), JSON.stringify(types))
  assert.ok(types.includes('character_mention'), JSON.stringify(types))
  assert.equal(new Set(first.map(({ id }) => id)).size, first.length, 'id наблюдений не уникальны')
})

test('the full name goes to aliases because Validate pins fullName to the canonical name', () => {
  const { markup } = scenario()
  const elizabeth = markup.characters.find(({ name }) => name === 'Элизабет')
  assert.equal(elizabeth.fullName, 'Элизабет')
  assert.ok(elizabeth.aliases.includes('Элизабет Беннет'))
})

test('an unknown gender produces no gender claim rather than an invented one', () => {
  const book = buildBook()
  const fragments = book.fragments['char:jane']
  const projection = projectCardsToSnapshot({
    cards: [card({
      characterKey: 'char:jane',
      name: 'Джейн',
      fullName: 'Джейн Беннет',
      fragments,
      traits: ['кроткая'],
      role: null,
      gender: 'unknown'
    })],
    fragmentsByCharacter: { 'char:jane': fragments },
    textLength: book.text.length
  })
  assert.equal(projection.characterProfiles[0].gender, null)
  assert.equal(projection.characterProfiles[0].role, null)
})

test('the projection is deterministic for the same cards and fragments', () => {
  const first = scenario()
  const second = scenario()
  assert.equal(
    first.projection.snapshotData.observationSetHash,
    second.projection.snapshotData.observationSetHash
  )
  assert.equal(first.snapshot.contentHash, second.snapshot.contentHash)
  assert.deepEqual(first.markup, second.markup)
})

test('a character with no fragments is refused instead of producing an empty card row', () => {
  const book = buildBook()
  assert.throws(
    () => projectCardsToSnapshot({
      cards: [card({
        characterKey: 'char:elizabeth',
        name: 'Элизабет',
        fullName: 'Элизабет Беннет',
        fragments: book.fragments['char:elizabeth'],
        traits: ['наблюдательная'],
        role: null
      })],
      fragmentsByCharacter: {},
      textLength: book.text.length
    }),
    { code: 'CARD_PROJECTION_FRAGMENTS_MISSING' }
  )
})

test('invalid projection inputs are refused', () => {
  assert.throws(() => projectCardsToSnapshot({ cards: [], fragmentsByCharacter: {}, textLength: 1 }), {
    code: 'CARD_PROJECTION_EMPTY'
  })
  const book = buildBook()
  assert.throws(
    () => projectCardsToSnapshot({
      cards: [card({
        characterKey: 'char:jane',
        name: 'Джейн',
        fullName: 'Джейн Беннет',
        fragments: book.fragments['char:jane'],
        traits: ['кроткая'],
        role: null
      })],
      fragmentsByCharacter: book.fragments,
      textLength: 0
    }),
    { code: 'CARD_PROJECTION_INVALID' }
  )
})

test('био, процитировавшее поздний абзац, не оставляет разметку без улики', () => {
  // Идентичность берёт только первые 64 фрагмента персонажа, а био цитирует
  // что угодно из карточки — и ссылается на улики того же типа. Пока эти два
  // множества расходились, разметка ссылалась на наблюдение, которого в снимке
  // нет, Validate отбивал публикацию целиком, и «Маленький принц» со 177
  // фрагментами не опубликовался ни разу.
  const paragraphs = Array.from({ length: 80 }, (_, index) =>
    `Маленький принц снова заговорил о своей розе, и это был раз номер ${index}.`)
  const text = paragraphs.join('\n\n')
  const fragments = paragraphs.map((paragraph, index) => {
    const startOffset = text.indexOf(paragraph)
    return {
      fragmentId: `frag:char:prince:${index}`,
      characterKey: 'char:prince',
      paragraphIndex: index,
      chapterIndex: 0,
      startOffset,
      endOffset: startOffset + paragraph.length,
      quote: paragraph
    }
  })
  // Био цитирует 70-й абзац — далеко за границей первых 64.
  const late = fragments[70].fragmentId
  const card = validateCharacterCard({
    contractVersion: 'character-card-v1',
    characterKey: 'char:prince',
    name: 'Маленький принц',
    fullName: '',
    aliases: [],
    firstMentionTextOffset: fragments[0].startOffset,
    cardWindow: { startOffset: 0, endOffset: text.length, chapterIndexes: [0] },
    mentionCount: fragments.length,
    mentionCountInWindow: fragments.length,
    traits: [{ value: 'заботливый', fragmentIds: [fragments[1].fragmentId], confidence: 0.9 }],
    bio: { value: 'Маленький принц бережёт свою розу.', fragmentIds: [late] },
    role: null,
    locations: [],
    appearancePrompt: '',
    gender: 'male',
    age: '',
    greeting: '',
    source: {
      normalizedTextHash: 'a'.repeat(64),
      inventoryVersion: 'name-inventory-v1',
      fragmentSetHash: 'b'.repeat(64),
      promptVersion: 'character-card-prompt-v1'
    },
    createdAt: '2026-09-14T07:00:00Z'
  })

  const projection = projectCardsToSnapshot({
    cards: [card],
    fragmentsByCharacter: { 'char:prince': fragments },
    textLength: text.length
  })
  const snapshotId = '9f4b6d61-0000-4000-8000-000000000001'
  const snapshot = cardSnapshotFor({ snapshotId, projection })
  const markup = assembleBookMarkupV3({
    snapshotId,
    textLength: text.length,
    entities: projection.entities,
    observations: projection.observations,
    characterProfiles: projection.characterProfiles,
    characterSelection: projection.characterSelection
  })
  const report = validateBookMarkupV3({
    markup,
    snapshot,
    observations: projection.observations,
    normalizedText: text,
    normalizedTextHash: createHash('sha256').update(text).digest('hex')
  })

  assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 1))
  assert.equal(report.valid, true)
})
