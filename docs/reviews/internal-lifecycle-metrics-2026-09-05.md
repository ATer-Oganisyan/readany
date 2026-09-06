# Operator-only internal chat lifecycle metrics

`GET /v2/admin/metrics` now adds `internalChatLifecycle` with exactly four
numeric aggregates: `active`, `waiting`, `limit`, `queue_limit`. Existing operator
authentication remains mandatory; public `/health` is unchanged. No book, user,
request, provider-error or accounting payload is exposed.

The counters are sampled after the awaited repository snapshot, immediately
before response serialization. Slow metrics SQL therefore cannot freeze the
lifecycle count at the earlier provider snapshot. This is a point-in-time gauge,
not an atomic view spanning SQL and provider counters. The route still depends
on PostgreSQL and cannot provide continuous monitoring while that query hangs.

Actual `completeInternalChat` and route registrations from `index.mjs` execute in
a loopback HTTP test using real Express/auth/gates, controlled provider response
and delayed accounting/repository boundaries. RED: field absent. GREEN verifies
cap1 pending ledger (`provider active=0`, `lifecycle active=1`), rejection before a
second provider call, awaited accounting completion, late sample becoming zero,
unauthenticated/wrong-token rejection, and no public-health expansion. An extra
private sentinel in the mocked gate status verifies explicit field projection.

No admission/release semantics changed. No shared server, database, real provider
or device was used. This adds observability for isolated mixed-load QA, not a
throughput or durability guarantee.

```sh
node --test services/narra-gateway/test/internal-lifecycle-metrics.test.mjs services/narra-gateway/test/internal-chat-cost-permit.test.mjs services/narra-gateway/test/operational-metrics-repository.test.mjs
```
