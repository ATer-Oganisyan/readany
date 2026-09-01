import assert from 'node:assert/strict'
import test from 'node:test'
import { createGenerationQueueOperatorRepository } from '../generation-queue-operator-repository.mjs'

const PAUSE = '22222222-2222-4222-8222-222222222222'

function fakePool() {
  const queries = []
  const client = {
    async query(sql, parameters = []) {
      queries.push({ sql: String(sql), parameters })
      if (/UPDATE generation_jobs AS job[\s\S]*operator_pause_id = \$1/.test(sql)) {
        return { rows: [{ id: 'one' }, { id: 'two' }] }
      }
      if (/SELECT id FROM generation_queue_operations/.test(sql)) return { rows: [{ id: PAUSE }] }
      if (/SET operator_pause_id = NULL/.test(sql)) return { rows: [{ id: 'one' }] }
      if (/count\(\*\).*operator_pause_id = \$1/s.test(sql)) return { rows: [{ count: 1 }] }
      if (/count\(\*\)/.test(sql)) return { rows: [{ count: 12 }] }
      return { rows: [] }
    },
    release() {}
  }
  return {
    queries,
    connect: async () => client,
    query: (...args) => client.query(...args)
  }
}

test('pause uses a visible operation id and row-locked bounded candidates', async () => {
  const pool = fakePool()
  const repository = createGenerationQueueOperatorRepository(pool, { idFactory: () => PAUSE })
  const selector = { jobType: 'scene_image', bookEditionIds: [], campaignId: 'canary' }
  assert.deepEqual(await repository.planPause({ selector, limit: 5 }), {
    matched: 12,
    wouldAffect: 5,
    limit: 5,
    selector
  })
  assert.deepEqual(
    await repository.pause({
      selector,
      limit: 5,
      reasonCode: 'CANARY_PAUSE',
      operatorId: 'test'
    }),
    { pauseId: PAUSE, affected: 2, selector, limit: 5 }
  )
  const mutation = pool.queries.find(({ sql }) => /WITH candidates/.test(sql) && /operator_pause_id = \$1/.test(sql))
  assert.match(mutation.sql, /FOR UPDATE SKIP LOCKED/)
  assert.match(mutation.sql, /LIMIT \$4/)
  assert.deepEqual(mutation.parameters, [PAUSE, 'scene_image', 'canary', 5])
  assert.ok(pool.queries.some(({ sql }) => sql === 'COMMIT'))
})

test('resume clears only the requested bounded batch and keeps the remaining pause visible', async () => {
  const pool = fakePool()
  const repository = createGenerationQueueOperatorRepository(pool)
  const result = await repository.resume({
    pauseId: PAUSE,
    limit: 1,
    reasonCode: 'CANARY_RELEASE',
    operatorId: 'test'
  })
  assert.deepEqual(result, { pauseId: PAUSE, affected: 1, remaining: 1, limit: 1 })
  const mutation = pool.queries.find(({ sql }) => /SET operator_pause_id = NULL/.test(sql))
  assert.match(mutation.sql, /LIMIT \$2/)
  assert.doesNotMatch(mutation.sql, /available_at/)
  const audit = pool.queries.find(({ sql }) => /resume_reason_code = \$4/.test(sql))
  assert.deepEqual(audit.parameters, [PAUSE, 1, 1, 'CANARY_RELEASE', 'test'])
})
