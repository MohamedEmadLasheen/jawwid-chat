#!/usr/bin/env bash
# Prove that this deployment's LiveKit Cloud credentials actually work.
#
#   scripts/infra/livekit-probe.sh
#
# WHY THIS EXISTS. A LiveKit access token is an HS256 JWT the API signs by
# itself. It will decode, validate and look completely correct whether or not
# the key it names exists, whether or not the secret matches, and whether or not
# LIVEKIT_URL points at anything. "The token parses" proves nothing about
# LiveKit. This asks LiveKit.
#
# WHAT IT PROVES WHEN IT PASSES
#   * LIVEKIT_URL resolves and is reachable.
#   * LIVEKIT_API_KEY names a project that exists.
#   * LIVEKIT_API_SECRET is the secret for that key -- the server verifies the
#     signature, so a wrong secret is rejected as unauthenticated.
#   * A token this codebase mints is accepted by the real service.
#
# WHAT IT DOES NOT PROVE, and must never be reported as proving
#   * that audio flows. Publishing and subscribing need a media client and two
#     devices; this is a control-plane call, not a media session.
#
# SECRETS. Nothing here prints a key, a secret, a token or a URL. Failures are
# reported by category and HTTP status only, because this is the kind of script
# whose output ends up pasted into an issue.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

missing=()
[ -n "${LIVEKIT_URL:-}" ]        || missing+=("LIVEKIT_URL")
[ -n "${LIVEKIT_API_KEY:-}" ]    || missing+=("LIVEKIT_API_KEY")
[ -n "${LIVEKIT_API_SECRET:-}" ] || missing+=("LIVEKIT_API_SECRET")

if [ ${#missing[@]} -ne 0 ]; then
  cat >&2 <<EOF
NOT VERIFIED — real LiveKit Cloud connection.

Missing configuration: ${missing[*]}

These are secrets and are not in the repository by design. Supply them from the
secret store for the environment you want to probe, then re-run:

  LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \\
    scripts/infra/livekit-probe.sh

Until then no claim of LiveKit connectivity is supportable, and this script
exits non-zero so a pipeline cannot mistake "unconfigured" for "working".
EOF
  exit 78   # EX_CONFIG
fi

# LiveKit Cloud's RoomService is Twirp over HTTPS on the same host as the
# signalling URL: wss://x.livekit.cloud -> https://x.livekit.cloud.
HTTP_URL="$(printf '%s' "$LIVEKIT_URL" | sed -e 's#^wss://#https://#' -e 's#^ws://#http://#')"

# A room-admin token, minted the same way the API mints a join token: HS256
# over {iss, exp, video:{...}}. python3 is already required by other scripts here.
# No `VAR=value` prefix here: the variables are already in this script's
# environment and are inherited by the child. Assigning them inline would also
# trip scripts/infra/scan-secrets.sh, which is right to flag the shape.
TOKEN="$(
  /usr/bin/python3 - <<'PY'
import base64, hashlib, hmac, json, os, time

def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')

key, secret = os.environ['LIVEKIT_API_KEY'], os.environ['LIVEKIT_API_SECRET']
now = int(time.time())
header = {'alg': 'HS256', 'typ': 'JWT'}
# roomList only: the probe reads, it never creates or joins anything.
payload = {'iss': key, 'sub': key, 'nbf': now - 5, 'exp': now + 60,
           'video': {'roomList': True}}
signing_input = f"{b64(json.dumps(header).encode())}.{b64(json.dumps(payload).encode())}"
sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
print(f"{signing_input}.{b64(sig)}")
PY
)"

if [ -z "$TOKEN" ]; then
  echo "NOT VERIFIED — could not mint a probe token locally." >&2
  exit 1
fi

RESPONSE="$(
  curl -sS -o /tmp/livekit-probe-body.$$ -w '%{http_code}' \
    --max-time 15 \
    -X POST "$HTTP_URL/twirp/livekit.RoomService/ListRooms" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{}' 2>/tmp/livekit-probe-err.$$
)" || RESPONSE="000"

BODY_FILE="/tmp/livekit-probe-body.$$"
cleanup() { rm -f "$BODY_FILE" "/tmp/livekit-probe-err.$$"; }
trap cleanup EXIT

case "$RESPONSE" in
  200)
    # Room count only -- names can identify a conversation.
    COUNT="$(/usr/bin/python3 -c "
import json,sys
try:
    print(len(json.load(open('$BODY_FILE')).get('rooms', []) or []))
except Exception:
    print('unknown')
")"
    echo "VERIFIED — LiveKit Cloud accepted a token minted by this codebase."
    echo "  endpoint reachable, key recognised, secret correct"
    echo "  active rooms visible to this project: $COUNT"
    echo
    echo "NOT proven by this probe: audio publish/subscribe, which needs a media"
    echo "client and two devices."
    exit 0
    ;;
  401|403)
    echo "NOT VERIFIED — LiveKit rejected the credentials (HTTP $RESPONSE)." >&2
    echo "  The key/secret pair is wrong for this project, or the key is disabled." >&2
    exit 1
    ;;
  404)
    echo "NOT VERIFIED — the endpoint answered but has no RoomService (HTTP 404)." >&2
    echo "  LIVEKIT_URL is probably not a LiveKit Cloud project URL." >&2
    exit 1
    ;;
  000)
    echo "NOT VERIFIED — could not reach the endpoint at all." >&2
    echo "  DNS, TLS, network egress or a wrong host. No HTTP response." >&2
    exit 1
    ;;
  *)
    echo "NOT VERIFIED — unexpected response from LiveKit (HTTP $RESPONSE)." >&2
    exit 1
    ;;
esac
