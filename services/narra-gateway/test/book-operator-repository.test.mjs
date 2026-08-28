import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostgresBookOperatorRepository } from '../book-operator-repository.mjs'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const IDENTITY_EVIDENCE_ID = '33333333-3333-4333-8333-333333333333'
const TRAIT_EVIDENCE_ID = '44444444-4444-4444-8444-444444444444'

function poolWithBooks() {
  return {
    async query(sql) {
      if (sql.includes('operator:list-editions')) {
        return { rows: [{
          id: BOOK_ID,
          scope: 'catalog',
          catalog_key: 'copper-horseman',
          title: 'Медный всадник',
          author: 'А. С. Пушкин',
          language: 'ru',
          format: 'epub',
          status: 'base_ready',
          content_sha256: 'a'.repeat(64),
          source_status: 'ready',
          byte_size: 1000,
          created_at: new Date('2026-08-14T10:00:00Z'),
          updated_at: new Date('2026-08-14T10:01:00Z')
        }] }
      }
      if (sql.includes('operator:latest-runs')) {
        return { rows: [{
          id: RUN_ID,
          book_edition_id: BOOK_ID,
          pipeline_version: 'book-analysis-v8',
          prompt_version: 'book-scan-v4',
          stage: 'scan',
          status: 'running',
          text_length: 10000,
          created_at: new Date('2026-08-14T10:01:00Z'),
          updated_at: new Date('2026-08-14T10:02:00Z')
        }] }
      }
      if (sql.includes('operator:analysis-job-counts')) {
        return { rows: [
          { run_id: RUN_ID, stage: 'prepare', status: 'ready', count: 1 },
          { run_id: RUN_ID, stage: 'scan', status: 'ready', count: 2 },
          { run_id: RUN_ID, stage: 'scan', status: 'running', count: 2 }
        ] }
      }
      if (sql.includes('operator:live-findings')) {
        return { rows: [{ run_id: RUN_ID, observation_count: 8, character_count: 3 }] }
      }
      if (sql.includes('operator:latest-publications')) return { rows: [] }
      if (sql.includes('operator:publication-quality')) return { rows: [] }
      if (sql.includes('operator:media-counts')) {
        return { rows: [{
          book_edition_id: BOOK_ID,
          queued: 1,
          running: 1,
          ready: 2,
          failed: 0,
          total: 4
        }] }
      }
      throw new Error(`unexpected query: ${sql}`)
    }
  }
}

test('dashboard list joins live analysis and media progress for every book', async () => {
  const repository = createPostgresBookOperatorRepository(poolWithBooks())
  const [book] = await repository.listBooks()
  assert.equal(book.id, BOOK_ID)
  assert.equal(book.language, 'ru')
  assert.equal(book.analysis.runId, RUN_ID)
  assert.equal(book.analysis.stage, 'scan')
  assert.deepEqual(book.analysis.jobs.scan, {
    total: 4, queued: 0, running: 2, ready: 2, failed: 0, cancelled: 0
  })
  assert.deepEqual(book.findings, {
    observations: 8,
    characters: 3,
    publishedCharacters: 0
  })
  assert.deepEqual(book.media, { queued: 1, running: 1, ready: 2, failed: 0, total: 4 })
  assert.equal(book.progress.percent > 10 && book.progress.percent < 50, true)
})

test('ready publication always reports one hundred percent', async () => {
  const pool = poolWithBooks()
  const original = pool.query
  pool.query = async (sql) => {
    if (sql.includes('operator:latest-runs')) {
      return { rows: [{
        id: RUN_ID,
        book_edition_id: BOOK_ID,
        pipeline_version: 'book-analysis-v8',
        prompt_version: 'book-scan-v4',
        stage: 'publish',
        status: 'ready'
      }] }
    }
    if (sql.includes('operator:latest-publications')) {
      return { rows: [{
        book_edition_id: BOOK_ID,
        id: '33333333-3333-4333-8333-333333333333',
        analysis_version: 'book-markup-v3',
        published_at: new Date('2026-08-14T10:03:00Z')
      }] }
    }
    if (sql.includes('operator:publication-quality')) {
      return { rows: [{
        book_edition_id: BOOK_ID,
        text_length: 100_000,
        character_count: 10,
        early_character_count: 6
      }] }
    }
    return original(sql)
  }
  const [book] = await createPostgresBookOperatorRepository(pool).listBooks()
  assert.equal(book.progress.percent, 100)
  assert.equal(book.findings.publishedCharacters, 10)
  assert.equal(book.quality.characterAppearance.status, 'suspicious')
  assert.equal(book.quality.characterAppearance.earlyCharacterCount, 6)
})

test('formatted JSON includes only evidence referenced by the published v3 markup', async () => {
  const calls = []
  const pool = {
    async query(sql, parameters) {
      calls.push([sql, parameters])
      if (sql.includes('operator:json-edition')) return { rows: [{
        id: BOOK_ID,
        scope: 'catalog',
        catalog_key: 'sample',
        title: 'Sample',
        author: 'Author',
        language: 'en',
        format: 'txt',
        status: 'base_ready',
        content_sha256: 'a'.repeat(64)
      }] }
      if (sql.includes('operator:json-publication')) return { rows: [{
        id: '55555555-5555-4555-8555-555555555555',
        run_id: RUN_ID,
        book_edition_id: BOOK_ID,
        artifact_id: '66666666-6666-4666-8666-666666666666',
        channel: 'shadow',
        analysis_version: 'book-markup-v3',
        content_hash: 'b'.repeat(64),
        data: { markup: { characters: [{
          characterKey: 'anna',
          identityEvidenceIds: [IDENTITY_EVIDENCE_ID],
          traits: [{
            value: 'Смелая',
            evidenceIds: [TRAIT_EVIDENCE_ID],
            confidence: 0.9
          }]
        }] } }
      }] }
      if (sql.includes('operator:json-artifacts')) return { rows: [] }
      if (sql.includes('operator:json-canonical-markup')) return { rows: [] }
      if (sql.includes('operator:json-evidence')) return { rows: [{
        id: TRAIT_EVIDENCE_ID,
        observation_type: 'character_trait',
        entity_kind: 'character',
        entity_candidate: 'Анна',
        fact: 'Анна смелая',
        evidence_quote: 'Анна первой вошла в дом.',
        evidence_start_offset: '120',
        evidence_end_offset: '147',
        confidence: 0.9,
        data: {}
      }] }
      throw new Error(`unexpected query: ${sql}`)
    }
  }
  const value = await createPostgresBookOperatorRepository(pool).getBookJson(BOOK_ID)
  const evidenceCall = calls.find(([sql]) => sql.includes('operator:json-evidence'))
  assert.deepEqual(new Set(evidenceCall[1][1]), new Set([
    IDENTITY_EVIDENCE_ID,
    TRAIT_EVIDENCE_ID
  ]))
  assert.deepEqual(value.evidence, [{
    id: TRAIT_EVIDENCE_ID,
    type: 'character_trait',
    entityKind: 'character',
    entityCandidate: 'Анна',
    fact: 'Анна смелая',
    quote: 'Анна первой вошла в дом.',
    startOffset: 120,
    endOffset: 147,
    confidence: 0.9,
    data: {}
  }])
})
