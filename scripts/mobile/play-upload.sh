#!/usr/bin/env bash
# OT-2b: puts ONE verified Android App Bundle on Google Play's INTERNAL testing track as a DRAFT
# release, through the Play Developer API v3 edits flow, and nothing else:
#
#   edits.insert -> edits.bundles.upload -> edits.tracks.update(internal, draft) -> edits.commit
#
# A draft is not sent to any tester: a person releases it in Play Console. The package, the track
# and the release status are constants below; no argument or environment variable can change them,
# and the script refuses to start if anything that looks like an override is set
# (scripts/qa/check-store-upload-guards.sh fails CI if the constants change).
#
#   PLAY_ACCESS_TOKEN=<OAuth access token for the androidpublisher scope> \
#     bash scripts/mobile/play-upload.sh <app-release.aab> <BUILD_NAME> <BUILD_NUMBER>
#
# The token is read from the environment only, removed from it before any other program starts,
# handed to curl on stdin (never on a command line) and never printed. Only HTTP status codes and
# Google's error status/reason codes are printed: never a header, never a response body.
#
# On any failure the open edit is deleted (best effort), so nothing is published, and the exit
# status is non-zero. Needs curl (7.76+, for --fail-with-body) and jq.
set -euo pipefail

say() { printf 'play-upload: %s\n' "$*"; }
err() { printf 'play-upload: %s\n' "$*" >&2; }

# ---- overrides are refused before anything else -------------------------------------------------
# PLAY_ACCESS_TOKEN is the only PLAY_* variable this script reads.
overrides=""
while IFS= read -r name; do
  case "$name" in
    PLAY_ACCESS_TOKEN) : ;;
    PLAY_*) overrides="$overrides $name" ;;
  esac
done < <(compgen -e)
for name in PACKAGE_NAME TRACK RELEASE_STATUS USER_FRACTION; do
  if [ -n "${!name+x}" ]; then overrides="$overrides $name"; fi
done
if [ -n "$overrides" ]; then
  err "refused: these variables are set:$overrides. The package, the track (internal) and the"
  err "status (draft) are fixed in this script and cannot be overridden. Unset them."
  exit 2
fi

readonly PACKAGE_NAME='com.jawwid.jawwid_chat'
readonly TRACK='internal'
readonly RELEASE_STATUS='draft'
readonly API='https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
readonly UPLOAD_API='https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications'
# Play's highest allowed versionCode.
readonly MAX_VERSION_CODE=2100000000

# ---- arguments --------------------------------------------------------------------------------
if [ "$#" -ne 3 ]; then
  err "usage: PLAY_ACCESS_TOKEN=... $0 <app-release.aab> <BUILD_NAME> <BUILD_NUMBER>"
  exit 2
fi
AAB="$1"
BUILD_NAME="$2"
BUILD_NUMBER="$3"
case "$AAB" in
  *.aab) : ;;
  *) err "refused: $AAB is not an .aab file"; exit 2 ;;
esac
[ -f "$AAB" ] && [ -s "$AAB" ] || { err "refused: no App Bundle at $AAB"; exit 2; }
[[ "$BUILD_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { err "refused: BUILD_NAME must be x.y.z (digits only)"; exit 2; }
[[ "$BUILD_NUMBER" =~ ^[1-9][0-9]{0,9}$ ]] && [ "$BUILD_NUMBER" -le "$MAX_VERSION_CODE" ] \
  || { err "refused: BUILD_NUMBER must be a positive integer no higher than $MAX_VERSION_CODE"; exit 2; }
readonly RELEASE_NAME="$BUILD_NAME ($BUILD_NUMBER)"

# ---- the token: environment only, then out of the environment ----------------------------------
token="${PLAY_ACCESS_TOKEN:-}"
unset PLAY_ACCESS_TOKEN
[ -n "$token" ] || { err "refused: PLAY_ACCESS_TOKEN is not set"; exit 2; }
# OAuth access tokens are URL-safe text. Anything else (a quote, a space, a line break) could
# change the curl configuration it is written into, so it is refused rather than escaped.
[[ "$token" =~ ^[A-Za-z0-9._~+/=-]+$ ]] || { err "refused: PLAY_ACCESS_TOKEN is not a well-formed access token"; exit 2; }

for tool in curl jq; do
  command -v "$tool" > /dev/null 2>&1 || { err "$tool not found"; exit 2; }
done
sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

W="$(mktemp -d)"
EDIT_ID=""
COMMITTED=0

# ---- clean-up: an edit that was not committed is deleted, whatever happened --------------------
finish() {
  local rc=$?
  trap - EXIT
  if [ -n "$EDIT_ID" ] && [ "$COMMITTED" -ne 1 ]; then
    if call DELETE "$API/$PACKAGE_NAME/edits/$EDIT_ID" "$W/delete.json"; then
      err "the uncommitted edit was deleted: nothing was published"
    else
      err "could not delete the uncommitted edit (HTTP $HTTP_CODE); it expires on its own and was never committed: nothing was published"
    fi
  fi
  rm -rf "$W"
  exit "$rc"
}
trap finish EXIT

# call METHOD URL OUTPUT [DATA_FILE CONTENT_TYPE]
# Sets HTTP_CODE. Returns non-zero on a transport error or an HTTP status of 400 or more.
HTTP_CODE=000
call() {
  local method="$1" url="$2" out="$3" data="${4:-}" ctype="${5:-}"
  local args=(-sS --fail-with-body --proto '=https' --tlsv1.2 --max-time 900
              -X "$method" -o "$out" -w '%{http_code}' -K -)
  if [ -n "$data" ]; then args+=(-H "Content-Type: $ctype" --data-binary "@$data"); fi
  local rc=0
  HTTP_CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$token" \
    | curl "${args[@]}" "$url" 2> "$W/curl.err")" || rc=$?
  [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]] || HTTP_CODE=000
  [ "$rc" -eq 0 ] && [ "$HTTP_CODE" -lt 400 ]
}

# Google's own codes only (error.status and error.errors[].reason): no message text, no headers.
google_reason() {
  jq -r '[.error.status // empty, (.error.errors[]?.reason // empty)] | map(tostring) | join(" ")' "$1" 2> /dev/null || true
}

# Play answers like this for an app that has never had a bundle uploaded in Play Console.
first_upload_required() {
  [ -s "$1" ] || return 1
  grep -Eqi 'package not found|applicationnotfound|app(lication)? not found|no application (was )?found|first (apk|bundle|upload|version)|upload[^"]{0,60}(manually|play console)' "$1"
}

failed() { # STEP OUTPUT
  local step="$1" out="$2" reason
  reason="$(google_reason "$out")"
  err "$step failed: HTTP $HTTP_CODE${reason:+ ($reason)}"
  if [ "$HTTP_CODE" = 000 ] && [ -s "$W/curl.err" ]; then
    head -3 "$W/curl.err" >&2
  fi
  if first_upload_required "$out"; then
    err "STOP: Google requires a first manual upload; do NOT do it from the development Mac; tell the lead"
    exit 1
  fi
  case "$HTTP_CODE" in
    401 | 403) err "the service account cannot act on $PACKAGE_NAME: check its Play Console invitation and app permission (docs/release/signed-builds-ci.md)" ;;
  esac
  exit 1
}

# ---- 1. edits.insert ---------------------------------------------------------------------------
printf '{}' > "$W/empty.json"
say "opening an edit for $PACKAGE_NAME"
call POST "$API/$PACKAGE_NAME/edits" "$W/insert.json" "$W/empty.json" application/json \
  || failed "edits.insert" "$W/insert.json"
EDIT_ID="$(jq -r '.id // empty' "$W/insert.json" 2> /dev/null || true)"
if ! [[ "$EDIT_ID" =~ ^[A-Za-z0-9_-]{1,128}$ ]]; then
  EDIT_ID=""
  err "edits.insert returned no usable edit id (HTTP $HTTP_CODE)"
  exit 1
fi
say "edits.insert: HTTP $HTTP_CODE"

# ---- 2. edits.bundles.upload -------------------------------------------------------------------
LOCAL_SHA256="$(sha256_of "$AAB")"
say "uploading $(basename "$AAB") (sha256 $LOCAL_SHA256)"
call POST "$UPLOAD_API/$PACKAGE_NAME/edits/$EDIT_ID/bundles?uploadType=media" "$W/upload.json" \
  "$AAB" application/octet-stream \
  || failed "edits.bundles.upload" "$W/upload.json"
got_code="$(jq -r '.versionCode // empty | tostring' "$W/upload.json" 2> /dev/null || true)"
got_sha="$(jq -r '.sha256 // empty' "$W/upload.json" 2> /dev/null || true)"
[ "$got_code" = "$BUILD_NUMBER" ] \
  || { err "edits.bundles.upload: Play read versionCode '$got_code' from the bundle, expected $BUILD_NUMBER"; exit 1; }
[ "$(printf '%s' "$got_sha" | tr '[:upper:]' '[:lower:]')" = "$LOCAL_SHA256" ] \
  || { err "edits.bundles.upload: Play's SHA-256 of the bundle does not match the verified file"; exit 1; }
say "edits.bundles.upload: HTTP $HTTP_CODE, versionCode $got_code, SHA-256 matches"

# ---- 3. edits.tracks.update: one draft release on the internal track ---------------------------
jq -n --arg track "$TRACK" --arg status "$RELEASE_STATUS" --arg name "$RELEASE_NAME" --arg code "$BUILD_NUMBER" \
  '{track: $track, releases: [{name: $name, versionCodes: [$code], status: $status}]}' > "$W/track-request.json"
call PUT "$API/$PACKAGE_NAME/edits/$EDIT_ID/tracks/$TRACK" "$W/track.json" "$W/track-request.json" application/json \
  || failed "edits.tracks.update" "$W/track.json"
# Play may answer with the track's other releases too (an earlier, finished internal release).
# Accepted only if: exactly one release is ours (status draft, versionCodes exactly [code]); no other
# release carries this versionCode; and every release is either a draft or a finished one, so none
# is staged, paused or of a status this script does not know. Anything else: the edit is deleted.
jq -e --arg track "$TRACK" --arg status "$RELEASE_STATUS" --arg code "$BUILD_NUMBER" '
  def codes: (.versionCodes // []) | map(tostring);
  .track == $track
  and ([.releases[]? | select(.status == $status and codes == [$code])] | length) == 1
  and ([.releases[]? | select(codes | any(.[]; . == $code))] | length) == 1
  and all(.releases[]?; .status == $status or .status == "completed")' "$W/track.json" > /dev/null 2>&1 \
  || { err "edits.tracks.update: Play's answer is not one $RELEASE_STATUS release of versionCode $BUILD_NUMBER on $TRACK with every other release finished and not carrying it"; exit 1; }
say "edits.tracks.update: HTTP $HTTP_CODE, track $TRACK, status $RELEASE_STATUS, name '$RELEASE_NAME'"

# ---- 4. edits.commit ---------------------------------------------------------------------------
: > "$W/commit-request.json"
call POST "$API/$PACKAGE_NAME/edits/$EDIT_ID:commit" "$W/commit.json" "$W/commit-request.json" application/json \
  || failed "edits.commit" "$W/commit.json"
[ "$(jq -r '.id // empty' "$W/commit.json" 2> /dev/null || true)" = "$EDIT_ID" ] \
  || { err "edits.commit: Play's answer does not name the edit that was committed"; exit 1; }
COMMITTED=1
say "edits.commit: HTTP $HTTP_CODE"
say "done: '$RELEASE_NAME' (versionCode $BUILD_NUMBER) is a $RELEASE_STATUS release on the $TRACK track of $PACKAGE_NAME."
say "No tester receives it until someone releases it in Play Console."
