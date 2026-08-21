import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_ANALYSIS_EXTRACTOR_VERSION,
  BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_PIPELINE_VERSION,
  BOOK_ANALYSIS_PROMPT_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION,
  BOOK_ANALYSIS_SYNTHESIS_VERSION,
  assertBookAnalysisRunTransition,
  normalizeBookAnalysisObservation,
  normalizeBookAnalysisResolvedEntity,
  normalizeBookMarkupV3,
  normalizeEvidenceClaim
} from '../book-analysis-contracts.mjs'

const evidenceId = '11111111-1111-4111-8111-111111111111'

test('scan prompt and extractor share the cache-isolating v15 version', () => {
  assert.equal(BOOK_ANALYSIS_PROMPT_VERSION, 'book-scan-v17')
  assert.equal(BOOK_ANALYSIS_EXTRACTOR_VERSION, BOOK_ANALYSIS_PROMPT_VERSION)
})

test('resolver, profile and scan fallback changes isolate versioned caches', () => {
  assert.equal(BOOK_ANALYSIS_PIPELINE_VERSION, 'book-analysis-v49')
  assert.equal(BOOK_ANALYSIS_SYNTHESIS_VERSION, 'character-profile-v14')
  assert.equal(BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION, 'character-identity-v22')
})

test('stored scan observations require exact server-resolved evidence coordinates', () => {
  const observation = normalizeBookAnalysisObservation({
    observationKey: 'chunk-7:trait:anna:1',
    type: 'character_trait',
    entityKind: 'character',
    entityCandidate: 'Анна',
    relatedEntityCandidates: [],
    fact: 'Проявляет решительность',
    evidence: {
      quote: 'Анна отказалась выполнить приказ.',
      startOffset: 12_400,
      endOffset: 12_432,
      chapterKey: 'chapter-7'
    },
    confidence: 0.91
  })
  assert.equal(observation.evidence.startOffset, 12_400)
  assert.equal(observation.confidence, 0.91)
  assert.throws(
    () => normalizeBookAnalysisObservation({
      ...observation,
      evidence: { ...observation.evidence, quote: '' }
    }),
    /evidence.quote/
  )
  assert.throws(
    () => normalizeBookAnalysisObservation({
      ...observation,
      evidence: { ...observation.evidence, endOffset: observation.evidence.startOffset }
    }),
    /must be after/
  )
})

test('factual claims cannot be created without evidence', () => {
  assert.deepEqual(normalizeEvidenceClaim({
    value: 'Решительная',
    evidenceIds: [evidenceId],
    confidence: 0.88
  }), {
    value: 'Решительная',
    evidenceIds: [evidenceId],
    confidence: 0.88
  })
  assert.throws(
    () => normalizeEvidenceClaim({ value: 'Решительная', evidenceIds: [], confidence: 0.88 }),
    /at least one evidence/
  )
})

test('resolved entities require evidence and keep resolution status explicit', () => {
  assert.deepEqual(normalizeBookAnalysisResolvedEntity({
    entityKey: 'character:anna',
    entityKind: 'character',
    canonicalName: 'Анна',
    aliases: ['Аня'],
    resolutionStatus: 'confirmed',
    confidence: 0.92,
    evidenceIds: [evidenceId],
    data: { observationCount: 1 }
  }), {
    entityKey: 'character:anna',
    entityKind: 'character',
    canonicalName: 'Анна',
    aliases: ['Аня'],
    resolutionStatus: 'confirmed',
    confidence: 0.92,
    evidenceIds: [evidenceId],
    data: { observationCount: 1 }
  })
  assert.throws(() => normalizeBookAnalysisResolvedEntity({
    entityKey: 'character:anna',
    entityKind: 'character',
    canonicalName: 'Анна',
    aliases: [],
    resolutionStatus: 'confirmed',
    confidence: 0.92,
    evidenceIds: []
  }), /at least one evidence/)
})

test('v3 markup keeps grounded facts separate from creative character data', () => {
  const markup = normalizeBookMarkupV3({
    schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    snapshotId: '22222222-2222-4222-8222-222222222222',
    textLength: 250_000,
    characters: [{
      characterKey: 'anna',
      name: 'Анна',
      fullName: 'Анна Сергеевна',
      aliases: ['Аня'],
      identityEvidenceIds: [evidenceId],
      firstAppearanceTextOffset: 1_200,
      warmupTextOffset: 1_000,
      role: { value: 'Главная героиня', evidenceIds: [evidenceId], confidence: 0.96 },
      traits: [{ value: 'Решительная', evidenceIds: [evidenceId], confidence: 0.88 }],
      personalityTimelineVersion: 'progressive-personality-v1',
      personalitySnapshots: [{
        cutoffTextOffset: 1_400,
        status: 'preliminary',
        traits: [{
          value: 'Решительная',
          evidenceIds: [evidenceId],
          confidence: 0.65,
          evidenceLevel: 'single_scene'
        }]
      }],
      appearance: [],
      speechExamples: [],
      creative: {
        greeting: 'Рада встрече.',
        appearancePrompt: 'Портрет Анны',
        voice: 'Che'
      }
    }],
    locations: [],
    events: [],
    relationships: [],
    storyArcs: []
  })
  assert.equal(markup.characters[0].traits[0].evidenceIds[0], evidenceId)
  assert.equal(markup.characters[0].personalityTimelineVersion, 'progressive-personality-v1')
  assert.equal(markup.characters[0].personalitySnapshots[0].status, 'preliminary')
  assert.equal(markup.characters[0].creative.greeting, 'Рада встрече.')
  assert.equal('evidenceIds' in markup.characters[0].creative, false)

  const legacyGender = normalizeBookMarkupV3({
    ...markup,
    characters: [{
      ...markup.characters[0],
      gender: { value: 'женщина', evidenceIds: [evidenceId], confidence: 0.9 }
    }]
  })
  assert.equal(legacyGender.characters[0].gender.value, 'female')

  const unknownGender = normalizeBookMarkupV3({
    ...markup,
    characters: [{
      ...markup.characters[0],
      gender: { value: 'не определён', evidenceIds: [evidenceId], confidence: 0.9 }
    }]
  })
  assert.equal(unknownGender.characters[0].gender, null)
})

test('analysis stages advance one step and terminal runs stay immutable', () => {
  assert.deepEqual(assertBookAnalysisRunTransition(
    { stage: 'prepare', status: 'queued' },
    { stage: 'prepare', status: 'running' }
  ), { stage: 'prepare', status: 'running' })
  assert.deepEqual(assertBookAnalysisRunTransition(
    { stage: 'prepare', status: 'running' },
    { stage: 'scan', status: 'running' }
  ), { stage: 'scan', status: 'running' })
  assert.throws(
    () => assertBookAnalysisRunTransition(
      { stage: 'prepare', status: 'running' },
      { stage: 'resolve', status: 'running' }
    ),
    /exactly one step/
  )
  assert.throws(
    () => assertBookAnalysisRunTransition(
      { stage: 'validate', status: 'running' },
      { stage: 'validate', status: 'ready' }
    ),
    /publish stage/
  )
  assert.throws(
    () => assertBookAnalysisRunTransition(
      { stage: 'publish', status: 'ready' },
      { stage: 'publish', status: 'running' }
    ),
    /immutable/
  )
})

test('v3 markup rejects references to entities outside the result', () => {
  assert.throws(() => normalizeBookMarkupV3({
    schemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    snapshotId: '22222222-2222-4222-8222-222222222222',
    textLength: 10_000,
    characters: [],
    locations: [],
    events: [{
      eventKey: 'meeting',
      title: 'Встреча',
      description: 'Герой встречает Анну.',
      participantCharacterKeys: ['missing-character'],
      locationKeys: [],
      evidenceIds: [evidenceId]
    }],
    relationships: [],
    storyArcs: []
  }), /unknown reference missing-character/)
})
