#!/usr/bin/env bash
# Logical backup of the Jawwid Chat database. Owner: AI #7 (infrastructure).
#
#   DATABASE_URL=... scripts/infra/backup-db.sh --out ./backups
#   DATABASE_URL=... scripts/infra/backup-db.sh --out ./backups --schema chat
#
# This is the SECOND line of defence. The first is the managed provider's
# continuous/PITR backup (docs/infrastructure/backup-recovery.md); this exists
# because a provider snapshot cannot be restored onto a laptop to answer "what
# did this table look like on Tuesday", and because a provider account
# compromise takes its own snapshots with it.
#
# Output is pg_dump's custom format (-Fc): compressed, and restorable
# selectively with pg_restore. A plain .sql dump is all-or-nothing.
#
# Requires pg_dump. If it is not installed, the script runs it from the Postgres
# container image instead, so a developer with only Docker can still take one.
set -euo pipefail

OUT_DIR="./backups"
SCHEMA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out)    OUT_DIR="${2:-}"; shift 2 ;;
    --schema) SCHEMA="${2:-}"; shift 2 ;;
    *) echo "usage: $0 [--out dir] [--schema name]" >&2; exit 64 ;;
  esac
done

: "${DATABASE_URL:?DATABASE_URL is required}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LABEL="${APP_ENV:-local}"
FILE="$OUT_DIR/jawwid-chat-${LABEL}-${STAMP}.dump"

ARGS=(--format=custom --no-owner --no-privileges --verbose)
[ -n "$SCHEMA" ] && ARGS+=(--schema="$SCHEMA")

# --no-owner/--no-privileges: role names differ between the managed production
# database and any machine you restore onto. Without these, a restore fails on
# roles that do not exist there, which is discovered during an incident.

# Inside a container, "localhost" is the container. On Linux --network host
# makes them the same; on macOS it does not, and the dump fails with a
# connection error that looks like the database is down.
docker_host_url() {
  printf '%s' "$1" | sed -e 's|@localhost:|@host.docker.internal:|' \
                          -e 's|@127\.0\.0\.1:|@host.docker.internal:|'
}

# `mktemp -t NAME` is a BSD idiom: macOS appends the random suffix itself, but
# GNU coreutils treats NAME as the template and refuses it -- "too few X's in
# template". With `set -e` that aborts the backup before it starts, on every
# Linux runner and every deployment host.
LOG="$(mktemp "${TMPDIR:-/tmp}/jawwid-backup-log.XXXXXX")"
trap 'rm -f "$LOG"' EXIT

echo "Backing up ${LABEL} -> ${FILE}"
if command -v pg_dump >/dev/null 2>&1; then
  # The URL is passed as an argument, so it is visible in this host's process
  # list for the duration. Acceptable on a build agent; on a shared host, set
  # PGPASSWORD and use discrete connection flags instead.
  if ! pg_dump "${ARGS[@]}" --dbname="$DATABASE_URL" --file="$FILE" 2>"$LOG"; then
    echo "pg_dump FAILED:" >&2
    # pg_dump quotes the DSN in its errors, and the DSN holds a password.
    sed -e 's|://[^@]*@|://***:***@|g' "$LOG" >&2
    exit 1
  fi
else
  # The image tag must match the SERVER's major version: pg_dump refuses to
  # dump from a server newer than itself.
  echo "  pg_dump not installed; using ${PG_IMAGE:-postgres:17-alpine}"
  if ! docker run --rm --network host \
      --add-host=host.docker.internal:host-gateway \
      -e PGCONNECT_TIMEOUT=10 \
      -v "$(cd "$OUT_DIR" && pwd)":/backup \
      "${PG_IMAGE:-postgres:17-alpine}" \
      pg_dump "${ARGS[@]}" --dbname="$(docker_host_url "$DATABASE_URL")" \
              --file="/backup/$(basename "$FILE")" 2>"$LOG"; then
    echo "pg_dump FAILED:" >&2
    sed -e 's|://[^@]*@|://***:***@|g' "$LOG" >&2
    exit 1
  fi
fi

# Docker only sees host paths its VM shares. On macOS, /tmp and /private/tmp
# usually are NOT shared: the dump is then written inside the VM and silently
# disappears, while docker itself exits 0.
if [ ! -f "$FILE" ]; then
  echo "backup file was not created: $FILE" >&2
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "The containerised fallback was used. Check that --out is on a path" >&2
    echo "your Docker installation shares with the host (a directory under" >&2
    echo "your home directory normally is; /tmp often is not)." >&2
  fi
  exit 1
fi

# A backup nobody verified is a guess. The checksum makes "the file is intact"
# a checkable claim, and pg_restore --list proves the archive is readable and
# non-empty before it is ever needed.
# Recorded against the BASENAME, from inside the directory: a checksum file
# that embeds the path it was created with cannot be verified after the dump is
# copied anywhere else -- which is the entire point of taking one.
BASE="$(basename "$FILE")"
if command -v shasum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && shasum -a 256 "$BASE" > "$BASE.sha256")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$BASE" > "$BASE.sha256")
fi

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
echo "  wrote ${SIZE} bytes"
[ "$SIZE" -gt 0 ] || { echo "backup is empty -- FAILED" >&2; exit 1; }
echo "  checksum: $(basename "$FILE").sha256"
echo
echo "Verify it is restorable BEFORE you need it:"
echo "  scripts/infra/restore-db.sh --file $FILE --into postgresql://.../scratch_db"
