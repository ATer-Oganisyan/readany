import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  createGenerationCostLedger,
  generationCostReport
} from '../generation-cost-ledger.mjs'

const connectionString = process.env.GENERATION_COST_E2E_DATABASE_URL

test('PostgreSQL cost ledger resolves a book from an analysis run and reports exact cost', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, max: 1 })
  const client = await pool.connect()
  const bookEditionId = randomUUID()
  const runId = randomUUID()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Synthetic cost test', '', 'txt', 'draft')`,
      [bookEditionId, `cost-test-${bookEditionId}`, 'a'.repeat(64)]
    )
    await client.query(
      `INSERT INTO book_analysis_runs (
         id, idempotency_key, book_edition_id, pipeline_version, prompt_version, input_hash
       ) VALUES ($1, $2, $3, 'pipeline-test', 'prompt-test', $4)`,
      [runId, `cost-test-run-${runId}`, bookEditionId, 'b'.repeat(64)]
    )
    const ledger = createGenerationCostLedger(client)
    await ledger.record({
      context: {
        analysisRunId: runId,
        operation: 'scan_book_chunk',
        stage: 'scan',
        metadata: { chunk_id: 'synthetic' }
      },
      modality: 'text',
      requestId: randomUUID(),
      attempts: [{
        attempt_id: randomUUID(),
        provider: 'litellm',
        model: 'synthetic-model',
        status: 'completed',
        retry_index: 0,
        http_status: 200,
        latency_ms: 12
      }],
      usage: { prompt_tokens: 40, completion_tokens: 2, total_tokens: 42 },
      responseCost: 0.0123
    })
    const report = await generationCostReport(client, { bookEditionIds: [bookEditionId] })
    assert.equal(report.details.length, 1)
    assert.equal(report.details[0].book_edition_id, bookEditionId)
    assert.equal(report.details[0].analysis_run_id, runId)
    assert.equal(report.details[0].cost_source, 'response_header')
    assert.equal(report.summary.total.total_tokens, 42)
    assert.equal(report.summary.total.exact_cost_usd, 0.0123)
    assert.equal(report.summary.total.unpriced_completed_count, 0)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
    await pool.end()
  }
})
