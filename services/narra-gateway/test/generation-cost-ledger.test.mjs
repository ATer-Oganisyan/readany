import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGenerationCostLedger,
  generationCostReport,
  normalizeGenerationUsage
} from '../generation-cost-ledger.mjs'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'

test('usage normalization distinguishes missing price from an exact zero', () => {
  assert.deepEqual(normalizeGenerationUsage({
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
    cost: 0.125
  }), {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    exactCost: 0.125
  })
  assert.equal(normalizeGenerationUsage({ cost: null }).exactCost, null)
  assert.equal(normalizeGenerationUsage({}).exactCost, null)
  assert.equal(normalizeGenerationUsage({ cost: 0 }).exactCost, 0)
})

test('ledger attributes every terminal retry and prices only the completed attempt', async () => {
  const queries = []
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params })
      return { rowCount: 1, rows: [{ attempt_id: params[0] }] }
    }
  }
  const ledger = createGenerationCostLedger(pool)
  const result = await ledger.record({
    context: {
      bookEditionId: BOOK_ID,
      analysisRunId: RUN_ID,
      operation: 'scan_book_chunk',
      stage: 'scan',
      metadata: { chunk_id: 'chunk-1', prompt: 'must be discarded' }
    },
    modality: 'text',
    requestId: REQUEST_ID,
    attempts: [{
      attempt_id: '44444444-4444-4444-8444-444444444444',
      provider: 'litellm', model: 'model-a', status: 'failed',
      retry_index: 0, http_status: 502, error_code: 'NETWORK', latency_ms: 100,
      response_cost: 0.1
    }, {
      attempt_id: '55555555-5555-4555-8555-555555555555',
      provider: 'litellm', model: 'model-b', status: 'completed',
      retry_index: 1, http_status: 200, latency_ms: 200
    }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.4 },
    responseCost: 0.5
  })

  assert.deepEqual(result, { recorded: 2 })
  assert.equal(queries.length, 2)
  assert.equal(queries[0].params[16], 0.1)
  assert.equal(queries[0].params[17], 'response_header')
  assert.equal(queries[1].params[13], 100)
  assert.equal(queries[1].params[14], 20)
  assert.equal(queries[1].params[15], 120)
  assert.equal(queries[1].params[16], 0.4)
  assert.equal(queries[1].params[17], 'response_usage')
  assert.deepEqual(JSON.parse(queries[1].params[19]), { chunk_id: 'chunk-1' })
})

test('report keeps unpriced successful calls visible instead of adding zero cost', async () => {
  const pool = {
    async query() {
      return { rows: [{
        book_edition_id: BOOK_ID,
        title: 'Book', author: 'Author', analysis_run_id: RUN_ID,
        request_id: REQUEST_ID, attempt_id: '44444444-4444-4444-8444-444444444444',
        modality: 'image', stage: 'cover', operation: 'generate_catalog_cover',
        provider: 'litellm', model: 'gpt-image-2', status: 'completed', retry_index: 0,
        http_status: 200, error_code: null, input_tokens: null, output_tokens: null,
        total_tokens: null, exact_cost_usd: null, cost_source: null, latency_ms: 500,
        metadata: {}, created_at: new Date('2026-08-27T00:00:00Z')
      }, {
        book_edition_id: BOOK_ID,
        title: 'Book', author: 'Author', analysis_run_id: RUN_ID,
        request_id: '66666666-6666-4666-8666-666666666666',
        attempt_id: '77777777-7777-4777-8777-777777777777',
        modality: 'text', stage: 'scan', operation: 'scan_book_chunk',
        provider: 'litellm', model: 'model-a', status: 'completed', retry_index: 0,
        http_status: 200, error_code: null, input_tokens: 50, output_tokens: 10,
        total_tokens: 60, exact_cost_usd: '0.0300000000', cost_source: 'response_header',
        latency_ms: 100, metadata: {}, created_at: new Date('2026-08-27T00:00:01Z')
      }] }
    }
  }
  const report = await generationCostReport(pool, { bookEditionIds: [BOOK_ID] })
  const image = report.aggregate.find(({ modality }) => modality === 'image')
  const text = report.aggregate.find(({ modality }) => modality === 'text')
  assert.equal(image.unpriced_completed_count, 1)
  assert.equal(image.unpriced_attempt_count, 1)
  assert.equal(image.priced_count, 0)
  assert.equal(image.exact_cost_usd, 0)
  assert.equal(text.priced_count, 1)
  assert.equal(text.exact_cost_usd, 0.03)
  assert.equal(text.total_tokens, 60)
})
