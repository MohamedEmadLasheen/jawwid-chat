#!/usr/bin/env bash
# Does the launch guard refuse every way production could launch on a Redis that
# is not managed, locked-down Valkey? scripts/infra/verify-managed-redis.sh with
# doctl stubbed by JSON files (no network, no credential). ADR-015.
#
#   1  a managed, online, fra1, noeviction cluster reachable only by this app: passes
#   2  plaintext redis:// is refused
#   3  the in-app redis host is refused
#   4  a host no cluster has is refused
#   5  a cluster that is not online, or not in fra1, is refused
#   6  an eviction policy other than noeviction (or none reported) is refused
#   7  no Trusted Sources, or any rule that is not this app, is refused
#   8  no app id (the app must exist first) is refused
#   9  the cluster password never appears in any output
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERIFY="$ROOT/scripts/infra/verify-managed-redis.sh"
FAILED=0
ok()   { echo "  ok  $1"; }
fail() { echo "  FAIL  $1"; FAILED=1; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/jawwid-valkey.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin"
export STUB_DIR="$SANDBOX"

# doctl as three JSON files: the calls verify-managed-redis.sh makes, nothing else.
cat > "$SANDBOX/bin/doctl" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "databases list") cat "$STUB_DIR/list.json" ;;
  "databases configuration") cat "$STUB_DIR/config.json" ;;
  "databases firewalls") cat "$STUB_DIR/firewalls.json" ;;
  *) echo "stub doctl: unexpected call: $*" >&2; exit 2 ;;
esac
STUB
chmod +x "$SANDBOX/bin/doctl"

PASSWORD="n0t-a-real-pw-7f3a"
HOST="jawwid-chat-prod-valkey-do-user-1.f.db.ondigitalocean.com"
APP="11111111-2222-3333-4444-555555555555"
GOOD_URL="rediss://default:$PASSWORD@$HOST:25061"

cluster() { # status region
  printf '[{"id":"c1","name":"jawwid-chat-prod-valkey","engine":"valkey","status":"%s","region":"%s",' "$1" "$2"
  printf '"connection":{"host":"%s"},"private_connection":{"host":"private-%s"}},' "$HOST" "$HOST"
  printf '{"id":"c2","name":"db-pgsql","engine":"pg","status":"online","region":"fra1","connection":{"host":"pg.example"},"private_connection":{"host":"p"}}]\n'
}
reset_stubs() {
  cluster online fra1 > "$SANDBOX/list.json"
  echo '{"valkey_maxmemory_policy":"noeviction","valkey_timeout":300}' > "$SANDBOX/config.json"
  printf '[{"uuid":"r1","cluster_uuid":"c1","type":"app","value":"%s"}]\n' "$APP" > "$SANDBOX/firewalls.json"
}

ALL_OUTPUT="$SANDBOX/all-output.txt"
run() { # url [app]
  local out rc
  out="$(PATH="$SANDBOX/bin:$PATH" DIGITALOCEAN_ACCESS_TOKEN=t DIGITALOCEAN_APP_ID="${2-$APP}" REDIS_URL="$1" \
    bash "$VERIFY" 2>&1)"
  rc=$?
  printf '%s\n' "$out" >> "$ALL_OUTPUT"
  LAST="$out"
  return $rc
}
expect_refused() { # what url [app] pattern
  if run "$2" "${3-$APP}"; then fail "$1 (it passed)"; return; fi
  if [ -n "${4:-}" ] && ! grep -q -- "$4" <<<"$LAST"; then fail "$1 (refused, but not for: $4)"; return; fi
  ok "$1"
}

reset_stubs
if run "$GOOD_URL" && grep -q "managed valkey: ready" <<<"$LAST"; then ok "a managed, online, fra1, noeviction, app-only cluster passes"
else fail "a good cluster passes: $LAST"; fi
if run "rediss://default:$PASSWORD@private-$HOST:25061"; then ok "its private hostname matches the same cluster"
else fail "private hostname: $LAST"; fi

expect_refused "plaintext redis:// is refused" "redis://default:$PASSWORD@$HOST:25061" "$APP" "rediss://"
expect_refused "the in-app redis host is refused" "rediss://redis:6379" "$APP" "in-app"
expect_refused "a host no cluster has is refused" "rediss://default:$PASSWORD@other.example:25061" "$APP" "found 0"
expect_refused "no app id is refused" "$GOOD_URL" "" "DIGITALOCEAN_APP_ID"

cluster creating fra1 > "$SANDBOX/list.json"
expect_refused "a cluster that is not online is refused" "$GOOD_URL" "$APP" "not online"
cluster online nyc3 > "$SANDBOX/list.json"
expect_refused "a cluster outside fra1 is refused" "$GOOD_URL" "$APP" "fra1"

reset_stubs
echo '{"valkey_maxmemory_policy":"allkeys-lru"}' > "$SANDBOX/config.json"
expect_refused "an evicting cluster is refused" "$GOOD_URL" "$APP" "evicts keys"
echo '{"valkey_timeout":300}' > "$SANDBOX/config.json"
expect_refused "a cluster reporting no eviction policy is refused" "$GOOD_URL" "$APP" "no eviction policy"

reset_stubs
echo '[]' > "$SANDBOX/firewalls.json"
expect_refused "no Trusted Sources is refused" "$GOOD_URL" "$APP" "reachable from any address"
printf '[{"type":"app","value":"%s"},{"type":"ip_addr","value":"203.0.113.7"}]\n' "$APP" > "$SANDBOX/firewalls.json"
expect_refused "an IP Trusted Source beside the app is refused" "$GOOD_URL" "$APP" "other than this app"
echo '[{"type":"app","value":"another-app"}]' > "$SANDBOX/firewalls.json"
expect_refused "another app's Trusted Source is refused" "$GOOD_URL" "$APP" "other than this app"

if grep -q -- "$PASSWORD" "$ALL_OUTPUT"; then fail "the cluster password appeared in the output"
else ok "the cluster password never appears in any output"; fi

if [ "$FAILED" -eq 0 ]; then echo "verify-managed-redis: pass"; else echo "verify-managed-redis: FAIL"; fi
exit "$FAILED"
