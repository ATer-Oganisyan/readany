# Narra infrastructure

This document records the production ownership boundary after the 5 August
2026 migration from Railway to `i167` (`158.160.163.167`). It is the current
source of truth for Narra server operations. The historical release plan in the
standalone Narra repository is not an operations runbook.

## Canonical source

| Runtime | Source | Deployment |
| --- | --- | --- |
| Gateway | `services/narra-gateway` | Docker Compose via `deploy-i167.sh` |
| Product analytics | `stats/narra` | systemd via `deploy.sh` |

The first reviewed gateway migration is merge commit `c8e38887efe7` (PR #3).
The analytics service currently runs commit `472c1b8dfd28` (PR #6). Both commits
are in `main`.

## Live production layout

- `narra-gateway-1` is a single Docker replica bound to
  `127.0.0.1:8788`. Persistent installation and outbox data lives in the
  external `narra_gateway-data` volume.
- `narra-gateway-backup.timer` creates daily root-only archives in
  `/srv/backups/narra-gateway` with 14-day retention.
- `stats-narra.service` binds to `127.0.0.1:9905`. Its SQLite database lives in
  `/srv/stats/narra/data` and is exposed through
  `https://stats.multitool.works/p/narra/`.
- `https://narra.multitool.works` remains fail-closed behind Caddy and returns
  the reviewed `503 not_ready` response. Connecting it to port `8788` is a
  separate production cutover, not part of the host migration.

Do not run a second production gateway writer against the same Docker volume.
Do not put provider, gateway, analytics or read credentials in Git.

## Railway retirement state

On 5 August 2026 the Railway staging gateway and staging analytics deployments
were stopped. Their persistent volumes were retained for rollback, and an
operator archive passed SQLite `PRAGMA integrity_check`. The archive checksum
is:

```text
f3217ce03f973271ded4ef696a82111bdc6b679e448a6e5ed2a08f665d013ab1
```

The Railway production deployment is crashed and stopped, has no persistent
volume and owns no custom domain. Its deletion is assigned to the Railway
account owner. Until that deletion is confirmed, it must not be treated as a
rollback target or redeployed.

The old Railway staging hostnames are expected to return `404`. Production
monitoring will report the retired staging targets as down until those targets
are removed from the monitor configuration.

## Staging policy

There is currently no replacement staging runtime on `i167`. If staging is
needed later, create an isolated gateway, database, credentials and backup
policy. Reserve `127.0.0.1:8789` for the staging gateway and
`127.0.0.1:9911` for staging analytics; neither port is currently assigned.

Do not restore the old Railway test database by default. Start clean and use
the retained archive only for a reviewed investigation. Do not re-enable the
legacy plaintext video upstream. Staging LLM traffic must use an HTTPS provider.

## Verification and rollback

For gateway deploy, backup, restore and compare-and-swap instructions, use
`services/narra-gateway/README.md`. For analytics deploy and rollback, use
`stats/narra/README.md`.

Operational runbooks migrated from the standalone Narra repository live in
`ops/narra/`:

- `ops/narra/caddy/` — the reviewed Caddy fragments and change procedure for
  the production hostname `narra.multitool.works` (i167) and the reserved
  video hostname `narra-video.multitool.works` (i46), including the
  compare-and-swap validate/reload workflow.
- `ops/narra/installations/` — the operator runbook for the no-invite
  installation registry (registration, revocation, budget overrides).

After an infrastructure change, verify:

1. local gateway `/health` and `/ready`;
2. public production stats `/p/narra/health`;
3. analytics outbox backlog, overflow and dead-letter counters;
4. container and systemd restart behavior;
5. the latest gateway volume and SQLite backups;
6. Caddy validation before any reload.

Sber Speech and Kandinsky credentials were shared between the retired Railway
staging environment and production. Rotate them through the provider consoles,
update `i167`, verify speech and image generation, and only then revoke the old
credentials.
