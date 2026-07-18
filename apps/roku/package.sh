#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
cd "$REPO_ROOT"
npm run roku:test
npm run roku:check
major="$(awk -F= '$1=="major_version"{print $2}' "$APP_ROOT/manifest")"
minor="$(awk -F= '$1=="minor_version"{print $2}' "$APP_ROOT/manifest")"
build="$(awk -F= '$1=="build_version"{print $2}' "$APP_ROOT/manifest")"
mkdir -p "$APP_ROOT/dist"
output="$APP_ROOT/dist/flux-roku-${major}.${minor}.${build}.zip"
rm -f "$output"
cd "$APP_ROOT"
package_paths=(manifest source components images)
if [[ -d locale ]]; then package_paths+=(locale); fi
zip -qr "$output" "${package_paths[@]}" -x 'dist/*' '*.map' '*.log'
printf '%s\n' "$output"
