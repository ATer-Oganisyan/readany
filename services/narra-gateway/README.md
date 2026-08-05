# Narra gateway

The server-side Narra boundary for ReadAny. It owns installation authentication,
provider credentials and routing, logical request telemetry, provider-attempt
telemetry, and the durable outbox to the Narra Traction module.

## Analytics delivery contract

Set both variables together:

```text
TRACTION_INGEST_URL=https://stats.multitool.works/p/narra/events
TRACTION_INGEST_TOKEN=<write-only token>
ANALYTICS_ENV=production
ANALYTICS_HMAC_SECRET=<independent random secret>
```

The gateway replaces installation IDs with HMAC actor IDs before delivery.
It never accepts analytics properties containing book text, titles, prompts,
answers, filenames, URLs or media. Delivery is at-least-once: events enter a
bounded segmented outbox, retry with backoff, and invalid poison events are
isolated in a bounded dead-letter area.

`GET /health` exposes `analytics_delivery.configured`, backlog size, overflow,
dead-letter count and last delivery outcome. Production is not analytics-ready
until `configured` is true and a canary event reaches the stats module.

## Local verification

```bash
npm install
npm test
```

Copy `.env.example` to `.env` only for local development. Secrets belong in the
deployment environment and must never be committed or shipped to the Expo app.
