# Backend simplification options

Scope: `services/narra-gateway` (the whole Node backend) plus the small Python
`services/autiobook-adapter`. Reviewed on 2026-09-10 against `main`.

## Diagnosis

| Measure | Value |
| --- | --- |
| `.mjs` files | **154, all flat in one directory** |
| Source LOC | 35,865 |
| Test LOC | 24,857 across 111 test files |
| Dead code | **zero** — every module is referenced somewhere |
| Repositories | 8 files, 8,209 LOC, 431 raw `.query()` calls |
| Queue claim implementations | **5** separate `FOR UPDATE SKIP LOCKED` blocks over 4 near-identical job tables |
| Worker runners | 6 files, 611 LOC, ~80% byte-identical |
| Compose services | 15, of which **6 are analysis stages on the same image** |
| Env var names | ~400 referenced; 192 lines in `.env.example` |
| Deploy bash | 1,582 LOC across 9 scripts |

The codebase is not rotting — it is unshaped. No dead code, disciplined tests,
current architecture docs. The complexity is structural: boilerplate that was
copied instead of parameterized, and a deployment topology finer-grained than
the schema requires.

> **Status (2026-09-10):** all five options are implemented — A and B on
> `refactor/backend-simplification-a-b`, C, D and E on
> `refactor/backend-simplification-c-e`, which is stacked on top of it.

## Option A — collapse 6 analysis worker processes into 1 — DONE

All six stages claim from **one** table (`book_analysis_jobs`) through **one**
stage-parameterized method (`claimAnalysisJob(workerId, { stages })`,
`services/narra-gateway/book-analysis-repository.mjs:1245`). They run the same
image with the same environment. `book-analysis-stage-worker-runner.mjs`
already proves the generalization: it serves synthesize/validate/publish from a
single entrypoint selected by `process.argv[2]`.

Replace the six runners with one `analysis-worker.mjs [stages...]` defaulting to
all stages.

- Deletes roughly 500 of 611 runner LOC; compose 15 → 10 services.
- Removes 20 per-stage env knobs
  (`BOOK_ANALYSIS_{SCAN,RESOLVE,EXTERNAL,STAGE}_{POLL_MS,LEASE_SECONDS,LEASE_RENEW_MS,IDLE_LOG_MS,WORKER_ID}`)
  in favour of one shared set with optional per-stage override.
- Tradeoff: one process handles one job at a time, so colocating stages lowers
  per-stage throughput. The stage-filter argument must survive so `scan` (the
  hot stage, already behind `BOOK_ANALYSIS_SCAN_REPLICAS`) can still be split
  out under load. Default topology becomes a single worker; the scaled topology
  stays available.

Effort ~1 day. Risk low. Highest payoff of anything listed here.

**As implemented.** `book-analysis-worker.mjs` takes the stage list from argv or
`BOOK_ANALYSIS_STAGES` and polls them in one loop; the scan, resolve, stage and
external runners are gone. A shared `worker-runtime.mjs` now carries the loop
(shutdown, pool, migrations, heartbeat, poll, idle log, backoff), and the search
and TTS runners use it too — both gained a heartbeat and idle logging they did
not have. Compose keeps one `book-analysis-worker` plus an opt-in
`book-analysis-pool` profile for hot stages.

The cost, which the old topology paid for deliberately: one process now holds
both storage and generator credentials, where `publish` previously held neither.
`BOOK_ANALYSIS_STAGES` restores the split for anyone who wants per-stage least
privilege back.

## Option B — one queue primitive instead of five — DONE

`book_analysis_jobs`, `generation_jobs`, `book_search_jobs` and
`book_tts_markup_jobs` carry the same columns (`status`, `priority`, `attempts`,
`payload`, `result`, `last_error_code`, `available_at`, `locked_at`,
`locked_by`, `lease_token`), and each repository re-implements claim, lease
renewal, backoff and failure independently. Retry semantics currently differ
between them by accident rather than by design.

Extract a `pg-job-queue.mjs` primitive parameterized by table name and column
contract. Each domain keeps its own table and payload shape.

Effort ~3 days. Risk medium — it touches every worker path, but each queue has
integration coverage (`test/postgres-*.integration.test.mjs`). Payoff: uniform
retry and lease behaviour, roughly 600 LOC removed.

**As implemented.** `pg-job-queue.mjs` holds the mechanics — the column
contract, the claimable predicate, the ordering, the lease assignment, the
claim/renew/sweep query shapes — while each repository keeps its own domain
predicates, because those carry business rules and must stay readable. All four
claims (`book_analysis_jobs`, `generation_jobs`, `book_search_jobs`,
`book_tts_markup_jobs`) and all four lease renewals go through it. The four
remaining `SKIP LOCKED` blocks are operator bulk mutations (retry, purge, pause,
resume), not claims, and were left alone.

Two latent defects surfaced while generating the SQL, both invisible to the
unit tests because they use fake pools:

- `book_tts_markup_jobs` has no `locked_at` column, so a naive shared writer
  would have emitted an invalid `UPDATE`. `lockedAt` is now optional in the
  column contract, and a test cross-checks every declared contract against the
  migration that owns the table.
- an unqualified `ORDER BY created_at` is ambiguous once the analysis claim
  joins `book_analysis_runs`, which also has `created_at`. Every fragment now
  defaults to the same `job` alias.

Also folded in: five copies of `transaction` became one, and the shared version
keeps the deadlock retry with backoff that only the markup repository had.
`validateLeaseSeconds` stays local to the analysis repository — its 30-second
floor is a domain rule, not shared mechanics.

## Option C — split the two god-files by responsibility — DONE

- `index.mjs` (2,516 LOC) is configuration plus a Kandinsky image client, a
  Kandinsky video client, a token cache, 23 routes and all DI wiring. Lines
  ~404–1039 are ~640 LOC of inline provider clients living in the entrypoint
  while `providers.mjs` (669 LOC) sits beside it. Move them out and move routes
  into a `routes/` folder; the entrypoint becomes wiring only.
- `internal-generation-service.mjs` (2,810 LOC) spends ~1,700 LOC on
  `normalize*`/validation before the service starts at line 1789, while
  `contracts.mjs` (315) and `book-analysis-contracts.mjs` (636) already exist.
  Validation is spread across three places; consolidate it.

Effort ~2 days. Risk low (pure moves). Payoff: the two files people avoid
touching become readable.

**As implemented.** The Kandinsky image and video clients became
`provider-kandinsky-image.mjs` and `provider-kandinsky-video.mjs`, factories
over config rather than closures over module-level globals. Their identical
serialising queue became `createSerialQueue`, and `abortableDelay` moved next
to `withTimeout` in `concurrency.mjs`. `httpErr`/`statusFor` moved to
`gateway-errors.mjs` — without that the extracted clients would have dragged
the whole of `index.mjs` behind them. The generation normalisers moved to
`internal-generation-contracts.mjs`; the service imports the 36 declarations it
actually uses and re-exports `filterStableTraits` and
`fallbackProfileDescription` so existing importers keep working.

`index.mjs` 2,516 → 2,068 lines; `internal-generation-service.mjs` 2,810 →
1,089.

## Option D — give the flat directory a shape — DONE

154 files in one folder with names as the only grouping (`book-analysis-*` alone
is 30 files / 10,452 LOC). Move to bounded contexts: `analysis/`, `catalog/`,
`search/`, `media/`, `tts/`, `db/`, `platform/` (http, env, security, logging).

Mechanical and verified by the existing 111 test files. Must land as its own
commit with zero behaviour change, otherwise the diff hides everything else.

Effort ~1 day. Risk low, but a large diff.

**As implemented.** 126 modules moved into `analysis/`, `books/`, `catalog/`,
`search/`, `generation/`, `providers/`, `tts/`, `db/` and `platform/`;
`index.mjs` stays at the root because it is the image entrypoint. No renames,
so git records all 126 as renames and the commit is +402/−391 across 240 files.

Three things did not move mechanically:

- six modules read sibling assets through `import.meta.url` (`operator-ui`,
  `migrations`, `data`, `cover-generation-config.json`, the Sber certificates);
  those URLs moved up one level.
- `seed-book-catalog.mjs` resolved `CATALOG_MANIFEST` against its own
  directory, so an operator's relative path would have silently changed
  meaning. It now resolves against the service root explicitly.
- the Dockerfile copied `*.mjs`, which after the move meant `index.mjs` alone —
  the image would have shipped with no application code. All nine directories
  are now copied.

A static check confirms all 513 relative specifiers in the service resolve.

## Option E — shrink the config surface — DONE

~400 env names is the single biggest obstacle to running the backend. Option A
removes 20 of them. Beyond that: one startup configuration module that parses
and validates everything once and fails fast, replacing the scattered
`parseEnvInt`/`parseEnvBool` calls executed at import time in every runner.

Effort ~2 days. Risk low. The payoff is operational rather than code size.

**As implemented.** `gateway-config.mjs` exposes `loadGatewayConfig(env)`: the
environment arrives as a parameter, every check runs once at startup, and the
result is frozen. `index.mjs` destructures it, so none of the identifiers used
across its routes changed and the move carries no behaviour diff. Fourteen
imports became dead and were removed, including `coverRouteReadiness`, which
`index.mjs` had already stopped using before this work.

## Option F — the generation HTTP hop: keep it

Workers call the gateway over HTTP (`GENERATOR_BASE_URL` points at the gateway,
which mounts `/internal` in the same process as the public API) instead of
importing the generation service directly. This looks like pure overhead — same
image, same database credentials — but it is the only thing keeping **provider
API keys out of worker containers**. Collapsing it would save ~270 LOC (client,
router, service token) and cost a real credential boundary.

Recommendation: do not. Recorded here so the option is on file as considered
and rejected.

## Minor items

- Duplicate migration numbers: three `018_*`, two `020_*`. Ordering is `.sort()`
  on filename (`postgres-runtime.mjs:77`), so it is deterministic and **not a
  live bug**, but it is an authoring hazard.
- 1,582 LOC of overlapping deploy bash (`deploy.sh` 447, `deploy-remote.sh` 363,
  two `prepare-*` scripts at ~250 each) could collapse into one parameterized
  script. Low priority.

## What is left

Nothing from this document. The remaining items are the two minor ones below,
plus the throughput question that Option A deliberately left open: whether a
single analysis worker keeps up in production, or whether the
`book-analysis-pool` profile needs to be switched on.

## Recommended sequence

1. **A** — biggest operational win, lowest risk, and the code already
   demonstrates the pattern.
2. **C** — makes the two god-files approachable before anyone else edits them.
3. **D** — structural move, its own commit, no behaviour change.
4. **B** — the real refactor; do it once the layout is stable.
5. **E** — continuous, though A already delivers part of it.

Net effect of 1–4: roughly −2,000 LOC, 15 → 10 containers, one queue
implementation instead of five, and no file above ~1,200 LOC.
