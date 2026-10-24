#!/usr/bin/env bash
# The Admin Web container's security headers, as a browser receives them.
# Owner: AI #7 (infrastructure). PD-28.
#
#   scripts/infra/check-web-headers.sh http://127.0.0.1:8080
#   scripts/infra/check-web-headers.sh https://admin.staging.jawwid.example
#
# Every HTML entry point -- Admin Web's / and /index.html, a deep link, and the
# teacher portal's /teacher/ and /teacher/index.html -- must carry the CSP
# (with frame-ancestors 'none': the console must not be framable), HSTS,
# nosniff and Referrer-Policy. nginx drops a server block's add_header in any location that has an
# add_header of its own, so one innocent per-location header removes all of
# them without an error; Admin Web's index.html shipped that way until PD-28.
# This catches it however it comes back.
#
# Also asserts each app gets ITS policy: only /teacher/ may allow
# 'wasm-unsafe-eval' (CanvasKit), and the caching rules per path.
#
# Used by CI (the freshly built image) and smoke.sh (a deployment).
set -uo pipefail

WEB="${1:-}"
[ -n "$WEB" ] || { echo "usage: $0 <admin-web-origin>" >&2; exit 64; }
WEB="${WEB%/}"

pass=0; fail=0
ok()  { printf '  PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); }

headers() { curl -sS --max-time 15 -D - -o /dev/null "$WEB$1" 2>/dev/null | tr -d '\r' | tr 'A-Z' 'a-z'; }
has()     { printf '%s' "$1" | grep -q -- "$2"; }

for path in / /index.html /some/deep/link /teacher/ /teacher/index.html /teacher/some/deep/link; do
  h="$(headers "$path")"
  status="$(printf '%s' "$h" | sed -n '1s/^http\/[0-9.]* \([0-9]*\).*/\1/p')"
  [ "$status" = "200" ] && ok "$path -> 200" || { bad "$path -> ${status:-no response}"; continue; }
  csp="$(printf '%s' "$h" | sed -n 's/^content-security-policy: //p')"
  case "$csp" in
    *"frame-ancestors 'none'"*) ok "$path CSP with frame-ancestors 'none'" ;;
    *) bad "$path CSP with frame-ancestors 'none' (got: ${csp:-none})" ;;
  esac
  has "$h" '^strict-transport-security: max-age=' && ok "$path HSTS" || bad "$path HSTS missing"
  has "$h" '^x-content-type-options: nosniff' && ok "$path nosniff" || bad "$path nosniff missing"
  has "$h" '^referrer-policy: strict-origin-when-cross-origin' && ok "$path Referrer-Policy" || bad "$path Referrer-Policy missing"
  case "$path" in
    /teacher/*)
      case "$csp" in *"'wasm-unsafe-eval'"*) ok "$path portal policy (wasm)" ;; *) bad "$path portal policy lacks 'wasm-unsafe-eval'" ;; esac
      has "$h" '^cache-control: no-cache' && ok "$path revalidated (no-cache)" || bad "$path Cache-Control no-cache missing" ;;
    *)
      case "$csp" in *"wasm-unsafe-eval"*) bad "$path Admin Web policy must not allow wasm-unsafe-eval" ;; *) ok "$path Admin Web policy (no wasm)" ;; esac
      has "$h" '^cache-control: no-store' && ok "$path index never cached (no-store)" || bad "$path Cache-Control no-store missing" ;;
  esac
done

h="$(headers /teacher)"
has "$h" '^http/[0-9.]* 301' && has "$h" '^location: /teacher/' \
  && ok "/teacher -> 301 /teacher/" || bad "/teacher does not redirect to /teacher/"

echo
echo "web headers: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
