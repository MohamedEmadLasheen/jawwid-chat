#!/usr/bin/env bash
# The weekly off-site copy of the database backup. Owner: infrastructure.
#
#   STORAGE_ENDPOINT=https://fra1.digitaloceanspaces.com STORAGE_REGION=fra1 \
#   BACKUP_BUCKET=jawwid-backups STORAGE_ACCESS_KEY=... STORAGE_SECRET_KEY=... \
#     scripts/infra/backup-offsite.sh upload ./backups
#   ... scripts/infra/backup-offsite.sh prune            # keeps the last 8 weeks
#   ... scripts/infra/backup-offsite.sh list
#
# The third line of defence (docs/infrastructure/backup-recovery.md §2): the
# managed database's daily backups and point-in-time recovery are the first;
# the encrypted pre-deploy dump (deploy-*.yml) is the second, but it exists only
# when someone deploys and lives 30 days as a GitHub artifact. This copy is
# taken every week whether or not anyone deploys, and kept for 8 weeks.
#
# WHAT IS UPLOADED is exactly what scripts/infra/backup-db.sh wrote: the
# `.dump.enc` (AES-256, encrypted in the pipe -- no plaintext ever existed),
# its `.hmac` and its `.sha256`. Only encrypted archives are accepted: a
# `.dump` without `.enc` is REFUSED, so a plaintext copy can never reach the
# bucket. Each object is read back (HEAD) and its size compared with the file.
#
# LAYOUT: s3://$BACKUP_BUCKET/backups/weekly/<YYYY-MM-DD>/<files>, one prefix
# per run, dated in UTC. PRUNE deletes whole weekly prefixes older than
# BACKUP_RETENTION_DAYS (default 56 = 8 weeks) and never one inside the window,
# and never touches anything outside backups/weekly/.
#
# Requires: aws (AWS CLI v2; preinstalled on GitHub's Ubuntu runners). No
# credential is read from or written to the repository: all of it comes from the
# environment (the production GitHub Environment's secrets).
set -euo pipefail

PREFIX="backups/weekly"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-56}"

die() { echo "backup-offsite: $*" >&2; exit 1; }

need_env() {
  local missing=""
  for v in STORAGE_ENDPOINT STORAGE_REGION BACKUP_BUCKET STORAGE_ACCESS_KEY STORAGE_SECRET_KEY; do
    [ -n "${!v:-}" ] || missing="$missing $v"
  done
  [ -z "$missing" ] || die "missing:$missing"
  command -v aws >/dev/null 2>&1 || die "the AWS CLI (aws) is not installed"
  export AWS_ACCESS_KEY_ID="$STORAGE_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$STORAGE_SECRET_KEY" AWS_DEFAULT_REGION="$STORAGE_REGION"
}

s3()    { aws --endpoint-url "$STORAGE_ENDPOINT" s3 "$@"; }
s3api() { aws --endpoint-url "$STORAGE_ENDPOINT" s3api "$@"; }

# Portable "N days before YYYY-MM-DD" (GNU date, then BSD date).
days_before() {
  date -u -d "$1 - $2 days" +%Y-%m-%d 2>/dev/null || date -u -j -v-"$2"d -f %Y-%m-%d "$1" +%Y-%m-%d
}

# Pure: which weekly prefixes (YYYY-MM-DD, one per line on stdin) are older
# than the window ending TODAY? ISO dates sort as strings, so a lexical compare
# is a date compare. Anything that is not a date is never a candidate.
prune_candidates() {
  local today="$1" cutoff
  cutoff="$(days_before "$today" "$RETENTION_DAYS")"
  while IFS= read -r d; do
    [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
    [[ "$d" < "$cutoff" ]] && echo "$d"
  done
  return 0
}

upload() {
  local dir="${1:-}" day files=0
  [ -d "$dir" ] || die "usage: $0 upload <dir written by backup-db.sh>"
  if compgen -G "$dir/*.dump" >/dev/null; then
    die "refusing: $dir holds a plaintext .dump; only encrypted archives (.dump.enc) leave this machine"
  fi
  compgen -G "$dir/*.dump.enc" >/dev/null || die "no encrypted archive (.dump.enc) in $dir"
  need_env
  day="${BACKUP_DAY:-$(date -u +%Y-%m-%d)}"
  for f in "$dir"/*.dump.enc "$dir"/*.dump.enc.hmac "$dir"/*.dump.enc.sha256; do
    [ -f "$f" ] || die "missing $(basename "$f") -- an archive without its .hmac cannot be restored"
    local key="$PREFIX/$day/$(basename "$f")" size remote
    s3 cp --only-show-errors "$f" "s3://$BACKUP_BUCKET/$key"
    size="$(wc -c < "$f" | tr -d ' ')"
    remote="$(s3api head-object --bucket "$BACKUP_BUCKET" --key "$key" --query ContentLength --output text)"
    [ "$remote" = "$size" ] || die "$key: $remote bytes in the bucket, $size on disk"
    echo "  stored  s3://$BACKUP_BUCKET/$key ($size bytes)"
    files=$((files + 1))
  done
  echo "backup-offsite: $files files stored under $PREFIX/$day/"
}

weekly_days() {
  s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$PREFIX/" --delimiter / \
    --query 'CommonPrefixes[].Prefix' --output text \
    | tr '\t' '\n' | sed -n "s#^$PREFIX/\([0-9-]*\)/\$#\1#p"
}

prune() {
  need_env
  local today="${BACKUP_TODAY:-$(date -u +%Y-%m-%d)}" kept=0 removed=0 d
  local all
  all="$(weekly_days | sort)"
  local old
  old="$(printf '%s\n' "$all" | prune_candidates "$today")"
  for d in $old; do
    s3 rm --only-show-errors --recursive "s3://$BACKUP_BUCKET/$PREFIX/$d/"
    echo "  removed $PREFIX/$d/ (older than $RETENTION_DAYS days)"
    removed=$((removed + 1))
  done
  kept=$(( $(printf '%s\n' "$all" | grep -c . || true) - removed ))
  echo "backup-offsite: kept $kept weekly copies, removed $removed"
}

case "${1:-}" in
  upload) shift; upload "$@" ;;
  prune) prune ;;
  list) need_env; weekly_days | sort ;;
  prune-candidates) shift; prune_candidates "${1:?today}" ;;  # for the guard: stdin = dates
  *) echo "usage: $0 upload <dir> | prune | list" >&2; exit 64 ;;
esac
