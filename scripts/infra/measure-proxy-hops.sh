#!/usr/bin/env bash
# Measure TRUSTED_PROXY_HOPS on a live deployment instead of guessing it.
# Owner: AI #7 (infrastructure). Procedure: docs/infrastructure/production-runbook.md §1d.
#
#   scripts/infra/measure-proxy-hops.sh send <api-origin> [--my-ip <your public address>]
#   doctl apps logs "$APP_ID" api --type run | scripts/infra/measure-proxy-hops.sh interpret
#
# `send` makes three requests to <api-origin>/health/live, each carrying the
# probe header (apps/api/src/infra/http/proxy-hop-probe.ts):
#   plain-<run>                 nothing forged
#   forged-xff-<run>            X-Forwarded-For: 192.0.2.123 (a documentation address)
#   forged-connecting-ip-<run>  do-connecting-ip: 192.0.2.123
# Requests go over IPv4, so --my-ip is your public IPv4 address. With it, each
# also carries the SHA-256 of that address, so the API can
# find WHERE in the chain your address is without being told what it is.
# The deployment must run with PROXY_HOPS_PROBE=on; nothing is logged otherwise.
#
# `interpret` reads the API's log on stdin and prints the verdict: the hop
# count, and whether a client can forge its way past it. It never prints an
# address (the probe never logs one).
set -euo pipefail

SENTINEL=192.0.2.123

usage() { sed -n '4,6p' "$0" >&2; exit 2; }

send() {
  local origin="${1:-}"; shift || true
  case "$origin" in https://*) ;; *) echo "error: <api-origin> must be https://..." >&2; exit 2 ;; esac
  case "$origin" in https://*/*) echo "error: <api-origin> is the origin only, no path" >&2; exit 2 ;; esac
  local my_ip="" expect=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --my-ip) my_ip="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
  if [ -n "$my_ip" ]; then
    local h
    h="$(printf '%s' "$my_ip" | shasum -a 256 | cut -d' ' -f1)"
    expect=(-H "x-jawwid-hop-probe-expect: $h")
  else
    echo "note: without --my-ip the hop count rests on do-connecting-ip, which DigitalOcean documents inconsistently." >&2
  fi
  local run; run="$(date +%s)"
  local url="$origin/health/live"
  curl -4 -fsS -o /dev/null ${expect[@]+"${expect[@]}"} -H "x-jawwid-hop-probe: plain-$run" "$url"
  curl -4 -fsS -o /dev/null ${expect[@]+"${expect[@]}"} -H "x-jawwid-hop-probe: forged-xff-$run" -H "X-Forwarded-For: $SENTINEL" "$url"
  curl -4 -fsS -o /dev/null ${expect[@]+"${expect[@]}"} -H "x-jawwid-hop-probe: forged-connecting-ip-$run" -H "do-connecting-ip: $SENTINEL" "$url"
  echo "sent run $run; now read the API log through: $0 interpret"
}

interpret() {
  local program
  program="$(cat <<'PY'
import json, re, sys
shapes = {}
for line in sys.stdin:
    m = re.search(r"proxy-hops probe (\{.*?\})", line.replace('\\"', '"'))
    if not m:
        continue
    try:
        s = json.loads(m.group(1))
    except ValueError:
        continue
    kind = re.sub(r"-\d+$", "", s.get("label", ""))
    shapes[kind] = s  # the latest run wins
plain, fx, fc = shapes.get("plain"), shapes.get("forged-xff"), shapes.get("forged-connecting-ip")
if not plain or not fx:
    sys.exit("STOP: no plain and forged-xff probe lines found. Is PROXY_HOPS_PROBE=on, and did `send` run?")
problems = []
for name, s in shapes.items():
    if not s["peerPrivate"]:
        problems.append(name + ": the TCP peer is a PUBLIC address -- the API is reachable directly, so no forwarded header can be trusted")
n = plain["hopsForExpected"]
basis = "your own address (--my-ip)"
if n is None and plain["connectingIpIndexFromRight"] is not None:
    n, basis = plain["connectingIpIndexFromRight"] + 1, "do-connecting-ip (UNCONFIRMED: re-run send with --my-ip)"
if n is None:
    sys.exit("STOP: the client address was not found in X-Forwarded-For. Re-run send with --my-ip.")
if fx["hopsForExpected"] not in (None, n):
    problems.append("forged-xff: the client moved to hop %s when an entry was forged" % fx["hopsForExpected"])
k = fx["sentinelIndexFromRight"]
if k is not None and k < n:
    problems.append("forged-xff: the forged entry is %d from the right, inside the %d trusted hops -- a client could choose its own address" % (k, n))
print("X-Forwarded-For entries (nothing forged): %d" % plain["xffEntries"])
print("forged X-Forwarded-For entry: " + ("removed by the platform" if k is None else "kept, %d from the right" % k))
if fc:
    print("forged do-connecting-ip: " + ("PASSED THROUGH -- never trust it" if fc["connectingIpIsSentinel"] else "overwritten by the platform"))
print("X-Forwarded-Proto: " + plain["forwardedProto"])
if problems:
    print("\nSTOP -- do not set TRUSTED_PROXY_HOPS:")
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("\nTRUSTED_PROXY_HOPS = %d   (from %s)" % (n, basis))
PY
)"
  python3 -I -c "$program"
}

case "${1:-}" in
  send) shift; send "$@" ;;
  interpret) interpret ;;
  *) usage ;;
esac
