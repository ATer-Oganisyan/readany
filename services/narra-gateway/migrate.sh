#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$HERE/compose.i167.yml"

environment=""
action=""
image=""
env_file=""
project=""
pull_policy="always"
dry_run=0
confirmed=0

usage() {
  cat <<'EOF'
Run or check Narra PostgreSQL migrations through Docker Compose.

Usage:
  ./migrate.sh --environment test|prod (--check|--apply) [options]

Options:
  --image IMAGE          Optional in test; required and immutable in prod.
  --env-file PATH        Environment-specific Compose env file.
  --project NAME         Compose project name.
  --pull always|missing|never
  --confirm              Required with --apply in prod.
  --dry-run              Print Compose commands without executing them.
  -h, --help

This operation never creates a backup and never restarts application services.
Run the independent backup procedure before a production migration when the
release policy requires one.
EOF
}

die() {
  echo "migrate: $*" >&2
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
    --check|--apply)
      [ -z "$action" ] || die "choose exactly one of --check or --apply"
      action="${1#--}"
      shift
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
    --confirm)
      confirmed=1
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
[ -n "$action" ] || die "choose exactly one of --check or --apply"
case "$pull_policy" in
  always|missing|never) ;;
  *) die "--pull must be always, missing, or never" ;;
esac

case "$environment" in
  test)
    image="${image:-ghcr.io/mishanaer/narra-gateway:test-latest}"
    env_file="${env_file:-${NARRA_TEST_ENV_FILE:-/srv/narra-stagging/compose.env}}"
    project="${project:-narra-stagging}"
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
    if [ "$action" = "apply" ] && [ "$confirmed" != 1 ]; then
      die "production migration requires --confirm"
    fi
    ;;
esac

[[ "$project" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || die "invalid Compose project name"
[[ "$image" != *[[:space:]]* ]] || die "image reference must not contain whitespace"

export NARRA_COMPOSE_PROJECT="$project"
export NARRA_GATEWAY_IMAGE="$image"
export NARRA_ENV_FILE="$env_file"

compose=(
  docker compose
  --project-name "$project"
  --env-file "$env_file"
  --file "$COMPOSE_FILE"
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

printf '[migrate] environment=%s action=%s project=%s image=%s\n' \
  "$environment" "$action" "$project" "$image"

if [ "$dry_run" != 1 ]; then
  [ -f "$env_file" ] || die "environment file not found: $env_file"
fi

run "${compose[@]}" config --quiet
if [ "$pull_policy" != "never" ]; then
  run "${compose[@]}" pull --policy "$pull_policy" migrate postgres
fi

if [ "$action" = "check" ]; then
  run "${compose[@]}" run --rm --no-deps migrate node migrate.mjs --check
else
  run "${compose[@]}" run --rm migrate
fi
