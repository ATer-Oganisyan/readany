import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createPostgresBookCharacterCorrectionRepository } from '../book-character-correction-repository.mjs'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const MARKUP_ID = '22222222-2222-4222-8222-222222222222'
const PUBLICATION_ID = '33333333-3333-4333-8333-333333333333'
const HASH = 'a'.repeat(64)
const EVIDENCE = [
  '44444444-4444-4444-8444-444444444441',
  '44444444-4444-4444-8444-444444444442'
]

function markup() {
  return {
    schemaVersion: 3,
    analysisVersion: 'book-markup-v3',
    snapshotId: '55555555-5555-4555-8555-555555555555',
    textLength: 10_000,
    characters: [{
      characterKey: 'helene',
      name: 'Элен',
      fullName: 'Элен',
      aliases: [],
      identityEvidenceIds: EVIDENCE,
      firstAppearanceTextOffset: 100,
      warmupTextOffset: 50,
      role: null,
      age: null,
      gender: null,
      description: null,
      traits: [],
      personalityTimelineVersion: '',
      personalitySnapshots: [],
      appearance: [],
      speechStyle: null,
      speechExamples: [],
      creative: {}
    }],
    locations: [],
    events: [],
    relationships: [],
    storyArcs: []
  }
}

function document() {
  return {
    contractVersion: 'book-character-correction-v1',
    base: {
      markupVersionId: MARKUP_ID,
      publicationId: PUBLICATION_ID,
      contentHash: HASH
    },
    reason: 'Добавляем подтверждённое описание без повторного анализа книги.',
    changes: [{
      characterKey: 'helene',
      reason: 'Профиль существующего персонажа был опубликован без описания.',
      set: {
        description: {
          value: 'Светская женщина, чьи решения заметно влияют на судьбы окружающих.',
          evidenceIds: EVIDENCE,
          confidence: 0.86
        }
      }
    }]
  }
}

function fakePool() {
  const state = {
    publicationId: PUBLICATION_ID,
    correction: null,
    statements: []
  }
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      state.statements.push({ sql: normalized, params })
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] }
      if (normalized.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] }
      if (normalized.includes('character-correction:base-markup')) {
        return {
          rows: [{
            id: BOOK_ID,
            title: 'Война и мир',
            author: 'Лев Толстой',
            markup_id: MARKUP_ID,
            input_hash: HASH,
            revision: 1,
            analysis_version: 'book-markup-v3',
            markup_published_at: new Date('2026-08-31T09:35:52.000Z')
          }]
        }
      }
      if (normalized.includes('character-correction:base-publication')) {
        return {
          rows: [{
            id: state.publicationId,
            run_id: '66666666-6666-4666-8666-666666666666',
            content_hash: HASH,
            published_at: new Date('2026-08-31T09:35:52.000Z'),
            data: { markup: markup() }
          }]
        }
      }
      if (normalized.includes("AND status = 'enabled'")) {
        assert.match(normalized, /base_publication_id = COALESCE/)
        const requestedPublication = params[3] ?? state.publicationId
        const matches = state.correction?.status === 'enabled' &&
          state.correction.book_edition_id === params[0] &&
          state.correction.base_markup_version_id === params[1] &&
          state.correction.base_content_hash === params[2] &&
          state.correction.base_publication_id === requestedPublication
        return { rows: matches ? [structuredClone(state.correction)] : [] }
      }
      if (normalized.startsWith('SELECT * FROM book_character_corrections')) {
        return { rows: state.correction ? [structuredClone(state.correction)] : [] }
      }
      if (normalized.startsWith('INSERT INTO book_character_corrections')) {
        state.correction = {
          book_edition_id: params[0],
          base_markup_version_id: params[1],
          base_publication_id: params[2],
          base_content_hash: params[3],
          correction_version: params[4],
          status: 'draft',
          document: JSON.parse(params[5]),
          document_hash: params[6],
          validation: JSON.parse(params[7]),
          created_by: params[8],
          updated_by: params[8],
          enabled_by: null,
          disabled_by: null,
          created_at: new Date('2026-09-01T00:00:00.000Z'),
          updated_at: new Date('2026-09-01T00:00:00.000Z'),
          enabled_at: null,
          disabled_at: null
        }
        return { rows: [structuredClone(state.correction)] }
      }
      if (normalized.startsWith('UPDATE book_character_corrections SET status = \'enabled\'')) {
        state.correction.status = 'enabled'
        state.correction.enabled_by = params[2]
        state.correction.enabled_at = new Date('2026-09-01T00:01:00.000Z')
        state.correction.disabled_by = null
        state.correction.disabled_at = null
        state.correction.updated_by = params[2]
        return { rows: [structuredClone(state.correction)] }
      }
      if (normalized.startsWith('UPDATE book_character_corrections SET status = \'disabled\'')) {
        state.correction.status = 'disabled'
        state.correction.disabled_by = params[2]
        state.correction.disabled_at = new Date('2026-09-01T00:02:00.000Z')
        state.correction.updated_by = params[2]
        return { rows: [structuredClone(state.correction)] }
      }
      throw new Error(`unexpected SQL: ${normalized}`)
    },
    release() {}
  }
  return {
    state,
    async query(sql, params) { return client.query(sql, params) },
    async connect() { return client }
  }
}

test('repository keeps correction draft inert, activates exact hash and disables it as rollback', async () => {
  const pool = fakePool()
  const repository = createPostgresBookCharacterCorrectionRepository(pool)

  const preview = await repository.previewCorrection(BOOK_ID, document())
  assert.equal(preview.projectedCharacters[0].description.value.startsWith('Светская'), true)

  const staged = await repository.stageCorrection({
    bookEditionId: BOOK_ID,
    document: document(),
    operatorId: 'codex'
  })
  assert.equal(staged.correction.status, 'draft')
  assert.equal(staged.correction.correctionVersion, 1)
  assert.equal(await repository.getEnabledCorrection({
    bookEditionId: BOOK_ID,
    markupVersionId: MARKUP_ID,
    contentHash: HASH
  }), null)

  await assert.rejects(
    repository.enableCorrection({
      bookEditionId: BOOK_ID,
      documentHash: 'f'.repeat(64),
      operatorId: 'codex'
    }),
    (error) => error.code === 'CHARACTER_CORRECTION_CHANGED' && error.status === 409
  )

  const enabled = await repository.enableCorrection({
    bookEditionId: BOOK_ID,
    documentHash: staged.correction.documentHash,
    operatorId: 'codex'
  })
  assert.equal(enabled.status, 'enabled')
  assert.ok(await repository.getEnabledCorrection({
    bookEditionId: BOOK_ID,
    markupVersionId: MARKUP_ID,
    contentHash: HASH
  }))
  await assert.rejects(
    repository.stageCorrection({
      bookEditionId: BOOK_ID,
      document: document(),
      operatorId: 'codex'
    }),
    (error) => error.code === 'CHARACTER_CORRECTION_ALREADY_ENABLED' && error.status === 409
  )

  pool.state.publicationId = '77777777-7777-4777-8777-777777777777'
  const stale = await repository.getCorrectionState(BOOK_ID)
  assert.equal(stale.stale, true)
  assert.equal(stale.effective, false)
  assert.equal(await repository.getEnabledCorrection({
    bookEditionId: BOOK_ID,
    markupVersionId: MARKUP_ID,
    contentHash: HASH
  }), null)

  pool.state.publicationId = PUBLICATION_ID
  const disabled = await repository.disableCorrection({
    bookEditionId: BOOK_ID,
    documentHash: staged.correction.documentHash,
    operatorId: 'codex'
  })
  assert.equal(disabled.status, 'disabled')
  assert.equal(await repository.getEnabledCorrection({
    bookEditionId: BOOK_ID,
    markupVersionId: MARKUP_ID,
    contentHash: HASH
  }), null)
})

test('migration stores one versioned correction per book without creating character entities', async () => {
  const sql = await readFile(
    new URL('../migrations/026_book_character_corrections.sql', import.meta.url),
    'utf8'
  )
  assert.match(sql, /book_edition_id UUID PRIMARY KEY/)
  assert.match(sql, /status IN \('draft', 'enabled', 'disabled'\)/)
  assert.match(sql, /base_markup_version_id UUID NOT NULL REFERENCES book_markup_versions/)
  assert.match(sql, /base_publication_id UUID NOT NULL REFERENCES book_analysis_publications/)
  assert.match(sql, /WHERE status = 'enabled'/)
  assert.doesNotMatch(sql, /INSERT INTO book_characters|CREATE TABLE book_characters/)
})
