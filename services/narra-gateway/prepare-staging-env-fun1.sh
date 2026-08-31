#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-fun1}"
TARGET_ENV="/srv/narra-stagging/compose.env"

if [ "$REMOTE" != "fun1" ]; then
  echo "Refusing to prepare any host except fun1" >&2
  exit 1
fi

ssh "$REMOTE" "sudo env TARGET_ENV='$TARGET_ENV' flock -x /run/lock/narra-staging-env.lock bash -se" <<'REMOTE_SCRIPT'
set -euo pipefail

test -f "$TARGET_ENV"
test "$(stat -c %a "$TARGET_ENV")" = 600
test "$(stat -c %U:%G "$TARGET_ENV")" = root:root

require_one() {
  key="$1"
  count="$(grep -Ec "^${key}=.+" "$TARGET_ENV" || true)"
  if [ "$count" != 1 ]; then
    echo "Required staging key is missing or duplicated: $key" >&2
    exit 1
  fi
}

for key in \
  GENERATOR_SERVICE_TOKEN \
  CATALOG_INGEST_TOKEN \
  NARRA_POSTGRES_PASSWORD \
  NARRA_MINIO_ROOT_PASSWORD \
  NARRA_STORAGE_SECRET_ACCESS_KEY; do
  require_one "$key"
done

if ! grep -qx 'BOOK_BACKEND_REQUIRED=true' "$TARGET_ENV"; then
  echo "BOOK_BACKEND_REQUIRED must be true in staging" >&2
  exit 1
fi
if ! grep -qx 'NARRA_HOST_PORT=8789' "$TARGET_ENV"; then
  echo "NARRA_HOST_PORT must be 8789 in staging" >&2
  exit 1
fi

analytics_count="$(grep -Ec '^ANALYTICS_ENV=' "$TARGET_ENV" || true)"
operator_count="$(grep -Ec '^INSTALLATION_OPERATOR_TOKEN=' "$TARGET_ENV" || true)"
if [ "$analytics_count" -gt 1 ] || [ "$operator_count" -gt 1 ]; then
  echo "Staging environment contains duplicated managed keys" >&2
  exit 1
fi
if [ "$analytics_count" = 1 ] && ! grep -qx 'ANALYTICS_ENV=staging' "$TARGET_ENV"; then
  echo "ANALYTICS_ENV must be staging" >&2
  exit 1
fi
if [ "$operator_count" = 1 ] && ! grep -Eq '^INSTALLATION_OPERATOR_TOKEN=.+$' "$TARGET_ENV"; then
  echo "INSTALLATION_OPERATOR_TOKEN must not be empty" >&2
  exit 1
fi

if [ "$analytics_count" = 1 ] && [ "$operator_count" = 1 ]; then
  echo "Staging environment is already prepared"
  exit 0
fi

backup_dir="/srv/backups/narra-stagging/env"
install -d -o root -g root -m 0700 "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
install -o root -g root -m 0600 "$TARGET_ENV" "$backup_dir/compose.env.$timestamp"

next="$(mktemp /srv/narra-stagging/compose.env.next.XXXXXX)"
trap 'rm -f "$next"' EXIT
install -o root -g root -m 0600 "$TARGET_ENV" "$next"
if [ "$analytics_count" = 0 ]; then
  printf '\nANALYTICS_ENV=staging\n' >> "$next"
fi
if [ "$operator_count" = 0 ]; then
  printf 'INSTALLATION_OPERATOR_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$next"
fi
chown root:root "$next"
chmod 0600 "$next"
mv -f "$next" "$TARGET_ENV"
trap - EXIT

grep -qx 'ANALYTICS_ENV=staging' "$TARGET_ENV"
grep -Eq '^INSTALLATION_OPERATOR_TOKEN=.+$' "$TARGET_ENV"
echo "Staging environment prepared; secret values were not printed"
REMOTE_SCRIPT
