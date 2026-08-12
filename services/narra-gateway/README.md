# Narra gateway

The server-side Narra boundary for ReadAny. It owns installation authentication,
provider credentials and routing, logical request telemetry, provider-attempt
telemetry, and the durable outbox to the Narra Traction module.

The staged book-markup backend contract is documented in
[`docs/book-markup-backend.md`](../../docs/book-markup-backend.md). Its first
PostgreSQL schema is in [`migrations/001_book_markup.sql`](migrations/001_book_markup.sql).

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

The book-markup migration and worker are separate processes:

```bash
npm run migrate:book-markup
npm run worker:book-markup
```

After deploying markup schema v2, enqueue legacy editions once with:

```bash
npm run backfill:book-markup
```

Permanently failed jobs are not duplicated by reader traffic. After correcting
the provider or configuration failure, retry a bounded batch explicitly:

```bash
npm run retry:book-generation
```

They require `DATABASE_URL`, the Gateway's private Docker URL in
`GENERATOR_BASE_URL`, and an independent `GENERATOR_SERVICE_TOKEN`; see
`.env.example`. The same Gateway exposes `/internal/v1/book-markup` and
`/internal/v1/character-bundles`; these routes do not accept installation
tokens. The worker runs migrations again at startup safely, so parallel starts
do not apply the same migration twice.

Worker and internal generator logs are single-line operational messages. They
show the book/job identifiers, title, selected analysis chunk ranges, character
names, media stages, providers, byte sizes and durations without logging source
text, prompts, credentials or generated payloads. Follow both processes on i167:

```bash
sudo docker compose --env-file /srv/narra-stagging/compose.env \
  -f /srv/narra-stagging/compose.yml --profile book-backend \
  logs -f --tail=200 gateway book-markup-worker
```

### Parallel book analysis shadow pipeline

The v3 analysis is operator-only and does not replace the reader-visible v2
markup. Start one idempotent run for a verified stored book directly in the
Gateway container, inspect its stage/job counters, and read the final shadow
publication:

The complete architecture, evidence filtering rules, versioning contract,
failure handling, scaling guidance and operator runbook are documented in
[`docs/book-analysis-v3.md`](../../docs/book-analysis-v3.md).

```bash
docker compose exec gateway npm run book-analysis -- \
  start --book-edition-id <book-edition-uuid>
docker compose exec gateway npm run book-analysis -- \
  status --run-id <analysis-run-uuid>
docker compose exec gateway npm run book-analysis -- \
  result --run-id <analysis-run-uuid>
```

The isolated `book-analysis-shadow` profile has one service per pipeline stage.
Each service claims only its own PostgreSQL jobs, so replicas can be changed
independently without changing the Gateway or the mobile contract. For a test
environment, a typical initial allocation is:

```bash
docker compose --profile book-analysis-shadow up -d \
  --scale book-analysis-prepare=1 \
  --scale book-analysis-scan=3 \
  --scale book-analysis-resolve=1 \
  --scale book-analysis-synthesize=3 \
  --scale book-analysis-validate=1 \
  --scale book-analysis-publish=1
```

The profile is disabled by default. Starting its workers does not enqueue books;
only the explicit `start` command does that. The resulting publication remains
in the immutable `shadow` channel and is not exposed by the public book API.

Stable `event` values such as `markup.chunk_selected`, `markup.published`,
`bundle.asset_ready`, `job.retry_scheduled` and `job.failed` can be filtered with
ordinary log tools.
An idle worker reports that it is alive at `BOOK_MARKUP_IDLE_LOG_MS` intervals
(five minutes by default), without writing a line on every queue poll.

When `DATABASE_URL` is configured, Gateway enables the authenticated book API:
`GET /v2/books/catalog`, `POST /v2/books/resolve`,
`POST /v2/books/local`, `POST /v2/books/:bookEditionId/local-markup`,
`GET /v2/books/:bookEditionId/manifest` and
`POST /v2/books/:bookEditionId/progress`. Future characters and partial media
are never included in a reader manifest.

User book sources remain on-device. Registration sends only hash and metadata;
local analysis publishes only derived character profiles. Generated private
media is served through `GET /v2/books/:bookEditionId/media/:assetId/download`
and expires after `PRIVATE_MATERIAL_TTL_DAYS` of inactivity. The source download
route is available only for catalog books.

Catalog uploads require the independent `CATALOG_INGEST_TOKEN`:
`POST /v2/admin/catalog/books/uploads`, the returned raw content path, and the
returned completion path. Catalog source files must be kept outside the
repository and supplied through an operator-owned manifest:

```bash
CATALOG_BASE_URL=https://api-test.narra.disrupt.builders \
CATALOG_INGEST_TOKEN='<secret>' \
CATALOG_MANIFEST=/secure/path/catalog.json npm run seed:catalog
```

Paths in that manifest are resolved relative to the manifest itself. Neither
the manifest nor the source books are shipped with the application. A manifest
book may include `cover` and `cover_mime_type`; the seeder uploads that image
through the separate cover prepare/content/complete flow. Public clients receive
only checksum, size, MIME type and an authenticated cover download path.

When MinIO is reachable only inside Compose, keep `BOOK_STORAGE_ENDPOINT` on
the internal service address and set `BOOK_STORAGE_PUBLIC_ENDPOINT` to the HTTPS
origin exposed by Caddy. Gateway uses the internal client for object operations
and the public client only for short-lived signed URLs.

The Expo client persists the last successful catalog response and verified
covers under its Documents directory. Selecting a catalog item downloads the
source through a short-lived signed URL, verifies SHA-256, imports it into the
local library and removes the temporary download. Reader-visible character
profiles and their complete media bundles are likewise cached after manifest
materialization, so already fetched data remains available offline.

Completion queues full markup jobs, so run this only when provider usage is
intended. S3/MinIO credentials remain server-side.

Reader progress now uses `progress_fraction`; Gateway derives the canonical
text offset from the v2 markup's `text_length`. Legacy `text_offset` requests
remain valid but the two fields cannot be sent together.

Set `BOOK_BACKEND_REQUIRED=true` only after PostgreSQL, storage, the internal
Gateway token and the worker are configured. `/ready` then probes PostgreSQL,
bucket access and the presence of the internal generator. The i167 Compose file
runs a private MinIO service, creates its bucket and non-root application user,
and starts the `book-backend` worker profile when that flag is enabled. Railway
needs a separate worker process using
`node book-markup-worker.mjs`; its HTTP health check should target `/ready` on
the Gateway service.

Copy `.env.example` to `.env` only for local development. Secrets belong in the
deployment environment and must never be committed or shipped to the Expo app.

## i167 production

The current production inventory, Railway retirement state and staging policy
are recorded in [`docs/narra-infrastructure.md`](../../docs/narra-infrastructure.md).
This directory is the canonical gateway source; do not redeploy the historical
copy from the standalone Narra repository.

Production is a single Docker replica behind Caddy on `127.0.0.1:8788`. The
file-backed installation registry and analytics outbox live in the external
`narra_gateway-data` volume. Two production writers must never mount that volume
at the same time.

The first migration from the legacy `/srv/nara` deployment creates a filtered,
root-only environment file and keeps all stable installation secrets:

```bash
REMOTE=max@158.160.163.167 ./bootstrap-i167.sh
```

Deploy only a clean, reviewed commit and pin the exact currently running image
ID as a compare-and-swap precondition:

```bash
EXPECTED_REMOTE_IMAGE_ID="$(ssh max@158.160.163.167 \
  "sudo docker inspect --format '{{.Image}}' narra-gateway-1")"

REMOTE=max@158.160.163.167 \
EXPECTED_REMOTE_IMAGE_ID="$EXPECTED_REMOTE_IMAGE_ID" \
REVIEWED_COMMIT="$(git rev-parse HEAD)" \
./deploy-i167.sh
```

The deploy builds an immutable image tagged by commit, creates and validates a
volume backup, runs the candidate against a cloned volume on localhost port
`8789`, and only then replaces the container on port `8788`. Caddy and the
public hostname do not change. A failed production probe restarts the previous
image automatically.

`narra-gateway-backup.timer` creates daily root-only volume archives with
14-day retention. A restore must be performed while the gateway is stopped:

```bash
sudo docker run --rm --network none --user 0:0 --entrypoint sh \
  -v narra_gateway-data:/data \
  -v /srv/backups/narra-gateway:/backup:ro \
  readany/narra-gateway:<reviewed-commit> \
  -c 'tar -xzf /backup/<archive>.tar.gz -C /data && chown -R 1000:1000 /data'
```

The secret file is `/etc/narra-gateway.env` with mode `0600`. Do not reuse the
gateway signing secret as the analytics HMAC secret and do not copy Stats read
credentials into the gateway container.
