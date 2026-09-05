# Mixed-load acceptance plan — not measured capacity

The native loop and unit tests do not establish capacity for thousands of daily
users. No completed mixed-load runner or production capacity result is claimed.
This plan was independently reviewed against the current gateway tests/routes.

## Isolation and workload

Use one isolated gateway writer, a unique PostgreSQL database, MinIO bucket and
gateway data directory, with actual HTTP routes, repository, workers and storage
adapter. Use locally controlled provider stubs and explicit child environment
allowlists: no inherited provider credentials, no production/TEST writes, no paid
model load. Preserve default SSRF protections. URL-import transport remains a
separate test; do not allow localhost fetching just to make this load test pass.
Docker is optional: existing local PostgreSQL/MinIO can host uniquely named QA
resources if isolation and process resource measurement are retained.

Initial hypotheses, **not analytics-derived requirements or measured results**:
1,000 daily identities, 100 concurrently reading clients, then a 2× control.
Open-arrival-rate traffic avoids hiding backlog when the service slows down:

| Stream | Nominal peak hypothesis | Separate burst |
| --- | --- | --- |
| New imports | 30 books/hour, mixed sizes | 10 uploads |
| Dialogues | 600 messages/hour | 40 messages |
| Speech | 800 chunks/hour | 20 starts |
| Scenes | 120/hour | 20 distinct, plus 64 duplicates of one request |

Prepare identities outside the measured phase, without changing production
registration limits. Record code SHA, seed, resource limits, exact file sizes,
chunk counts and configuration. Reading requests include content, manifest and
character preview; foreground assistant/character chat runs alongside real
background analysis. Run complete creation/upload/publication, not preinserted
finished-job rows. The speech stub needs valid audio and the actual configured
transport, not just a 200 response with arbitrary bytes.

## Phases and proposed gates

1. One complete book lifecycle preflight.
2. Ten-minute warm-up, two-hour nominal run, fifteen-minute 2×/burst run.
3. Faults: provider 429/503, stalled bodies, client cancellation, worker restart.
4. Stop arrivals, drain jobs/transfers, verify persisted data and cleanup.

Measure per-route admission/TTFB/complete p50/p95/p99, separating injected model
delay; gateway/worker RSS and CPU; active/waiting; oldest job age and completion
distribution by owner; retries, aborted bytes, duplicate publications and orphan
storage. The added operator-only `internalChatLifecycle` gauge distinguishes
pending accounting from provider-active work; public health remains unchanged.
Use the updated gateway code when measuring it, and remember that the admin
metrics route itself awaits SQL and is not a database-independent watchdog.

Proposed acceptance: zero lost sources, cross-owner access, duplicate publication
or cap violations; nominal queues do not grow indefinitely; small books progress
beside a large book; overload fails explicitly within bounded queues; all active
and waiting work drains. Initial local metadata/content targets are p95 ≤500 ms,
p99 ≤1 s; foreground admission p95 ≤2 s under the declared nominal stub profile.
No linear post-warm-up RSS growth; retain 25% resource headroom. These targets
must be evaluated, not described as already achieved.

Analysis amplification is a major risk: hypothetically 250 scans/book ×30 books/h
requires 7,500 calls/h before profiles, while ten slots at ten seconds/call offer
only 3,600 calls/h. Measure actual task amplification and backlog; do not shrink
the corpus until a nominal run looks green.

Cleanup is confined to the run's manifest/UUID resources and follows stopped
workers/transfers and lease checks. Preserve artifacts and manifest on failure.
A stub pass proves infrastructure behavior only, not real model quality, cost,
voice quality, provider latency or native UI responsiveness. Distributed quotas,
backup/restore and signed-device acceptance remain separate release gates.
