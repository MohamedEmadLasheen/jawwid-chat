#!/usr/bin/env bash
# Post-deployment smoke test. Owner: AI #7 (infrastructure).
#
#   scripts/infra/smoke.sh https://api.staging.jawwid.example
#   scripts/infra/smoke.sh https://api.staging.jawwid.example --web https://admin.staging.jawwid.example
#
# Runs automatically after every staging deployment and before a production
# deployment is allowed to proceed. It is deliberately SHALLOW: it asserts the
# deployment is wired up, not that the product is correct. Product correctness
# is AI #5's suite (docs/qa/test-plan.md).
#
# It authenticates as nobody and reads no customer data, so it is safe to run
# against production.
set -uo pipefail

BASE="${1:-}"
WEB=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --web) WEB="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done
[ -n "$BASE" ] || { echo "usage: $0 <api-base-url> [--web <admin-url>]" >&2; exit 64; }
BASE="${BASE%/}"; WEB="${WEB%/}"

pass=0; fail=0
ok()   { printf '  PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); }

fetch() { curl -sS --max-time 15 "$@" 2>/dev/null; }

echo "Smoke test: $BASE"
echo

# --- 1. liveness --------------------------------------------------------------
code="$(fetch -o /tmp/smoke-live.json -w '%{http_code}' "$BASE/health/live")"
[ "$code" = "200" ] && ok "GET /health/live -> 200" || bad "GET /health/live -> ${code:-no response}"

# --- 2. readiness -------------------------------------------------------------
code="$(fetch -o /tmp/smoke-ready.json -w '%{http_code}' "$BASE/health/ready")"
if [ "$code" = "200" ]; then
  ok "GET /health/ready -> 200 (dependencies reachable)"
else
  bad "GET /health/ready -> ${code:-no response}"
  [ -s /tmp/smoke-ready.json ] && sed 's/^/        /' /tmp/smoke-ready.json
fi

# --- 2b. the runtime database role -------------------------------------------
# THE PHASE 1 DEPLOYMENT PREREQUISITE, asserted from outside the process.
#
# Every row-level security policy in this schema is inert for a connection that
# owns the schema, is a superuser, or has BYPASSRLS. The application refuses to
# start on one outside local/test/ci -- but a deployment that never restarted,
# or a failover onto a differently configured host, can put a running instance
# in that state. /health/ready reports it, so the smoke test asserts it.
#
# `leastPrivileged` is null when the probe could not determine it (an
# unreachable database, an older build). Treated as a FAILURE here rather than
# a pass: "we could not tell" is not "it is fine".
least="$(sed -n 's/.*"leastPrivileged":\([a-z]*\).*/\1/p' /tmp/smoke-ready.json 2>/dev/null)"
rls="$(sed -n 's/.*"rlsEnforced":\([a-z]*\).*/\1/p' /tmp/smoke-ready.json 2>/dev/null)"
role="$(sed -n 's/.*"databaseRole":"\([^"]*\)".*/\1/p' /tmp/smoke-ready.json 2>/dev/null)"

if [ "$least" = "true" ] && [ "$rls" = "true" ]; then
  ok "database role is least-privileged and RLS is enforced (role ${role:-unknown})"
else
  bad "database role is NOT least-privileged (leastPrivileged=${least:-unknown}, rlsEnforced=${rls:-unknown}, role=${role:-unknown})"
  echo "        The API is connecting as an owner, superuser or BYPASSRLS role."
  echo "        Point DATABASE_URL at chat_app. See docs/recovery/PHASE-1-REPORT.md 11."
fi

# --- 3. release identity ------------------------------------------------------
# "What is running?" must be answerable from the outside. A deployment that
# reports commit=unknown cannot be correlated with a rollback decision.
commit="$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' /tmp/smoke-live.json 2>/dev/null)"
if [ -n "$commit" ] && [ "$commit" != "unknown" ]; then
  ok "build identity present (commit ${commit:0:12})"
else
  bad "build identity missing -- GIT_COMMIT was not injected at build time"
fi

# --- 4. health must not leak configuration ------------------------------------
if grep -Eq 'postgres(ql)?://|redis://|password|secret|BEGIN [A-Z ]*PRIVATE KEY' \
     /tmp/smoke-live.json /tmp/smoke-ready.json 2>/dev/null; then
  bad "health payload contains connection-string or credential-shaped text"
else
  ok "health payload carries no credentials"
fi

# --- 5. security headers ------------------------------------------------------
headers="$(fetch -D - -o /dev/null "$BASE/health/live" | tr 'A-Z' 'a-z')"
case "$BASE" in
  https://*)
    printf '%s' "$headers" | grep -q 'strict-transport-security' \
      && ok "HSTS present" || bad "Strict-Transport-Security missing"
    ;;
  *) printf '  SKIP  HSTS (not an https target)\n' ;;
esac
printf '%s' "$headers" | grep -q 'x-content-type-options: *nosniff' \
  && ok "X-Content-Type-Options: nosniff" || bad "X-Content-Type-Options missing"

# --- 6. CORS must not reflect an arbitrary origin -----------------------------
# The failure this catches is a permissive CORS config that echoes back whatever
# Origin it is given -- which makes any website able to call the API with the
# staff member's credentials.
evil="https://not-a-jawwid-origin.example"
cors="$(fetch -D - -o /dev/null -H "Origin: $evil" "$BASE/health/live" | tr 'A-Z' 'a-z')"
if printf '%s' "$cors" | grep -q "access-control-allow-origin: *\(\*\|$evil\)"; then
  bad "CORS reflects an untrusted origin (or uses '*')"
else
  ok "CORS does not accept an untrusted origin"
fi

# --- 7. admin web -------------------------------------------------------------
if [ -n "$WEB" ]; then
  echo
  echo "Admin Web: $WEB"
  code="$(fetch -o /tmp/smoke-web.html -w '%{http_code}' "$WEB/")"
  [ "$code" = "200" ] && ok "GET / -> 200" || bad "GET / -> ${code:-no response}"

  # SPA fallback: a deep link must render the app, not a 404 from the web server.
  code="$(fetch -o /dev/null -w '%{http_code}' "$WEB/inbox/some-deep-link")"
  [ "$code" = "200" ] && ok "SPA fallback serves deep links" || bad "SPA deep link -> $code"

  wh="$(fetch -D - -o /dev/null "$WEB/" | tr 'A-Z' 'a-z')"
  printf '%s' "$wh" | grep -q 'content-security-policy' \
    && ok "CSP present" || bad "Content-Security-Policy missing"
  # index.html must not be cached, or a rollback keeps serving the old bundle.
  printf '%s' "$wh" | grep -Eq 'cache-control:.*(no-store|no-cache)' \
    && ok "index.html is not cached" || bad "index.html is cacheable -- rollbacks will not take effect"
fi

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
