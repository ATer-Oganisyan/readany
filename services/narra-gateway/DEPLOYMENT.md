# Backend deployment

`deploy-remote.sh` is the supported entrypoint for a developer machine or CI.
It uploads a fixed three-file deployment bundle over SSH and invokes the
server-side operation. `deploy.sh` remains the container-management entrypoint
on the target host. It invokes only Docker Compose for validation, image pulls,
migration checks, container recreation, health waiting, and status output. It
never uses SSH, rsync, systemd, raw `docker`, or npm.

`deploy-i167.sh` and `deploy-staging-fun1.sh` are deprecated and disabled.
The `compose.i167.yml` filename is retained only for compatibility; the file is
now parameterized by environment and is used for both TEST and PROD.

## Remote entrypoint

The local proxy accepts the same deployment arguments plus SSH transport
options:

```bash
# TEST uses the existing fun1 SSH alias by default
./deploy-remote.sh --environment test --component gateway

# An explicit host may be used from CI or another workstation
./deploy-remote.sh \
  --environment test \
  --host deploy@test.example.internal \
  --image ghcr.io/mishanaer/narra-gateway:test-latest \
  --component analysis-workers

# PROD has no hard-coded host
./deploy-remote.sh \
  --environment prod \
  --host deploy@prod.example.internal \
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha>
```

The proxy always copies exactly this allowlist:

- `deploy.sh`;
- `migrate.sh`;
- `compose.i167.yml`.

It never copies the application source, Git metadata, `.env`, SQL migrations,
Dockerfile, tests, or package files. Runtime code and migrations come from the
selected Docker image. Secrets stay in the environment-specific `compose.env`
on the target host.

The files are uploaded into `releases/<bundle-version>`, checked by SHA-256,
and executed under a host-level deployment lock. After a successful operation,
the `current` symlink is switched to that bundle. Existing release directories
are accepted only when all three files are byte-for-byte identical.

`current` is the stable server-side entrypoint, so operators never need to find
a release by commit:

```bash
/srv/narra-stagging/current/deploy.sh --environment test

/opt/narra-production/current/deploy.sh \
  --environment prod \
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha>
```

After every successful remote operation, old bundles are pruned automatically.
The five newest releases are retained by default, and the target of `current`
is never deleted even if it falls outside that set. Change the retention or
disable cleanup when investigating a release:

```bash
./deploy-remote.sh --environment test --keep-releases 10

./deploy-remote.sh --environment test --no-release-cleanup
```

Cleanup removes a directory only when it is an immediate child of `releases`
and contains exactly the three expected bundle files. An unfamiliar directory
is reported and skipped instead of being deleted recursively.

By default, the proxy uploads the three files to a private temporary directory,
opens one SSH session with a pseudo-terminal, and runs the complete server-side
operation through one `sudo bash` process. `sudo` asks for the server password
once; the operator does not run `sudo su`, create deployment directories, copy
files manually, or invoke Docker separately.

For a private GHCR package, authenticate the SSH user once on the server. The
privileged deployment automatically reuses that user's Docker credential file:

```bash
ssh fun1
read -rsp 'GHCR token: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" \
  | docker login ghcr.io --username <github-user> --password-stdin
unset GHCR_TOKEN
exit
```

Use a classic personal access token with only `read:packages`. This registry
login is not repeated on later deploys. If the GHCR package is public, skip it.
After SSH key access and this one-time private-registry login are in place, the
entire TEST deployment is one local command and one sudo password prompt:

```bash
./deploy-remote.sh --environment test --component gateway
```

Use `--no-sudo` only when the SSH user has already been provisioned with write
access to the deployment root, read access to `compose.env`, and permission to
run Docker Compose. CI cannot answer an interactive sudo prompt, so a future CI
deploy job must either connect with a dedicated root SSH key or use a reviewed
non-interactive privilege policy. The sudo password must never be stored in CI.

The target host must provide Bash, `flock`, `sha256sum`, standard file utilities,
and Docker Compose. The developer machine or CI runner must provide `ssh` and
`scp`. These are deployment prerequisites, not application dependencies.

Host-key verification is deliberately not disabled. CI must provide a trusted
`known_hosts` entry and a dedicated SSH key. SSH itself uses batch mode and
will not request an SSH password; the allocated terminal is used only for the
single remote sudo prompt.

Transport-specific flags are `--host`, `--ssh-port`, `--identity-file`,
`--remote-root`, `--bundle-version`, `--keep-releases`,
`--no-release-cleanup`, `--sudo`, `--no-sudo`, and `--transport-dry-run`. All
other flags are passed to `deploy.sh`.

The server has no Git checkout, so remote `--from`/`--to` is prohibited. CI
must calculate changed paths before connecting and pass repeatable
`--changed-path` arguments.

Remote migrations use the same proxy:

```bash
./deploy-remote.sh --environment test --operation migrate-check
./deploy-remote.sh --environment test --operation migrate-apply

./deploy-remote.sh \
  --environment prod \
  --host deploy@prod.example.internal \
  --operation migrate-apply \
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha> \
  --confirm
```

`--transport-dry-run` makes no network connection and prints the complete
SSH/SCP plan. The ordinary `--dry-run` is forwarded to the server-side tool: it
still uploads the bundle and connects, but Docker Compose mutations are only
printed.

## Environments and image versions

GitHub Actions builds the gateway on a GitHub-hosted runner after tests pass on
`main`, then publishes two tags to GHCR:

- `ghcr.io/<repository-owner>/narra-gateway:<full-git-sha>`;
- `ghcr.io/<repository-owner>/narra-gateway:test-latest`.

No runner or build container is required on the application server. TEST pulls
`test-latest`; PROD must receive the exact full-SHA tag (or digest) of the image
that was already tested and published. The server only pulls and starts images.

| Environment | Compose project | Default env file | Gateway port | Image policy |
|---|---|---|---|---|
| `test` | `narra-stagging` | `/srv/narra-stagging/compose.env` | `8789` | defaults to mutable `ghcr.io/mishanaer/narra-gateway:test-latest` |
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
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha>
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
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha> \
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
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha> \
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
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha> \
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
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha>

./migrate.sh --environment prod --apply --confirm \
  --image ghcr.io/mishanaer/narra-gateway:<full-git-sha>
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
  --image ghcr.io/mishanaer/narra-gateway:<previous-full-git-sha>
```

Database rollback is not coupled to application rollback. Forward-fix is the
default; a data restore is a separate reviewed recovery operation.

## Useful flags

- `--dry-run` prints exact Compose commands without contacting Docker;
- `--pull always|missing|never` controls image fetching;
- `--wait-timeout N` controls Compose health waiting;
- `--service NAME` selects an exact persistent service;
- `--confirm-stateful-restart` protects PROD databases and storage.
