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
