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
#   BUILD_NAME           x.y.z, digits only                  (--build-name; pubspec's version is not used)
#   BUILD_NUMBER         positive integer, higher than the last upload (--build-number)
#   SENTRY_DSN           https://...                         (crash reporting; required, never printed)
#   SENTRY_ENVIRONMENT   optional, default production
#
#   scripts/mobile/build-store.sh ios       # flutter build ipa (signed by Xcode: team KX683HAR3Y)
#   scripts/mobile/build-store.sh android   # flutter build appbundle (android/key.properties)
#   scripts/mobile/build-store.sh check     # only the checks, no build
#   scripts/mobile/build-store.sh ios-config  # checks, then `flutter build ios --config-only` with the
#                                             # same flags: CI archives and signs with xcodebuild itself
#                                             # (.github/workflows/release-store-builds.yml)
#
# The API and lessons hosts must look like production (no staging, dev, test, qa, uat, sandbox,
# preview, local, localhost, example, ngrok, internal label, no IP literal). Debug symbols are kept
# in build/symbols/<platform>/<BUILD_NAME>+<BUILD_NUMBER> (--split-debug-info; the code is not obfuscated).
#
# None of these are secrets (the Sentry DSN is not printed). See docs/mobile/store-builds.md.
#
# FLUTTER overrides the flutter binary (default: `flutter` on PATH, then
# ~/development/flutter/bin/flutter).
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  ios | android | check | ios-config) : ;;
  *) echo "usage: $0 ios|android|check|ios-config" >&2; exit 2 ;;
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

# The host of an https URL, lower-cased, without port. Refuses user info, IP literals and any host
# label that marks a non-production environment. Prints the accepted host.
production_host() { # name value
  local name="$1" value="$2" rest host label
  rest="${value#https://}"
  host="${rest%%[/?#]*}"
  case "$host" in *@*) fail "$name must not contain user info (user@host)" ;; esac
  case "$host" in \[*) fail "$name host must be a name, not an IP literal: $host" ;; esac
  host="${host%%:*}"
  host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
  [ -n "$host" ] || fail "$name has no host"
  if [[ "$host" =~ ^[0-9.]+$ ]]; then fail "$name host must be a name, not an IP literal: $host"; fi
  local IFS='.-'
  for label in $host; do
    case "$label" in
      staging | stage | dev | develop | test | testing | qa | uat | sandbox | preview | local | localhost | example | ngrok | internal)
        fail "$name host looks non-production ('$label' in $host): a store build must use the production host" ;;
    esac
  done
  printf '%s' "$host"
}

[[ "${BUILD_NAME:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "BUILD_NAME must be x.y.z (digits only), e.g. 1.0.1"
[[ "${BUILD_NUMBER:-}" =~ ^[1-9][0-9]*$ ]] || fail "BUILD_NUMBER must be a positive integer, higher than the last upload"
https_url API_BASE_URL "${API_BASE_URL:-}"
case "$API_BASE_URL" in */api/v1) : ;; *) fail "API_BASE_URL must end in /api/v1" ;; esac
API_HOST="$(production_host API_BASE_URL "$API_BASE_URL")"
LESSONS_HOST=""
https_url PRIVACY_POLICY_URL "${PRIVACY_POLICY_URL:-}"
https_url TERMS_URL "${TERMS_URL:-}"
https_url SUPPORT_URL "${SUPPORT_URL:-}"
email_address SUPPORT_EMAIL "${SUPPORT_EMAIL:-}"
if [ -n "${LESSONS_ORIGIN:-}" ]; then
  https_url LESSONS_ORIGIN "$LESSONS_ORIGIN"
  LESSONS_HOST="$(production_host LESSONS_ORIGIN "$LESSONS_ORIGIN")"
fi
[ -n "${SENTRY_DSN:-}" ] || fail "SENTRY_DSN is not set: a store build must report crashes"
case "$SENTRY_DSN" in
  https://?*) : ;;
  *) fail "SENTRY_DSN must be an https URL" ;;
esac
case "$SENTRY_DSN" in
  *[[:space:]]*) fail "SENTRY_DSN must not contain spaces" ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "$TARGET" = android ] && [ ! -f "$ROOT/android/key.properties" ]; then
  fail "android/key.properties is missing: a store build is never signed with the debug key (docs/mobile/store-builds.md)"
fi
echo "build-store: version $BUILD_NAME+$BUILD_NUMBER, API host $API_HOST${LESSONS_HOST:+, lessons host $LESSONS_HOST}, Sentry DSN set"
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
PLATFORM="$TARGET"
[ "$TARGET" = ios-config ] && PLATFORM=ios
SYMBOLS="build/symbols/$PLATFORM/$BUILD_NAME+$BUILD_NUMBER"
mkdir -p "$SYMBOLS"
"$FLUTTER" pub get --enforce-lockfile
if [ "$TARGET" = ios-config ]; then
  # Writes the version, the dart-defines and the symbols path into ios/Flutter/Generated.xcconfig
  # without building or signing. `xcodebuild archive` then compiles the Dart code with exactly
  # these values, so the defines live in this file only (CI must not repeat them).
  "$FLUTTER" build ios --release --config-only --build-name "$BUILD_NAME" --build-number "$BUILD_NUMBER" --split-debug-info="$SYMBOLS" "${DEFINES[@]}"
  echo "build-store: iOS project configured for $BUILD_NAME+$BUILD_NUMBER; archive it with xcodebuild"
  echo "build-store: Dart symbols will be written to: $ROOT/$SYMBOLS"
  exit 0
fi
if [ "$TARGET" = ios ]; then
  "$FLUTTER" build ipa --release --build-name "$BUILD_NAME" --build-number "$BUILD_NUMBER" --split-debug-info="$SYMBOLS" "${DEFINES[@]}"
else
  "$FLUTTER" build appbundle --release --build-name "$BUILD_NAME" --build-number "$BUILD_NUMBER" --split-debug-info="$SYMBOLS" "${DEFINES[@]}"
fi
echo "build-store: Dart symbols (keep; upload to Sentry): $ROOT/$SYMBOLS"
if [ "$TARGET" = ios ]; then
  echo "build-store: dSYMs: $ROOT/build/ios/archive/Runner.xcarchive/dSYMs"
fi
echo "build-store: upload them with sentry-cli (docs/mobile/store-builds.md, 'Debug symbols')"
