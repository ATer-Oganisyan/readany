#!/usr/bin/env bash
set -euo pipefail

environment=""
host=""
remote_root=""
env_file=""
deploy_user="narra-deploy"
ssh_port=""
identity_file=""
public_key_file=""
transport_dry_run=0

usage() {
  cat <<'EOF'
Prepare an existing Narra host for non-interactive CI deployments.

Usage:
  ./prepare-deploy-host.sh --environment test|prod [options]

Options:
  --host USER@HOST       TEST defaults to fun1; required for PROD.
  --deploy-user USER     Dedicated server account (default: narra-deploy).
  --public-key PATH      CI public key. Default: ~/.ssh/narra-deploy-ci.pub.
                         A dedicated key pair is generated when absent.
  --identity-file PATH   Admin SSH private key used for this one-time setup.
  --ssh-port PORT        Optional admin SSH port.
  --remote-root PATH     TEST: /srv/narra-stagging; PROD: /opt/narra-production.
  --env-file PATH        Defaults to <remote-root>/compose.env.
  --transport-dry-run    Print the SSH command without connecting or generating.
  -h, --help             Show this help.

The command connects to the target host as the existing administrator and uses
one sudo invocation. CI itself never receives SSH or sudo passwords.
EOF
}

die() {
  echo "prepare-deploy-host: $*" >&2
  exit 2
}

need_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"
}

shell_join() {
  local rendered
  printf -v rendered '%q ' "$@"
  printf '%s' "${rendered% }"
}

print_command() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment|--env)
      need_value "$@"
      environment="$2"
      shift 2
      ;;
    --host)
      need_value "$@"
      host="$2"
      shift 2
      ;;
    --deploy-user)
      need_value "$@"
      deploy_user="$2"
      shift 2
      ;;
    --public-key)
      need_value "$@"
      public_key_file="$2"
      shift 2
      ;;
    --identity-file)
      need_value "$@"
      identity_file="$2"
      shift 2
      ;;
    --ssh-port)
      need_value "$@"
      ssh_port="$2"
      shift 2
      ;;
    --remote-root)
      need_value "$@"
      remote_root="$2"
      shift 2
      ;;
    --env-file)
      need_value "$@"
      env_file="$2"
      shift 2
      ;;
    --transport-dry-run)
      transport_dry_run=1
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
  test)
    host="${host:-${NARRA_TEST_SSH_HOST:-fun1}}"
    remote_root="${remote_root:-/srv/narra-stagging}"
    ;;
  prod)
    host="${host:-${NARRA_PROD_SSH_HOST:-}}"
    [ -n "$host" ] || die "--host or NARRA_PROD_SSH_HOST is required in prod"
    remote_root="${remote_root:-/opt/narra-production}"
    ;;
  "") die "--environment is required" ;;
  *) die "--environment must be test or prod" ;;
esac
env_file="${env_file:-$remote_root/compose.env}"

[[ "$host" =~ ^([a-zA-Z0-9._-]+@)?[a-zA-Z0-9._-]+$ ]] \
  || die "invalid SSH host; pass the port separately with --ssh-port"
[[ "$deploy_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || die "invalid deploy user"
for remote_path in "$remote_root" "$env_file"; do
  [[ "$remote_path" =~ ^/[a-zA-Z0-9._/-]+$ ]] \
    || die "remote paths must be absolute and contain no whitespace"
  [ "$remote_path" != "/" ] || die "remote paths must not be /"
  [[ "/$remote_path/" != *"/../"* ]] || die "remote paths must not contain .."
done
if [ -n "$ssh_port" ]; then
  [[ "$ssh_port" =~ ^[1-9][0-9]{0,4}$ ]] || die "invalid SSH port"
  [ "$ssh_port" -le 65535 ] || die "invalid SSH port"
fi
if [ -n "$identity_file" ]; then
  [ -f "$identity_file" ] || die "identity file not found: $identity_file"
fi

if [ -z "$public_key_file" ]; then
  [ -n "${HOME:-}" ] || die "HOME or --public-key is required"
  public_key_file="$HOME/.ssh/narra-deploy-ci.pub"
fi
private_key_file="${public_key_file%.pub}"

if [ "$transport_dry_run" = 0 ] && [ ! -f "$public_key_file" ]; then
  command -v ssh-keygen >/dev/null 2>&1 || die "ssh-keygen is required"
  if [ -f "$private_key_file" ]; then
    ssh-keygen -y -f "$private_key_file" > "$public_key_file"
  else
    install -d -m 0700 "$(dirname "$private_key_file")"
    ssh-keygen -q -t ed25519 -N '' -C "narra-ci-deploy" -f "$private_key_file"
  fi
fi

if [ "$transport_dry_run" = 1 ] && [ ! -f "$public_key_file" ]; then
  public_key="ssh-ed25519 DRY_RUN_KEY narra-ci-deploy"
else
  [ -f "$public_key_file" ] || die "public key not found: $public_key_file"
  public_key="$(tr -d '\r\n' < "$public_key_file")"
  [[ "$public_key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))[[:space:]][A-Za-z0-9+/=]+([[:space:]].*)?$ ]] \
    || die "unsupported or invalid public key: $public_key_file"
fi

command -v ssh >/dev/null 2>&1 || die "ssh is required"
command -v base64 >/dev/null 2>&1 || die "base64 is required"
public_key_base64="$(printf '%s' "$public_key" | base64 | tr -d '\r\n')"

read -r -d '' remote_script <<'REMOTE_SCRIPT' || true
set -euo pipefail
deploy_user="$1"
remote_root="$2"
env_file="$3"
public_key_base64="$4"

command -v useradd >/dev/null
command -v usermod >/dev/null
command -v docker >/dev/null
command -v base64 >/dev/null
docker compose version >/dev/null
getent group docker >/dev/null
test -f "$env_file"

if ! id "$deploy_user" >/dev/null 2>&1; then
  useradd --create-home --user-group --shell /bin/bash "$deploy_user"
fi
deploy_group="$(id -gn "$deploy_user")"
deploy_home="$(getent passwd "$deploy_user" | cut -d: -f6)"
test -n "$deploy_home"

usermod -aG docker "$deploy_user"
install -d -o "$deploy_user" -g "$deploy_group" -m 0700 "$deploy_home/.ssh"
authorized_keys="$deploy_home/.ssh/authorized_keys"
touch "$authorized_keys"
public_key="$(printf '%s' "$public_key_base64" | base64 -d)"
key_entry="restrict $public_key"
grep -Fqx -- "$key_entry" "$authorized_keys" \
  || printf '%s\n' "$key_entry" >> "$authorized_keys"
chown "$deploy_user:$deploy_group" "$authorized_keys"
chmod 0600 "$authorized_keys"

install -d -o "$deploy_user" -g "$deploy_group" -m 0750 \
  "$remote_root" "$remote_root/releases"
chown -R "$deploy_user:$deploy_group" "$remote_root/releases"
chown "$deploy_user:$deploy_group" "$remote_root"
chmod 0750 "$remote_root"
if [ -e "$remote_root/deploy.lock" ]; then
  chown "$deploy_user:$deploy_group" "$remote_root/deploy.lock"
fi
chown "root:$deploy_group" "$env_file"
chmod 0640 "$env_file"

printf '[prepare-deploy-host] user=%s root=%s env=%s\n' \
  "$deploy_user" "$remote_root" "$env_file"
printf '[prepare-deploy-host] CI access is ready; no sudo password is required during deploy\n'
REMOTE_SCRIPT

remote_invocation="$(shell_join \
  sudo bash -lc "$remote_script" prepare-deploy-host \
  "$deploy_user" "$remote_root" "$env_file" "$public_key_base64"
)"
remote_command="$(shell_join bash -lc "$remote_invocation")"

ssh_args=(-tt)
if [ -n "$ssh_port" ]; then
  ssh_args+=(-p "$ssh_port")
fi
if [ -n "$identity_file" ]; then
  ssh_args+=(-i "$identity_file")
fi

printf '[prepare-deploy-host] environment=%s host=%s deploy-user=%s\n' \
  "$environment" "$host" "$deploy_user"
print_command ssh "${ssh_args[@]}" "$host" "$remote_command"
if [ "$transport_dry_run" = 0 ]; then
  ssh "${ssh_args[@]}" "$host" "$remote_command"
  printf '[prepare-deploy-host] private CI key: %s\n' "$private_key_file"
  printf '[prepare-deploy-host] add it to GitHub Environment secrets as NARRA_%s_SSH_KEY\n' \
    "$(printf '%s' "$environment" | tr '[:lower:]' '[:upper:]')"
fi
