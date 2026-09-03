#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-fun1}"
TARGET_ENV="/srv/narra-stagging/compose.env"
CURRENT_CONTAINER="narra-stagging-gateway-1"

if [ "$REMOTE" != "fun1" ]; then
  echo "Refusing to prepare any host except fun1" >&2
  exit 1
fi

ssh "$REMOTE" "sudo env TARGET_ENV='$TARGET_ENV' CURRENT_CONTAINER='$CURRENT_CONTAINER' flock -x /run/lock/narra-staging-env.lock bash -se" <<'REMOTE_SCRIPT'
set -euo pipefail

test -f "$TARGET_ENV"
env_mode="$(stat -c %a "$TARGET_ENV")"
env_owner="$(stat -c %U "$TARGET_ENV")"
env_group="$(stat -c %G "$TARGET_ENV")"
test "$env_owner" = root
case "$env_mode" in
  600|640) ;;
  *)
    echo "Staging environment permissions must be 600 or 640" >&2
    exit 1
    ;;
esac

require_one() {
  key="$1"
  count="$(grep -Ec "^${key}=.+" "$TARGET_ENV" || true)"
  if [ "$count" != 1 ]; then
    echo "Required staging key is missing or duplicated: $key" >&2
    exit 1
  fi
}

runtime_keys=(
  ALLOW_INSECURE_LLM_HTTP
  ALLOW_INSECURE_TLS
  ALLOW_INSECURE_VIDEO_HTTP
  ANALYTICS_HMAC_SECRET
  BOOK_ANALYSIS_PIPELINE
  CORS_ORIGIN
  COVER_IMAGE_PROVIDER
  GATEWAY_TOKEN_SECRET
  INSTALLATION_SECRET_PEPPER
  KANDINSKY_TOKEN
  LITELLM_API_KEY
  LITELLM_BASE_URL
  LITELLM_IMAGE_MODEL
  LITELLM_MODEL
  LLM_API_KEY
  LLM_BASE_URL
  LLM_CONCURRENCY
  LLM_FALLBACK_DEFAULT
  LLM_INSECURE_HTTP_HOSTS
  LLM_MODEL
  LLM_OMIT_TEMPERATURE
  LLM_ROUTE_STRUCTURED_TASK
  OPENROUTER_API_KEY
  PRIVATE_MATERIAL_CLEANUP_BATCH_SIZE
  PRIVATE_MATERIAL_CLEANUP_MS
  PRIVATE_MATERIAL_TTL_DAYS
  SBER_SALUTE_AUTH_KEY
  SBER_SALUTE_OAUTH_URL
  SBER_SALUTE_RECOGNITION_MODEL
  SBER_SALUTE_RECOGNIZE_URL
  SBER_SALUTE_SYNTH_URL
  TRACTION_INGEST_TOKEN
  TRACTION_INGEST_URL
  VIDEO_REQUIRED
)

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
operator_username_count="$(grep -Ec '^BOOK_OPERATOR_USERNAME=' "$TARGET_ENV" || true)"
operator_password_count="$(grep -Ec '^BOOK_OPERATOR_PASSWORD=' "$TARGET_ENV" || true)"
if [ "$analytics_count" -gt 1 ] || [ "$operator_count" -gt 1 ] \
  || [ "$operator_username_count" -gt 1 ] || [ "$operator_password_count" -gt 1 ]; then
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

container_environment="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CURRENT_CONTAINER")"
runtime_missing=()
for key in "${runtime_keys[@]}"; do
  source_count="$(printf '%s\n' "$container_environment" | grep -Ec "^${key}=" || true)"
  target_count="$(grep -Ec "^${key}=" "$TARGET_ENV" || true)"
  if [ "$source_count" != 1 ]; then
    echo "Current staging container must contain exactly one runtime key: $key" >&2
    exit 1
  fi
  if [ "$target_count" -gt 1 ]; then
    echo "Staging environment contains a duplicated runtime key: $key" >&2
    exit 1
  fi
  source_line="$(printf '%s\n' "$container_environment" | grep -m1 "^${key}=")"
  if [ "$target_count" = 0 ]; then
    runtime_missing+=("$key")
  elif ! grep -Fqx -- "$source_line" "$TARGET_ENV"; then
    echo "Refusing to overwrite a runtime value that differs from the current container: $key" >&2
    exit 1
  fi
done

current_managed_keys=(
  INSTALLATION_OPERATOR_TOKEN
  BOOK_OPERATOR_USERNAME
  BOOK_OPERATOR_PASSWORD
)
for key in "${current_managed_keys[@]}"; do
  source_count="$(printf '%s\n' "$container_environment" | grep -Ec "^${key}=" || true)"
  target_count="$(grep -Ec "^${key}=" "$TARGET_ENV" || true)"
  if [ "$source_count" != 1 ]; then
    echo "Current staging container must contain exactly one managed key: $key" >&2
    exit 1
  fi
  source_line="$(printf '%s\n' "$container_environment" | grep -m1 "^${key}=")"
  if [ "$target_count" = 1 ] && ! grep -Fqx -- "$source_line" "$TARGET_ENV"; then
    echo "Refusing to change a managed value from the current container: $key" >&2
    exit 1
  fi
done

operator_token_line="$(printf '%s\n' "$container_environment" | grep -m1 '^INSTALLATION_OPERATOR_TOKEN=')"
operator_username_line="$(printf '%s\n' "$container_environment" | grep -m1 '^BOOK_OPERATOR_USERNAME=')"
operator_password_line="$(printf '%s\n' "$container_environment" | grep -m1 '^BOOK_OPERATOR_PASSWORD=')"
operator_token="${operator_token_line#*=}"
operator_username="${operator_username_line#*=}"
operator_password="${operator_password_line#*=}"
if [ "${#operator_token}" -lt 32 ] || [ -z "$operator_username" ] \
  || [ "${#operator_password}" -lt 20 ]; then
  echo "Current staging operator values are unavailable or invalid" >&2
  exit 1
fi

require_length() {
  file="$1"
  key="$2"
  minimum="$3"
  line="$(grep -m1 "^${key}=" "$file")"
  value="${line#*=}"
  if [ "${#value}" -lt "$minimum" ]; then
    echo "Staging key does not satisfy its minimum length: $key" >&2
    exit 1
  fi
}

validate_environment() {
  file="$1"
  grep -qx 'ANALYTICS_ENV=staging' "$file"
  require_length "$file" INSTALLATION_OPERATOR_TOKEN 32
  require_length "$file" BOOK_OPERATOR_USERNAME 1
  require_length "$file" BOOK_OPERATOR_PASSWORD 20
  require_length "$file" GATEWAY_TOKEN_SECRET 32
  require_length "$file" INSTALLATION_SECRET_PEPPER 32
  require_length "$file" ANALYTICS_HMAC_SECRET 32

  secret_keys=(
    GATEWAY_TOKEN_SECRET
    ANALYTICS_HMAC_SECRET
    INSTALLATION_SECRET_PEPPER
    INSTALLATION_OPERATOR_TOKEN
    CATALOG_INGEST_TOKEN
    BOOK_OPERATOR_PASSWORD
  )
  for ((left = 0; left < ${#secret_keys[@]}; left += 1)); do
    left_line="$(grep -m1 "^${secret_keys[$left]}=" "$file")"
    left_value="${left_line#*=}"
    for ((right = left + 1; right < ${#secret_keys[@]}; right += 1)); do
      right_line="$(grep -m1 "^${secret_keys[$right]}=" "$file")"
      right_value="${right_line#*=}"
      if [ "$left_value" = "$right_value" ]; then
        echo "Independent staging secrets must not be equal" >&2
        exit 1
      fi
    done
  done

  for key in "${runtime_keys[@]}"; do
    test "$(grep -Ec "^${key}=" "$file")" = 1
    source_line="$(printf '%s\n' "$container_environment" | grep -m1 "^${key}=")"
    grep -Fqx -- "$source_line" "$file"
  done
}

if [ "$analytics_count" = 1 ] && [ "$operator_count" = 1 ] \
  && [ "$operator_username_count" = 1 ] && [ "$operator_password_count" = 1 ] \
  && [ "${#runtime_missing[@]}" = 0 ]; then
  validate_environment "$TARGET_ENV"
  echo "Staging environment is already prepared"
  exit 0
fi

backup_dir="/srv/backups/narra-stagging/env"
install -d -o root -g root -m 0700 "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
install -o root -g root -m 0600 "$TARGET_ENV" "$backup_dir/compose.env.$timestamp"

next="$(mktemp /srv/narra-stagging/compose.env.next.XXXXXX)"
trap 'rm -f "$next"' EXIT
install -o root -g "$env_group" -m "$env_mode" "$TARGET_ENV" "$next"
if [ "$analytics_count" = 0 ]; then
  printf '\nANALYTICS_ENV=staging\n' >> "$next"
fi
if [ "$operator_count" = 0 ]; then
  printf '%s\n' "$operator_token_line" >> "$next"
fi
if [ "$operator_username_count" = 0 ]; then
  printf '%s\n' "$operator_username_line" >> "$next"
fi
if [ "$operator_password_count" = 0 ]; then
  printf '%s\n' "$operator_password_line" >> "$next"
fi
for key in "${runtime_missing[@]}"; do
  printf '%s\n' "$container_environment" | grep -m1 "^${key}=" >> "$next"
done
validate_environment "$next"
chown "root:$env_group" "$next"
chmod "$env_mode" "$next"
mv -f "$next" "$TARGET_ENV"
trap - EXIT

validate_environment "$TARGET_ENV"
echo "Staging environment prepared; secret values were not printed"
REMOTE_SCRIPT
