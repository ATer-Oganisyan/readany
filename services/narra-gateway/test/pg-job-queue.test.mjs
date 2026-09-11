import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assertLeaseSeconds,
  claimJobSql,
  claimOrderSql,
  claimableSql,
  expireExhaustedLeasesSql,
  jobQueueColumns,
  leaseExpiredSql,
  renewLeaseSql
} from '../db/pg-job-queue.mjs'

const migrations = {
  analysis: await readFile(new URL('../migrations/005_parallel_book_analysis.sql', import.meta.url), 'utf8'),
  generation: await readFile(new URL('../migrations/001_book_markup.sql', import.meta.url), 'utf8'),
  search: await readFile(new URL('../migrations/018_book_search.sql', import.meta.url), 'utf8'),
  tts: await readFile(new URL('../migrations/018_book_tts_markup.sql', import.meta.url), 'utf8')
}

function tableColumns(sql, table) {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
  const begin = start === -1 ? sql.indexOf(`CREATE TABLE ${table} (`) : start
  assert.notEqual(begin, -1, `${table} is not defined`)
  const body = sql.slice(begin, sql.indexOf('\n);', begin))
  return new Set([...body.matchAll(/^\s{2}([a-z_]+)\s+[A-Z]/gm)].map((match) => match[1]))
}

const TTS_COLUMNS = jobQueueColumns({
  attempts: 'attempt_count',
  maxAttempts: null,
  priority: null,
  availableAt: null,
  lockedAt: null,
  lockedBy: 'lease_owner',
  errorCode: 'error_code'
})
const GENERATION_COLUMNS = jobQueueColumns({ maxAttempts: null, leaseExpiresAt: null })

test('every declared column contract exists in the migration that owns the queue', () => {
  const cases = [
    ['book_analysis_jobs', migrations.analysis, jobQueueColumns()],
    ['generation_jobs', migrations.generation, GENERATION_COLUMNS],
    ['book_search_jobs', migrations.search, jobQueueColumns()],
    ['book_tts_markup_jobs', migrations.tts, TTS_COLUMNS]
  ]
  for (const [table, sql, columns] of cases) {
    const declared = tableColumns(sql, table)
    for (const [role, column] of Object.entries(columns)) {
      if (!column) continue
      assert.ok(declared.has(column), `${table} has no ${role} column "${column}"`)
    }
  }
})

test('a queue without a lease column derives expiry from the claim timestamp', () => {
  assert.equal(
    leaseExpiredSql({ columns: jobQueueColumns() }),
    'job.lease_expires_at <= now()'
  )
  assert.equal(
    leaseExpiredSql({ columns: GENERATION_COLUMNS, leaseSeconds: '$2' }),
    'job.locked_at < now() - make_interval(secs => $2)'
  )
})

test('a queue that can express neither form of lease expiry is rejected', () => {
  assert.throws(
    () => jobQueueColumns({ lockedAt: null, leaseExpiresAt: null }),
    /leaseExpiresAt or a lockedAt column/
  )
  assert.throws(() => jobQueueColumns({ status: null }), /status column is required/)
  assert.throws(() => jobQueueColumns({ nonsense: 'x' }), /unknown job column: nonsense/)
})

test('the claimable predicate drops the attempt ceiling only when the queue has none', () => {
  assert.match(claimableSql({ columns: jobQueueColumns() }), /job\.attempts < job\.max_attempts AND/)
  assert.doesNotMatch(
    claimableSql({ columns: GENERATION_COLUMNS, leaseSeconds: '$2' }),
    /max_attempts/
  )
  // Без available_at очередь выдаёт queued-задание сразу.
  assert.match(claimableSql({ columns: TTS_COLUMNS }), /^\(job\.status = 'queued' OR/)
})

test('ordering stays qualified so a joined queue is never ambiguous', () => {
  // book_analysis_runs тоже имеет created_at: неквалифицированный ORDER BY
  // здесь падает на «column reference is ambiguous».
  assert.equal(
    claimOrderSql(),
    'job.priority DESC, job.available_at, job.created_at'
  )
  assert.equal(
    claimOrderSql({ before: ['(SELECT 1) ASC NULLS FIRST'] }),
    'job.priority DESC, (SELECT 1) ASC NULLS FIRST, job.available_at, job.created_at'
  )
  assert.equal(claimOrderSql({ columns: TTS_COLUMNS }), 'job.created_at')
})

test('a single-table claim locks the queue row without FOR UPDATE OF', () => {
  const sql = claimJobSql({
    table: 'generation_jobs',
    columns: GENERATION_COLUMNS,
    lockedBy: '$1',
    leaseSeconds: '$2',
    leaseToken: '$3'
  })
  assert.match(sql, /FOR UPDATE SKIP LOCKED/)
  assert.doesNotMatch(sql, /FOR UPDATE OF/)
  assert.match(sql, /SET status = 'running', attempts = attempts \+ 1, locked_at = now\(\)/)
  // Очередь без lease_expires_at не должна получить эту колонку в SET.
  assert.doesNotMatch(sql, /lease_expires_at/)
})

test('a joined claim locks only the queue row and keeps its extra projection', () => {
  const sql = claimJobSql({
    table: 'book_analysis_jobs',
    select: ['run.input_hash AS source_hash'],
    from: 'JOIN book_analysis_runs AS run ON run.id = job.run_id',
    where: ["run.status IN ('queued', 'running')"],
    lockedBy: '$1',
    leaseSeconds: '$3',
    leaseToken: '$4',
    returning: 'job.*, candidate.source_hash'
  })
  assert.match(sql, /SELECT job\.id, run\.input_hash AS source_hash/)
  assert.match(sql, /FOR UPDATE OF job SKIP LOCKED/)
  assert.match(sql, /RETURNING job\.\*, candidate\.source_hash/)
  assert.match(sql, /lease_expires_at = now\(\) \+ make_interval\(secs => \$3\)/)
})

test('a claim clears the previous error code only when asked', () => {
  const kept = claimJobSql({
    table: 'book_search_jobs',
    lockedBy: '$1',
    leaseSeconds: '$4',
    leaseToken: '$5'
  })
  const cleared = claimJobSql({
    table: 'book_tts_markup_jobs',
    columns: TTS_COLUMNS,
    lockedBy: '$1',
    leaseSeconds: '$3',
    leaseToken: '$2',
    clearErrorCode: true
  })
  assert.doesNotMatch(kept, /last_error_code = NULL/)
  assert.match(cleared, /error_code = NULL/)
  // У TTS нет locked_at — колонку нельзя писать в SET.
  assert.doesNotMatch(cleared, /locked_at/)
})

test('renewal always proves ownership through the lease token', () => {
  for (const columns of [jobQueueColumns(), GENERATION_COLUMNS, TTS_COLUMNS]) {
    const sql = renewLeaseSql({
      table: 'queue',
      columns,
      id: '$1',
      leaseToken: '$2',
      leaseSeconds: '$3'
    })
    assert.match(sql, /status = 'running'/)
    assert.match(sql, /lease_token = \$2::uuid/)
    assert.match(sql, /RETURNING id/)
  }
})

test('the exhaustion sweep releases the lease and reports rows for the rollup', () => {
  const sql = expireExhaustedLeasesSql({
    table: 'book_analysis_jobs',
    where: ['job.stage = ANY($1::text[])'],
    returning: 'job.run_id'
  })
  assert.match(sql, /SET status = 'failed', last_error_code = 'LEASE_EXPIRED'/)
  assert.match(sql, /locked_at = NULL, locked_by = NULL, lease_token = NULL, lease_expires_at = NULL/)
  assert.match(sql, /job\.attempts >= job\.max_attempts/)
  assert.match(sql, /RETURNING job\.run_id/)
})

test('lease durations outside the supported window are rejected', () => {
  assert.equal(assertLeaseSeconds(300), 300)
  assert.throws(() => assertLeaseSeconds(0), /between 1 and 3600/)
  assert.throws(() => assertLeaseSeconds(3_601), /between 1 and 3600/)
  assert.throws(() => assertLeaseSeconds(1.5), /between 1 and 3600/)
})
