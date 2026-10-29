#!/usr/bin/env bash
# Object storage versioning and lifecycle: apply, verify, prove. Owner: infrastructure.
#
#   scripts/infra/storage-versioning.sh apply                     # set both, then verify
#   scripts/infra/storage-versioning.sh verify                    # read both back; exit 0 only if right
#   scripts/infra/storage-versioning.sh --verify-expiry start     # versioning + restore drill on a probe
#   scripts/infra/storage-versioning.sh --verify-expiry check ID  # >= 2 days later: did the provider expire it?
#
# WHY (docs/infrastructure/backup-recovery.md, "Object storage")
# Attachments, voice notes, avatars, Materials and whiteboard images exist ONLY
# in the bucket: Postgres holds their keys, not their bytes. A delete -- by the
# API, by a bug, by a person with a key -- is otherwise final. With versioning,
# a deleted or overwritten object becomes a "noncurrent version" that can be
# copied back. The lifecycle bounds what that costs: noncurrent versions expire
# after NONCURRENT_DAYS, and abandoned multipart uploads after one day.
#
# PROVIDER. Plain S3 API through the AWS CLI, so it runs against any
# S3-compatible store that implements versioning: DigitalOcean Spaces, AWS S3,
# MinIO. Cloudflare R2 does NOT implement PutBucketVersioning (its S3
# compatibility table, 2026), so `apply` fails there, loudly -- which is the
# correct answer: R2 cannot meet this requirement.
#
# THE PROBE RULE. A second lifecycle rule expires noncurrent versions under
# `_lifecycle-probe/` after ONE day. `--verify-expiry` uses it to prove, in two
# days instead of thirty, that the provider actually honours
# NoncurrentVersionExpiration. That proof matters: DigitalOcean documents
# lifecycle expiry of current objects, and noncurrent expiry only indirectly.
# The probe writes a few bytes under that prefix and nowhere else.
#
# Environment (the API's own names, so the same Environment values work):
#   STORAGE_ENDPOINT    https://<region>.digitaloceanspaces.com (or another S3 endpoint)
#   STORAGE_BUCKET      the bucket
#   STORAGE_REGION      optional; defaults to us-east-1 (Spaces ignores it)
#   STORAGE_ACCESS_KEY  \  a key that may read (verify) or also write (apply)
#   STORAGE_SECRET_KEY  /  the bucket's versioning + lifecycle configuration
# Credentials are passed to the AWS CLI in its environment and NEVER printed.
#
# Permissions:
#   verify                 s3:GetBucketVersioning, s3:GetLifecycleConfiguration
#   apply                  + s3:PutBucketVersioning, s3:PutLifecycleConfiguration
#   --verify-expiry        + s3:PutObject, s3:GetObject(Version), s3:DeleteObject,
#                            s3:ListBucketVersions on _lifecycle-probe/
# On DigitalOcean Spaces, a full-access key has all of these. A key limited to
# one bucket may be refused the configuration calls; if so this script fails
# and says which call was refused. It never reports success it did not observe.
#
# Requires: aws (AWS CLI v2), python3. Bash 3.2 compatible.
set -euo pipefail

NONCURRENT_DAYS=30
MULTIPART_DAYS=1
PROBE_PREFIX="_lifecycle-probe/"
PROBE_DAYS=1
# Lifecycle runs are asynchronous (providers sweep about daily), so a probe
# version due after PROBE_DAYS may legitimately linger. Only after this many
# days is "still there" a failure rather than "too early".
PROBE_DEADLINE_DAYS=3

err() { echo "::error title=Object storage versioning::$*" >&2; }
die() { err "$*"; exit 1; }

for v in STORAGE_ENDPOINT STORAGE_BUCKET STORAGE_ACCESS_KEY STORAGE_SECRET_KEY; do
  [ -n "${!v:-}" ] || die "$v is not set"
done
command -v aws >/dev/null 2>&1 || die "the AWS CLI (aws) is not installed"
command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

export AWS_ACCESS_KEY_ID="$STORAGE_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$STORAGE_SECRET_KEY"
export AWS_DEFAULT_REGION="${STORAGE_REGION:-us-east-1}"
[ "$AWS_DEFAULT_REGION" = "auto" ] && AWS_DEFAULT_REGION=us-east-1
unset AWS_PROFILE AWS_SESSION_TOKEN
# AWS CLI >= 2.23 adds CRC checksums to every request by default; several
# S3-compatible stores (Spaces among them) refuse those. Only where required.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_PAGER=""

BUCKET="$STORAGE_BUCKET"
s3api() { aws --endpoint-url "$STORAGE_ENDPOINT" s3api "$@"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/jawwid-storage.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# ------------------------------------------------------------------ verify
verify() {
  local status
  if ! status="$(s3api get-bucket-versioning --bucket "$BUCKET" --query Status --output text 2>"$TMP/err")"; then
    sed 's/^/  /' "$TMP/err" >&2
    die "GetBucketVersioning was refused or failed on bucket $BUCKET (the key needs s3:GetBucketVersioning)"
  fi
  case "$status" in ''|None|null) status="never enabled" ;; esac
  if [ "$status" != "Enabled" ]; then
    die "versioning on $BUCKET is '$status', not Enabled -- a delete there is final. Run: scripts/infra/storage-versioning.sh apply"
  fi
  echo "versioning: Enabled"

  if ! s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --output json >"$TMP/lc.json" 2>"$TMP/err"; then
    sed 's/^/  /' "$TMP/err" >&2
    die "GetBucketLifecycleConfiguration was refused, failed, or found no rules on $BUCKET -- noncurrent versions would accumulate forever"
  fi
  python3 - "$TMP/lc.json" "$NONCURRENT_DAYS" "$MULTIPART_DAYS" "$PROBE_PREFIX" "$PROBE_DAYS" <<'PY' || exit 1
import json, sys
path, nc_days, mp_days, probe_prefix, probe_days = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], int(sys.argv[5])
rules = [r for r in json.load(open(path)).get("Rules", []) if r.get("Status") == "Enabled"]

def prefix(r):
    f = r.get("Filter")
    if f is None:
        return r.get("Prefix", "")
    if set(f) - {"Prefix"}:
        return None          # a tag or And filter: not a whole-prefix rule
    return f.get("Prefix", "")

def nc(r):
    return (r.get("NoncurrentVersionExpiration") or {}).get("NoncurrentDays")

def mp(r):
    return (r.get("AbortIncompleteMultipartUpload") or {}).get("DaysAfterInitiation")

problems = []
whole = [r for r in rules if prefix(r) == ""]
if not any(nc(r) == nc_days for r in whole):
    problems.append(f"no enabled whole-bucket rule expires noncurrent versions after {nc_days} days")
if any(nc(r) is not None and nc(r) < nc_days for r in whole):
    problems.append(f"a whole-bucket rule expires noncurrent versions sooner than {nc_days} days")
if any(r.get("Expiration") for r in whole):
    problems.append("a whole-bucket rule expires CURRENT objects -- that deletes live attachments")
if not any(mp(r) == mp_days for r in whole):
    problems.append(f"no enabled whole-bucket rule aborts incomplete multipart uploads after {mp_days} day(s)")
if not any(prefix(r) == probe_prefix and nc(r) == probe_days for r in rules):
    problems.append(f"the probe rule ({probe_prefix}, {probe_days} day) is missing")
for p in problems:
    print(f"::error title=Object storage lifecycle::{p}", file=sys.stderr)
if problems:
    sys.exit(1)
print(f"lifecycle: noncurrent versions expire after {nc_days} days; "
      f"incomplete multipart uploads after {mp_days} day(s); probe rule present")
PY
}

# ------------------------------------------------------------------- apply
apply() {
  s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled \
    || die "PutBucketVersioning failed on $BUCKET (the provider may not implement versioning -- Cloudflare R2 does not)"
  # Rule 1 covers the whole bucket. It never expires a CURRENT object: only
  # noncurrent (deleted or overwritten) versions, and abandoned uploads.
  local lifecycle
  lifecycle="$(printf '{"Rules":[%s,%s]}' \
    "{\"ID\":\"jawwid-noncurrent-${NONCURRENT_DAYS}d\",\"Status\":\"Enabled\",\"Filter\":{\"Prefix\":\"\"},\"NoncurrentVersionExpiration\":{\"NoncurrentDays\":${NONCURRENT_DAYS}},\"AbortIncompleteMultipartUpload\":{\"DaysAfterInitiation\":${MULTIPART_DAYS}}}" \
    "{\"ID\":\"jawwid-lifecycle-probe\",\"Status\":\"Enabled\",\"Filter\":{\"Prefix\":\"${PROBE_PREFIX}\"},\"NoncurrentVersionExpiration\":{\"NoncurrentDays\":${PROBE_DAYS}}}")"
  s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "$lifecycle" \
    || die "PutBucketLifecycleConfiguration failed on $BUCKET"
  echo "applied; reading back"
  verify
}

# ----------------------------------------------------------- probe helpers
put_text() {   # put_text KEY TEXT -> prints the new version id
  printf '%s' "$2" > "$TMP/body"
  s3api put-object --bucket "$BUCKET" --key "$1" --body "$TMP/body" --query VersionId --output text
}
get_text() {   # get_text KEY [VERSION]
  if [ -n "${2:-}" ]; then
    s3api get-object --bucket "$BUCKET" --key "$1" --version-id "$2" "$TMP/out" >/dev/null
  else
    s3api get-object --bucket "$BUCKET" --key "$1" "$TMP/out" >/dev/null
  fi
  cat "$TMP/out"
}
count_versions() {   # count_versions KEY -> "<versions> <delete-markers>"
  s3api list-object-versions --bucket "$BUCKET" --prefix "$1" --output json > "$TMP/v.json"
  python3 - "$TMP/v.json" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); k = sys.argv[2]
v = [x for x in d.get("Versions") or [] if x["Key"] == k]
m = [x for x in d.get("DeleteMarkers") or [] if x["Key"] == k]
print(len(v), len(m))
PY
}

probe_start() {
  verify >/dev/null
  local id key v1 v2 counts restored
  id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  key="${PROBE_PREFIX}${id}/object"

  v1="$(put_text "$key" "probe $id version 1")"
  v2="$(put_text "$key" "probe $id version 2")"
  [ -n "$v1" ] && [ "$v1" != "None" ] && [ "$v1" != "null" ] && [ "$v1" != "$v2" ] \
    || die "the bucket returned no distinct version ids -- versioning is not in effect"
  s3api delete-object --bucket "$BUCKET" --key "$key" >/dev/null

  counts="$(count_versions "$key")"
  [ "$counts" = "2 1" ] \
    || die "after a delete the bucket holds '$counts' (versions, delete markers), expected '2 1' -- deletes are not recoverable"
  echo "a deleted object kept both of its versions (2 versions, 1 delete marker)"

  # The restore drill: exactly the runbook's procedure, then delete again so
  # the probe's versions are noncurrent and due for expiry.
  s3api copy-object --bucket "$BUCKET" --key "$key" \
    --copy-source "${BUCKET}/${key}?versionId=${v2}" >/dev/null
  restored="$(get_text "$key")"
  [ "$restored" = "probe $id version 2" ] \
    || die "the restore drill brought back different bytes than the version it copied"
  echo "restore drill: copying a noncurrent version back made it current again"
  s3api delete-object --bucket "$BUCKET" --key "$key" >/dev/null

  # A CURRENT marker the probe rule never expires, recording when this began.
  put_text "${PROBE_PREFIX}${id}/started" "$(date -u +%s)" >/dev/null
  echo
  echo "probe started: $id"
  echo "noncurrent versions under ${PROBE_PREFIX} are due to expire after ${PROBE_DAYS} day(s)."
  echo "On or after $(python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc)+d.timedelta(days=${PROBE_DAYS}+1)).strftime('%Y-%m-%d %H:%M UTC'))"), run:"
  echo "  scripts/infra/storage-versioning.sh --verify-expiry check $id"
}

probe_check() {
  local id="$1" key started age_days counts
  case "$id" in ''|*/*) die "usage: --verify-expiry check <probe-id printed by start>" ;; esac
  key="${PROBE_PREFIX}${id}/object"
  started="$(get_text "${PROBE_PREFIX}${id}/started" 2>/dev/null)" \
    || die "probe $id was never started on $BUCKET (no ${PROBE_PREFIX}${id}/started)"
  case "$started" in ''|*[!0-9]*) die "probe $id has an unreadable start marker" ;; esac
  age_days="$(( ( $(date -u +%s) - started ) / 86400 ))"
  counts="$(count_versions "$key")"
  case "$counts" in
    "0 "*)
      echo "PASS: the provider expired the probe's noncurrent versions (started ${age_days} day(s) ago)."
      echo "NoncurrentVersionExpiration is honoured; the ${NONCURRENT_DAYS}-day rule will bound storage."
      s3api delete-object --bucket "$BUCKET" --key "${PROBE_PREFIX}${id}/started" >/dev/null || true
      ;;
    *)
      if [ "$age_days" -lt "$PROBE_DEADLINE_DAYS" ]; then
        echo "TOO EARLY: ${counts%% *} noncurrent version(s) remain after ${age_days} day(s); lifecycle sweeps are asynchronous."
        echo "Check again once ${PROBE_DEADLINE_DAYS} days have passed."
        exit 3
      fi
      die "the provider has NOT expired noncurrent versions after ${age_days} days (${counts%% *} remain). NoncurrentVersionExpiration is not honoured: storage will grow without bound. Escalate to the provider; do not rely on the ${NONCURRENT_DAYS}-day rule."
      ;;
  esac
}

case "${1:-}" in
  apply)  apply ;;
  verify) verify ;;
  --verify-expiry)
    case "${2:-}" in
      start) probe_start ;;
      check) probe_check "${3:-}" ;;
      *) die "usage: $0 --verify-expiry {start|check <probe-id>}" ;;
    esac ;;
  *) echo "usage: $0 {apply|verify|--verify-expiry start|--verify-expiry check <id>}" >&2; exit 64 ;;
esac
