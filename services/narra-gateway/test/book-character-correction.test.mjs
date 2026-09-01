import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION,
  applyBookCharacterCorrection,
  bookCharacterCorrectionHash,
  resolveCorrectedCharacterKey
} from '../book-character-correction.mjs'

const MARKUP_ID = '11111111-1111-4111-8111-111111111111'
const PUBLICATION_ID = '22222222-2222-4222-8222-222222222222'
const HASH = 'a'.repeat(64)
const EVIDENCE = {
  target1: '33333333-3333-4333-8333-333333333331',
  target2: '33333333-3333-4333-8333-333333333332',
  source1: '44444444-4444-4444-8444-444444444441',
  source2: '44444444-4444-4444-8444-444444444442'
}

function profile({ key, name, aliases = [], evidenceIds, role = null, description = null }) {
  return {
    characterKey: key,
    name,
    fullName: name,
    aliases,
    identityEvidenceIds: evidenceIds,
    firstAppearanceTextOffset: key === 'hero' ? 200 : 100,
    warmupTextOffset: key === 'hero' ? 150 : 50,
    role,
    age: null,
    gender: null,
    description,
    traits: [],
    personalityTimelineVersion: '',
    personalitySnapshots: [],
    appearance: [],
    speechStyle: null,
    speechExamples: [],
    creative: { greeting: '', appearancePrompt: '', voice: '' }
  }
}

function markup() {
  return {
    schemaVersion: 3,
    analysisVersion: 'book-markup-v3',
    snapshotId: '55555555-5555-4555-8555-555555555555',
    textLength: 10_000,
    characters: [
      profile({
        key: 'hero',
        name: 'Герой',
        evidenceIds: [EVIDENCE.target1, EVIDENCE.target2]
      }),
      profile({
        key: 'hero-full-name',
        name: 'Полное Имя Героя',
        aliases: ['Господин Герой'],
        evidenceIds: [EVIDENCE.source1, EVIDENCE.source2],
        role: {
          value: 'Главный герой',
          evidenceIds: [EVIDENCE.source1],
          confidence: 0.9
        },
        description: {
          value: 'Полное подтверждённое описание героя из двух независимых эпизодов.',
          evidenceIds: [EVIDENCE.source1, EVIDENCE.source2],
          confidence: 0.9
        }
      })
    ],
    locations: [],
    events: [{
      eventKey: 'meeting',
      title: 'Встреча',
      description: 'Два профиля одной личности участвуют во встрече.',
      participantCharacterKeys: ['hero', 'hero-full-name'],
      locationKeys: [],
      evidenceIds: [EVIDENCE.source1]
    }],
    relationships: [{
      relationshipKey: 'self-fragment',
      sourceCharacterKey: 'hero-full-name',
      targetCharacterKey: 'hero',
      type: 'identity-fragment',
      description: 'Ошибочно раздвоенная личность.',
      evidenceIds: [EVIDENCE.source1]
    }],
    storyArcs: [{
      storyArcKey: 'hero-arc',
      title: 'Арка героя',
      description: 'Арка ошибочно раздвоенного героя.',
      characterKeys: ['hero', 'hero-full-name'],
      eventKeys: ['meeting'],
      evidenceIds: [EVIDENCE.source1]
    }]
  }
}

function correction(overrides = {}) {
  return {
    contractVersion: BOOK_CHARACTER_CORRECTION_CONTRACT_VERSION,
    base: {
      markupVersionId: MARKUP_ID,
      publicationId: PUBLICATION_ID,
      contentHash: HASH
    },
    reason: 'Объединяем два подтверждённых профиля одной личности без нового characterKey.',
    changes: [
      {
        characterKey: 'hero',
        reason: 'Сохраняем существующий ключ и переносим готовые подтверждённые поля.',
        copy: {
          roleFrom: 'hero-full-name',
          descriptionFrom: 'hero-full-name'
        },
        addAliases: ['Ещё одно имя']
      },
      {
        characterKey: 'hero-full-name',
        reason: 'Полная форма имени является дублем существующего героя.',
        redirectTo: 'hero'
      }
    ],
    ...overrides
  }
}

const base = {
  markupVersionId: MARKUP_ID,
  publicationId: PUBLICATION_ID,
  contentHash: HASH
}

test('correction copies grounded fields, redirects a duplicate and remaps references', () => {
  const result = applyBookCharacterCorrection(correction(), { markup: markup(), base })

  assert.equal(result.markup.characters.length, 1)
  const hero = result.markup.characters[0]
  assert.equal(hero.characterKey, 'hero')
  assert.equal(hero.role.value, 'Главный герой')
  assert.match(hero.description.value, /подтверждённое описание/)
  assert.deepEqual(hero.aliases, ['Ещё одно имя', 'Полное Имя Героя', 'Господин Герой'])
  assert.equal(hero.firstAppearanceTextOffset, 100)
  assert.equal(hero.warmupTextOffset, 50)
  assert.deepEqual(result.markup.events[0].participantCharacterKeys, ['hero'])
  assert.equal(result.markup.relationships[0].sourceCharacterKey, 'hero')
  assert.equal(result.markup.relationships[0].targetCharacterKey, 'hero')
  assert.deepEqual(result.markup.storyArcs[0].characterKeys, ['hero'])
  assert.deepEqual(result.diff.redirects, { 'hero-full-name': 'hero' })
  assert.equal(resolveCorrectedCharacterKey('hero-full-name', result.document), 'hero')
})

test('redirect deterministically caps merged identity evidence without dropping redirected identities entirely', () => {
  const value = markup()
  value.characters[0].identityEvidenceIds = Array.from({ length: 64 }, (_, index) =>
    `target-evidence-${String(index).padStart(2, '0')}`)
  value.characters[1].identityEvidenceIds = Array.from({ length: 64 }, (_, index) =>
    `source-evidence-${String(index).padStart(2, '0')}`)
  value.characters[1].role.evidenceIds = [value.characters[1].identityEvidenceIds[0]]
  value.characters[1].description.evidenceIds = value.characters[1].identityEvidenceIds.slice(0, 2)

  const result = applyBookCharacterCorrection(correction(), { markup: value, base })
  const ids = result.markup.characters[0].identityEvidenceIds
  assert.equal(ids.length, 64)
  assert.deepEqual(ids.slice(0, 48), value.characters[0].identityEvidenceIds.slice(0, 48))
  assert.deepEqual(ids.slice(48), value.characters[1].identityEvidenceIds.slice(0, 16))
})

test('correction can replace or explicitly clear only role and description', () => {
  const document = correction({
    changes: [{
      characterKey: 'hero',
      reason: 'Добавляем описание по evidence и явно удаляем ошибочную роль.',
      set: {
        role: null,
        description: {
          value: 'Новое описание героя подтверждено двумя сохранёнными цитатами книги.',
          evidenceIds: [EVIDENCE.target1, EVIDENCE.target2],
          confidence: 0.85
        }
      }
    }]
  })
  const result = applyBookCharacterCorrection(document, { markup: markup(), base })
  assert.equal(result.markup.characters[0].role, null)
  assert.match(result.markup.characters[0].description.value, /^Новое описание/)
})

test('correction suppresses one invalid mixed identity and removes its references', () => {
  const document = correction({
    changes: [{
      characterKey: 'hero-full-name',
      reason: 'Профиль смешивает разные личности и не имеет безопасной цели redirect.',
      suppress: true
    }]
  })
  const result = applyBookCharacterCorrection(document, { markup: markup(), base })

  assert.deepEqual(result.markup.characters.map(({ characterKey }) => characterKey), ['hero'])
  assert.deepEqual(result.markup.events[0].participantCharacterKeys, ['hero'])
  assert.equal(result.markup.relationships.length, 0)
  assert.deepEqual(result.markup.storyArcs[0].characterKeys, ['hero'])
  assert.deepEqual(result.diff.suppressed, ['hero-full-name'])
  assert.equal(resolveCorrectedCharacterKey('hero-full-name', result.document), null)
})

test('suppress must be the only action and cannot be a redirect target', () => {
  assert.throws(
    () => applyBookCharacterCorrection(correction({
      changes: [{
        characterKey: 'hero-full-name',
        reason: 'Нельзя одновременно скрывать профиль и менять его aliases.',
        suppress: true,
        addAliases: ['Запрещённый alias']
      }]
    }), { markup: markup(), base }),
    /suppress cannot contain/
  )

  assert.throws(
    () => applyBookCharacterCorrection(correction({
      changes: [{
        characterKey: 'hero',
        reason: 'Скрываем профиль, поэтому он не может быть целью redirect.',
        suppress: true
      }, {
        characterKey: 'hero-full-name',
        reason: 'Запрещённый redirect на скрываемый профиль.',
        redirectTo: 'hero'
      }]
    }), { markup: markup(), base }),
    /target cannot be suppressed/
  )
})

test('correction fails closed when the published base changed', () => {
  assert.throws(
    () => applyBookCharacterCorrection(correction(), {
      markup: markup(),
      base: { ...base, contentHash: 'b'.repeat(64) }
    }),
    (error) => error.code === 'CHARACTER_CORRECTION_STALE' && error.status === 409
  )
})

test('correction rejects new keys, redirect chains and foreign evidence', () => {
  assert.throws(
    () => applyBookCharacterCorrection(correction({
      changes: [{
        characterKey: 'new-character',
        reason: 'Нельзя создавать новую сущность через correction overlay.',
        addAliases: ['Новое имя']
      }]
    }), { markup: markup(), base }),
    /does not exist/
  )

  assert.throws(
    () => applyBookCharacterCorrection(correction({
      changes: [{
        characterKey: 'hero-full-name',
        reason: 'Первая половина запрещённой цепочки redirect.',
        redirectTo: 'hero'
      }, {
        characterKey: 'hero',
        reason: 'Вторая половина запрещённой цепочки redirect.',
        redirectTo: 'hero-full-name'
      }]
    }), { markup: markup(), base }),
    /redirect chains/
  )

  assert.throws(
    () => applyBookCharacterCorrection(correction({
      changes: [{
        characterKey: 'hero',
        reason: 'Нельзя сослаться на evidence другого или неизвестного персонажа.',
        set: {
          description: {
            value: 'Описание намеренно использует неподтверждённую постороннюю цитату.',
            evidenceIds: [EVIDENCE.target1, '99999999-9999-4999-8999-999999999999'],
            confidence: 0.8
          }
        }
      }]
    }), { markup: markup(), base }),
    /is not owned by the corrected identity/
  )
})

test('normalized correction hash is stable across object key order', () => {
  const first = correction()
  const second = {
    changes: first.changes.map((change) => ({ ...change })),
    reason: first.reason,
    base: {
      contentHash: first.base.contentHash,
      publicationId: first.base.publicationId,
      markupVersionId: first.base.markupVersionId
    },
    contractVersion: first.contractVersion
  }
  assert.equal(bookCharacterCorrectionHash(first), bookCharacterCorrectionHash(second))
})
