#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:?set REMOTE=max@158.160.163.167}"
TARGET_ENV="${TARGET_ENV:-/etc/narra-gateway.env}"
CURRENT_CONTAINER="${CURRENT_CONTAINER:-narra-gateway-1}"
STATS_ENV="${STATS_ENV:-/etc/stats/narra.env}"

if [ "$REMOTE" != "max@158.160.163.167" ] \
  || [ "$TARGET_ENV" != "/etc/narra-gateway.env" ] \
  || [[ ! "$CURRENT_CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] \
  || [ "$STATS_ENV" != "/etc/stats/narra.env" ]; then
  echo "Refusing non-canonical bootstrap target" >&2
  exit 1
fi

ssh "$REMOTE" \
  "sudo env TARGET_ENV='$TARGET_ENV' CURRENT_CONTAINER='$CURRENT_CONTAINER' STATS_ENV='$STATS_ENV' \
    flock -x /run/lock/narra-gateway-deploy.lock bash -se" <<'REMOTE_SCRIPT'
set -euo pipefail

test ! -e "$TARGET_ENV"
docker inspect "$CURRENT_CONTAINER" >/dev/null
test -r "$STATS_ENV"

temporary="${TARGET_ENV}.bootstrap.$$"
trap 'rm -f "$temporary"' EXIT
umask 077
docker exec "$CURRENT_CONTAINER" env | awk -F= '
  $1 ~ /^(AI_|ALLOW_|ANALYTICS_|API_LIMIT_|CORS_|EVENT_|GATEWAY_|IMAGE_|IMPORT_|INSTALLATION_|KANDINSKY_|LITELLM_|LLM_|OPENROUTER_|REFRESH_|REGISTRATION_|SALUTE|SBER_|SPEECH_|VIDEO_)/ &&
  $1 !~ /^TRACTION_/ { print }
' > "$temporary"

stats_token="$(sed -n 's/^STATS_INGEST_TOKEN=//p' "$STATS_ENV")"
test "${#stats_token}" -ge 32
printf '%s\n' \
  'TRACTION_INGEST_URL=https://stats.multitool.works/p/narra/events' \
  "TRACTION_INGEST_TOKEN=$stats_token" \
  'VIDEO_REQUIRED=false' >> "$temporary"

for key in GATEWAY_TOKEN_SECRET INSTALLATION_SECRET_PEPPER INSTALLATION_OPERATOR_TOKEN \
  ANALYTICS_HMAC_SECRET LLM_API_KEY KANDINSKY_TOKEN SBER_SALUTE_AUTH_KEY \
  TRACTION_INGEST_URL TRACTION_INGEST_TOKEN; do
  grep -q "^${key}=." "$temporary"
done

install -o root -g root -m 0600 "$temporary" "$TARGET_ENV"
chmod 0600 /srv/nara/.env
echo "Gateway environment installed with root-only permissions"
REMOTE_SCRIPT
