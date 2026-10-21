#!/usr/bin/env bash
# Logical backup of the Jawwid Chat database. Owner: AI #7 (infrastructure).
#
#   APP_ENV=production BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup.key \
#     DATABASE_URL=... scripts/infra/backup-db.sh --out ./backups --schema chat
#   APP_ENV=local DATABASE_URL=... scripts/infra/backup-db.sh --out ./backups
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
# ENCRYPTION. A backup is a complete copy of every family's messages. With
# BACKUP_ENCRYPTION_KEY_FILE (preferred) or BACKUP_ENCRYPTION_PASSPHRASE set,
# pg_dump's output is encrypted IN THE PIPE and the plaintext archive never
# exists as a file; the format is described in backup-crypto.sh. Without a key
# the backup is REFUSED unless APP_ENV is local, test or ci -- and an unset
# APP_ENV is not local. --allow-plaintext overrides that, and makes writing an
# unencrypted copy a recorded decision rather than a silent default.
set -euo pipefail

# shellcheck source=scripts/infra/backup-crypto.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-crypto.sh"

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

# ---- encrypt, or refuse -- BEFORE the dump, not after it ---------------------
#
# Dumping and then encrypting-and-deleting would put an unencrypted copy of
# every family's messages on disk for the duration, and leave it there on a
# failure part way through. So the decision is made before pg_dump runs, and an
# encrypted backup never has a plaintext stage at all.
ENCRYPT=0
if backup_key_resolve; then
  ENCRYPT=1
else
  rc=$?
  # A key that is configured but unusable is an error everywhere: falling back
  # to plaintext would quietly ignore the operator's stated intent.
  [ "$rc" -eq 1 ] || exit 1
fi

if [ "$ENCRYPT" -eq 0 ] && [ "$ALLOW_PLAINTEXT" -ne 1 ]; then
  case "${APP_ENV:-}" in
    local|test|ci) : ;;
    *)
      cat >&2 <<MSG
refusing: this would write an UNENCRYPTED copy of every family's messages.

APP_ENV is "${APP_ENV:-<unset>}" and no backup key is configured. Set
BACKUP_ENCRYPTION_KEY_FILE (a file whose first line is the secret, mode 600) or
BACKUP_ENCRYPTION_PASSPHRASE, or -- only if the archive goes straight into an
encrypted bucket -- re-run with --allow-plaintext to record that the decision
was deliberate. On a developer machine, set APP_ENV=local.
MSG
      exit 1 ;;
  esac
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
# Whatever is written here -- archive, tag, checksum -- is readable by this
# user only.
umask 077
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LABEL="${APP_ENV:-local}"
FILE="$OUT_DIR/jawwid-chat-${LABEL}-${STAMP}.dump"
[ "$ENCRYPT" -eq 1 ] && FILE="$FILE.enc"

ARGS=(--format=custom --no-owner --verbose)
[ -n "$SCHEMA" ] && ARGS+=(--schema="$SCHEMA")

# --no-owner: the OWNER role genuinely differs between the managed production
# database and any machine you restore onto, and without it a restore fails on
# a role that does not exist there.
#
# --no-privileges is deliberately NOT passed, and that is a correction. It used
# to be, "for portability" -- but the roles named in this schema's GRANTs are
# not the platform's, they are OURS (anon, authenticated, service_role,
# chat_app, chat_service), created by our own migrations and therefore present
# wherever this schema is restored. A --no-privileges archive carries ZERO ACL
# entries, so every restore produced a database in which chat_app could not
# read or write a single table: the application fails closed against its own
# restored data. pg_restore can always skip ACLs it does not want
# (restore-db.sh --no-privileges); it can never invent ones the dump did not
# record.

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
PARTIAL=""
# Returns 0 explicitly: this runs on EXIT, and a trap whose last command fails
# REPLACES the script's exit status.
cleanup() {
  rm -f "$LOG"
  if [ -n "$PARTIAL" ]; then rm -f "$PARTIAL"; fi
  return 0
}
trap cleanup EXIT

# Which pg_dump runs is a version decision, not a convenience one: pg_dump
# refuses to dump from a server newer than itself. `PG_IMAGE` is how this
# repository already names a client of a known major (backup-recovery.md §3,
# and local-development.md answers "server version mismatch" with "set
# PG_IMAGE") -- so naming one has to win over whatever happens to be on PATH.
#
# Preferring PATH unconditionally made that variable inert exactly where it was
# needed. Every GitHub runner installs postgresql-client 16 for psql, so the CI
# backup drill picked up pg_dump 16, ignored the PG_IMAGE=postgres:17-alpine it
# was given, and failed against the postgres:17 service.
#
# Unset PG_IMAGE keeps the old order: a local pg_dump if there is one, the
# default image if there is not. Production sets a DSN, not an image, so it is
# unaffected.
USE_CONTAINER=0
if [ -n "${PG_IMAGE:-}" ] || ! command -v pg_dump >/dev/null 2>&1; then
  USE_CONTAINER=1
fi

dump_failed() {
  echo "$1" >&2
  # pg_dump quotes the DSN in its errors, and the DSN holds a password.
  sed -e 's|://[^@]*@|://***:***@|g' "$LOG" >&2
  exit 1
}

echo "Backing up ${LABEL} -> ${FILE}"
if [ "$USE_CONTAINER" -eq 1 ]; then
  # The image tag must match the SERVER's major version: pg_dump refuses to
  # dump from a server newer than itself.
  if [ -n "${PG_IMAGE:-}" ]; then
    echo "  using pg_dump from ${PG_IMAGE}"
  else
    echo "  pg_dump not installed; using postgres:17-alpine"
  fi
fi

if [ "$ENCRYPT" -eq 1 ]; then
  # pg_dump writes to STDOUT and openssl encrypts the stream, so the only file
  # that ever exists is ciphertext. In the container case nothing is mounted at
  # all: the archive crosses the docker boundary as an encrypted-on-arrival
  # stream, which also sidesteps the macOS shared-path trap below.
  echo "  encrypting in the pipe (aes-256-cbc, pbkdf2-sha256 x${BACKUP_KDF_ITER}, HMAC-SHA256 tag)"
  if [ "$USE_CONTAINER" -eq 0 ]; then
    DUMP=(pg_dump "${ARGS[@]}" --dbname="$DATABASE_URL")
  else
    DUMP=(docker run --rm --network host
          --add-host=host.docker.internal:host-gateway
          -e PGCONNECT_TIMEOUT=10
          "${PG_IMAGE:-postgres:17-alpine}"
          pg_dump "${ARGS[@]}" --dbname="$(docker_host_url "$DATABASE_URL")")
  fi
  # Written under a .partial name and renamed only once complete, so a failure
  # part way through never leaves something that looks like a finished backup.
  PARTIAL="$FILE.partial"
  if ! "${DUMP[@]}" 2>"$LOG" | backup_encrypt_to "$PARTIAL"; then
    dump_failed "pg_dump or encryption FAILED:"
  fi
  # 32 bytes is openssl's header plus one block of padding: the ciphertext of
  # NOTHING. pg_dump succeeded and produced no archive.
  if [ "$(wc -c < "$PARTIAL" | tr -d ' ')" -le 32 ]; then
    echo "pg_dump produced an empty archive -- FAILED" >&2
    exit 1
  fi
  mv "$PARTIAL" "$FILE"
  PARTIAL=""
  backup_write_tag "$FILE"
elif [ "$USE_CONTAINER" -eq 0 ]; then
  if [ "$ALLOW_PLAINTEXT" -eq 1 ]; then
    echo "  WARNING: writing an UNENCRYPTED backup because --allow-plaintext was given"
  else
    echo "  WARNING: unencrypted (APP_ENV=${APP_ENV:-}). Set BACKUP_ENCRYPTION_KEY_FILE to encrypt at rest."
  fi
  # The URL is passed as an argument, so it is visible in this host's process
  # list for the duration. Acceptable on a build agent; on a shared host, set
  # PGPASSWORD and use discrete connection flags instead.
  if ! pg_dump "${ARGS[@]}" --dbname="$DATABASE_URL" --file="$FILE" 2>"$LOG"; then
    dump_failed "pg_dump FAILED:"
  fi
else
  if [ "$ALLOW_PLAINTEXT" -eq 1 ]; then
    echo "  WARNING: writing an UNENCRYPTED backup because --allow-plaintext was given"
  else
    echo "  WARNING: unencrypted (APP_ENV=${APP_ENV:-}). Set BACKUP_ENCRYPTION_KEY_FILE to encrypt at rest."
  fi
  if ! docker run --rm --network host \
      --add-host=host.docker.internal:host-gateway \
      -e PGCONNECT_TIMEOUT=10 \
      -v "$(cd "$OUT_DIR" && pwd)":/backup \
      "${PG_IMAGE:-postgres:17-alpine}" \
      pg_dump "${ARGS[@]}" --dbname="$(docker_host_url "$DATABASE_URL")" \
              --file="/backup/$(basename "$FILE")" 2>"$LOG"; then
    dump_failed "pg_dump FAILED:"
  fi
fi

# Docker only sees host paths its VM shares. On macOS, /tmp and /private/tmp
# usually are NOT shared: the dump is then written inside the VM and silently
# disappears, while docker itself exits 0.
if [ ! -f "$FILE" ]; then
  echo "backup file was not created: $FILE" >&2
  if [ "$USE_CONTAINER" -eq 1 ]; then
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
# For an encrypted backup it covers the .enc, the artefact actually stored.
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
if [ "$ENCRYPT" -eq 1 ]; then
  echo "  integrity tag: $(basename "$FILE").hmac (keep it with the archive; restore refuses without it)"
fi
echo
echo "Verify it is restorable BEFORE you need it:"
echo "  scripts/infra/restore-db.sh --file $FILE --into postgresql://.../scratch_db"
