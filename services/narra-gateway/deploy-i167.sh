#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:?set REMOTE=max@158.160.163.167}"
EXPECTED_REMOTE_IMAGE_ID="${EXPECTED_REMOTE_IMAGE_ID:?set the exact current gateway image ID}"
REVIEWED_COMMIT="${REVIEWED_COMMIT:?set the full commit approved by review}"
REMOTE_ROOT="${REMOTE_ROOT:-/srv/narra-gateway}"
TARGET_ENV="${TARGET_ENV:-/etc/narra-gateway.env}"
CURRENT_CONTAINER="${CURRENT_CONTAINER:-narra-gateway-1}"
DRY_RUN="${DRY_RUN:-0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
HEAD="$(git -C "$REPO" rev-parse HEAD)"

if [ "$REMOTE" != "max@158.160.163.167" ] \
  || [ "$REMOTE_ROOT" != "/srv/narra-gateway" ] \
  || [ "$TARGET_ENV" != "/etc/narra-gateway.env" ] \
  || [[ ! "$CURRENT_CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] \
  || [[ ! "$EXPECTED_REMOTE_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] \
  || [[ ! "$REVIEWED_COMMIT" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Invalid deployment precondition" >&2
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

VERSION="${HEAD:0:12}-$(date -u +%Y%m%d%H%M)"
IMAGE="readany/narra-gateway:$HEAD"
REMOTE_RELEASES="$REMOTE_ROOT/releases"
REMOTE_STAGE="$REMOTE_RELEASES/$VERSION"
FLAGS=(-az --exclude=node_modules --exclude=.data --exclude=.env --exclude='*.log')
[ "$DRY_RUN" = "1" ] && FLAGS+=(--dry-run -v)

remote_image_id="$(ssh "$REMOTE" "sudo docker inspect --format '{{.Image}}' '$CURRENT_CONTAINER'")"
if [ "$remote_image_id" != "$EXPECTED_REMOTE_IMAGE_ID" ]; then
  echo "Remote image drift: expected $EXPECTED_REMOTE_IMAGE_ID, got $remote_image_id" >&2
  exit 1
fi

echo "[deploy] reviewed $HEAD -> $REMOTE ($IMAGE)"
if [ "$DRY_RUN" = "1" ]; then
  rsync "${FLAGS[@]}" --rsync-path="sudo rsync" "$HERE/" "$REMOTE:$REMOTE_STAGE/"
  exit 0
fi

ssh "$REMOTE" \
  "sudo test ! -e '$REMOTE_STAGE' \
   && sudo test -f '$TARGET_ENV' \
   && sudo test \"\$(stat -c %a '$TARGET_ENV')\" = 600 \
   && sudo install -d -o root -g root -m 0755 '$REMOTE_RELEASES' '$REMOTE_STAGE'"
rsync "${FLAGS[@]}" --rsync-path="sudo rsync" "$HERE/" "$REMOTE:$REMOTE_STAGE/"

ssh "$REMOTE" \
  "sudo env \
    REMOTE_ROOT='$REMOTE_ROOT' \
    REMOTE_STAGE='$REMOTE_STAGE' \
    VERSION='$VERSION' \
    IMAGE='$IMAGE' \
    EXPECTED_REMOTE_IMAGE_ID='$EXPECTED_REMOTE_IMAGE_ID' \
    TARGET_ENV='$TARGET_ENV' \
    CURRENT_CONTAINER='$CURRENT_CONTAINER' \
    flock -x /run/lock/narra-gateway-deploy.lock bash -se" <<'REMOTE_SCRIPT'
set -euo pipefail

current_image_id="$(docker inspect --format '{{.Image}}' "$CURRENT_CONTAINER")"
test "$current_image_id" = "$EXPECTED_REMOTE_IMAGE_ID"
current_image_ref="$(docker inspect --format '{{.Config.Image}}' "$CURRENT_CONTAINER")"
test -n "$current_image_ref"

chown -R root:root "$REMOTE_STAGE"
chmod -R go-w "$REMOTE_STAGE"
chmod 0755 "$REMOTE_STAGE/deploy-i167.sh" "$REMOTE_STAGE/bootstrap-i167.sh" "$REMOTE_STAGE/backup-i167.sh"

docker build --pull \
  --build-arg "GATEWAY_BUILD_VERSION=$VERSION" \
  --tag "$IMAGE" "$REMOTE_STAGE"

backup_dir="/srv/backups/narra-gateway"
install -d -o root -g root -m 0700 "$backup_dir"
BACKUP_DIR="$backup_dir" CONTAINER="$CURRENT_CONTAINER" \
  "$REMOTE_STAGE/backup-i167.sh" >/dev/null
backup="$(find "$backup_dir" -maxdepth 1 -type f -name 'gateway-data-*.tar.gz' -printf '%T@ %p\n' \
  | sort -nr | head -n1 | cut -d' ' -f2-)"
test -n "$backup"
gzip -t "$backup"

candidate="narra-gateway-candidate-${VERSION//[^A-Za-z0-9_.-]/-}"
candidate_volume="narra_gateway_candidate_${VERSION//[^A-Za-z0-9_.-]/_}"
cleanup_candidate() {
  docker stop --time 30 "$candidate" >/dev/null 2>&1 || true
  docker rm "$candidate" >/dev/null 2>&1 || true
  docker volume rm "$candidate_volume" >/dev/null 2>&1 || true
}
trap cleanup_candidate EXIT
cleanup_candidate
docker volume create "$candidate_volume" >/dev/null
docker run --rm --network none --user 0:0 \
  --entrypoint sh \
  -v "$candidate_volume:/data" \
  -v "$backup_dir:/backup:ro" \
  "$IMAGE" -c "tar -xzf '/backup/$(basename "$backup")' -C /data && chown -R 1000:1000 /data"

docker run -d --name "$candidate" --init \
  --env-file "$TARGET_ENV" \
  -e NODE_ENV=production \
  -e PORT=8787 \
  -e DATA_DIR=/data \
  -e PERSISTENT_DATA_MOUNT_PATH=/data \
  -e INSTALLATION_SINGLE_REPLICA_ACK=true \
  -e COVER_JOB_WORKER_ENABLED=false \
  -p 127.0.0.1:8789:8787 \
  -v "$candidate_volume:/data" \
  --read-only --tmpfs /tmp:size=64m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 256 --memory 1g --cpus 1.5 \
  "$IMAGE" >/dev/null

candidate_ready=0
for _attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8789/ready >/dev/null; then
    candidate_ready=1
    break
  fi
  sleep 1
done
test "$candidate_ready" = 1
curl -fsS http://127.0.0.1:8789/health | python3 -c '
import json, sys
data = json.load(sys.stdin)
expected = sys.argv[1]
assert data["ok"] is True
assert data["version"] == expected
assert data["services"]["gigachat"] is True
assert data["services"]["salutespeech"] is True
assert data["services"]["cover"] is True
assert data["installation_registry"]["storage_verified"] is True
assert data["cover_jobs"]["storage_verified"] is True
assert data["cover_jobs"]["worker"]["enabled"] is False
assert data["analytics_delivery"]["configured"] is True
' "$VERSION"

cleanup_candidate
trap - EXIT

previous_target="$(readlink -f "$REMOTE_ROOT/current" 2>/dev/null || true)"
ln -sfn "$REMOTE_STAGE" "$REMOTE_ROOT/current.next"
mv -Tf "$REMOTE_ROOT/current.next" "$REMOTE_ROOT/current"
printf 'NARRA_GATEWAY_IMAGE=%s\n' "$IMAGE" > "$REMOTE_ROOT/deployment.env.next"
chmod 0644 "$REMOTE_ROOT/deployment.env.next"
mv -f "$REMOTE_ROOT/deployment.env.next" "$REMOTE_ROOT/deployment.env"

compose_profiles=()
rollback_profiles=()
book_backend_enabled=0
if test -n "$(docker ps -aq \
  --filter label=com.docker.compose.project=narra \
  --filter label=com.docker.compose.service=book-markup-worker)"; then
  rollback_profiles+=(--profile book-backend)
fi
if grep -qx 'BOOK_BACKEND_REQUIRED=true' "$TARGET_ENV"; then
  compose_profiles+=(--profile book-backend)
  book_backend_enabled=1
fi

mutating=1
rollback() {
  trap - ERR
  set +e
  NARRA_GATEWAY_IMAGE="$current_image_ref" docker compose -p narra \
    -f "$REMOTE_STAGE/compose.i167.yml" "${rollback_profiles[@]}" up -d --remove-orphans
  if test -n "$previous_target" && test -d "$previous_target"; then
    ln -sfn "$previous_target" "$REMOTE_ROOT/current.rollback"
    mv -Tf "$REMOTE_ROOT/current.rollback" "$REMOTE_ROOT/current"
  fi
  echo "Gateway deployment failed; previous image restart attempted" >&2
  return 1
}
trap 'if [ "$mutating" = 1 ]; then rollback; fi' ERR

NARRA_GATEWAY_IMAGE="$IMAGE" docker compose -p narra \
  -f "$REMOTE_STAGE/compose.i167.yml" "${compose_profiles[@]}" up -d --remove-orphans

if test "$book_backend_enabled" = 1; then
  sleep 3
  for worker_service in book-markup-worker book-identity-worker; do
    worker_ids="$(NARRA_GATEWAY_IMAGE="$IMAGE" docker compose -p narra \
      -f "$REMOTE_STAGE/compose.i167.yml" --profile book-backend ps -q "$worker_service")"
    test -n "$worker_ids"
    for worker_id in $worker_ids; do
      test "$(docker inspect --format '{{.State.Running}}' "$worker_id")" = true
      test "$(docker inspect --format '{{.RestartCount}}' "$worker_id")" = 0
    done
  done
fi

production_ready=0
for _attempt in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8788/ready >/dev/null; then
    production_ready=1
    break
  fi
  sleep 1
done
test "$production_ready" = 1
curl -fsS http://127.0.0.1:8788/health | python3 -c '
import json, sys
data = json.load(sys.stdin)
expected = sys.argv[1]
assert data["ok"] is True
assert data["version"] == expected
assert data["installation_registry"]["storage_verified"] is True
assert data["analytics_delivery"]["configured"] is True
' "$VERSION"
curl -fsS https://api.narra.disrupt.builders/health | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data["ok"] is True
assert data["version"] == sys.argv[1]
' "$VERSION"

install -m 0644 "$REMOTE_STAGE/narra-gateway-backup.service" \
  /etc/systemd/system/narra-gateway-backup.service
install -m 0644 "$REMOTE_STAGE/narra-gateway-backup.timer" \
  /etc/systemd/system/narra-gateway-backup.timer
systemctl daemon-reload
systemctl enable --now narra-gateway-backup.timer

mutating=0
trap - ERR
echo "Gateway deployment probes passed; rollback image and volume backup retained"
REMOTE_SCRIPT
