#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROKU_IP="${1:-${ROKU_IP:-}}"
ROKU_USER="${ROKU_USER:-rokudev}"
ROKU_PASSWORD="${2:-${ROKU_PASSWORD:-}}"
if [[ -z "$ROKU_IP" || -z "$ROKU_PASSWORD" ]]; then
  echo "Usage: ROKU_PASSWORD=... $0 <roku-ip> [password]" >&2
  exit 2
fi
zip_path="$($APP_ROOT/package.sh)"
curl --fail --silent --show-error --digest --user "$ROKU_USER:$ROKU_PASSWORD" \
  -F "mysubmit=Install" -F "archive=@$zip_path" "http://$ROKU_IP/plugin_install"
printf 'Flux Roku sideloaded to %s\n' "$ROKU_IP"

