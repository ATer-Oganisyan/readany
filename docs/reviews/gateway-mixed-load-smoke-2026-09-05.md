# Isolated mixed HTTP smoke — not capacity acceptance

Run from the repository root:

```sh
node scripts/qa/gateway-mixed-load-smoke.mjs
node scripts/qa/gateway-mixed-load-smoke.mjs --run-smoke
node --test scripts/qa/gateway-mixed-load-smoke.test.mjs
```

The default only describes the run. Explicit execution starts the actual gateway
in a child process on a fresh loopback port, with a local provider stub and a new
private temporary data directory. The environment is explicitly allowlisted;
existing database URLs, provider credentials and shared gateways are not used.
No PostgreSQL, S3, book worker, import, speech or real model is exercised.

## Behavioral assertions

- Hold 22 background calls: ten active and twelve waiting. One more background
  request fails with 429; both interactive stream and complete requests still
  succeed through reserved capacity.
- Invalid input returns 400 without changing held active/waiting counts.
- Abort held requests, inject provider 503, cancel a stalled HTTP 200 body.
- Hold eleven foreground requests with four more queued. A reserved background
  request and its queued successor must both complete while all foreground
  requests remain held. Verify the remaining counts are exactly eleven/four.
- Launch 40 mixed requests at 5 ms intervals without awaiting each completion.
  Accepted requests complete with 200; bounded-queue overload may return 429.
  Record completed/rejected counts separately, including background requests.
- Actual upstream concurrency never exceeds twelve, sampled queue never exceeds
  sixteen; gateway and upstream work drain completely.
- Run the existing internal lifecycle metrics HTTP regression separately. Its
  pending ledger is controlled in memory and the actual gateway method is used;
  this is explicitly **not** an actual PostgreSQL accounting failure test.

Evidence is retained in a private `narra-mixed-load-*` temporary directory:
report, per-request samples, public gate samples, gateway RSS and ledger TAP.
Only the run-owned gateway credential data is removed, after the child stops.
Child termination escalates from TERM to KILL under a six-second deadline.
Requests are bounded to eight seconds; failed drain is an error, not a pass.

## First observed run

Base SHA `7403957f8bd54d303e541ca49a3f677f9ad78856` plus the uncommitted smoke.
67 measured chat requests: 42 successful, one explicit overload, one injected
503, 23 deliberate aborts. Provider peak twelve; sampled queue peak sixteen;
final active/waiting zero. Gateway RSS peak 139,472 KiB over seventeen samples.
Stream completion p95 314.28 ms/p99 318.57 ms; complete-route completion p95
309.68 ms/p99 325.01 ms. Stub adds 20 ms before headers and 100 ms before body
completion; these are local diagnostic observations, **not production targets**.
The invalid-body check was subsequently added outside those 67 measured chats.
Node 24 and Node 22 behavioral runner tests: two passed on each, including actual child cleanup and
private evidence permissions.

## Remaining acceptance

This second-scale run neither establishes RSS stability nor owner/job fairness,
thousand-DAU capacity, model quality, cost, native responsiveness or throughput of
analysis. Continue the separate mixed-load acceptance plan with explicitly owned
PG/S3 fixtures, actual jobs/publication, worker faults, long open-arrival traffic,
CPU and oldest-job age. The present fairness assertion only proves background
request progress beside explicitly held foreground HTTP requests. No external resources were
created, no live provider was called and nothing was deployed.

## CI regression and deterministic fairness check

Gateway run33977175887 on `ac74deb` passed the main 849 PostgreSQL/S3 tests,
but failed the separate mixed smoke assertion that every background burst
request must return 200. The 47-test job finished with 46 PASS / 1 FAIL.
Increasing the controlled provider body delay to600ms reproduced the failure:
the open arrival stream legitimately exceeds the bounded queue. A previous
all-200 observation is retained above, not treated as a universal guarantee.

The explicit held-request barrier now tests background progress independently
of burst timing. The burst still rejects unexpected statuses and must include
successful background work. Injecting a503 into the reserved background request
must fail the fairness gate; failure samples are retained and owned child/data
resources are cleaned. Production concurrency and queue limits are unchanged.

A second controlled burst holds all upstream responses until all forty arrivals
are accounted for. At least twelve must be rejected by the twelve-active /
sixteen-waiting hard cap before any response is released. This tests overload
without assuming a fast arrival loop or a particular provider delay. Foreground
and background reserve checks use separate explicit barriers.

Independent review additionally reproduced client EOF preceding the server's
permit release. The fairness check now waits for the exact eleven-active /
four-waiting settled state, while continuously checking held foreground requests.
It does not issue retries or relax the expected counts.
