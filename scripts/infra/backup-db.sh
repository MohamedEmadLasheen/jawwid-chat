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
#
# ENCRYPTION. A backup is a complete copy of every family's messages, so it is
# encrypted at rest when BACKUP_ENCRYPTION_PASSPHRASE is set, and REFUSED
# unencrypted when APP_ENV is staging or production. Everywhere else it is a
# loud warning rather than a refusal, so a developer restoring last Tuesday onto
# a laptop is not forced to invent a passphrase.
set -euo pipefail

OUT_DIR="./backups"
SCHEMA=""
ALLOW_PLAINTEXT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out)    OUT_DIR="${2:-}"; shift 2 ;;
    --schema) SCHEMA="${2:-}"; shift 2 ;;
    --allow-plaintext) ALLOW_PLAINTEXT=1; shift ;;
    *) echo "usage: $0 [--out dir] [--schema name] [--allow-plaintext]" >&2; exit 64 ;;
  esac
done

# REFUSED BEFORE THE DUMP, not after it.
#
# The check has to come first. Dumping and then deleting would put an
# unencrypted copy of every family's messages on disk for the duration -- which
# is the exact thing being prevented -- and on a failure part-way through it
# would leave one there.
if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] && [ "$ALLOW_PLAINTEXT" -ne 1 ]; then
  case "${APP_ENV:-local}" in
    production|staging)
      cat >&2 <<'MSG'
refusing: this would write an UNENCRYPTED copy of every family's messages.

APP_ENV is staging or production and BACKUP_ENCRYPTION_PASSPHRASE is not set.
Set it, or store the archive in an encrypted bucket and re-run with
--allow-plaintext to record that the decision was deliberate.
MSG
      exit 1 ;;
  esac
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LABEL="${APP_ENV:-local}"
FILE="$OUT_DIR/jawwid-chat-${LABEL}-${STAMP}.dump"

ARGS=(--format=custom --no-owner --verbose)
[ -n "$SCHEMA" ] && ARGS+=(--schema="$SCHEMA")

# --no-owner: the OWNER role genuinely differs between the managed production
# database and any machine you restore onto (`postgres` here, `supabase_admin`
# there), and without it a restore fails on a role that does not exist.
#
# --no-privileges is deliberately NOT passed, and this is a correction.
#
# It used to be, for the same stated reason -- but the roles named in this
# schema's GRANTs are not the platform's, they are OURS: chat_app, chat_service,
# authenticated, service_role, all created by 20260905091150 and therefore
# identical in every environment this schema is ever restored into. Excluding
# them did not buy portability; it silently dropped the privilege model.
#
# The cost was total. A `--no-privileges` dump carries ZERO ACL entries, so
# every restore produced a database in which chat_app could not INSERT into a
# single table -- the application fails closed against its own restored data,
# and db/tests/schema_acceptance.sql rejects it. Verified: the dump this now
# writes carries 93 ACL entries and 186 chat_app grants, and the restored
# database passes schema_acceptance, br1_invariants, rls_enforcement,
# tenant_isolation, assignment_invariants and od01_conversation_model.
#
# Capturing privileges is strictly safer than omitting them: pg_restore can
# always skip ACLs it does not want (restore-db.sh --no-privileges), but it can
# never reconstruct ACLs a dump never recorded.

# Inside a container, "localhost" is the container. On Linux --network host
# makes them the same; on macOS it does not, and the dump fails with a
# connection error that looks like the database is down.
docker_host_url() {
  printf '%s' "$1" | sed -e 's|@localhost:|@host.docker.internal:|' \
                          -e 's|@127\.0\.0\.1:|@host.docker.internal:|'
}

LOG="$(mktemp -t jawwid-backup-log)"
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
# ENCRYPTION, before the checksum.
#
# The order is deliberate: the checksum must describe the artefact that is
# actually stored, or "verify before you restore" checks a file that no longer
# exists. restore-db.sh decrypts first and verifies against the same artefact.
#
# openssl enc rather than age or gpg because neither is installed on a stock
# macOS or a slim CI image, and a backup step that depends on a tool the host
# does not have is a backup that silently does not happen. It gives
# confidentiality but not authentication; the .sha256 beside it is an integrity
# check, not a keyed one, so a managed encrypted bucket remains the better
# answer where one exists (backup-recovery.md).
if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  command -v openssl >/dev/null 2>&1 || {
    echo "BACKUP_ENCRYPTION_PASSPHRASE is set but openssl is not installed" >&2
    exit 1
  }
  echo "  encrypting (aes-256-cbc, pbkdf2)"
  # The passphrase is passed by environment, never as an argument: an argument
  # is visible in this host's process list to every other user on it.
  if ! openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
        -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_ENCRYPTION_PASSPHRASE; then
    echo "encryption FAILED -- removing the plaintext dump" >&2
    rm -f "$FILE" "$FILE.enc"
    exit 1
  fi
  # The plaintext must not outlive the encrypted copy. Removed only after
  # openssl succeeded, so a failure never destroys the only copy.
  rm -f "$FILE"
  FILE="$FILE.enc"
elif [ "$ALLOW_PLAINTEXT" -eq 1 ]; then
  echo "  WARNING: writing an UNENCRYPTED backup because --allow-plaintext was given"
else
  echo "  WARNING: unencrypted. Set BACKUP_ENCRYPTION_PASSPHRASE to encrypt at rest."
fi

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
