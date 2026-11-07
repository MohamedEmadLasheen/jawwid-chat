#!/usr/bin/env bash
# PD-56 (store compliance): the ONLY way to build the app for the App Store or
# Google Play. It refuses to build unless everything a store build must carry
# is set and well-formed, so a store build can never ship without them:
#
#   API_BASE_URL         https://<api host>/api/v1          (compiled in)
#   PRIVACY_POLICY_URL   https://...  ({lang} -> ar | en)   (the owner's text)
#   TERMS_URL            https://...  ({lang} -> ar | en)   (the owner's text)
#   SUPPORT_URL          https://...  ({lang} -> ar | en)   (help page, shown in the app; Apple 1.2/1.5)
#   SUPPORT_EMAIL        name@host.tld                      (support address, shown in the app)
#   LESSONS_ORIGIN       optional, https://...               (PD-29 lesson audio)
#   SENTRY_DSN           optional, https://...               (crash reporting; unset = off)
#   SENTRY_ENVIRONMENT   optional, default production
#
#   scripts/mobile/build-store.sh ios       # flutter build ipa (signed by Xcode: team KX683HAR3Y)
#   scripts/mobile/build-store.sh android   # flutter build appbundle (android/key.properties)
#   scripts/mobile/build-store.sh check     # only the checks, no build
#
# None of these are secrets. See docs/mobile/store-builds.md.
#
# FLUTTER overrides the flutter binary (default: `flutter` on PATH, then
# ~/development/flutter/bin/flutter).
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  ios | android | check) : ;;
  *) echo "usage: $0 ios|android|check" >&2; exit 2 ;;
esac

fail() { echo "build-store: $*" >&2; exit 1; }

https_url() { # name value
  local name="$1" value="$2"
  [ -n "$value" ] || fail "$name is not set: a store build must carry it"
  case "$value" in
    https://?*) : ;;
    *) fail "$name must be an https URL, got: $value" ;;
  esac
  case "$value" in
    *[[:space:]]*) fail "$name must not contain spaces" ;;
  esac
}

email_address() { # name value
  local name="$1" value="$2"
  [ -n "$value" ] || fail "$name is not set: a store build must carry it"
  case "$value" in
    *[[:space:]]*) fail "$name must not contain spaces" ;;
  esac
  # One @, something before it, and a dotted host after it. Plausible, not a full RFC check.
  [[ "$value" =~ ^[^@:/]+@[^@:/.]+(\.[^@:/.]+)+$ ]] || fail "$name must be an e-mail address like support@example.org, got: $value"
}

https_url API_BASE_URL "${API_BASE_URL:-}"
case "$API_BASE_URL" in */api/v1) : ;; *) fail "API_BASE_URL must end in /api/v1" ;; esac
https_url PRIVACY_POLICY_URL "${PRIVACY_POLICY_URL:-}"
https_url TERMS_URL "${TERMS_URL:-}"
https_url SUPPORT_URL "${SUPPORT_URL:-}"
email_address SUPPORT_EMAIL "${SUPPORT_EMAIL:-}"
[ -z "${LESSONS_ORIGIN:-}" ] || https_url LESSONS_ORIGIN "$LESSONS_ORIGIN"
[ -z "${SENTRY_DSN:-}" ] || https_url SENTRY_DSN "$SENTRY_DSN"
[ -n "${SENTRY_DSN:-}" ] || echo "build-store: SENTRY_DSN is not set: this build will report no crashes" >&2

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "$TARGET" = android ] && [ ! -f "$ROOT/android/key.properties" ]; then
  fail "android/key.properties is missing: a store build is never signed with the debug key (docs/mobile/store-builds.md)"
fi
if [ "$TARGET" = check ]; then
  echo "build-store: ok"
  exit 0
fi

FLUTTER="${FLUTTER:-$(command -v flutter || echo "$HOME/development/flutter/bin/flutter")}"
[ -x "$FLUTTER" ] || fail "flutter not found (set FLUTTER=/path/to/flutter)"

DEFINES=(
  --dart-define=JAWWID_API_BASE_URL="$API_BASE_URL"
  --dart-define=PRIVACY_POLICY_URL="$PRIVACY_POLICY_URL"
  --dart-define=TERMS_URL="$TERMS_URL"
  --dart-define=SUPPORT_URL="$SUPPORT_URL"
  --dart-define=SUPPORT_EMAIL="$SUPPORT_EMAIL"
  --dart-define=JAWWID_LESSONS_ORIGIN="${LESSONS_ORIGIN:-}"
  --dart-define=SENTRY_DSN="${SENTRY_DSN:-}"
  --dart-define=SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-production}"
)

cd "$ROOT"
"$FLUTTER" pub get --enforce-lockfile
if [ "$TARGET" = ios ]; then
  "$FLUTTER" build ipa --release "${DEFINES[@]}"
else
  "$FLUTTER" build appbundle --release "${DEFINES[@]}"
fi
