#!/usr/bin/env bash
# Does the weekly off-site backup store only encrypted archives, completely, and
# keep exactly the last 8 weeks? scripts/infra/backup-offsite.sh, with the AWS
# CLI stubbed by a bucket in a temporary directory (no network, no credential).
#
#   1  retention: a weekly copy exactly 56 days old is KEPT, one day older is
#      removed, anything that is not a date is never a candidate
#   2  a plaintext .dump is refused before anything is uploaded
#   3  an archive without its .hmac is refused (it could not be restored)
#   4  the three files land under backups/weekly/<day>/ and are read back
#   5  prune removes only expired weekly prefixes, never anything else
#   6  the application's STORAGE_* key is never used: without the BACKUP_* key
#      and BACKUP_BUCKET it refuses
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OFFSITE="$ROOT/scripts/infra/backup-offsite.sh"
FAILED=0
ok()   { echo "  ok  $1"; }
fail() { echo "  FAIL  $1"; FAILED=1; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/jawwid-offsite.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
BUCKET_DIR="$SANDBOX/bucket"
mkdir -p "$BUCKET_DIR" "$SANDBOX/bin"

# A bucket as a directory. Only the calls backup-offsite.sh makes.
cat > "$SANDBOX/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = "--endpoint-url" ] && shift 2
svc="$1"; op="$2"; shift 2
case "$svc $op" in
  "s3 cp")
    while [ "${1#--}" != "$1" ]; do shift; done
    src="$1"; dst="${2#s3://*/}"
    mkdir -p "$BUCKET_DIR/$(dirname "$dst")"; cp "$src" "$BUCKET_DIR/$dst" ;;
  "s3 rm")
    while [ "${1#--}" != "$1" ]; do shift; done
    rm -rf "$BUCKET_DIR/${1#s3://*/}" ;;
  "s3api head-object")
    while [ $# -gt 0 ]; do [ "$1" = "--key" ] && key="$2"; shift; done
    wc -c < "$BUCKET_DIR/$key" | tr -d ' ' ;;
  "s3api list-objects-v2")
    while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && prefix="$2"; shift; done
    ls "$BUCKET_DIR/$prefix" 2>/dev/null | sed "s#^#$prefix#; s#\$#/#" | paste -sd '\t' - ;;
  *) echo "stub aws: unexpected $svc $op" >&2; exit 2 ;;
esac
STUB
chmod +x "$SANDBOX/bin/aws"
export PATH="$SANDBOX/bin:$PATH" BUCKET_DIR
export BACKUP_SPACES_ENDPOINT=https://spaces.invalid BACKUP_SPACES_REGION=fra1 BACKUP_BUCKET=jawwid-backups \
  BACKUP_SPACES_ACCESS_KEY=AKIA-STUB BACKUP_SPACES_SECRET_KEY=stub-secret

# 1 -----------------------------------------------------------------------------
got="$(printf '2026-09-12\n2026-09-13\n2026-11-01\nnot-a-date\n../etc\n' | bash "$OFFSITE" prune-candidates 2026-11-08)"
[ "$got" = "2026-09-12" ] && ok "retention: 56 days kept, 57 removed, non-dates ignored" \
  || fail "retention: expected 2026-09-12 only, got: $(echo $got)"

# 2 -----------------------------------------------------------------------------
PLAIN="$SANDBOX/plain"; mkdir -p "$PLAIN"; echo PGDMP > "$PLAIN/x.dump"
if bash "$OFFSITE" upload "$PLAIN" >/dev/null 2>&1; then fail "a plaintext .dump was uploaded"
elif [ -n "$(ls -A "$BUCKET_DIR")" ]; then fail "a refused plaintext upload still wrote to the bucket"
else ok "a plaintext .dump is refused before anything is uploaded"; fi

# 3 -----------------------------------------------------------------------------
NOTAG="$SANDBOX/notag"; mkdir -p "$NOTAG"; echo enc > "$NOTAG/x.dump.enc"; echo sum > "$NOTAG/x.dump.enc.sha256"
if BACKUP_DAY=2026-11-01 bash "$OFFSITE" upload "$NOTAG" >/dev/null 2>&1; then fail "an archive without its .hmac was accepted"
else ok "an archive without its .hmac is refused"; fi
rm -rf "${BUCKET_DIR:?}"/*

# 4 -----------------------------------------------------------------------------
GOOD="$SANDBOX/good"; mkdir -p "$GOOD"
head -c 4096 /dev/urandom > "$GOOD/chat-2026.dump.enc"; echo tag > "$GOOD/chat-2026.dump.enc.hmac"; echo sum > "$GOOD/chat-2026.dump.enc.sha256"
if BACKUP_DAY=2026-11-08 bash "$OFFSITE" upload "$GOOD" >/dev/null 2>&1 \
   && cmp -s "$GOOD/chat-2026.dump.enc" "$BUCKET_DIR/backups/weekly/2026-11-08/chat-2026.dump.enc" \
   && [ -f "$BUCKET_DIR/backups/weekly/2026-11-08/chat-2026.dump.enc.hmac" ] \
   && [ -f "$BUCKET_DIR/backups/weekly/2026-11-08/chat-2026.dump.enc.sha256" ]; then
  ok "the archive, its .hmac and its .sha256 land under backups/weekly/<day>/, byte for byte"
else fail "the upload did not store all three files intact"; fi

# 5 -----------------------------------------------------------------------------
for d in 2026-08-30 2026-09-12 2026-09-13 2026-10-04; do mkdir -p "$BUCKET_DIR/backups/weekly/$d"; echo x > "$BUCKET_DIR/backups/weekly/$d/a.dump.enc"; done
mkdir -p "$BUCKET_DIR/conversations/c1"; echo keep > "$BUCKET_DIR/conversations/c1/attachment"
BACKUP_TODAY=2026-11-08 bash "$OFFSITE" prune >/dev/null 2>&1
left="$(ls "$BUCKET_DIR/backups/weekly" | paste -sd ' ' -)"
if [ "$left" = "2026-09-13 2026-10-04 2026-11-08" ] && [ -f "$BUCKET_DIR/conversations/c1/attachment" ]; then
  ok "prune removes only expired weekly prefixes (kept: $left), nothing outside backups/weekly/"
else fail "prune left: $left"; fi

# 6 -----------------------------------------------------------------------------
if env -u BACKUP_SPACES_ACCESS_KEY -u BACKUP_SPACES_SECRET_KEY -u BACKUP_BUCKET \
     STORAGE_ACCESS_KEY=app STORAGE_SECRET_KEY=app STORAGE_BUCKET=app-bucket \
     BACKUP_DAY=2026-11-15 bash "$OFFSITE" upload "$GOOD" >/dev/null 2>&1; then
  fail "the upload ran on the application's STORAGE_* key"
else ok "without its own BACKUP_* key and bucket it refuses; the app's key is never used"; fi

[ "$FAILED" -eq 0 ] && echo "backup-offsite: pass" || { echo "backup-offsite: FAIL"; exit 1; }
