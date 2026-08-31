const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LABEL = /^[a-z][a-z0-9_]{0,79}$/
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'not_configured'])
const METADATA_KEYS = new Set([
  'target_version', 'reconciliation_version', 'snapshot_id', 'entity_key',
  'checkpoint_index', 'chunk_id', 'adaptive_part', 'analysis_version',
  'scene_key', 'slot_index', 'character_key', 'bundle_version'
])

function finiteNonNegative(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null
}

function integerNonNegative(value) {
  const number = finiteNonNegative(value)
  return number == null ? null : Math.round(number)
}

export function normalizeGenerationUsage(usage) {
  const value = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {}
  const inputTokens = integerNonNegative(value.prompt_tokens ?? value.input_tokens)
  const outputTokens = integerNonNegative(value.completion_tokens ?? value.output_tokens)
  const explicitTotal = integerNonNegative(value.total_tokens)
  const totalTokens = explicitTotal ?? (
    inputTokens != null || outputTokens != null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null
  )
  const exactCost = finiteNonNegative(value.cost, 1_000_000)
  return { inputTokens, outputTokens, totalTokens, exactCost }
}

function boundedLabel(value, fallback = 'unknown') {
  const normalized = String(value || '').trim().slice(0, 240)
  return normalized || fallback
}

function cleanMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!METADATA_KEYS.has(key)) return []
    if (typeof item === 'string') return [[key, item.slice(0, 240)]]
    if (typeof item === 'boolean' || Number.isSafeInteger(item) || item == null) return [[key, item]]
    return []
  }))
}

function normalizeContext(context, modality) {
  const operation = String(context?.operation || '').trim()
  const stage = String(context?.stage || '').trim()
  if (!LABEL.test(operation)) throw new TypeError('generation cost operation is invalid')
  if (!LABEL.test(stage)) throw new TypeError('generation cost stage is invalid')
  const bookEditionId = context?.bookEditionId == null ? null : String(context.bookEditionId)
  const analysisRunId = context?.analysisRunId == null ? null : String(context.analysisRunId)
  if (bookEditionId && !UUID.test(bookEditionId)) throw new TypeError('generation cost bookEditionId is invalid')
  if (analysisRunId && !UUID.test(analysisRunId)) throw new TypeError('generation cost analysisRunId is invalid')
  if (!bookEditionId && !analysisRunId) {
    throw new TypeError('generation cost context requires bookEditionId or analysisRunId')
  }
  if (!['text', 'image'].includes(modality)) throw new TypeError('generation cost modality is invalid')
  return {
    bookEditionId,
    analysisRunId,
    operation,
    stage,
    metadata: cleanMetadata(context?.metadata)
  }
}

function terminalAttempts(attempts) {
  const terminal = new Map()
  for (const attempt of Array.isArray(attempts) ? attempts : []) {
    if (!UUID.test(String(attempt?.attempt_id || '')) || !TERMINAL_STATUSES.has(attempt?.status)) continue
    terminal.set(attempt.attempt_id, attempt)
  }
  return [...terminal.values()]
}

export function createGenerationCostLedger(pool, { required = true, logger = console } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('a pg-compatible pool is required')

  async function record({ context, modality, requestId, attempts, usage, responseCost }) {
    const normalizedContext = normalizeContext(context, modality)
    if (!UUID.test(String(requestId || ''))) throw new TypeError('generation cost requestId is invalid')
    const completedAttempts = terminalAttempts(attempts)
    if (!completedAttempts.length) {
      const error = new Error('generation cost request has no terminal provider attempt')
      if (required) throw error
      logger.error?.('[generation-cost] terminal attempt is missing', { request_id: requestId })
      return { recorded: 0 }
    }
    const normalizedUsage = normalizeGenerationUsage(usage)
    const headerCost = finiteNonNegative(responseCost, 1_000_000)
    let recorded = 0
    for (const attempt of completedAttempts) {
      const successful = attempt.status === 'completed'
      const attemptHeaderCost = finiteNonNegative(attempt.response_cost, 1_000_000)
      const exactCost = successful
        ? normalizedUsage.exactCost ?? attemptHeaderCost ?? headerCost
        : attemptHeaderCost
      const costSource = exactCost != null
        ? successful && normalizedUsage.exactCost != null ? 'response_usage' : 'response_header'
        : null
      const result = await pool.query(
        `WITH resolved AS (
           SELECT COALESCE(
             $3::uuid,
             (SELECT book_edition_id FROM book_analysis_runs WHERE id = $4::uuid)
           ) AS book_edition_id
         )
         INSERT INTO generation_cost_events (
           attempt_id, request_id, book_edition_id, analysis_run_id,
           modality, operation, stage, provider, model, status, retry_index,
           http_status, error_code, input_tokens, output_tokens, total_tokens,
           exact_cost_usd, cost_source, latency_ms, metadata, updated_at
         )
         SELECT
           $1::uuid, $2::uuid, resolved.book_edition_id, $4::uuid,
           $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16,
           $17, $18, $19, $20::jsonb, now()
         FROM resolved
         WHERE resolved.book_edition_id IS NOT NULL
         ON CONFLICT (attempt_id) DO UPDATE SET
           status = EXCLUDED.status,
           http_status = EXCLUDED.http_status,
           error_code = EXCLUDED.error_code,
           input_tokens = COALESCE(EXCLUDED.input_tokens, generation_cost_events.input_tokens),
           output_tokens = COALESCE(EXCLUDED.output_tokens, generation_cost_events.output_tokens),
           total_tokens = COALESCE(EXCLUDED.total_tokens, generation_cost_events.total_tokens),
           exact_cost_usd = COALESCE(EXCLUDED.exact_cost_usd, generation_cost_events.exact_cost_usd),
           cost_source = COALESCE(EXCLUDED.cost_source, generation_cost_events.cost_source),
           latency_ms = COALESCE(EXCLUDED.latency_ms, generation_cost_events.latency_ms),
           updated_at = now()
         RETURNING attempt_id`,
        [
          attempt.attempt_id,
          requestId,
          normalizedContext.bookEditionId,
          normalizedContext.analysisRunId,
          modality,
          normalizedContext.operation,
          normalizedContext.stage,
          boundedLabel(attempt.provider),
          boundedLabel(attempt.model),
          attempt.status,
          integerNonNegative(attempt.retry_index) ?? 0,
          integerNonNegative(attempt.http_status),
          attempt.error_code ? boundedLabel(attempt.error_code) : null,
          successful ? normalizedUsage.inputTokens : null,
          successful ? normalizedUsage.outputTokens : null,
          successful ? normalizedUsage.totalTokens : null,
          exactCost,
          costSource,
          integerNonNegative(attempt.latency_ms),
          JSON.stringify(normalizedContext.metadata)
        ]
      )
      if (!result.rowCount) {
        const error = new Error('generation cost book could not be resolved')
        if (required) throw error
        logger.error?.('[generation-cost] book could not be resolved', {
          request_id: requestId,
          analysis_run_id: normalizedContext.analysisRunId
        })
        continue
      }
      recorded += 1
    }
    return { recorded }
  }

  return { record }
}

export async function generationCostReport(pool, {
  bookEditionIds,
  from = null,
  to = null
}) {
  const ids = [...new Set(bookEditionIds || [])]
  if (!ids.length || ids.some((id) => !UUID.test(String(id)))) {
    throw new TypeError('at least one valid book edition id is required')
  }
  const result = await pool.query(
    `SELECT
       event.book_edition_id,
       edition.title,
       edition.author,
       event.analysis_run_id,
       event.request_id,
       event.attempt_id,
       event.modality,
       event.stage,
       event.operation,
       event.provider,
       event.model,
       event.status,
       event.retry_index,
       event.http_status,
       event.error_code,
       event.input_tokens,
       event.output_tokens,
       event.total_tokens,
       event.exact_cost_usd::text,
       event.cost_source,
       event.latency_ms,
       event.metadata,
       event.created_at
     FROM generation_cost_events AS event
     JOIN book_editions AS edition ON edition.id = event.book_edition_id
     WHERE event.book_edition_id = ANY($1::uuid[])
       AND ($2::timestamptz IS NULL OR event.created_at >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR event.created_at < $3::timestamptz)
     ORDER BY event.book_edition_id, event.created_at, event.retry_index, event.attempt_id`,
    [ids, from, to]
  )
  const details = result.rows.map((row) => ({
    ...row,
    exact_cost_usd: row.exact_cost_usd == null ? null : Number(row.exact_cost_usd)
  }))
  const aggregate = new Map()
  const byBook = new Map()
  const emptySummary = () => ({
    attempt_count: 0,
    completed_count: 0,
    failed_count: 0,
    priced_count: 0,
    unpriced_attempt_count: 0,
    unpriced_completed_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    exact_cost_usd: 0
  })
  const total = emptySummary()
  const addSummary = (summary, row) => {
    summary.attempt_count += 1
    if (row.exact_cost_usd == null) summary.unpriced_attempt_count += 1
    else {
      summary.priced_count += 1
      summary.exact_cost_usd += row.exact_cost_usd
    }
    if (row.status === 'completed') {
      summary.completed_count += 1
      if (row.exact_cost_usd == null) summary.unpriced_completed_count += 1
    } else summary.failed_count += 1
    summary.input_tokens += Number(row.input_tokens || 0)
    summary.output_tokens += Number(row.output_tokens || 0)
    summary.total_tokens += Number(row.total_tokens || 0)
  }
  for (const row of details) {
    const book = byBook.get(row.book_edition_id) || {
      book_edition_id: row.book_edition_id,
      title: row.title,
      author: row.author,
      ...emptySummary()
    }
    addSummary(book, row)
    byBook.set(row.book_edition_id, book)
    addSummary(total, row)
    const key = [row.book_edition_id, row.modality, row.stage, row.operation, row.provider, row.model].join('\u0000')
    const current = aggregate.get(key) || {
      book_edition_id: row.book_edition_id,
      title: row.title,
      author: row.author,
      modality: row.modality,
      stage: row.stage,
      operation: row.operation,
      provider: row.provider,
      model: row.model,
      attempt_count: 0,
      completed_count: 0,
      failed_count: 0,
      priced_count: 0,
      unpriced_attempt_count: 0,
      unpriced_completed_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      exact_cost_usd: 0
    }
    current.attempt_count += 1
    if (row.exact_cost_usd == null) current.unpriced_attempt_count += 1
    else {
      current.priced_count += 1
      current.exact_cost_usd += row.exact_cost_usd
    }
    if (row.status === 'completed') {
      current.completed_count += 1
      if (row.exact_cost_usd == null) current.unpriced_completed_count += 1
    } else current.failed_count += 1
    current.input_tokens += Number(row.input_tokens || 0)
    current.output_tokens += Number(row.output_tokens || 0)
    current.total_tokens += Number(row.total_tokens || 0)
    aggregate.set(key, current)
  }
  return {
    filters: { bookEditionIds: ids, from, to },
    summary: { total, books: [...byBook.values()] },
    aggregate: [...aggregate.values()],
    details
  }
}
