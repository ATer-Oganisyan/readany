#!/usr/bin/env bash
set -euo pipefail

# Compatibility entrypoint. The only supported target is the staging host
# available through the local SSH alias `fun1`.
HERE="$(cd "$(dirname "$0")" && pwd)"
exec "$HERE/deploy-staging-fun1.sh" "$@"
