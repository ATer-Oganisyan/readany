#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups/narra-gateway}"
CONTAINER="${CONTAINER:-narra-gateway-1}"
VOLUME="${VOLUME:-narra_gateway-data}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ ! "$BACKUP_DIR" =~ ^/srv/backups/[A-Za-z0-9._/-]+$ ]] \
  || [[ ! "$CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] \
  || [[ ! "$VOLUME" =~ ^[A-Za-z0-9._-]+$ ]] \
  || [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "Invalid backup configuration" >&2
  exit 1
fi

exec 9>/run/lock/narra-gateway-backup.lock
flock -n 9 || exit 0

install -d -o root -g root -m 0700 "$BACKUP_DIR"
image="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/gateway-data-$stamp.tar.gz"
partial="$target.partial"
trap 'rm -f "$partial"' EXIT

docker run --rm --network none --read-only --user 0:0 \
  --entrypoint tar \
  -v "$VOLUME:/source:ro" \
  -v "$BACKUP_DIR:/backup" \
  "$image" -czf "/backup/$(basename "$partial")" -C /source .
gzip -t "$partial"
mv "$partial" "$target"
trap - EXIT
chmod 0600 "$target"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'gateway-data-*.tar.gz' \
  -mtime "+$RETENTION_DAYS" -delete

echo "$target"
