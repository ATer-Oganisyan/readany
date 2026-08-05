# Narra product analytics

## Data path

```text
ReadAny Expo client
  -> authenticated Narra gateway
  -> privacy validation + HMAC actor pseudonym
  -> durable Traction outbox
  -> ReadAny/stats/narra
  -> Traction module and Metrics Delivery
```

Reading history and detailed personal reading reports remain local in
`packages/core`. Central analytics receives only the closed event contract.

## Ownership

- Expo records product lifecycle, character discovery/chat entry, character
  analysis and media-job outcomes. Its persistent queue is bounded to 1,000
  events, flushes in batches of 100 and retains events for at most 31 days.
- The gateway is authoritative for logical AI request outcomes, provider/model
  attempts, latency, fallback, token usage and observed cost. One user action
  has one `request_id` across retry and cross-provider fallback.
- The stats module derives active users, sessions, funnels, cohorts, retention,
  reliability and typed product metrics. Technical attempts never count as
  separate user value.

## Canonical metrics

- DAU: unique actors with qualified reading or an explicit user-origin Narra
  action on the current `Europe/Moscow` date.
- WAU: the same active definition in the current Moscow ISO week.
- MAU: the same active definition across the rolling last 30 Moscow dates.
- Sessions / DAU: explicit session IDs, with a 30-minute gap fallback only when
  an event lacks a session ID.
- Tools / DAU: unique user-origin logical AI `request_id` values today divided
  by today's DAU.

## Product metrics

| Stable ID | Definition |
| --- | --- |
| `product.narra.value_wau` | Unique actors receiving a successful user-origin Narra result in the current Moscow ISO week. |
| `product.narra.activation_7d` | Share of mature first app-open cohorts receiving a successful Narra result within seven days. |
| `product.narra.value_retention_d7` | Share of mature first-value cohorts receiving another successful Narra result at least seven days later. |

The detailed dashboard also exposes request success and outcome coverage,
p50/p95 latency, fallback rate, attempts per request, provider/model breakdown,
token and exact-cost coverage, feature adoption, funnels, ingest lag, freshness
and schema coverage.

## Privacy rules

Never send book titles or text, chapter text, excerpts, prompts, responses,
chat messages, memory, filenames, file paths, URLs, image/audio content or raw
installation identifiers. Add a property only by changing the closed client,
gateway and stats allowlists together and covering the change with tests.

The stats module supports token-protected `POST /delete` for erasing one HMAC
actor. Traction exposes it only through the dedicated 1 KiB privacy route.

`EXPO_PUBLIC_NARRA_ANALYTICS_TIER` supports `none`, `essential` and `extended`.
The default matches the previous Narra product behavior (`extended`); setting
`essential` keeps only lifecycle, book-open and qualified-reading events.

## Release gate

Before considering analytics operational:

1. Configure matching production `TRACTION_INGEST_URL`, token and environment
   on the gateway; the token never belongs in the client.
2. Confirm gateway `/health` reports delivery configured, no overflow/dead
   letter growth, and a recent successful delivery.
3. Send a canary product event and verify it appears once in Narra `/summary`.
4. Run the Narra stats tests and Traction's Narra contract cases.
5. Alert on outbox backlog age/bytes, overflow, dead letters, stats freshness,
   request outcome coverage and schema/request-ID coverage.
