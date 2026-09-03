#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

operation="deploy"
environment=""
host=""
remote_root=""
ssh_port=""
identity_file=""
bundle_version=""
transport_dry_run=0
forward_args=()

bundle_files=(
  "$HERE/deploy.sh"
  "$HERE/migrate.sh"
  "$HERE/compose.i167.yml"
)

usage() {
  cat <<'EOF'
Upload the minimal Narra deployment bundle and run it on a remote server.

Usage:
  ./deploy-remote.sh --environment test|prod [remote options] [deploy options]

Remote options:
  --host USER@HOST             TEST defaults to fun1; required for PROD unless
                               NARRA_PROD_SSH_HOST is set.
  --ssh-port PORT              Optional SSH port.
  --identity-file PATH         Optional SSH private key.
  --remote-root PATH           Defaults to /srv/narra-stagging in TEST and
                               /opt/narra-production in PROD.
  --bundle-version ID          Deployment bundle directory name; defaults to
                               the current Git commit.
  --operation OPERATION        deploy (default), migrate-check, migrate-apply.
  --transport-dry-run          Print SSH/SCP commands without connecting.
  -h, --help                   Show this help.

All other options are forwarded to deploy.sh or migrate.sh. In particular:
  --mode, --component, --service, --changed-path, --image, --env-file,
  --project, --pull, --wait-timeout, --confirm-stateful-restart, --confirm,
  and --dry-run.

The fixed server bundle contains only deploy.sh, migrate.sh, and
compose.i167.yml. Application source, migrations, secrets, and repository
metadata are never copied. Migrations are read from the selected Docker image.

Git-based --from/--to diff calculation is intentionally rejected because the
remote server has no repository. Calculate the diff locally or in CI and pass
one or more --changed-path arguments.
EOF
}

die() {
  echo "deploy-remote: $*" >&2
  exit 2
}

need_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      need_value "$@"
      host="$2"
      shift 2
      ;;
    --ssh-port)
      need_value "$@"
      ssh_port="$2"
      shift 2
      ;;
    --identity-file)
      need_value "$@"
      identity_file="$2"
      shift 2
      ;;
    --remote-root)
      need_value "$@"
      remote_root="$2"
      shift 2
      ;;
    --bundle-version)
      need_value "$@"
      bundle_version="$2"
      shift 2
      ;;
    --operation)
      need_value "$@"
      operation="$2"
      shift 2
      ;;
    --transport-dry-run)
      transport_dry_run=1
      shift
      ;;
    --environment|--env)
      need_value "$@"
      environment="$2"
      forward_args+=("$1" "$2")
      shift 2
      ;;
    --from|--to)
      die "$1 is unavailable for remote deploy; pass --changed-path from CI"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

case "$environment" in
  test|prod) ;;
  "") die "--environment is required" ;;
  *) die "--environment must be test or prod" ;;
esac

case "$operation" in
  deploy|migrate-check|migrate-apply) ;;
  *) die "--operation must be deploy, migrate-check, or migrate-apply" ;;
esac

case "$environment" in
  test)
    host="${host:-${NARRA_TEST_SSH_HOST:-fun1}}"
    remote_root="${remote_root:-/srv/narra-stagging}"
    ;;
  prod)
    host="${host:-${NARRA_PROD_SSH_HOST:-}}"
    [ -n "$host" ] || die "--host or NARRA_PROD_SSH_HOST is required in prod"
    remote_root="${remote_root:-/opt/narra-production}"
    ;;
esac

[[ "$host" =~ ^([a-zA-Z0-9._-]+@)?[a-zA-Z0-9._-]+$ ]] \
  || die "invalid SSH host; pass the port separately with --ssh-port"
[[ "$remote_root" =~ ^/[a-zA-Z0-9._/-]+$ ]] \
  || die "remote root must be an absolute path without whitespace"
[ "$remote_root" != "/" ] || die "remote root must not be /"
[[ "/$remote_root/" != *"/../"* ]] || die "remote root must not contain .."
remote_root="${remote_root%/}"

if [ -n "$ssh_port" ]; then
  [[ "$ssh_port" =~ ^[1-9][0-9]{0,4}$ ]] || die "--ssh-port must be a valid port"
  [ "$ssh_port" -le 65535 ] || die "--ssh-port must be a valid port"
fi
if [ -n "$identity_file" ]; then
  [ -f "$identity_file" ] || die "identity file not found: $identity_file"
fi

for file in "${bundle_files[@]}"; do
  [ -f "$file" ] || die "deployment bundle file not found: $file"
done

if [ -z "$bundle_version" ]; then
  command -v git >/dev/null 2>&1 || die "git or --bundle-version is required"
  bundle_version="$(git -C "$HERE" rev-parse HEAD 2>/dev/null)" \
    || die "cannot determine deployment bundle version"
fi
[[ "$bundle_version" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$ ]] \
  || die "invalid bundle version"

command -v ssh >/dev/null 2>&1 || die "ssh is required"
command -v scp >/dev/null 2>&1 || die "scp is required"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "sha256sum or shasum is required"
  fi
}

print_command() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
}

run() {
  print_command "$@"
  [ "$transport_dry_run" = 1 ] || "$@"
}

shell_join() {
  local rendered
  printf -v rendered '%q ' "$@"
  printf '%s' "${rendered% }"
}

ssh_args=(-o BatchMode=yes)
scp_args=(-o BatchMode=yes)
if [ -n "$ssh_port" ]; then
  ssh_args+=(-p "$ssh_port")
  scp_args+=(-P "$ssh_port")
fi
if [ -n "$identity_file" ]; then
  ssh_args+=(-i "$identity_file")
  scp_args+=(-i "$identity_file")
fi

release_dir="$remote_root/releases/$bundle_version"
incoming_dir="$remote_root/releases/.incoming-$bundle_version-$$-$RANDOM"
lock_file="$remote_root/deploy.lock"

quoted_root="$(printf '%q' "$remote_root")"
quoted_incoming="$(printf '%q' "$incoming_dir")"
prepare_line="set -euo pipefail; install -d -m 0755 $quoted_root $quoted_root/releases; test ! -e $quoted_incoming; install -d -m 0755 $quoted_incoming"
prepare_command="$(shell_join bash -lc "$prepare_line")"

printf '[deploy-remote] environment=%s operation=%s host=%s bundle=%s\n' \
  "$environment" "$operation" "$host" "$bundle_version"
printf '[deploy-remote] files= deploy.sh migrate.sh compose.i167.yml\n'

run ssh "${ssh_args[@]}" "$host" "$prepare_command"
run scp "${scp_args[@]}" "${bundle_files[@]}" "$host:$incoming_dir/"

deploy_hash="$(sha256_file "$HERE/deploy.sh")"
migrate_hash="$(sha256_file "$HERE/migrate.sh")"
compose_hash="$(sha256_file "$HERE/compose.i167.yml")"

quoted_release="$(printf '%q' "$release_dir")"
finalize_line="set -euo pipefail; test \"\$(sha256sum $quoted_incoming/deploy.sh | awk '{print \$1}')\" = $deploy_hash; test \"\$(sha256sum $quoted_incoming/migrate.sh | awk '{print \$1}')\" = $migrate_hash; test \"\$(sha256sum $quoted_incoming/compose.i167.yml | awk '{print \$1}')\" = $compose_hash; chmod 0755 $quoted_incoming/deploy.sh $quoted_incoming/migrate.sh; chmod 0644 $quoted_incoming/compose.i167.yml; if [ -d $quoted_release ]; then cmp -s $quoted_incoming/deploy.sh $quoted_release/deploy.sh; cmp -s $quoted_incoming/migrate.sh $quoted_release/migrate.sh; cmp -s $quoted_incoming/compose.i167.yml $quoted_release/compose.i167.yml; rm -- $quoted_incoming/deploy.sh $quoted_incoming/migrate.sh $quoted_incoming/compose.i167.yml; rmdir $quoted_incoming; else mv -- $quoted_incoming $quoted_release; fi"
finalize_invocation="$(shell_join flock -x "$lock_file" bash -lc "$finalize_line")"
finalize_command="$(shell_join bash -lc "$finalize_invocation")"
run ssh "${ssh_args[@]}" "$host" "$finalize_command"

case "$operation" in
  deploy)
    entrypoint="$release_dir/deploy.sh"
    remote_args=("${forward_args[@]}")
    ;;
  migrate-check)
    entrypoint="$release_dir/migrate.sh"
    remote_args=("${forward_args[@]}" --check)
    ;;
  migrate-apply)
    entrypoint="$release_dir/migrate.sh"
    remote_args=("${forward_args[@]}" --apply)
    ;;
esac

remote_invocation="$(shell_join flock -x "$lock_file" "$entrypoint" "${remote_args[@]}")"
quoted_current="$(printf '%q' "$remote_root/current")"
quoted_current_next="$(printf '%q' "$remote_root/current.next")"
activate_line="set -euo pipefail; $remote_invocation; ln -sfn $quoted_release $quoted_current_next; mv -Tf -- $quoted_current_next $quoted_current"
activate_command="$(shell_join bash -lc "$activate_line")"
run ssh "${ssh_args[@]}" "$host" "$activate_command"

if [ "$transport_dry_run" = 1 ]; then
  printf '[deploy-remote] transport dry-run completed; no connection was made\n'
else
  printf '[deploy-remote] completed host=%s release=%s\n' "$host" "$release_dir"
fi
