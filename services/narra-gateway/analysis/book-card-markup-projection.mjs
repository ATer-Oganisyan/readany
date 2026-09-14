/**
 * Проекция карточек и фрагментов в модель снапшота (P7 work order'а).
 *
 * Совместимость здесь достигается не обещанием, а формой данных. Validate,
 * ассемблер `book-markup-v3`, TTS sidecar, чат и граф читают наблюдения и
 * сущности снапшота; значит, конвейер карточек должен отдать именно наблюдения
 * и сущности, а не «что-то похожее». Тогда существующая проверка работает без
 * изменений — и если проекция врёт, падает она, а не потребитель через месяц.
 *
 * Перевод устроен так:
 *
 * - фрагмент — уже evidence в нужном смысле: точная цитата с глобальными
 *   смещениями. Наблюдение из него получается добавлением типа;
 * - тип наблюдения диктует потребитель. Validate требует, чтобы `role`
 *   ссылался на `character_role`, `age` — на `character_age`, черта — на
 *   поведенческие типы. Один фрагмент, процитированный и ролью, и чертой, даёт
 *   два наблюдения с разными типами и разными id: тип — это утверждение о том,
 *   чем цитата служит, а не свойство абзаца;
 * - карточка становится профилем персонажа v3, а подтверждённый персонаж —
 *   сущностью `character` со статусом `confirmed`.
 *
 * Ограничение Validate, которое стоит помнить: `fullName` персонажа обязан
 * совпадать с каноническим именем сущности, иначе проверка считает это
 * расхождением идентичности. Поэтому полное имя карточки уходит в псевдонимы,
 * а не в `fullName`.
 */

import { createHash } from 'node:crypto'
import {
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION
} from './book-analysis-contracts.mjs'

export const CARD_MARKUP_PROJECTION_VERSION = 'card-markup-projection-v1'

/** Тип наблюдения под каждое поле карточки — так, как их требует Validate. */
const CLAIM_OBSERVATION_TYPES = Object.freeze({
  role: 'character_role',
  age: 'character_age',
  gender: 'character_gender',
  bio: 'character_mention',
  trait: 'character_action',
  location: 'character_mention',
  identity: 'character_mention'
})

function projectionError(code, message) {
  return Object.assign(new Error(message), { code })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

/** Тот же хэш, которым Validate проверяет замороженные наборы. */
export function projectionContentHash(value) {
  return sha256(JSON.stringify(canonical(value)))
}

function observationId(fragmentId, type) {
  return `${fragmentId}:${type}`
}

function claimFrom(claim, type, allowed) {
  if (!claim) return null
  const ids = claim.fragmentIds.filter((fragmentId) => allowed.has(fragmentId))
  if (!ids.length) return null
  return {
    value: claim.value,
    evidenceIds: ids.map((fragmentId) => observationId(fragmentId, type)),
    confidence: typeof claim.confidence === 'number' ? claim.confidence : 0.9
  }
}

/**
 * Наблюдения и сущности из карточек и фрагментов.
 *
 * @param {object} input
 * @param {Array} input.cards валидированные карточки `character-card-v1`
 * @param {Map<string, Array>|object} input.fragmentsByCharacter фрагменты по персонажу
 * @param {number} input.textLength
 */
export function projectCardsToSnapshot({ cards, fragmentsByCharacter, textLength }) {
  if (!Array.isArray(cards) || !cards.length) {
    throw projectionError('CARD_PROJECTION_EMPTY', 'cards must be a non-empty array')
  }
  if (!Number.isSafeInteger(textLength) || textLength < 1) {
    throw projectionError('CARD_PROJECTION_INVALID', 'textLength must be a positive safe integer')
  }
  const byCharacter = fragmentsByCharacter instanceof Map
    ? fragmentsByCharacter
    : new Map(Object.entries(fragmentsByCharacter ?? {}))

  const observations = []
  const seenObservations = new Set()
  const entities = []
  const characterProfiles = []
  const warmupDistance = Math.max(2_000, Math.round(textLength * 0.02))

  for (const card of [...cards].sort((left, right) =>
    left.characterKey.localeCompare(right.characterKey, 'en'))) {
    const fragments = byCharacter.get(card.characterKey) ?? []
    if (!fragments.length) {
      throw projectionError(
        'CARD_PROJECTION_FRAGMENTS_MISSING',
        `character ${card.characterKey} has no fragments to project`
      )
    }
    const fragmentById = new Map(fragments.map((fragment) => [fragment.fragmentId, fragment]))
    const allowed = new Set(fragmentById.keys())
    const entityEvidenceIds = []

    const emit = (fragmentId, type) => {
      const fragment = fragmentById.get(fragmentId)
      if (!fragment) return null
      const id = observationId(fragmentId, type)
      if (!seenObservations.has(id)) {
        seenObservations.add(id)
        if (fragment.endOffset > textLength) {
          throw projectionError(
            'CARD_PROJECTION_INVALID',
            `fragment ${fragmentId} lies past the end of the text`
          )
        }
        observations.push({
          id,
          observationKey: id,
          type,
          entityKind: 'character',
          entityCandidate: card.name,
          relatedEntityCandidates: [],
          fact: card.name,
          evidence: {
            quote: fragment.quote,
            startOffset: fragment.startOffset,
            endOffset: fragment.endOffset,
            chapterKey: fragment.chapterIndex >= 0 ? `chapter:${fragment.chapterIndex}` : ''
          },
          confidence: 0.99,
          data: {}
        })
      }
      if (!entityEvidenceIds.includes(id)) entityEvidenceIds.push(id)
      return id
    }

    // Идентичность персонажа опирается на его первые фрагменты: Validate
    // требует хотя бы один identityEvidenceId и проверяет, что он принадлежит
    // сущности.
    const identityFragments = [...fragments]
      .sort((left, right) => left.startOffset - right.startOffset)
      .slice(0, 64)
    for (const fragment of identityFragments) {
      emit(fragment.fragmentId, CLAIM_OBSERVATION_TYPES.identity)
    }
    // Био ссылается на улики того же типа, что и идентичность, но цитирует оно
    // что угодно из карточки — а идентичность берёт только первые 64 фрагмента.
    // Пока эти два множества расходились, био ссылалось на наблюдение, которого
    // в снимке нет, и Validate отбивал публикацию целиком: «Маленький принц» со
    // 177 фрагментами так и не опубликовался ни разу.
    for (const fragmentId of card.bio.fragmentIds) {
      emit(fragmentId, CLAIM_OBSERVATION_TYPES.identity)
    }
    for (const type of [
      CLAIM_OBSERVATION_TYPES.role,
      CLAIM_OBSERVATION_TYPES.age,
      CLAIM_OBSERVATION_TYPES.gender,
      CLAIM_OBSERVATION_TYPES.trait
    ]) {
      const source = type === CLAIM_OBSERVATION_TYPES.trait
        ? card.traits.flatMap(({ fragmentIds }) => fragmentIds)
        : type === CLAIM_OBSERVATION_TYPES.role
          ? (card.role?.fragmentIds ?? [])
          : card.bio.fragmentIds
      for (const fragmentId of source) emit(fragmentId, type)
    }

    const identityEvidenceIds = identityFragments
      .map(({ fragmentId }) => observationId(fragmentId, CLAIM_OBSERVATION_TYPES.identity))
    const firstAppearanceTextOffset = Math.min(
      card.firstMentionTextOffset,
      ...fragments.map(({ startOffset }) => startOffset)
    )
    // Полное имя уходит в псевдонимы: Validate требует fullName === canonical.
    const aliases = [...new Set([
      ...card.aliases,
      ...(card.fullName && card.fullName !== card.name ? [card.fullName] : [])
    ])].slice(0, 32)

    entities.push({
      entityKey: card.characterKey,
      entityKind: 'character',
      canonicalName: card.name,
      aliases,
      resolutionStatus: 'confirmed',
      confidence: 0.95,
      evidenceIds: entityEvidenceIds,
      data: {
        observationCount: entityEvidenceIds.length,
        firstEvidenceStartOffset: firstAppearanceTextOffset,
        lastEvidenceEndOffset: Math.max(...fragments.map(({ endOffset }) => endOffset))
      }
    })

    characterProfiles.push({
      characterKey: card.characterKey,
      name: card.name,
      fullName: card.name,
      aliases,
      identityEvidenceIds,
      firstAppearanceTextOffset,
      warmupTextOffset: Math.max(0, firstAppearanceTextOffset - warmupDistance),
      role: claimFrom(card.role, CLAIM_OBSERVATION_TYPES.role, allowed),
      age: card.age
        ? claimFrom(
            { value: card.age, fragmentIds: card.bio.fragmentIds },
            CLAIM_OBSERVATION_TYPES.age,
            allowed
          )
        : null,
      gender: card.gender === 'unknown'
        ? null
        : claimFrom(
            { value: card.gender, fragmentIds: card.bio.fragmentIds },
            CLAIM_OBSERVATION_TYPES.gender,
            allowed
          ),
      description: claimFrom(card.bio, CLAIM_OBSERVATION_TYPES.identity, allowed),
      traits: card.traits
        .map((trait) => claimFrom(trait, CLAIM_OBSERVATION_TYPES.trait, allowed))
        .filter(Boolean),
      personalityTimelineVersion: '',
      personalitySnapshots: [],
      // Паспорт внешности — творческое поле карточки, а не цитируемый факт,
      // поэтому в `appearance` он не идёт: там каждое утверждение обязано
      // ссылаться на наблюдение соответствующего типа.
      appearance: [],
      speechStyle: null,
      speechExamples: [],
      creative: {
        greeting: card.greeting ?? '',
        appearancePrompt: card.appearancePrompt ?? '',
        voice: ''
      }
    })
  }

  const observationIds = observations.map(({ id }) => id)
  const snapshotEntities = entities.map(({ ...entity }) => entity)
  return {
    projectionVersion: CARD_MARKUP_PROJECTION_VERSION,
    observations,
    entities,
    characterProfiles,
    characterSelection: null,
    snapshotData: {
      observationIds,
      observationSetHash: projectionContentHash(observations),
      entities: snapshotEntities,
      entitySetHash: projectionContentHash(snapshotEntities),
      characterSelection: null
    },
    evidenceCount: observations.length
  }
}

/**
 * Снапшот в форме, которую читает Validate: `id`, `contentHash`,
 * `evidenceCount`, `data`. Хэш считается по тем же правилам, что и в проверке,
 * иначе она справедливо сочтёт снапшот подделанным.
 */
export function cardSnapshotFor({ snapshotId, projection }) {
  const data = { ...projection.snapshotData }
  return {
    id: snapshotId,
    contentHash: projectionContentHash(data),
    evidenceCount: projection.evidenceCount,
    data
  }
}

export const CARD_MARKUP_TARGET = Object.freeze({
  schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
  analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION
})
