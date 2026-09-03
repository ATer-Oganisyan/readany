# Narra gateway

The server-side Narra boundary for ReadAny. It owns installation authentication,
provider credentials and routing, logical request telemetry, provider-attempt
telemetry, and the durable outbox to the Narra Traction module.

The staged book-markup backend contract is documented in
[`docs/book-markup-backend.md`](../../docs/book-markup-backend.md). Its first
PostgreSQL schema is in [`migrations/001_book_markup.sql`](migrations/001_book_markup.sql).

## LLM request parameters

The Gateway, not the client, owns model sampling and reasoning parameters. The
legacy `temperature` field is still accepted by `/v2/ai/chat/stream` and
`/v2/ai/chat/complete` for mobile compatibility, but its value is ignored.

[`model-request-config.mjs`](model-request-config.mjs) is the source of truth for
provider/model capabilities and purpose-specific defaults. Unknown models get
no optional sampling parameters. The currently configured GPT-5.6 Luna routes
use `temperature: 0.85` together with `reasoning_effort: none` for
`character_chat`; structured analysis, summaries, scenarios and memory omit
temperature and keep the model's default reasoning behavior.

The text configuration covers both current proxy/model identifiers:

- `giga:gpt-5.6-luna`;
- `litellm:openrouter/openai/gpt-5.6-luna`.

Text routes accept only the logical providers `giga` and `litellm`. The second
route has independent `LITELLM_BASE_URL`, `LITELLM_API_KEY` and
`LITELLM_MODEL[_<PURPOSE>]` settings, so an OpenRouter-backed model is reached
through LiteLLM without sharing the direct OpenRouter image credential or
OpenRouter-specific request fields. Covers independently select
`COVER_IMAGE_PROVIDER=litellm|openrouter`. The LiteLLM image route uses
`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_IMAGE_MODEL` and the standard
`POST /v1/images/generations` contract; direct `OPENROUTER_*` remains a separate
compatibility route. Provider credentials never enter the mobile contract.

GPT-5.6 Luna's model and reasoning modes are documented by
[OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-luna), while
OpenRouter documents its OpenAI-style `reasoning_effort` shorthand in the
[chat-completions contract](https://openrouter.ai/docs/api/api-reference/presets/create-presets-chat-completions).

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

## Durable image jobs

Book covers use an authenticated, installation-owned job API:

- `POST /v2/media/cover/jobs` accepts bounded `book` metadata and creates or
  reuses a job by `request_id`;
- `GET /v2/media/cover/jobs/:jobId` polls status and returns the completed image;
- `POST /v2/media/cover/jobs/:jobId/ack` deletes a terminal job after the client persists it.

Job metadata and result files live under `DATA_DIR/cover-jobs-<environment>` on
the persistent volume. Running jobs return to the queue after a restart, result
retention defaults to 24 hours, and expired records are removed before capacity
checks and by the worker. The production worker must have a single writer;
deployment candidates start with `COVER_JOB_WORKER_ENABLED=false`.

The Gateway builds personal and catalog cover prompts from the same versioned
template, including genre art direction and a deterministic background palette.
All new personal and catalog cover jobs use GPT Image 2 with Nano Banana 2
fallback through the configured `COVER_IMAGE_PROVIDER`; Kandinsky is not part of
the cover route.
The APK sends no prompt, provider key or model. Catalog covers use PostgreSQL
`catalog_cover` jobs and are copied idempotently to object storage before
`catalog_book_covers` is marked ready. Client-authored prompts are accepted only
for already released clients by the durable job endpoint and the compatibility
`/v2/media/cover` route.

Manual scenes created from reader-selected text use the legacy parallel
`/v2/media/scene/jobs` API. The client sends bounded book/chapter facts, while
the Gateway owns the prompt, Kandinsky routing, retry, result retention and
acknowledgement. Scene metadata and results live under
`DATA_DIR/scene-jobs-<environment>` and use the `SCENE_JOB_*` limits.

Automatic reader scenes use `POST /v2/books/:bookEditionId/scenes/at`. The
client sends only its reading position; the Gateway resolves the stable scene
slot from the published v3 markup policy, reads the canonical normalized book
text, and returns either a signed ready image URL or the durable job status.
Catalog books warm all scene slots after final markup publication. Private
books initially warm the first 10% and extend that frontier to 10% beyond the
reader's reported progress. Provisional markup remains display-only until the
resolver has published the final markup.

## Durable book markup and catalog

The book-markup migration and worker are separate processes:

```bash
npm run migrate:book-markup
npm run worker:book-markup
```

After deploying markup schema v2, enqueue legacy editions once with:

```bash
npm run backfill:book-markup
```

Catalog genres use a fixed taxonomy of 20 IDs derived from the 500 EPUB files in
`narra-books-ru` and the 1000 EPUB files in `narra-books-en`. The explicit
book-to-genre table is checked in as `data/catalog-book-genres.json`; EN rows
retain their EPUB `dc:subject` evidence, while RU rows are explicitly marked up
from title and author because those EPUB files do not contain `dc:subject`.
There is no runtime LLM classification and no genre generation job.

Migration `016_book_genres.sql` creates the single many-to-many relation
`book_edition_genres` and fills it from that table, including aliases for legacy
staging catalog keys. Catalog ingestion applies the same hardcoded mapping to
books added after migrations run.

`GET /v2/books/catalog` exposes the additive `genres` array and nullable base
language code, for example `"genres": ["science-fiction", "romance"]` and
`"language": "ru"`. Old clients can ignore both fields. A missing language is
serialized as `null`; new clients must continue accepting it.

`GET /v2/books/catalog/languages/:language` is the versioned category contract.
`:language` is `ru` or `en`; the response identifies itself as
`book-catalog-language-v1` and uses a language-bound opaque cursor. A cursor
issued for one language is rejected for the other language.

`GET /v2/books/genres` exposes the complete normalized taxonomy independently
from the paginated book list. The authenticated response is versioned and keeps
both display languages explicit:

```json
{
  "version": "catalog-genres-v1",
  "items": [
    {
      "id": "science-fiction",
      "label_ru": "Научная фантастика",
      "label_en": "Science Fiction",
      "order": 4
    }
  ]
}
```

Permanently failed jobs are not duplicated by reader traffic. After correcting
the provider or configuration failure, retry a bounded batch explicitly:

```bash
npm run retry:book-generation
```

### Queue controls and operational metrics

Generation queues are paused through an explicit database state, never by
moving `available_at` to an arbitrary future date. Every command is a dry run
unless `--execute` is present, and a single command can affect at most 1000
jobs:

```bash
npm run operator:generation-queue -- status
npm run operator:generation-queue -- pause --job-type scene_image \
  --campaign-id recovery-canary --limit 25 --reason RECOVERY_CANARY --operator release-owner
npm run operator:generation-queue -- pause --job-type scene_image \
  --campaign-id recovery-canary --limit 25 --reason RECOVERY_CANARY --operator release-owner --execute
npm run operator:generation-queue -- resume --pause-id <uuid> --limit 25 \
  --reason RECOVERY_CANARY_RELEASE --operator release-owner
npm run operator:generation-queue -- resume --pause-id <uuid> --limit 25 \
  --reason RECOVERY_CANARY_RELEASE --operator release-owner --execute
```

Resume clears only the named pause in bounded batches and preserves every
job's original schedule. Persistent workers publish a database heartbeat keyed
by container ID, worker type and immutable build version. Their Compose health
check requires the process/container to be alive, PostgreSQL to be reachable
and the heartbeat to be no older than 60 seconds.

`GET /v2/admin/metrics` requires the dedicated `INSTALLATION_OPERATOR_TOKEN` as
a bearer token. It returns only aggregate queue/stage/error/latency/concurrency,
heartbeat and build-version data; it never returns book text, prompts, provider
credentials or signed object URLs.

They require `DATABASE_URL`, the Gateway's private Docker URL in
`GENERATOR_BASE_URL`, and an independent `GENERATOR_SERVICE_TOKEN`; see
`.env.example`. The same Gateway exposes `/internal/v1/book-markup` and
`/internal/v1/character-bundles`; these routes do not accept installation
tokens. The worker runs migrations again at startup safely, so parallel starts
do not apply the same migration twice.

Worker and internal generator logs are single-line operational messages. They
show the book/job identifiers, title, selected analysis chunk ranges, character
names, media stages, providers, byte sizes and durations without logging source
text, prompts, credentials or generated payloads. Follow both staging processes
on i167:

```bash
sudo docker compose --env-file /srv/narra-stagging/compose.env \
  -f /srv/narra-stagging/compose.yml --profile book-backend \
  logs -f --tail=200 gateway book-markup-worker
```

### Parallel book analysis pipeline

The v11 analysis pipeline produces canonical v3 markup. Its immutable audit
publication uses the internal `shadow` channel name, then atomically materializes
the reader-visible v3 revision and media jobs. Start one idempotent run for a
verified stored book directly in the Gateway container, inspect its stage/job
counters, read the publication, or create a new isolated rerun:

The complete architecture, evidence filtering rules, versioning contract,
failure handling, scaling guidance and operator runbook are documented in
[`docs/book-analysis-v3.md`](../../docs/book-analysis-v3.md).

```bash
docker compose exec gateway npm run book-analysis -- \
  start --book-edition-id <book-edition-uuid>
docker compose exec gateway npm run book-analysis -- \
  restart --book-edition-id <book-edition-uuid>
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
only ingestion, `start`, or an explicit `restart` enqueues analysis. The internal
`shadow` publication is the immutable audit source for the canonical v3 reader
projection; retained v2 rows are not selected by the mobile manifest.

Pipeline v17 scans paragraph-aware cores around 4,000 characters (2,500–5,000,
with 500 characters of context overlap). Before resolve can freeze a snapshot,
evidence must cover at least 75% of fixed 4,000-character bands and the result
must contain a confirmed non-metadata character. Relationship participants bind
to resolved character entity keys, including evidence-backed candidates; an
unresolved relationship is reported but does not reject the otherwise complete
book. One-off name mentions, collective labels and composite names do not enter
character synthesis, while an author copied only from front matter is rejected.
Deterministic quality failures stop immediately instead of repeating the same
resolve input. An incomplete replacement run fails without replacing the current
published revision. A new successful publication requeues failed media bundles
for its characters once; manifest reads do not repeatedly reset failed work.

The v6 scan extractor also retries a fragment instead of caching it when a
provider returns at least five observations but strict quote validation accepts
less than 25%. This catches locally lossy responses that whole-book band
coverage alone cannot detect.

Test environments can expose the latest shadow publication through the
authenticated `GET /v2/books/:bookEditionId/analysis-shadow/manifest` route by
setting `BOOK_SHADOW_PREVIEW_ENABLED=true`. The route is limited to catalog
books already accessible to the reader, applies the same progress-based
media authorization rule, and returns the complete published profile list.
Evidence stays private. The Expo development/preview builds then show a manual
v2/v3 switch on the book's character screen. Production builds do not enable
that switch.

Stable `event` values such as `markup.chunk_selected`, `markup.published`,
`bundle.asset_ready`, `job.retry_scheduled` and `job.failed` can be filtered with
ordinary log tools.
An idle worker reports that it is alive at `BOOK_MARKUP_IDLE_LOG_MS` intervals
(five minutes by default), without writing a line on every queue poll.

When `DATABASE_URL` is configured, Gateway enables the authenticated book API:
`GET /v2/books/genres`, `GET /v2/books/catalog`,
`GET /v2/books/catalog/languages/:language`, `POST /v2/books/resolve`,
`POST /v2/books/local`, `POST /v2/books/:bookEditionId/local-markup`,
`GET /v2/books/:bookEditionId/identity`,
`GET /v2/books/:bookEditionId/manifest` and
`POST /v2/books/:bookEditionId/progress`. A ready v3 manifest contains every
published character profile and its appearance anchor. The client applies its
local reading progress; media bytes are fetched lazily only for reached characters.

Book identity is a separate durable job and does not wait for character markup.
`GET /v2/books/:bookEditionId/identity` returns `202` with
`status: "processing"` and `poll_after_ms` until it is ready. A ready response is
`200` with the normalized `title`, `author`, normalization `source` and
`updated_at`. A terminal failed job is also returned as `200` with
`status: "failed"` and a safe `error_code`. Private editions are visible only to
their owning installation.

Private book registration sends hash and metadata first, then uploads the source
to owner-scoped temporary storage for canonical v3 analysis. The source and
generated private media expire after `PRIVATE_MATERIAL_TTL_DAYS` of inactivity.
Private source download is never exposed; the source download route is available
only for catalog books.

Prepared catalog text has two read contracts. `GET /v2/books/:bookEditionId/content`
returns a short-lived URL for the complete normalized text. `GET
/v2/books/:bookEditionId/content/chunks` returns the first UTF-8-safe text range;
pass its `next_cursor` back as the `cursor` query parameter to continue. A range
contains at most 90,000 characters (50 conventional 1,800-character pages),
never crosses a chapter boundary, and splits an oversized chapter across
successive ranges. `GET /v2/books/:bookEditionId/content/toc` returns the chapter
navigation and byte ranges. When a book has no embedded table of contents, the
reader falls back to consecutive fixed-size ranges without inferring chapters.
Both text contracts use the same immutable content hash. Private books are
intentionally excluded because their reader content remains on the user's
device. Existing prepared books can be populated with navigation by running
`npm run backfill:book-content-navigation`.

Catalog uploads require the independent `CATALOG_INGEST_TOKEN`:
`POST /v2/admin/catalog/books/uploads`, the returned raw content path, and the
returned completion path. Catalog source files must be kept outside the
repository and supplied through an operator-owned manifest:

```bash
CATALOG_BASE_URL=https://api-test.narra.disrupt.builders \
CATALOG_INGEST_TOKEN='<secret>' \
CATALOG_MANIFEST=/secure/path/catalog.json npm run seed:catalog
```

Each future manifest entry may carry `language`; `ru-RU` and `en-US`-style tags
are normalized to their base code. Existing manifests remain valid, and the
seeder also infers `ru`/`en` from `narra-ru-`/`narra-en-` catalog keys. Paths in
that manifest are resolved relative to the manifest itself. Neither
the manifest nor the source books are shipped with the application. A manifest
book may include `cover` and `cover_mime_type`; the seeder uploads that image
through the separate cover prepare/content/complete flow. Public clients receive
only checksum, size, MIME type and an authenticated cover download path.
When no separate catalog cover is uploaded, the durable cover worker first checks
the immutable EPUB or FB2 source. A valid embedded JPEG, PNG or WebP cover is
copied to permanent book storage; the image provider is called only when the
source has no supported embedded cover.

The password-protected book operations UI is served by the Gateway at
`/operator/`. Configure a dedicated `BOOK_OPERATOR_PASSWORD` of at least 20
characters and optionally `BOOK_OPERATOR_USERNAME` (defaults to `narra`). The
password must differ from every bearer/signing secret. The UI provides:

- live per-book progress across `prepare → scan → resolve → synthesize → validate → publish`;
- observed, resolved and published characters plus portrait/audio/animation status;
- a chronological analysis and generation operation log;
- formatted publication, artifact and canonical-markup JSON;
- an explicit per-book v3 restart that keeps the current publication active until the replacement passes validation;
- catalog book and cover upload with visible checksum, transfer and pipeline progress.

The browser upload routes and `/v2/admin/catalog/*` routes receive the same
`CatalogIngestService` instance. Both therefore use the identical verified
storage flow and `ensureAnalysisRun`; only Basic-authenticated browser entry and
Bearer-authenticated CLI entry differ. Live state is read from PostgreSQL every
two seconds and is never reconstructed from process memory or logs.

When MinIO is reachable only inside Compose, keep `BOOK_STORAGE_ENDPOINT` on
the internal service address and set `BOOK_STORAGE_PUBLIC_ENDPOINT` to the HTTPS
origin exposed by Caddy. Gateway uses the internal client for object operations
and the public client only for short-lived signed URLs.

The Expo client persists the last successful catalog response and verified
covers under its Documents directory. Selecting a catalog item downloads the
source through a short-lived signed URL, verifies SHA-256, imports it into the
local library and removes the temporary download. Published character profiles
and reader-visible media bundles are likewise cached after manifest materialization,
so already fetched data remains available offline.

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

## Backend deployment

Use [`deploy-remote.sh`](./deploy-remote.sh) from a developer machine or CI. It
copies only `deploy.sh`, `migrate.sh`, and `compose.i167.yml`, then invokes the
selected operation over SSH. It never copies application source or secrets.
The stable server entrypoint is `current/deploy.sh`; five deployment bundles
are retained automatically by default.

The server-side [`deploy.sh`](./deploy.sh) manages TEST or PROD exclusively
through Docker Compose. The default deployment recreates only gateway;
selected, full, and Git-diff modes control workers, PostgreSQL, and MinIO
independently.

Database migrations use the separate [`migrate.sh`](./migrate.sh) operation.
Backups are never triggered implicitly by deploy or migration.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for environment defaults, immutable image
rules, component groups, migration order, and command examples.

The historical `deploy-i167.sh` and `deploy-staging-fun1.sh` entrypoints are
deprecated and disabled.
