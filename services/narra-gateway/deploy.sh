#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$HERE/compose.i167.yml"

environment=""
mode="default"
mode_explicit=0
image=""
env_file=""
project=""
pull_policy="always"
wait_timeout=180
dry_run=0
confirm_stateful_restart=0
diff_from=""
diff_to="HEAD"
components=()
requested_services=()
changed_paths=()
services=()

gateway_services=(gateway)
analysis_services=(
  book-analysis-prepare
  book-analysis-scan
  book-analysis-resolve
  book-analysis-synthesize
  book-analysis-validate
  book-analysis-publish
)
book_worker_services=(book-markup-worker book-identity-worker "${analysis_services[@]}")
media_services=(book-media-worker)
scene_services=(book-scene-worker)
tts_services=(book-tts-markup-worker)
worker_services=(
  "${book_worker_services[@]}"
  "${media_services[@]}"
  "${scene_services[@]}"
  "${tts_services[@]}"
)
runtime_services=(gateway "${worker_services[@]}")
stateful_services=(postgres minio)
full_services=(postgres minio minio-init gateway "${worker_services[@]}")
valid_services=("${full_services[@]}")

usage() {
  cat <<'EOF'
Narra backend deployer. Every deployment mutation is performed by Docker Compose.

Usage:
  ./deploy.sh --environment test|prod [options]

Modes:
  --mode default        Recreate only gateway (default).
  --mode selected       Recreate services selected by --component/--service.
  --mode full           Recreate databases, storage, gateway, and all workers.
  --mode diff           Select affected services from a Git diff.

Selection (repeatable, selected mode):
  --component gateway|workers|book-workers|analysis-workers
              |media-workers|scene-workers|tts-workers
              |runtime|databases|storage|stateful|all
  --service COMPOSE_SERVICE

Diff mode:
  --from GIT_REF        Required unless --changed-path is supplied.
  --to GIT_REF          Defaults to HEAD.
  --changed-path PATH   Supply a repository-relative changed path directly.

Environment and image:
  --image IMAGE         Optional in test; required and immutable in prod.
  --env-file PATH       Defaults to the environment's server env file.
  --project NAME        Defaults to narra-stagging or narra-production.

Execution:
  --pull always|missing|never  Image pull policy (default: always).
  --wait-timeout SECONDS      Compose health timeout (default: 180).
  --confirm-stateful-restart  Required in prod when PostgreSQL/MinIO restart.
  --dry-run                   Print Compose commands without executing them.
  -h, --help                  Show this help.

TEST defaults to readany/narra-gateway:test-latest. PROD accepts only an image
by sha256 digest, full 40-character Git SHA tag, or exact SemVer tag.

Migrations and backups are never executed by this script. Run migrate.sh as a
separate operation before deploy. Backups remain a separate operator action.
EOF
}

die() {
  echo "deploy: $*" >&2
  exit 2
}

need_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment|--env)
      need_value "$@"
      environment="$2"
      shift 2
      ;;
    --mode)
      need_value "$@"
      mode="$2"
      mode_explicit=1
      shift 2
      ;;
    --component)
      need_value "$@"
      components+=("$2")
      shift 2
      ;;
    --service)
      need_value "$@"
      requested_services+=("$2")
      shift 2
      ;;
    --from)
      need_value "$@"
      diff_from="$2"
      shift 2
      ;;
    --to)
      need_value "$@"
      diff_to="$2"
      shift 2
      ;;
    --changed-path)
      need_value "$@"
      changed_paths+=("$2")
      shift 2
      ;;
    --image)
      need_value "$@"
      image="$2"
      shift 2
      ;;
    --env-file)
      need_value "$@"
      env_file="$2"
      shift 2
      ;;
    --project)
      need_value "$@"
      project="$2"
      shift 2
      ;;
    --pull)
      need_value "$@"
      pull_policy="$2"
      shift 2
      ;;
    --wait-timeout)
      need_value "$@"
      wait_timeout="$2"
      shift 2
      ;;
    --confirm-stateful-restart)
      confirm_stateful_restart=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

case "$environment" in
  test|prod) ;;
  "") die "--environment is required" ;;
  *) die "--environment must be test or prod" ;;
esac
case "$mode" in
  default|selected|full|diff) ;;
  *) die "--mode must be default, selected, full, or diff" ;;
esac
case "$pull_policy" in
  always|missing|never) ;;
  *) die "--pull must be always, missing, or never" ;;
esac
[[ "$wait_timeout" =~ ^[1-9][0-9]*$ ]] || die "--wait-timeout must be a positive integer"

if [ "${#components[@]}" -gt 0 ] || [ "${#requested_services[@]}" -gt 0 ]; then
  if [ "$mode_explicit" = 0 ]; then
    mode="selected"
  elif [ "$mode" != "selected" ]; then
    die "--component and --service require --mode selected"
  fi
fi
if [ "$mode" = "selected" ] && [ "${#components[@]}" -eq 0 ] && [ "${#requested_services[@]}" -eq 0 ]; then
  die "selected mode requires --component or --service"
fi
if [ "$mode" != "diff" ] && { [ -n "$diff_from" ] || [ "${#changed_paths[@]}" -gt 0 ] || [ "$diff_to" != "HEAD" ]; }; then
  die "diff selectors require --mode diff"
fi

case "$environment" in
  test)
    image="${image:-readany/narra-gateway:test-latest}"
    env_file="${env_file:-${NARRA_TEST_ENV_FILE:-/srv/narra-stagging/compose.env}}"
    project="${project:-narra-stagging}"
    host_port=8789
    gateway_volume="${project}_gateway-data"
    ;;
  prod)
    [ -n "$image" ] || die "--image is required in prod"
    if [[ ! "$image" =~ @sha256:[a-f0-9]{64}$ ]] \
      && [[ ! "$image" =~ :[a-f0-9]{40}$ ]] \
      && [[ ! "$image" =~ :v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      die "prod image must use a sha256 digest, full Git SHA tag, or exact SemVer tag"
    fi
    env_file="${env_file:-${NARRA_PROD_ENV_FILE:-/opt/narra-production/compose.env}}"
    project="${project:-narra-production}"
    host_port=8788
    gateway_volume="${project}_gateway-data"
    ;;
esac

[[ "$project" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || die "invalid Compose project name"
[[ "$image" != *[[:space:]]* ]] || die "image reference must not contain whitespace"

add_service() {
  local candidate="$1" existing
  if [ "${#services[@]}" -gt 0 ]; then
    for existing in "${services[@]}"; do
      [ "$existing" = "$candidate" ] && return 0
    done
  fi
  services+=("$candidate")
}

add_many() {
  local item
  for item in "$@"; do add_service "$item"; done
}

is_valid_service() {
  local candidate="$1" allowed
  for allowed in "${valid_services[@]}"; do
    [ "$candidate" = "$allowed" ] && return 0
  done
  return 1
}

add_component() {
  case "$1" in
    gateway) add_many "${gateway_services[@]}" ;;
    workers) add_many "${worker_services[@]}" ;;
    book-workers) add_many "${book_worker_services[@]}" ;;
    analysis-workers) add_many "${analysis_services[@]}" ;;
    media-workers) add_many "${media_services[@]}" ;;
    scene-workers) add_many "${scene_services[@]}" ;;
    tts-workers) add_many "${tts_services[@]}" ;;
    runtime) add_many "${runtime_services[@]}" ;;
    databases) add_service postgres ;;
    storage) add_service minio ;;
    stateful) add_many "${stateful_services[@]}" ;;
    all) add_many "${full_services[@]}" ;;
    *) die "unknown component: $1" ;;
  esac
}

select_from_changed_path() {
  local path="$1"
  case "$path" in
    services/narra-gateway/migrations/*)
      add_many "${runtime_services[@]}"
      ;;
    services/narra-gateway/compose.i167.yml)
      add_many "${full_services[@]}"
      ;;
    services/narra-gateway/index.mjs)
      add_service gateway
      ;;
    services/narra-gateway/book-analysis-scan-worker.mjs|services/narra-gateway/book-analysis-scan-worker-runner.mjs)
      add_service book-analysis-scan
      ;;
    services/narra-gateway/book-analysis-resolve-worker.mjs|services/narra-gateway/book-analysis-resolve-worker-runner.mjs)
      add_service book-analysis-resolve
      ;;
    services/narra-gateway/book-analysis-prepare-worker.mjs|services/narra-gateway/book-analysis-worker.mjs)
      add_service book-analysis-prepare
      ;;
    services/narra-gateway/book-analysis-synthesize-worker.mjs)
      add_service book-analysis-synthesize
      ;;
    services/narra-gateway/book-analysis-validate-worker.mjs)
      add_service book-analysis-validate
      ;;
    services/narra-gateway/book-analysis-publish-worker.mjs)
      add_service book-analysis-publish
      ;;
    services/narra-gateway/book-analysis-stage-worker-runner.mjs)
      add_many book-analysis-synthesize book-analysis-validate
      ;;
    services/narra-gateway/book-identity-worker.mjs)
      add_service book-identity-worker
      ;;
    services/narra-gateway/book-tts-markup-worker*.mjs)
      add_many "${tts_services[@]}"
      ;;
    services/narra-gateway/book-markup-worker.mjs|services/narra-gateway/generation-worker.mjs)
      add_many book-markup-worker "${media_services[@]}" "${scene_services[@]}"
      ;;
    services/narra-gateway/Dockerfile|services/narra-gateway/package.json|services/narra-gateway/package-lock.json)
      add_many "${runtime_services[@]}"
      ;;
    services/narra-gateway/test/*|services/narra-gateway/README.md|services/narra-gateway/*.sh|services/narra-gateway/migrate.mjs)
      ;;
    services/narra-gateway/*)
      # Unknown backend source is treated as shared to avoid a partial rollout.
      add_many "${runtime_services[@]}"
      ;;
    *)
      ;;
  esac
}

case "$mode" in
  default)
    add_service gateway
    ;;
  full)
    add_many "${full_services[@]}"
    ;;
  selected)
    if [ "${#components[@]}" -gt 0 ]; then
      for component in "${components[@]}"; do add_component "$component"; done
    fi
    if [ "${#requested_services[@]}" -gt 0 ]; then
      for service in "${requested_services[@]}"; do
        is_valid_service "$service" || die "unknown or one-shot Compose service: $service"
        add_service "$service"
      done
    fi
    ;;
  diff)
    if [ "${#changed_paths[@]}" -eq 0 ]; then
      [ -n "$diff_from" ] || die "diff mode requires --from or --changed-path"
      repo="$(git -C "$HERE" rev-parse --show-toplevel)" || die "diff mode requires a Git checkout"
      if [ "$diff_to" = "WORKTREE" ]; then
        diff_output="$(git -C "$repo" diff --name-only "$diff_from" --)" || die "cannot calculate Git diff"
      else
        diff_output="$(git -C "$repo" diff --name-only "$diff_from" "$diff_to" --)" || die "cannot calculate Git diff"
      fi
      while IFS= read -r changed_path; do
        [ -n "$changed_path" ] && changed_paths+=("$changed_path")
      done <<< "$diff_output"
    fi
    if [ "${#changed_paths[@]}" -gt 0 ]; then
      for changed_path in "${changed_paths[@]}"; do
        select_from_changed_path "$changed_path"
      done
    fi
    ;;
esac

if [ "${#services[@]}" -eq 0 ]; then
  echo "[deploy] no backend Compose services are affected; nothing to do"
  exit 0
fi

stateful_selected=0
application_selected=0
for service in "${services[@]}"; do
  case "$service" in
    postgres|minio|minio-init) stateful_selected=1 ;;
  esac
  case "$service" in
    gateway|book-*) application_selected=1 ;;
  esac
done

if [ "$environment" = "prod" ] && [ "$stateful_selected" = 1 ] \
  && [ "$confirm_stateful_restart" != 1 ]; then
  die "production PostgreSQL/MinIO restart requires --confirm-stateful-restart"
fi

export NARRA_COMPOSE_PROJECT="$project"
export NARRA_GATEWAY_IMAGE="$image"
export NARRA_ENV_FILE="$env_file"
export NARRA_HOST_PORT="$host_port"
export NARRA_GATEWAY_VOLUME="$gateway_volume"

compose=(
  docker compose
  --project-name "$project"
  --env-file "$env_file"
  --file "$COMPOSE_FILE"
  --profile book-backend
  --profile media
  --profile scenes
  --profile tts-markup
  --profile operations
)

print_command() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
}

run() {
  print_command "$@"
  [ "$dry_run" = 1 ] || "$@"
}

printf '[deploy] environment=%s mode=%s project=%s image=%s\n' \
  "$environment" "$mode" "$project" "$image"
printf '[deploy] services='
printf ' %s' "${services[@]}"
printf '\n'

if [ "$dry_run" != 1 ]; then
  [ -f "$env_file" ] || die "environment file not found: $env_file"
fi

run "${compose[@]}" config --quiet

if [ "$pull_policy" != "never" ]; then
  run "${compose[@]}" pull --policy "$pull_policy" "${services[@]}"
fi

if [ "$application_selected" = 1 ]; then
  run "${compose[@]}" run --rm --no-deps migrate node migrate.mjs --check
fi

up_args=(up -d --force-recreate --wait --wait-timeout "$wait_timeout" --pull never)
if [ "$mode" != "full" ]; then
  up_args+=(--no-deps)
fi
run "${compose[@]}" "${up_args[@]}" "${services[@]}"
run "${compose[@]}" ps "${services[@]}"
