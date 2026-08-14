# Book markup backend

This document fixes the implementation boundaries for server-side book markup.

## Domain rules

- A full markup revision discovers every character and records exact text anchors.
- `warmup_text_offset` may trigger shared generation work before a character appears.
- `first_appearance_text_offset` gates reader access and must never be inferred from
  the global maximum reading progress.
- A warmed character means one versioned, atomic media bundle is complete.
- A ready bundle remains hidden from a reader until that reader crosses the first
  appearance anchor.
- Generation is idempotent by book edition, stable character key and bundle version.

## Character bundle v1

The first bundle version requires:

- primary portrait;
- greeting audio;
- idle portrait animation.

Voice configuration is structured markup rather than a media asset. Dynamic chat
speech, arbitrary scenes and chapter TTS are not part of the finite bundle.

## Delivery stages

1. Domain contract, PostgreSQL schema and idempotency semantics.
2. Durable PostgreSQL repository and markup worker pipeline.
3. Catalog resolution, reader-aware manifest and warmup APIs.
4. Mobile binding, local cache and progress coordinator.
5. Integration, migration and operational acceptance.

## Stage 2 runtime

The durable queue and all published revisions live in PostgreSQL. Run migrations
before serving or processing jobs; the worker also runs them under a PostgreSQL
advisory lock at startup. Applied migration checksums are immutable.

The worker claims one job with `FOR UPDATE SKIP LOCKED`, renews its lease while a
Generator call is active, and retries failures with bounded exponential backoff.
Book markup is published in one transaction. Character media becomes `ready` only
after every required bundle asset is stored and linked in one transaction.

The internal Generator contract has two authenticated operations:

- `POST /internal/v1/book-markup`;
- `POST /internal/v1/character-bundles`.

Both receive a stable idempotency key. The Generator must finish object-storage
writes before returning asset metadata to the worker.

`book-markup-v2` results must include `textLength` and express every warmup and
first-appearance offset against that exact normalized text stream.

## Stage 3 gateway API

All routes below require the existing installation bearer token:

- `GET /v2/books/catalog` returns only catalog editions in `base_ready` or
  `published` state and uses an opaque keyset cursor;
- `POST /v2/books/resolve` resolves a catalog key or a local SHA-256. A local
  hash reuses a ready catalog edition first, then the caller's private edition;
  otherwise the result is `local_registration_required`;
- `POST /v2/books/local` registers only the local book's hash and metadata;
- `POST /v2/books/:bookEditionId/local-markup` accepts only derived character
  profiles and appearance fractions produced by the client;
- `GET /v2/books/:bookEditionId/manifest` returns the published markup and only
  characters already visible to that reader;
- `POST /v2/books/:bookEditionId/progress` advances the reader's text watermark
  and requests all bundles whose markup-defined warmup offsets were crossed.

The server stores a monotonic per-reader text watermark. Moving backwards in the
UI does not lock an already revealed character again. Every progress call
re-evaluates all due characters, so an interrupted enqueue is healed by the next
call while the character-level generation key remains idempotent.

Warmup and visibility are intentionally independent. A bundle may be globally
ready before first appearance, but the manifest omits that character completely.
Once visible, the manifest returns either `preparing` with no assets or `ready`
with the complete finite bundle. It never returns partial media.

Private access is scoped to the installation subject until account identity is
introduced. A private book owned by another subject resolves as not found.

## Stage 4 local books and mobile delivery

The app identifies a local book by the SHA-256 of its exact source bytes. It
first calls `POST /v2/books/resolve`; this reuses a catalog edition or the same
installation's local-only edition. For a new user book the app registers hash,
title, author and format with `POST /v2/books/local`. It keeps the source file
and extracted chunks on-device. Character analysis uses the existing Gateway AI
route, then `POST /v2/books/:bookEditionId/local-markup` publishes only derived
profiles and fractional appearance anchors. Source bytes and extracted prose
are not accepted by either endpoint and no `book_files` row exists for a
private edition.

The worker therefore never runs full book markup for local-only editions. It
only creates character media after reader progress crosses a published warmup
anchor. Media downloads use short-lived reader-authorized URLs at
`GET /v2/books/:bookEditionId/media/:assetId/download`. The source download
endpoint is catalog-only.

Media authorization repeats the per-reader first-appearance check at download
time, so a leaked asset ID is insufficient to reveal a future character.

The mobile reader restores its cached manifest immediately, then synchronizes
in the background. Relocations are coalesced into a monotonic reading fraction
plus the current source section and the start fraction of the visible page.
Startup and CFI-restoration events calibrate this section coordinate; after
startup only actual forward movement is synchronized. The resulting manifest
downloads portrait, greeting audio and idle animation in native background sessions. Files are
verified by size and SHA-256 and the UI publishes the three local paths only as
one complete bundle. A failed or incomplete download remains `preparing` and
cannot expose partial media.

Generated private markup, bundles and S3 objects have a sliding retention period
(`PRIVATE_MATERIAL_TTL_DAYS`, seven days by default). Reader access extends it;
an hourly cleanup transaction queues object deletions, removes expired database
rows and retries failed S3 deletions. Production must set the `BOOK_STORAGE_*`
variables and must not ship storage credentials in the app.
On i167 this contract is provided by an internal-only MinIO service with a
persistent Docker volume. Its root credential is used only by the one-shot
bucket initializer; Gateway receives a separate application credential.

The generator is not a separate deployment. Gateway owns the existing LLM,
image, speech and video integrations and exposes two service-token-protected
routes on the private Docker network. The second process is only
`book-markup-worker.mjs`; it claims durable PostgreSQL jobs and calls those
internal routes. If the external idle-video provider is absent, Gateway creates
a short local MP4 animation from the generated portrait.

Catalog source books are the only books uploaded to backend storage. An operator
uses `POST /v2/admin/catalog/books/uploads`, uploads the exact bytes through the
returned Gateway path, then calls the returned completion path. These routes
require the independent `CATALOG_INGEST_TOKEN`. An operator-owned manifest
outside the repository can be ingested idempotently with
`CATALOG_MANIFEST=/secure/path/catalog.json npm run seed:catalog`; completion
queues full book markup for the worker. Source books and the ingest manifest
must not be bundled with the mobile application or committed to this repository.
Catalog covers use a separate checksum-bound upload attached to the edition and
are returned as authenticated download metadata by `GET /v2/books/catalog`.

The mobile catalog is offline-first: it renders the last persisted catalog,
refreshes it from Gateway, caches verified covers, and imports a selected source
into the app's local library. Published character manifests and their atomic
portrait/audio/animation bundles are cached under the book ID. No checked-in
catalog profiles or presentation assets are used as runtime fallbacks.

## Stage 5 canonical progress and rollout

Markup schema v2 adds `text_length`, measured in the same normalized text stream
used to produce every character anchor. Mobile clients send
`progress_fraction` from `0` to `1`; PostgreSQL converts it to
`round(text_length * progress_fraction)` before evaluating warmup and visibility.
This removes the previous dependency on the renderer's approximate character
count. `text_offset` remains accepted as a mutually exclusive legacy input.

The renderer fraction and the normalized text stream are close but are not the
same coordinate system: title pages, navigation documents and markup removed
during text extraction can produce different offsets near the beginning of a
book. Therefore catalog character visibility additionally uses:

- `firstAppearanceSectionIndex` and `firstAppearanceSectionFraction` in the
  published character data;
- `section_index` and `section_fraction` in reader progress and
  `reader_book_positions`.

When both sides have section coordinates, section order and within-section
fraction are authoritative for manifest and media-download authorization. The
global text offset remains the warmup coordinate and the compatibility fallback
for older clients or local markup without section anchors.

The fraction, derived text watermark and section coordinate are monotonic per
reader. If a reader reports progress before markup is published, the fraction is retained;
publishing the v2 revision derives the canonical offset in the same transaction.

Migration `002_canonical_reader_progress.sql` is additive: legacy markup rows
keep a nullable `text_length` until regenerated. Queue those revisions with:

```bash
npm run migrate:book-markup
npm run backfill:book-markup
npm run backfill:character-sections
```

The backfill uses the new `book-markup-v2` idempotency key and never replaces a
currently published revision until the new result is complete. Run it before
shipping fraction-only clients for a catalog containing v1 markup.
The character-section backfill is deterministic: it downloads the immutable
catalog source, repeats the normal text extraction, verifies `text_length`, and
adds section anchors to existing character JSON. It does not call an LLM or
regenerate character media. When an existing reader position has a matching
`chapter_key`, the same transaction conservatively calibrates it to the start
of that source section, removing previously over-reported startup offsets.
Migration `007_section_aware_reader_progress.sql` is additive and keeps old
progress requests valid; a later legacy request without section coordinates
falls back to the text watermark when it advances.

Jobs exhaust their bounded automatic retries into `failed`. Recovery is an
explicit operator action that reuses the same idempotency keys and resets both
the job and character bundle state:

```bash
npm run retry:book-generation
```

Production rollout order:

1. deploy Gateway and migration with `BOOK_BACKEND_REQUIRED=false`;
2. configure PostgreSQL, the Gateway service token and all `BOOK_STORAGE_*` variables;
3. run the v2 backfill and start `npm run worker:book-markup`;
4. set `BOOK_BACKEND_REQUIRED=true` and require `/ready` to pass.

When required, readiness performs live PostgreSQL and bucket-access probes. The
i167 Compose file enables a separate, resource-bounded worker profile
automatically during deploy. On Railway, create a second service from the same
image with start command `node book-markup-worker.mjs`.

The opt-in end-to-end test exercises a real PostgreSQL and S3-compatible store:
local-only registration, derived markup publication, fraction-to-offset
conversion, private warmup, visibility gating and authorized temporary media.
Its environment variables are listed in
`test/book-backend.e2e.test.mjs`.
