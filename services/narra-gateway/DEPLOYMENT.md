# Backend deployment

`deploy.sh` is the only supported backend deploy entrypoint. Run it directly
on the target host from the versioned gateway directory. It invokes only
Docker Compose for validation, image pulls, migration checks, container
recreation, health waiting, and status output. It never uses SSH, rsync,
systemd, raw `docker`, or npm.

`deploy-i167.sh` and `deploy-staging-fun1.sh` are deprecated and disabled.
The `compose.i167.yml` filename is retained only for compatibility; the file is
now parameterized by environment and is used for both TEST and PROD.

## Environments and image versions

| Environment | Compose project | Default env file | Gateway port | Image policy |
|---|---|---|---|---|
| `test` | `narra-stagging` | `/srv/narra-stagging/compose.env` | `8789` | defaults to mutable `readany/narra-gateway:test-latest` |
| `prod` | `narra-production` | `/opt/narra-production/compose.env` | `8788` | explicit immutable image is required |

Production accepts only one of these forms:

- digest: `registry/name@sha256:<64 hex>`;
- full Git SHA tag: `registry/name:<40 hex>`;
- exact SemVer tag: `registry/name:v1.2.3` or `registry/name:1.2.3`.

`latest`, branch names, and short SHA tags are rejected in production. The
PostgreSQL, MinIO, and MinIO client images remain pinned by digest in Compose.

Environment defaults can be overridden with `--env-file` and `--project`.
TEST and PROD must use different projects, volumes, ports, credentials, and
object-storage buckets.

## Default deploy

The common operation updates only gateway and never restarts its dependencies:

```bash
./deploy.sh --environment test

./deploy.sh --environment prod \
  --image readany/narra-gateway:<full-git-sha>
```

The exact sequence is:

1. `docker compose config --quiet`;
2. `docker compose pull gateway`;
3. one-shot migration check using the selected application image;
4. `docker compose up -d --force-recreate --no-deps --wait gateway`;
5. `docker compose ps gateway`.

`--no-deps` is the important default: PostgreSQL, MinIO and workers are not
recreated when only gateway changes.

## Selecting containers

Use repeatable component groups or exact Compose service names:

```bash
# Analysis workers only
./deploy.sh --environment test \
  --component analysis-workers

# Gateway and scene worker
./deploy.sh --environment test \
  --component gateway \
  --service book-scene-worker

# PostgreSQL only; production additionally requires confirmation
./deploy.sh --environment prod \
  --component databases \
  --image readany/narra-gateway:<full-git-sha> \
  --confirm-stateful-restart
```

Available groups:

| Component | Services |
|---|---|
| `gateway` | `gateway` |
| `analysis-workers` | prepare, scan, resolve, synthesize, validate, publish |
| `book-workers` | markup, identity, and all analysis workers |
| `media-workers` | character media worker |
| `scene-workers` | scene worker |
| `tts-workers` | TTS markup worker |
| `workers` | every persistent worker |
| `runtime` | gateway and every persistent worker |
| `databases` | PostgreSQL |
| `storage` | MinIO |
| `stateful` | PostgreSQL and MinIO |
| `all` | stateful services, MinIO initialization, gateway, all workers |

One-shot operator/campaign containers are intentionally not valid deploy
targets. Run them as separate operations.

## Full deploy

```bash
./deploy.sh --environment test --mode full

./deploy.sh --environment prod \
  --mode full \
  --image readany/narra-gateway:<full-git-sha> \
  --confirm-stateful-restart
```

Full mode recreates PostgreSQL, MinIO, gateway, and all persistent workers.
Production requires `--confirm-stateful-restart`; there is no implicit bypass.
Compose starts services in dependency order and waits for their health checks.

## Deploy from a diff

```bash
./deploy.sh --environment test \
  --mode diff --from <previous-release-ref> --to HEAD
```

CI may pass known paths directly:

```bash
./deploy.sh --environment test --mode diff \
  --changed-path services/narra-gateway/index.mjs
```

The mapping is conservative:

- gateway entrypoint changes recreate gateway;
- a specific worker runner recreates that worker;
- shared backend modules, Dockerfile or dependencies recreate all application
  containers because they share one image;
- Compose changes select the full stack;
- migration changes select the full application runtime;
- docs, tests and deploy tooling do not restart containers;
- changes outside the gateway backend are ignored.

If no backend service is affected, the command exits successfully without
calling Compose. Always inspect the plan first when using automatic selection:

```bash
./deploy.sh --environment prod --mode diff \
  --from <previous-release-ref> \
  --image readany/narra-gateway:<full-git-sha> \
  --dry-run
```

## Migrations

Database migrations are an explicit operation and are never applied by
`deploy.sh`. Gateway and workers start with `DATABASE_AUTO_MIGRATE=false`; they
fail closed when their image contains an unapplied migration.

Release order:

1. create and verify a backup using the independent backup operation;
2. pull and check the candidate migration on TEST;
3. apply it on TEST;
4. deploy and verify TEST containers;
5. repeat backup/check/apply for PROD;
6. deploy the compatible PROD application image.

Commands:

```bash
./migrate.sh --environment test --check
./migrate.sh --environment test --apply

./migrate.sh --environment prod --check \
  --image readany/narra-gateway:<full-git-sha>

./migrate.sh --environment prod --apply --confirm \
  --image readany/narra-gateway:<full-git-sha>
```

`migrate.sh` uses `docker compose run --rm migrate`. It neither restarts
application containers nor creates a backup. Migrations remain checksum-
protected and serialized by a PostgreSQL advisory lock.

Production schema changes must use expand/migrate/contract sequencing. A
migration applied before container recreation must remain compatible with the
currently running production image. Destructive cleanup belongs to a later
release after every old container has been retired.

## Backup and rollback

Backup is intentionally outside both `deploy.sh` and `migrate.sh`. The existing
`backup-i167.sh` remains a separate legacy operator tool until a
multi-environment backup command is introduced; neither new script calls it.

Container rollback is a new deploy with the previous immutable image:

```bash
./deploy.sh --environment prod \
  --image readany/narra-gateway:<previous-full-git-sha>
```

Database rollback is not coupled to application rollback. Forward-fix is the
default; a data restore is a separate reviewed recovery operation.

## Useful flags

- `--dry-run` prints exact Compose commands without contacting Docker;
- `--pull always|missing|never` controls image fetching;
- `--wait-timeout N` controls Compose health waiting;
- `--service NAME` selects an exact persistent service;
- `--confirm-stateful-restart` protects PROD databases and storage.
