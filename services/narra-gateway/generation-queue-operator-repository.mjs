import { randomUUID } from 'node:crypto'

function selectorSql(selector, firstParameter = 1) {
  const clauses = ["status = 'queued'", 'operator_pause_id IS NULL']
  const parameters = []
  if (selector.jobType) {
    parameters.push(selector.jobType)
    clauses.push(`job_type = $${firstParameter + parameters.length - 1}`)
  }
  if (selector.bookEditionIds?.length) {
    parameters.push(selector.bookEditionIds)
    clauses.push(`book_edition_id = ANY($${firstParameter + parameters.length - 1}::uuid[])`)
  }
  if (selector.campaignId) {
    parameters.push(selector.campaignId)
    clauses.push(`payload->>'campaign_id' = $${firstParameter + parameters.length - 1}`)
  }
  return { where: clauses.join(' AND '), parameters }
}

async function transaction(pool, operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export function createGenerationQueueOperatorRepository(pool, { idFactory = randomUUID } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('a pg-compatible pool is required')
  }
  return {
    async status() {
      const result = await pool.query(
        `SELECT operation.id, operation.selector, operation.reason_code,
                operation.operator_id, operation.paused_count, operation.resumed_count,
                operation.resume_reason_code, operation.resume_operator_id,
                operation.created_at, operation.last_resumed_at, operation.completed_at,
                count(job.id)::integer AS remaining
         FROM generation_queue_operations AS operation
         LEFT JOIN generation_jobs AS job ON job.operator_pause_id = operation.id
         GROUP BY operation.id
         ORDER BY operation.created_at DESC, operation.id
         LIMIT 100`
      )
      return result.rows.map((row) => ({
        id: row.id,
        selector: row.selector,
        reasonCode: row.reason_code,
        operatorId: row.operator_id,
        resumeReasonCode: row.resume_reason_code ?? undefined,
        resumeOperatorId: row.resume_operator_id ?? undefined,
        pausedCount: Number(row.paused_count),
        resumedCount: Number(row.resumed_count),
        remaining: Number(row.remaining),
        createdAt: row.created_at,
        lastResumedAt: row.last_resumed_at ?? undefined,
        completedAt: row.completed_at ?? undefined
      }))
    },

    async planPause({ selector, limit }) {
      const filter = selectorSql(selector)
      const result = await pool.query(
        `SELECT count(*)::integer AS count FROM generation_jobs WHERE ${filter.where}`,
        filter.parameters
      )
      const matched = Number(result.rows[0]?.count ?? 0)
      return { matched, wouldAffect: Math.min(matched, limit), limit, selector }
    },

    async pause({ selector, limit, reasonCode, operatorId }) {
      return transaction(pool, async (client) => {
        const operationId = idFactory()
        await client.query(
          `INSERT INTO generation_queue_operations (id, selector, reason_code, operator_id)
           VALUES ($1, $2::jsonb, $3, $4)`,
          [operationId, JSON.stringify(selector), reasonCode, operatorId]
        )
        const filter = selectorSql(selector, 2)
        const result = await client.query(
          `WITH candidates AS (
             SELECT id FROM generation_jobs
             WHERE ${filter.where}
             ORDER BY priority DESC, available_at, created_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $${2 + filter.parameters.length}
           )
           UPDATE generation_jobs AS job
           SET operator_pause_id = $1, operator_paused_at = now(), updated_at = now()
           FROM candidates WHERE job.id = candidates.id
           RETURNING job.id`,
          [operationId, ...filter.parameters, limit]
        )
        await client.query(
          `UPDATE generation_queue_operations SET paused_count = $2 WHERE id = $1`,
          [operationId, result.rows.length]
        )
        return { pauseId: operationId, affected: result.rows.length, selector, limit }
      })
    },

    async planResume({ pauseId, limit }) {
      const result = await pool.query(
        `SELECT count(*)::integer AS count
         FROM generation_jobs WHERE operator_pause_id = $1`,
        [pauseId]
      )
      const matched = Number(result.rows[0]?.count ?? 0)
      return { pauseId, matched, wouldAffect: Math.min(matched, limit), limit }
    },

    async resume({ pauseId, limit, reasonCode, operatorId }) {
      return transaction(pool, async (client) => {
        const operation = await client.query(
          'SELECT id FROM generation_queue_operations WHERE id = $1 FOR UPDATE',
          [pauseId]
        )
        if (!operation.rows[0]) {
          const error = new Error('queue pause was not found')
          error.code = 'NOT_FOUND'
          throw error
        }
        const result = await client.query(
          `WITH candidates AS (
             SELECT id FROM generation_jobs
             WHERE operator_pause_id = $1
             ORDER BY operator_paused_at, created_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $2
           )
           UPDATE generation_jobs AS job
           SET operator_pause_id = NULL, operator_paused_at = NULL,
               updated_at = now()
           FROM candidates WHERE job.id = candidates.id
           RETURNING job.id`,
          [pauseId, limit]
        )
        const remaining = await client.query(
          'SELECT count(*)::integer AS count FROM generation_jobs WHERE operator_pause_id = $1',
          [pauseId]
        )
        const remainingCount = Number(remaining.rows[0]?.count ?? 0)
        await client.query(
          `UPDATE generation_queue_operations
           SET resumed_count = resumed_count + $2,
               resume_reason_code = $4, resume_operator_id = $5,
               last_resumed_at = now(),
               completed_at = CASE WHEN $3 = 0 THEN now() ELSE NULL END
           WHERE id = $1`,
          [pauseId, result.rows.length, remainingCount, reasonCode, operatorId]
        )
        return { pauseId, affected: result.rows.length, remaining: remainingCount, limit }
      })
    }
  }
}
