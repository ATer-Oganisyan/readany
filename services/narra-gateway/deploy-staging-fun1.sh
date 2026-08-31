#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-fun1}"
EXPECTED_REMOTE_IMAGE_ID="${EXPECTED_REMOTE_IMAGE_ID:?set the exact current staging gateway image ID}"
REVIEWED_COMMIT="${REVIEWED_COMMIT:?set the full commit approved by review}"
DRY_RUN="${DRY_RUN:-0}"
REMOTE_ROOT="/srv/narra-stagging"
TARGET_ENV="$REMOTE_ROOT/compose.env"
PROJECT="narra-stagging"
CURRENT_CONTAINER="$PROJECT-gateway-1"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
HEAD="$(git -C "$REPO" rev-parse HEAD)"
SSH_OPTIONS=(-o ServerAliveInterval=15 -o ServerAliveCountMax=12)

if [ "$REMOTE" != "fun1" ] \
  || [[ ! "$EXPECTED_REMOTE_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] \
  || [[ ! "$REVIEWED_COMMIT" =~ ^[a-f0-9]{40}$ ]] \
  || [[ ! "$DRY_RUN" =~ ^[01]$ ]]; then
  echo "Invalid staging deployment precondition" >&2
  exit 1
fi
if [ "$HEAD" != "$REVIEWED_COMMIT" ]; then
  echo "REVIEWED_COMMIT does not match HEAD" >&2
  exit 1
fi
if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=all)" ]; then
  echo "Refusing to deploy a dirty worktree" >&2
  exit 1
fi

VERSION="${HEAD}-$(date -u +%Y%m%dT%H%M%SZ)"
IMAGE="readany/narra-gateway:$HEAD"
REMOTE_STAGE="$REMOTE_ROOT/releases/$VERSION"
FLAGS=(-az --exclude=node_modules --exclude=.data --exclude=.env --exclude='*.log')
[ "$DRY_RUN" = 1 ] && FLAGS+=(--dry-run -v)

remote_image_id="$(ssh "${SSH_OPTIONS[@]}" "$REMOTE" \
  "sudo docker inspect --format '{{.Image}}' '$CURRENT_CONTAINER'")"
if [ "$remote_image_id" != "$EXPECTED_REMOTE_IMAGE_ID" ]; then
  echo "Remote image drift: expected $EXPECTED_REMOTE_IMAGE_ID, got $remote_image_id" >&2
  exit 1
fi

echo "[staging-deploy] reviewed $HEAD -> fun1:$REMOTE_STAGE"
if [ "$DRY_RUN" = 1 ]; then
  rsync "${FLAGS[@]}" --rsync-path="sudo rsync" "$HERE/" "$REMOTE:$REMOTE_STAGE/"
  exit 0
fi

ssh "${SSH_OPTIONS[@]}" "$REMOTE" \
  "sudo test ! -e '$REMOTE_STAGE' \
   && sudo test -f '$TARGET_ENV' \
   && sudo test \"\$(sudo stat -c %a '$TARGET_ENV')\" = 600 \
   && sudo grep -qx 'ANALYTICS_ENV=staging' '$TARGET_ENV' \
   && sudo grep -qx 'BOOK_BACKEND_REQUIRED=true' '$TARGET_ENV' \
   && sudo grep -Eq '^INSTALLATION_OPERATOR_TOKEN=.+$' '$TARGET_ENV' \
   && sudo grep -Eq '^BOOK_OPERATOR_USERNAME=.+$' '$TARGET_ENV' \
   && sudo grep -Eq '^BOOK_OPERATOR_PASSWORD=.{20,}$' '$TARGET_ENV' \
   && sudo grep -Eq '^GATEWAY_TOKEN_SECRET=.{32,}$' '$TARGET_ENV' \
   && sudo grep -Eq '^INSTALLATION_SECRET_PEPPER=.{32,}$' '$TARGET_ENV' \
   && sudo grep -Eq '^ANALYTICS_HMAC_SECRET=.{32,}$' '$TARGET_ENV' \
   && sudo install -d -o root -g root -m 0755 '$REMOTE_ROOT/releases' '$REMOTE_STAGE'"
rsync "${FLAGS[@]}" --rsync-path="sudo rsync" "$HERE/" "$REMOTE:$REMOTE_STAGE/"

ssh "${SSH_OPTIONS[@]}" "$REMOTE" \
  "sudo env \
    REMOTE_ROOT='$REMOTE_ROOT' \
    REMOTE_STAGE='$REMOTE_STAGE' \
    HEAD='$HEAD' \
    IMAGE='$IMAGE' \
    EXPECTED_REMOTE_IMAGE_ID='$EXPECTED_REMOTE_IMAGE_ID' \
    TARGET_ENV='$TARGET_ENV' \
    PROJECT='$PROJECT' \
    CURRENT_CONTAINER='$CURRENT_CONTAINER' \
    flock -x /run/lock/narra-staging-deploy.lock bash -se" <<'REMOTE_SCRIPT'
set -euo pipefail

current_image_id="$(docker inspect --format '{{.Image}}' "$CURRENT_CONTAINER")"
test "$current_image_id" = "$EXPECTED_REMOTE_IMAGE_ID"
current_image_ref="$(docker inspect --format '{{.Config.Image}}' "$CURRENT_CONTAINER")"
test -n "$current_image_ref"

chown -R root:root "$REMOTE_STAGE"
chmod -R go-w "$REMOTE_STAGE"
chmod 0755 "$REMOTE_STAGE"/*.sh

postgres_container="$PROJECT-postgres-1"
minio_volume="${PROJECT}_book-object-data"
gateway_volume="${PROJECT}_gateway-data"
test "$(docker inspect --format '{{.State.Running}}' "$postgres_container")" = true
while IFS='|' read -r filename expected_checksum; do
  [[ "$filename" =~ ^[0-9]+_[a-z0-9_]+\.sql$ ]]
  [[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]]
  migration="$REMOTE_STAGE/migrations/$filename"
  if [ ! -f "$migration" ] \
    || [ "$(sha256sum "$migration" | awk '{print $1}')" != "$expected_checksum" ]; then
    echo "Applied migration differs from the reviewed release: $filename" >&2
    exit 1
  fi
done < <(
  docker exec "$postgres_container" sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "SELECT filename, checksum FROM book_markup_schema_migrations ORDER BY filename"'
)

docker build --pull \
  --build-arg "GATEWAY_BUILD_VERSION=$HEAD" \
  --tag "$IMAGE" "$REMOTE_STAGE"
docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" \
  | grep -qx "GATEWAY_BUILD_VERSION=$HEAD"

candidate="narra-staging-candidate-${HEAD:0:12}"
candidate_volume="narra_staging_candidate_${HEAD:0:12}"
cleanup_candidate() {
  docker stop --time 20 "$candidate" >/dev/null 2>&1 || true
  docker rm "$candidate" >/dev/null 2>&1 || true
  docker volume rm "$candidate_volume" >/dev/null 2>&1 || true
}
trap cleanup_candidate EXIT
cleanup_candidate
docker volume create "$candidate_volume" >/dev/null
docker run --rm --network none --user 0:0 --entrypoint sh \
  -v "$candidate_volume:/data" \
  "$IMAGE" -c 'chown -R 1000:1000 /data'
docker run -d --name "$candidate" --init --env-file "$TARGET_ENV" \
  -e NODE_ENV=production -e ANALYTICS_ENV=staging \
  -e PORT=8787 -e DATA_DIR=/data -e PERSISTENT_DATA_MOUNT_PATH=/data \
  -e DATABASE_URL= -e BOOK_BACKEND_REQUIRED=false \
  -e INSTALLATION_SINGLE_REPLICA_ACK=true -e COVER_JOB_WORKER_ENABLED=false \
  -p 127.0.0.1:18789:8787 -v "$candidate_volume:/data" \
  --read-only --tmpfs /tmp:size=64m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 256 --memory 1g --cpus 1.5 "$IMAGE" >/dev/null

candidate_ready=0
for _attempt in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:18789/ready >/dev/null; then
    candidate_ready=1
    break
  fi
  sleep 1
done
test "$candidate_ready" = 1
curl -fsS http://127.0.0.1:18789/health | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data["ok"] is True
assert data["version"] == sys.argv[1]
assert data["installation_registry"]["storage_verified"] is True
' "$HEAD"
cleanup_candidate
trap - EXIT

backup_dir="/srv/backups/narra-stagging/$(date -u +%Y%m%dT%H%M%SZ)-${HEAD:0:12}"
install -d -o root -g root -m 0700 "$backup_dir"
install -o root -g root -m 0600 "$TARGET_ENV" "$backup_dir/compose.env"
install -o root -g root -m 0644 /srv/narra-stagging/compose.yml "$backup_dir/compose.yml"
if test -f /srv/narra-stagging/compose.override.yml; then
  install -o root -g root -m 0644 /srv/narra-stagging/compose.override.yml \
    "$backup_dir/compose.override.yml"
fi
printf '%s\n' "$current_image_id" > "$backup_dir/previous-image-id"
printf '%s\n' "$current_image_ref" > "$backup_dir/previous-image-ref"
chmod 0600 "$backup_dir"/*

test "$(docker inspect --format '{{.State.Running}}' "$postgres_container")" = true
test "$(docker volume inspect --format '{{.Name}}' "$minio_volume")" = "$minio_volume"
test "$(docker volume inspect --format '{{.Name}}' "$gateway_volume")" = "$gateway_volume"

docker exec "$postgres_container" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
  > "$backup_dir/postgres.dump.next"
mv -f "$backup_dir/postgres.dump.next" "$backup_dir/postgres.dump"
docker exec -i "$postgres_container" pg_restore --list < "$backup_dir/postgres.dump" >/dev/null

docker run --rm --network none --user 0:0 --entrypoint sh \
  -v "$gateway_volume:/data:ro" \
  -v "$backup_dir:/backup" \
  "$IMAGE" -c 'tar -czf /backup/gateway-data.tar.gz -C /data .'
gzip -t "$backup_dir/gateway-data.tar.gz"

minio_mount="$(docker volume inspect --format '{{.Mountpoint}}' "$minio_volume")"
find "$minio_mount" -type f -printf '%s\n' \
  | awk '{ files += 1; bytes += $1 } END { printf "files=%d bytes=%.0f\n", files, bytes }' \
  > "$backup_dir/minio-inventory-summary"
chmod 0600 "$backup_dir"/*

profiles=(--profile book-backend --profile media --profile scenes --profile tts-markup)
scales=(
  --scale book-markup-worker=1
  --scale book-identity-worker=1
  --scale book-analysis-prepare=1
  --scale book-analysis-scan=1
  --scale book-analysis-resolve=1
  --scale book-analysis-synthesize=1
  --scale book-analysis-validate=1
  --scale book-analysis-publish=1
  --scale book-media-worker=1
  --scale book-scene-worker=1
  --scale book-tts-markup-worker=1
)
compose_env=(
  NARRA_COMPOSE_PROJECT="$PROJECT"
  NARRA_GATEWAY_IMAGE="$IMAGE"
  NARRA_ENV_FILE="$TARGET_ENV"
  NARRA_HOST_PORT=8789
  NARRA_GATEWAY_VOLUME="${PROJECT}_gateway-data"
  BOOK_MARKUP_WORKER_REPLICAS=1
  BOOK_IDENTITY_WORKER_REPLICAS=1
  BOOK_ANALYSIS_SCAN_REPLICAS=1
  BOOK_ANALYSIS_SYNTHESIZE_REPLICAS=1
  BOOK_MEDIA_WORKER_REPLICAS=1
  BOOK_SCENE_WORKER_REPLICAS=1
  BOOK_TTS_MARKUP_WORKER_REPLICAS=1
)

env "${compose_env[@]}" docker compose -p "$PROJECT" --env-file "$TARGET_ENV" \
  -f "$REMOTE_STAGE/compose.i167.yml" "${profiles[@]}" config --quiet

mutating=1
rollback() {
  trap - ERR
  set +e
  failed_gateway_id="$(docker compose -p "$PROJECT" --env-file "$TARGET_ENV" \
    -f "$REMOTE_STAGE/compose.i167.yml" "${profiles[@]}" ps -q gateway 2>/dev/null)"
  if [ -n "$failed_gateway_id" ]; then
    docker logs --tail 200 "$failed_gateway_id" > "$backup_dir/failed-gateway.log" 2>&1
    chmod 0600 "$backup_dir/failed-gateway.log"
  fi
  rollback_files=(-f /srv/narra-stagging/compose.yml)
  test -f /srv/narra-stagging/compose.override.yml \
    && rollback_files+=(-f /srv/narra-stagging/compose.override.yml)
  NARRA_GATEWAY_IMAGE="$current_image_ref" docker compose -p "$PROJECT" \
    --env-file "$TARGET_ENV" "${rollback_files[@]}" \
    --profile book-backend --profile book-scenes up -d
  echo "Staging deployment failed; previous Compose and image restart attempted" >&2
  exit 1
}
trap 'if [ "$mutating" = 1 ]; then rollback; fi' ERR

env "${compose_env[@]}" docker compose -p "$PROJECT" --env-file "$TARGET_ENV" \
  -f "$REMOTE_STAGE/compose.i167.yml" "${profiles[@]}" \
  up -d "${scales[@]}"

services=(
  gateway
  book-markup-worker
  book-identity-worker
  book-analysis-prepare
  book-analysis-scan
  book-analysis-resolve
  book-analysis-synthesize
  book-analysis-validate
  book-analysis-publish
  book-media-worker
  book-scene-worker
  book-tts-markup-worker
)
for service in "${services[@]}"; do
  ids="$(env "${compose_env[@]}" docker compose -p "$PROJECT" --env-file "$TARGET_ENV" \
    -f "$REMOTE_STAGE/compose.i167.yml" "${profiles[@]}" ps -q "$service")"
  test -n "$ids"
  test "$(printf '%s\n' $ids | wc -l)" = 1
  container_id="$(printf '%s\n' $ids)"
  test "$(docker inspect --format '{{.State.Running}}' "$container_id")" = true
  test "$(docker inspect --format '{{.RestartCount}}' "$container_id")" = 0
  healthy=0
  for _health_attempt in $(seq 1 18); do
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")"
    if [ "$health" = healthy ]; then
      healthy=1
      break
    fi
    sleep 5
  done
  test "$healthy" = 1
done

curl -fsS http://127.0.0.1:8789/ready | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data["ok"] is True
assert data["version"] == sys.argv[1]
assert data["environment"] == "staging"
assert data["checks"]["book_backend_required"] is True
assert data["checks"]["book_backend"] is True
' "$HEAD"
operator_token="$(sed -n 's/^INSTALLATION_OPERATOR_TOKEN=//p' "$TARGET_ENV")"
test -n "$operator_token"
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $operator_token" http://127.0.0.1:8789/v2/admin/metrics)" = 200
curl -fsS https://api-test.narra.disrupt.builders/health | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data["ok"] is True
assert data["version"] == sys.argv[1]
' "$HEAD"

ln -sfn "$REMOTE_STAGE" "$REMOTE_ROOT/current.next"
mv -Tf "$REMOTE_ROOT/current.next" "$REMOTE_ROOT/current"
printf 'NARRA_GATEWAY_IMAGE=%s\n' "$IMAGE" > "$REMOTE_ROOT/deployment.env.next"
chmod 0644 "$REMOTE_ROOT/deployment.env.next"
mv -f "$REMOTE_ROOT/deployment.env.next" "$REMOTE_ROOT/deployment.env"

mutating=0
trap - ERR
echo "Staging deployment probes passed; backup and previous image were retained"
REMOTE_SCRIPT
