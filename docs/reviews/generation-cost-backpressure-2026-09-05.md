# P1: generation cost recording can retain LLM capacity indefinitely

Date: 2026-09-05. Diagnosis, standalone model-free reproduction and partial source fix.
No running gateway, database settings, billing data or provider configuration changed.

## Partial fix verified — provider capacity only

`completeInternalChat` now releases its provider permit exactly once after
response consumption/attempt finalization settles, before awaited accounting.
The failure path releases after the provider operation rejects, before recording
its attempts. The accounting call remains awaited with the same input and error
policy; no detached queue, skipped-record race, DB cancellation or connection
release was added.

New actual-method behavioral tests in
`services/narra-gateway/test/internal-chat-cost-permit.test.mjs` reproduced three
failures before the fix, then passed for success, malformed response and provider
rejection. They hold finalization to prove no early permit release, hold the
ledger to prove the next waiter progresses, and settle the ledger to verify the
original result/error and exactly-once release. Related recorder, ledger,
provider-response and workload suites: **22 tests passed**.

The standalone probe now exits **0** with `outcome: pending`, `active: 0`,
`waiting: 0`. **The caller still hangs while the ledger is suspended.** This is
not accounting durability acceptance. A separate fail-fast
`internalChatLifecycleGate` now bounds the complete internal-chat lifecycle,
including awaited accounting, before provider admission. Its validated
`INTERNAL_CHAT_LIFECYCLE_LIMIT` defaults to `LLM_CONCURRENCY` (1–100), has no
waiting queue, and rejects saturation with RATE/429 before paid work. It remains
occupied on request abort until accounting settles. The tests also reproduce
the missing lifecycle bound RED, then verify saturation makes no second provider
call and both terminal paths/admission rejection release lifecycle ownership.
The probe shows `lifecycleActive: 1` while accounting is pending and zero after
controlled cleanup. This process-local cap covers only `completeInternalChat`,
not image/speech accounting or cross-replica capacity. A bounded durable delivery
design remains a separate gate. No live AI or database writes were used.

## Original observed behavior (before partial fix)

`completeInternalChat` in `services/narra-gateway/index.mjs` consumes a successful
provider response, then awaits `recordInternalGenerationCost` before releasing
`llmGate` in `finally`. Its failure path also awaits cost recording before release.
The recorder's `await ledger.record(input)` and ledger's `await pool.query(...)`
do not receive or race the request signal. A deadline signal therefore cannot
interrupt a suspended accounting write.

The actual-method probe uses the real recorder and ledger, a completed synthetic
provider response and a controlled suspended pool query. After request abort:

```json
{"outcome":"pending","queryCalls":1,"activeSignalAborted":true,"active":1,"waiting":1}
```

After settling the mock query, both active and waiting counts return to zero.
This demonstrates executable control flow, not source-text assertions. A finite
observation window establishes that abort is ineffective; the absence of another
completion trigger in this awaited chain explains the unbounded wait.

```sh
node scripts/qa/reproduce-cost-ledger-stall.mjs
```

Expected exit **2** means the known defect reproduced. Exit 0 means that exact
observation no longer reproduced and requires review, not automatic acceptance
of financial durability. Other errors indicate a broken diagnostic. Its own
query and waiter are always settled during bounded cleanup. It opens no DB
connection and makes no model/network request.

## Financial semantics: what is and is not guaranteed

The table records provider-attempt cost/usage statistics. Whether it is an actual
customer-billing source of truth or mandatory accounting ledger is **unknown**;
do not silently decide that product policy in a technical fix.

`GENERATION_COST_LEDGER_REQUIRED=true` configures ledger validation: missing
terminal attempts or unresolved books raise errors. However,
`createBestEffortGenerationCostRecorder` catches rejected writes and returns
`recorded: 0, skipped: record_failed`; an unavailable ledger is also skipped.
The flag therefore does **not** currently guarantee durable recording, retry or
failure of the generation request. The existing tests explicitly preserve the
generation result on ledger failure. There is no durable replay queue in this
recorder, and multiple attempt rows can commit partially before a later failure.

The ledger uses `attempt_id` as its primary key and upserts conflicts. Replaying
the same immutable event identities can therefore avoid duplicate rows, unlike
rerunning the paid generation with newly created request/attempt IDs.

## Database timeout boundary

`postgres-runtime.mjs` sets pool size and connection timeout, but does not
explicitly set statement/query timeouts. Actual deployed role/server timeout
settings were not inspected, so no claim is made that every deployment has none.

PostgreSQL's `statement_timeout` terminates a server statement; a client-side
timeout is a different boundary. Configure cost-specific deadlines rather than
changing every shared-pool operation or migration without separate acceptance.
[PostgreSQL statement timeout](https://www.postgresql.org/docs/current/runtime-config-client.html),
[node-postgres client settings](https://node-postgres.com/apis/client).

Do not return a checked-out client as healthy while its query is still active.
The installed `pg-pool` passes query errors to `client.release(err)`, which removes
the client. With a custom watchdog, retain ownership until the query settles or
destroy the uncertain connection; never merely race and invoke plain `release()`.
Connection loss can leave commit outcome unknown, so retain/replay the same
event instead of assuming rollback. [Pool release semantics](https://node-postgres.com/apis/pool).

## Further implementation gate

1. **Implemented in source:** separate provider-slot lifetime from accounting delivery: release the LLM
   permit after provider consumption/finalization on both success and failure.
   This alone restores a slot but does not solve caller hangs or accounting backlog.
2. Decide whether this is best-effort statistics or mandatory durable accounting.
   For mandatory delivery, use a durable cost outbox with immutable attempt IDs,
   bounded disk/backlog and replay acknowledgment; do not apply the lossy analytics
   writer or `Promise.race -> skipped` to financial records.
3. Bound cost-writer concurrency and database operations, retain pending events
   on ambiguous completion, and reject new paid work before provider invocation
   when durable capacity is unavailable. Do not replace an occupied LLM queue
   with an unlimited detached accounting queue.
4. Regressions: hung SQL and disconnect, no early connection reuse, uncertain
   commit plus idempotent replay, restart with pending events, outbox exhaustion,
   and no repeated paid generation solely to retry accounting.

Durable-outbox implementation is a separate approval/acceptance gate after the
live pipeline work. No scope expansion or runtime implementation is implied by
this report. The existing public queue deadline does not fix this internal
post-provider stall.
