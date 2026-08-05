# Narra module for Traction

Independent FastAPI + SQLite product analytics module for `stats.multitool.works/p/narra/`.

- `GET /health` — liveness and deployed version
- `POST /events` — token-protected gateway ingest with dedupe by `event_id`
- `POST /delete` — token-protected erasure of one pseudonymous analytics actor
- `GET /summary?days=N` — Traction core plus canonical six metrics
- `GET /dashboard?days=N` and `GET /` — Narra product dashboard
- `GET /monitors` — authenticated domain/endpoint availability, latency and TLS

The module accepts only HMAC-pseudonymous actors, opaque IDs and a closed
property allow-list. Content, prompts, answers, titles, filenames, URLs and
media are not accepted.

Local run:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
STATS_ENVIRONMENT=development STATS_ALLOW_UNAUTHENTICATED_INGEST=1 .venv/bin/python server.py
```

Production variables:

```text
STATS_PORT=9905
STATS_ENVIRONMENT=production
STATS_DB=/srv/stats/narra/data/events.db
STATS_INGEST_TOKEN=<write-only random token, at least 32 characters>
STATS_TRUST_LOOPBACK_PROXY=1
STATS_COST_CURRENCY=USD
STATS_MONITOR_ENABLED=1
STATS_MONITOR_INTERVAL_SECONDS=60
STATS_MONITOR_TIMEOUT_SECONDS=5
STATS_MONITOR_RETENTION_DAYS=30
```

On i167 the token belongs in root-owned `/etc/stats/narra.env` (`0600`), not
in the repository or the systemd unit. The deploy script installs/refreshes
the unit but preserves that environment file.

The canonical i167 service binds to `127.0.0.1` and may set
`STATS_TRUST_LOOPBACK_PROXY=1`, because Caddy is the only network entry and
already enforces Traction's shared Basic Auth. Startup rejects this mode on a
non-loopback bind. Any directly reachable deployment, including Railway, must
leave this flag off and set `STATS_READ_USERNAME` plus a random
`STATS_READ_PASSWORD` of at least 32 characters.

The Railway gateway receives matching `TRACTION_INGEST_URL` and
`TRACTION_INGEST_TOKEN`. There is intentionally no legacy analytics import:
the module accepts only events produced through the new closed contract and
does not read data or source code from the retired Narra repository.

## Domains and critical endpoint monitoring

The production stats process runs fixed-target HTTPS probes independently of
product telemetry and stores only coarse operational samples: target ID, state,
HTTP status, latency, TLS days remaining and an enumerated error code. Response
bodies are bounded to 64 KiB and are never persisted. Redirects are not
followed, and HTTP clients cannot supply a URL, so `/monitors` is not an SSRF
proxy. Each probe runs in a disposable child process that is forcibly terminated
at the absolute deadline. DNS answers are checked for public addresses and the
HTTPS connection is pinned to a checked address while retaining hostname/SNI
verification.

Default targets:

- `https://api.narra.disrupt.builders/health` — production gateway;
- `https://narra-staging.multitool.works/ready` — staging gateway readiness;
- `https://stats.multitool.works/p/narra/health` — production analytics;
- `https://stats-narra-staging-staging.up.railway.app/health` — staging analytics.

The reviewed production placeholder is deliberately classified as `standby`
only when it returns the exact reviewed `503` JSON contract; it remains
available but not live. Staging `/ready` with a non-empty `degraded` list is shown as
`degraded`, not falsely green. Every target exposes current HTTP/latency/TLS
data plus 1-hour, 24-hour and 7-day availability, scheduled-probe coverage and
p95 latency. Missed scheduled checks reduce availability, so one fresh probe
after monitor downtime cannot make an unobserved window look 100% healthy.

Targets may be changed only through root/Railway environment configuration:

```text
STATS_MONITOR_PRODUCTION_GATEWAY_URL
STATS_MONITOR_STAGING_GATEWAY_URL
STATS_MONITOR_PRODUCTION_ANALYTICS_URL
STATS_MONITOR_STAGING_ANALYTICS_URL
STATS_MONITOR_INTERVAL_SECONDS=60
STATS_MONITOR_TIMEOUT_SECONDS=5
STATS_MONITOR_STALE_AFTER_SECONDS=180
STATS_MONITOR_RETENTION_DAYS=30
```

All overrides must remain public, credential-free HTTPS URLs on the default
port, without query strings or redirects. Production monitoring is
enabled by default; staging is disabled by default to avoid duplicate probes
and may be enabled explicitly for an isolated test. This in-dashboard monitor
does not replace an external alerting service: UptimeRobot or another
out-of-process monitor should still watch production gateway and analytics
health so an outage of the stats process itself is observable.

The stale threshold defaults to three configured probe intervals. If the
runner stops and a sample ages past that threshold, the target becomes `down`
with `STALE`; `/health` exposes monitor state, freshness and oldest sample age
without making product events depend on the monitor.

The reviewed production deploy path serializes deploys with remote `flock`,
rechecks the expected remote version and server hash immediately before the
atomic app swap, backs up the systemd unit and makes an online SQLite backup.
Application and unit roll back automatically on a failed probe. The database
backup is recovery-only: this release adds only backward-compatible tables and
indexes, so the previous application can safely continue using the same
database after rollback.

## Overview and tool semantics

The Traction Overview keeps the canonical six-field contract:
`ever_used`, `dau`, `wau`, `mau`, `sessions_per_dau` and `tools_per_dau`.
`ever_used` is a legacy field name whose fleet meaning is lifetime distinct
pseudonymous actors. The dashboard labels it **Known users** and keeps it equal
to top-level `installs`, so it cannot be lower than DAU. Observed book openers
and seven-day activation are separate product metrics; they may undercount while
older clients are visible only through server-side AI traffic.
DAU uses the current `Europe/Moscow` calendar date, WAU the current Moscow ISO
week and MAU the rolling last 30 Moscow dates. Both ratios use numerators from
the same current Moscow date as the DAU denominator, regardless of the period
selected in the detailed dashboard.

For Narra, the selected `Tools / DAU` definition is **logical AI requests per
calendar-day DAU**. Retry and cross-provider fallback share a `request_id` and count
once. The detailed dashboard deliberately shows five alternatives alongside
the selected formula:

- provider attempts per calendar-day DAU;
- logical AI requests per active user-day;
- explicit product actions per active user-day;
- distinct feature breadth per active user-day;
- completed value proxies per active user-day.

This keeps the Overview stable while making the product choice visible. A
technical attempt metric must not silently replace a product-usage KPI.

The product layer also publishes stable Metrics Delivery cards:
`product.narra.value_wau`, `product.narra.activation_7d` and
`product.narra.value_retention_d7`. Value means a successful user-origin Narra
result; provider retries and fallbacks never create additional value events.

The diagnostic section is separate from Overview. It includes average DAU over
available days, depth per user-day, feature-classification coverage, freshness,
ingest lag p50/p95, explicit errors, request-ID coverage and client telemetry
coverage. The AI section shows average, median and p95 for both completed-request
latency and input-plus-output tokens, alongside the measured sample size and
coverage. Average supports capacity planning, median describes a typical request,
and p95 exposes the slow or deep tail. The growing selected-window token total
remains a compact capacity/cost diagnostic with its exact value visible in the
card; it is not a headline adoption KPI. Slow-request rate, p99 latency and a
copyable opaque request-suffix table support log correlation without exposing
prompts or output. The table also separates input, output and total tokens and
highlights the most common task/route pair in the displayed slowest sample.

Request success uses matched `ai_request_started` identities. Completed or
failed outcomes enter immediately; a start without a terminal outcome enters
the denominator after a configurable grace window (420 seconds by default,
covering two sequential 180-second streaming attempts) as overdue pending. Orphan
terminal events are excluded and reported, while outcome coverage remains
visible. Provider attempts become successful only after the response body has
been fully consumed and parsed.

`Attempts / request` uses only terminal attempts matched to request starts in
the selected request cohort. Provider/model tables and attempt error rate keep
the separate technical event-window view; terminal attempts whose starts lie
outside the window are shown as boundary/unmatched and do not inflate the
cohort ratio.

Cost is observed-only. OpenRouter usage and LiteLLM usage/response headers are
accepted only with an explicit source and USD currency; missing or ambiguous
cost remains missing and lowers coverage instead of becoming zero.

All events in this dashboard are directly observed through the new contract.
There is no `mixed` or `reconstructed` history mode and no attempt to infer
events from the retired Narra client.
Days before collection starts are never rendered as artificial zeroes.

Staging uses a separate endpoint/database/token with
`STATS_ENVIRONMENT=staging`. The gateway sends the matching environment in a
server-controlled header; a mismatch is rejected before storage so staging
cannot silently pollute production metrics.

For the separate Railway staging service, first inspect `railway status --json`
and confirm the Narra project, `stats-narra-staging` service and `staging`
environment. Then deploy this directory with the target stated explicitly:

```bash
railway up stats/narra --path-as-root \
  --service stats-narra-staging \
  --environment staging
```

Never rely on the directory's current Railway link: this monorepo also deploys
the Narra gateway. `--path-as-root` makes `stats/narra` the uploaded root, so
`railway.json` pins the launcher and `/health` probe instead of letting
Railpack guess an ASGI module name. If the service is later connected directly
to GitHub, set its Config File Path to `/stats/narra/railway.json` explicitly; Railway
does not resolve that path relative to the service Root Directory.

Use a dedicated Volume mounted at `/data` and set:

```text
STATS_HOST=0.0.0.0
PORT=9905
STATS_ENVIRONMENT=staging
STATS_DB=/data/events.db
STATS_INGEST_TOKEN=<staging-only random token, at least 32 characters>
STATS_READ_USERNAME=<staging dashboard operator>
STATS_READ_PASSWORD=<staging-only random password, at least 32 characters>
STATS_COST_CURRENCY=USD
STATS_ALLOW_UNAUTHENTICATED_INGEST=0
```

Railway may assign `PORT`; it takes precedence over `STATS_PORT`, which remains
the fallback for non-Railway hosts. The public domain must route to the actual
listen port. The staging token, database and Volume must never be shared with
production.

The app itself protects `/`, `/summary` and `/dashboard` with HTTP Basic Auth;
this prevents the direct Railway domain from bypassing Traction's access
control. `/health` stays public for Railway and `/events` keeps its independent
write-only ingest token. Production Traction may terminate the same Basic Auth
at its reverse proxy, but direct access to this service must remain protected.

The dashboard reads the bounded analytics history into memory for rolling
retention. Browser and hub bursts are collapsed by a 15-second in-process cache,
which is invalidated immediately after event ingestion or privacy deletion.
Responses expose `Server-Timing` and `X-Narra-Stats-Cache` for performance
diagnosis. Before high-volume traffic, replace the raw-history calculation with
SQL aggregates plus an explicit retention/pruning policy; the 512 MiB service
limit is a safety stop, not a scaling design.

The deploy script keeps application code and its virtualenv root-owned; only
`/srv/stats/narra/data` is writable by `gigatool`. Before a high-availability
production rollout, replace in-place rsync with versioned releases plus an
atomic current symlink and rollback.
