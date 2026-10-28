#!/usr/bin/env bash
# PD-28: build the teacher web portal -- the SAME Flutter app as the phones, for
# the browser -- and place it where the Admin Web image serves it (/teacher/).
#
#   scripts/mobile/build-teacher-web.sh https://api.staging.jawwid.example/api/v1
#
# The API base URL is compiled into the bundle, exactly as it is into a phone
# build (lib/core/network/api_config.dart), so the bundle is per environment like
# Admin Web's (ADR-006). It is not a secret; nothing secret may be passed here.
#
# Output: apps/admin-web/teacher-web/, which apps/admin-web/Dockerfile copies to
# /usr/share/nginx/html/teacher/. See docs/mobile/teacher-web-portal.md.
#
# FLUTTER overrides the flutter binary (default: `flutter` on PATH, then
# ~/development/flutter/bin/flutter).
set -euo pipefail

API_BASE_URL="${1:-}"
case "$API_BASE_URL" in
  http://*/api/v1 | https://*/api/v1) : ;;
  *) echo "usage: $0 <api base url ending in /api/v1>" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/apps/admin-web/teacher-web"

FLUTTER="${FLUTTER:-$(command -v flutter || echo "$HOME/development/flutter/bin/flutter")}"
[ -x "$FLUTTER" ] || { echo "flutter not found (set FLUTTER=/path/to/flutter)" >&2; exit 1; }

cd "$ROOT"
"$FLUTTER" pub get --enforce-lockfile
# --no-web-resources-cdn: CanvasKit is served from /teacher/canvaskit/, never
#   from gstatic, so the CSP names no third-party script host.
# --base-href /teacher/: every asset URL is relative to the portal's path.
# --no-wasm-dry-run: this is the JavaScript build; the wasm report is noise.
"$FLUTTER" build web --release \
  --no-web-resources-cdn \
  --no-wasm-dry-run \
  --base-href /teacher/ \
  --dart-define=JAWWID_API_BASE_URL="$API_BASE_URL" \
  --dart-define=JAWWID_LESSONS_ORIGIN="${LESSONS_ORIGIN:-}"

# Replace the previous build, keeping the placeholder that lets the Admin Web
# image build without a portal in it (local Admin Web work).
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .gitkeep -exec rm -rf {} +
cp -R build/web/. "$OUT/"
# Debug symbols are for crash tools, not for browsers.
find "$OUT" -name '*.symbols' -delete

test -f "$OUT/index.html" && test -f "$OUT/canvaskit/canvaskit.wasm"
echo "teacher web portal built for $API_BASE_URL -> $OUT"
