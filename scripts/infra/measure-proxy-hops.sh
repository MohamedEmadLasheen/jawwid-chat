#!/usr/bin/env bash
# Measure TRUSTED_PROXY_HOPS on a live deployment instead of guessing it.
# Owner: AI #7 (infrastructure). Procedure: docs/infrastructure/production-runbook.md §1d.
#
#   PROXY_HOPS_PROBE_TOKEN=<token> scripts/infra/measure-proxy-hops.sh send <api-origin> --my-ip <your public IPv4>
#   doctl apps logs "$APP_ID" api --type run | scripts/infra/measure-proxy-hops.sh interpret --run <run id>
#
# `send` makes three requests to <api-origin>/health/live, each carrying the
# deployment's probe token (the PROXY_HOPS_PROBE secret; read from the
# environment so it stays out of the shell history and the process list) and a
# fresh random RUN ID (apps/api/src/infra/http/proxy-hop-probe.ts):
#   plain-<run>                 nothing forged
#   forged-xff-<run>            X-Forwarded-For: 192.0.2.123 (a documentation address)
#   forged-connecting-ip-<run>  do-connecting-ip: 192.0.2.123
# Requests go over IPv4; each carries the SHA-256 of your IPv4 address, so the
# API can find WHERE in the chain your address is without logging it.
#
# `interpret --run <id>` reads the API's log on stdin and decides from THAT run
# only. It prints a hop count only when all of these hold, and otherwise STOP:
#   - exactly one line of each of the three kinds for the run (a missing line,
#     or a duplicate -- a replay or a second send with the same id -- is STOP);
#   - your address was found in every one of them, at the same position;
#   - the TCP peer was a private address every time (the API is not reachable
#     directly, so the platform's chain is the only way in);
#   - the forged X-Forwarded-For entry is either removed by the platform or
#     lands LEFT of the trusted hops, so a client cannot choose its address.
# The token gate means nobody without it can add a line; the run id means no
# earlier run (another deploy, another day) is ever mixed in.
set -euo pipefail

SENTINEL=192.0.2.123

usage() { sed -n '5,6p' "$0" >&2; exit 2; }

send() {
  local origin="${1:-}"; shift || true
  case "$origin" in https://*) ;; *) echo "error: <api-origin> must be https://..." >&2; exit 2 ;; esac
  case "${origin#https://}" in */*|"") echo "error: <api-origin> is the origin only: no path, no trailing slash" >&2; exit 2 ;; esac
  local my_ip=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --my-ip) my_ip="${2:-}"; shift; [ $# -eq 0 ] || shift ;;
      *) usage ;;
    esac
  done
  if ! printf '%s' "$my_ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    echo "error: --my-ip <your public IPv4 address> is required: it is how the hop count is proven" >&2; exit 2
  fi
  local token="${PROXY_HOPS_PROBE_TOKEN:-}"
  if [ -z "$token" ]; then
    echo "error: set PROXY_HOPS_PROBE_TOKEN to the deployment's PROXY_HOPS_PROBE secret" >&2; exit 2
  fi
  local h run
  h="$(printf '%s' "$my_ip" | shasum -a 256 | cut -d' ' -f1)"
  run="$(openssl rand -hex 8)"
  local url="$origin/health/live"
  local common=(-H "x-jawwid-hop-probe-token: $token" -H "x-jawwid-hop-probe-expect: $h")
  curl -4 -fsS -o /dev/null "${common[@]}" -H "x-jawwid-hop-probe: plain-$run" "$url"
  curl -4 -fsS -o /dev/null "${common[@]}" -H "x-jawwid-hop-probe: forged-xff-$run" -H "X-Forwarded-For: $SENTINEL" "$url"
  curl -4 -fsS -o /dev/null "${common[@]}" -H "x-jawwid-hop-probe: forged-connecting-ip-$run" -H "do-connecting-ip: $SENTINEL" "$url"
  echo "sent run $run"
  echo "now: doctl apps logs \"\$DIGITALOCEAN_APP_ID\" api --type run | $0 interpret --run $run"
}

interpret() {
  local run=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --run) run="${2:-}"; shift; [ $# -eq 0 ] || shift ;;
      *) usage ;;
    esac
  done
  if ! printf '%s' "$run" | grep -Eq '^[0-9a-f]{16}$'; then
    echo "error: --run <the 16-hex-digit run id that send printed> is required" >&2; exit 2
  fi
  local program
  program="$(cat <<'PY'
import json, re, sys
run = sys.argv[1]
KINDS = ("plain", "forged-xff", "forged-connecting-ip")
seen = {k: [] for k in KINDS}
for line in sys.stdin:
    text = line.replace('\\"', '"')
    for m in re.finditer(r"proxy-hops probe (\{[^{}]*\})", text):
        try:
            s = json.loads(m.group(1))
        except ValueError:
            continue
        label = s.get("label", "")
        for k in KINDS:
            if label == k + "-" + run:
                seen[k].append(s)

def stop(why):
    print("STOP -- do not set TRUSTED_PROXY_HOPS:")
    for w in why:
        print("  - " + w)
    sys.exit(1)

missing = [k for k in KINDS if not seen[k]]
dupes = [k for k in KINDS if len(seen[k]) > 1]
if missing or dupes:
    stop([f"no {k} line for run {run} (is PROXY_HOPS_PROBE set to the token you used, and did send succeed?)" for k in missing] +
         [f"{len(seen[k])} {k} lines for run {run}: a replay or a repeated send; run send again for a fresh id" for k in dupes])
plain, fx, fc = (seen[k][0] for k in KINDS)
problems = []
for k, s in zip(KINDS, (plain, fx, fc)):
    if s.get("peerPrivate") is not True:
        problems.append(f"{k}: the TCP peer was a PUBLIC address -- the API is reachable directly, so no forwarded header can be trusted")
    if not isinstance(s.get("hopsForExpected"), int):
        problems.append(f"{k}: your address was not found in X-Forwarded-For (wrong --my-ip, or not IPv4?)")
if problems:
    stop(problems)
n = plain["hopsForExpected"]
if n < 1:
    stop(["the hop count came out below 1"])
for k, s in (("forged-xff", fx), ("forged-connecting-ip", fc)):
    if s["hopsForExpected"] != n:
        problems.append(f"{k}: your address moved to hop {s['hopsForExpected']} (plain: {n}) -- the chain is not stable")
k = fx.get("sentinelIndexFromRight")
if k is not None and (not isinstance(k, int) or k < n):
    problems.append(f"forged-xff: the forged entry is {k} from the right, inside the {n} trusted hops -- a client could choose its own address")
if problems:
    stop(problems)
print(f"run {run}")
print(f"X-Forwarded-For entries (nothing forged): {plain['xffEntries']}")
print("forged X-Forwarded-For entry: " + ("removed by the platform" if k is None else f"kept, {k} from the right, outside the trusted hops"))
print("forged do-connecting-ip: " + ("PASSED THROUGH -- never trust it" if fc.get("connectingIpIsSentinel") else "overwritten by the platform"))
print(f"X-Forwarded-Proto: {plain.get('forwardedProto')}")
print(f"\nTRUSTED_PROXY_HOPS = {n}")
PY
)"
  python3 -I -c "$program" "$run"
}

case "${1:-}" in
  send) shift; send "$@" ;;
  interpret) shift; interpret "$@" ;;
  *) usage ;;
esac
