#!/usr/bin/env bash
set -euo pipefail

echo "DEPRECATED: remote SSH deploy is disabled." >&2
echo "Run deploy.sh directly on the target host; it uses Docker Compose only." >&2
exit 64
