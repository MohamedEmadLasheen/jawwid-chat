#!/usr/bin/env bash
# Refuse to build a browser bundle that carries a server secret.
# Owner: AI #7 (infrastructure).
#
#   scripts/infra/check-web-env.sh              # checks VITE_* in the environment
#   scripts/infra/check-web-env.sh --bundle apps/admin-web/dist
#
# Vite inlines every VITE_* variable into the JavaScript it ships. There is no
# such thing as a "private" VITE_ variable: whatever is here is readable by
# anyone who opens the browser's devtools. This check runs before the build (on
# the variables) and after it (on the emitted bundle), because the second catches
# secrets that reached the bundle some other way.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE=""
[ "${1:-}" = "--bundle" ] && BUNDLE="${2:-}"

# Names that must never appear with a VITE_ prefix.
FORBIDDEN_NAME='SECRET|PRIVATE|PASSWORD|CREDENTIAL|SERVICE_ACCOUNT|SERVICE_ROLE|_API_KEY$|^VITE_JWT|^VITE_CORE_API|^VITE_STORAGE_SECRET|^VITE_LIVEKIT_API_SECRET'

# Values that are credentials whatever they are called.
FORBIDDEN_VALUE='-----BEGIN [A-Z ]*PRIVATE KEY-----|"type"[[:space:]]*:[[:space:]]*"service_account"|service_role'

errors=0

while IFS='=' read -r -d '' name value; do
  case "$name" in VITE_*) : ;; *) continue ;; esac

  if printf '%s' "$name" | grep -Eq "$FORBIDDEN_NAME"; then
    printf '  FORBIDDEN  %s — a VITE_ variable is public; this name says it is not\n' "$name"
    errors=$((errors + 1))
    continue
  fi
  # -e: the pattern starts with "-" and grep would read it as options.
  if [ -n "$value" ] && printf '%s' "$value" | grep -Eq -e "$FORBIDDEN_VALUE"; then
    printf '  FORBIDDEN  %s — value looks like a credential\n' "$name"
    errors=$((errors + 1))
  fi
done < <(env -0)

if [ -n "$BUNDLE" ]; then
  [ -d "$BUNDLE" ] || { echo "bundle directory not found: $BUNDLE" >&2; exit 66; }
  # -l: report the file, never the matching text. Printing a leaked key into a
  # CI log would copy the leak into a second system.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf '  FORBIDDEN  credential-shaped content in %s\n' "$f"
    errors=$((errors + 1))
  done < <(grep -rlE -e "$FORBIDDEN_VALUE" "$BUNDLE" 2>/dev/null || true)
fi

if [ "$errors" -eq 0 ]; then
  echo "web bundle configuration: clean"
else
  echo
  echo "web bundle configuration: $errors problem(s) — build refused"
  echo "A secret needed by the browser is a design error, not a configuration"
  echo "one: route the call through the API instead. See"
  echo "docs/infrastructure/secrets.md, 'Client applications'."
  exit 1
fi
