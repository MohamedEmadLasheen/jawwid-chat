#!/usr/bin/env bash
# Restore a Jawwid Chat backup. Owner: AI #7 (infrastructure).
#
#   scripts/infra/restore-db.sh --file backups/x.dump --into postgresql://.../scratch
#   BACKUP_ENCRYPTION_KEY_FILE=... \
#     scripts/infra/restore-db.sh --file backups/x.dump.enc --into ... --schema chat
#
# Used for two things: recovering from data loss, and the periodic restore
# DRILL. A backup that has never been restored is an untested assumption --
# docs/infrastructure/backup-recovery.md schedules the drill and records results.
#
# SAFETY
# The target is never inferred. --into must be given explicitly, and restoring
# into anything that looks like production additionally requires
# --i-understand-this-overwrites-production. Defaults that point at production
# are how a drill becomes an outage.
#
# Everything that can reject the archive -- checksum, key, integrity tag, a
# trial decryption -- runs BEFORE the first connection to the target. An
# encrypted archive is decrypted only into a pipe to pg_restore: the plaintext
# never touches disk, here or in a container.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/infra/backup-crypto.sh
. "$ROOT/scripts/infra/backup-crypto.sh"

FILE=""; TARGET=""; CONFIRM_PROD=0; SCHEMA=""; NO_PRIVILEGES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file)   FILE="${2:-}"; shift 2 ;;
    --into)   TARGET="${2:-}"; shift 2 ;;
    --schema) SCHEMA="${2:-}"; shift 2 ;;
    # Escape hatch for a target cluster whose roles cannot be created (a shared
    # analytics box, a provider that forbids CREATE ROLE). It produces a
    # database the APPLICATION CANNOT USE -- fine for inspecting data, never
    # acceptable as a recovery.
    --no-privileges) NO_PRIVILEGES=1; shift ;;
    --i-understand-this-overwrites-production) CONFIRM_PROD=1; shift ;;
    *) echo "usage: $0 --file dump --into url [--schema name] [--no-privileges]" >&2; exit 64 ;;
  esac
done

[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "--file is required and must exist" >&2; exit 64; }
[ -n "$TARGET" ] || { echo "--into is required (no default target, by design)" >&2; exit 64; }

# A private working directory for the CIPHERTEXT snapshot below. Never holds
# plaintext. Removed on any exit; the function returns 0 explicitly because a
# trap whose last command fails REPLACES the script's exit status -- which once
# made every successful restore report failure.
WORK=""
cleanup() {
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  return 0
}
trap cleanup EXIT

# Verify integrity before touching the target. Restoring a truncated dump on top
# of a live database is worse than not restoring at all.
if [ -f "$FILE.sha256" ]; then
  echo "Verifying checksum..."
  if command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$FILE")" && shasum -a 256 -c "$(basename "$FILE").sha256") >/dev/null \
      || { echo "CHECKSUM MISMATCH -- refusing to restore" >&2; exit 1; }
  elif command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256") >/dev/null \
      || { echo "CHECKSUM MISMATCH -- refusing to restore" >&2; exit 1; }
  fi
  echo "  checksum ok"
else
  echo "  no .sha256 alongside the dump; integrity unverified"
fi

# ---- an encrypted archive: key, tag, trial decryption -------------------------
#
# The .sha256 above is unkeyed: whoever can modify the archive can rewrite it.
# The .hmac tag is keyed, so it is the check that actually binds the archive to
# the key holder -- and a wrong key fails it the same way a modified archive
# does, before anything is decrypted.
ENCRYPTED=0
SOURCE="$FILE"
case "$FILE" in *.enc) ENCRYPTED=1 ;; esac

if [ "$ENCRYPTED" -eq 1 ]; then
  if backup_key_resolve; then :; else
    if [ $? -eq 1 ]; then
      echo "this archive is encrypted: set BACKUP_ENCRYPTION_KEY_FILE or BACKUP_ENCRYPTION_PASSPHRASE" >&2
    fi
    exit 1
  fi
  if [ ! -f "$FILE.hmac" ]; then
    echo "refusing: $(basename "$FILE").hmac is missing, so the archive cannot be verified" >&2
    exit 1
  fi

  # Verify and decrypt a PRIVATE SNAPSHOT, not the file in place: otherwise the
  # archive could be swapped between the check and the restore. It is
  # ciphertext, so it is safe on any disk.
  WORK="$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/jawwid-restore.XXXXXX")"
  cp "$FILE" "$WORK/archive.dump.enc"
  cp "$FILE.hmac" "$WORK/archive.dump.enc.hmac"
  SOURCE="$WORK/archive.dump.enc"

  echo "Verifying the integrity tag (HMAC-SHA256)..."
  if backup_verify_tag "$SOURCE" "$SOURCE.hmac"; then
    echo "  tag ok"
  else
    case $? in
      3) echo "refusing: $(basename "$FILE").hmac is malformed or of an unknown format" >&2 ;;
      *) cat >&2 <<'MSG'
REFUSING TO RESTORE: the integrity tag does not match.

Either the key is wrong, or the archive or its .hmac file was modified after the
backup was taken. Nothing has been decrypted and the target was not touched.
MSG
      ;;
    esac
    exit 1
  fi

  # A trial decryption into nothing. The tag already proves the archive is the
  # one this key produced; this proves it also DECRYPTS, end to end, before the
  # restore starts consuming it.
  echo "Trial decryption..."
  if ! backup_decrypt_from "$SOURCE" "$BACKUP_TAG_ITER" >/dev/null 2>&1; then
    echo "REFUSING TO RESTORE: the archive does not decrypt with this key" >&2
    exit 1
  fi
  echo "  decrypts ok"
fi

case "$TARGET" in
  *prod*|*production*)
    if [ "$CONFIRM_PROD" -ne 1 ]; then
      cat >&2 <<'MSG'
refusing: the target looks like production.

Restoring over production destroys everything written since the backup was
taken. If that is genuinely the intent, re-run with:
  --i-understand-this-overwrites-production
and take a fresh backup of the CURRENT production state first -- you will want
it if the restore turns out to be the wrong choice.
MSG
      exit 1
    fi
    ;;
esac

ARGS=(--no-owner --exit-on-error --verbose)
[ "$NO_PRIVILEGES" -eq 1 ] && ARGS+=(--no-privileges)

# --schema is NOT passed to pg_restore. pg_dump records the schema's own entries
# with the namespace "-", not "chat":
#
#     6;    2615 16385 SCHEMA - chat postgres
#     5289; 0    0     ACL    - SCHEMA chat postgres
#
# `pg_restore --schema=chat` keeps only entries whose namespace is "chat", so it
# discards BOTH: the restore dies on `schema "chat" does not exist`, and
# pre-creating the schema to silence that leaves it with NO ACL -- chat_app has
# no USAGE and cannot read one row, while every structural check still passes.
# backup-db.sh already scopes the dump with pg_dump --schema, so the flag was
# redundant here and only ever subtracted.

# Same host/container translation the dump side does.
host_url() {
  printf '%s' "$1" | sed -e 's|@localhost:|@host.docker.internal:|' \
                          -e 's|@127\.0\.0\.1:|@host.docker.internal:|'
}

# Which pg_restore runs follows the same rule as backup-db.sh: PG_IMAGE names a
# client of a known major and outranks PATH. pg_restore refuses an archive
# written by a newer pg_dump ("unsupported version in file header"), and the CI
# runner's PATH carries client 16 while the dump came from 17.
USE_CONTAINER=0
if [ -n "${PG_IMAGE:-}" ] || ! command -v pg_restore >/dev/null 2>&1; then
  USE_CONTAINER=1
fi

# Read ONE value from the target. Separate from target_sql because that prints
# psql's table formatting, which is useless for a comparison: using it for one
# once made this script refuse every restore, including onto an empty database.
target_scalar() {
  if command -v psql >/dev/null 2>&1; then
    psql -tAq -v ON_ERROR_STOP=1 -d "$TARGET" -c "$1"
  else
    docker run --rm --network host --add-host=host.docker.internal:host-gateway \
      "${PG_IMAGE:-postgres:17-alpine}" \
      psql -tAq -v ON_ERROR_STOP=1 -d "$(host_url "$TARGET")" -c "$1"
  fi
}

# Run statements against the target, using local psql if present.
target_sql() {
  if command -v psql >/dev/null 2>&1; then
    psql -v ON_ERROR_STOP=1 -q -d "$TARGET" -c "$1"
  else
    docker run --rm --network host --add-host=host.docker.internal:host-gateway \
      "${PG_IMAGE:-postgres:17-alpine}" \
      psql -v ON_ERROR_STOP=1 -q -d "$(host_url "$TARGET")" -c "$1"
  fi
}

# ---- prepare the target ------------------------------------------------------
#
# Three things a schema-scoped dump cannot do for itself.
#
# 1. THE SCHEMA must NOT exist yet. The archive creates it together with the
#    USAGE grants the application needs, so a target that already has one would
#    fail part way through under --exit-on-error. Refusing early, with the
#    remedy, beats failing half way through a restore.
if [ -n "$SCHEMA" ]; then
  if [ "$(target_scalar "select count(*) from pg_namespace where nspname = '$SCHEMA'" | tr -d '[:space:]')" != "0" ]; then
    cat >&2 <<MSG
refusing: schema "$SCHEMA" already exists on the target.

The archive creates it, together with the USAGE grants the application needs, so
restoring onto a database that already has it would fail part way through. Drop
it first -- on a scratch target:

  drop schema "$SCHEMA" cascade;

Never on a database whose contents you have not already backed up.
MSG
    exit 1
  fi
fi

# 2. EXTENSIONS. btree_gist and pg_trgm live in `public`, outside a `--schema
#    chat` dump, but chat's exclusion constraints and search indexes need them.
#    The list is read from the migrations, which are the authority, so a new
#    extension cannot silently break restores; creating one the archive does
#    not need is harmless.
EXTENSIONS="$(grep -hoiE 'create extension if not exists [a-z0-9_]+' "$ROOT"/supabase/migrations/*.sql 2>/dev/null \
  | awk '{ print tolower($NF) }' | sort -u | tr '\n' ' ')"
if [ -n "${EXTENSIONS// /}" ]; then
  echo "Preparing target: extensions ${EXTENSIONS}"
  ext_sql=""
  for e in $EXTENSIONS; do ext_sql="${ext_sql}create extension if not exists \"$e\"; "; done
  target_sql "$ext_sql" >/dev/null
fi

# 3. THE ROLES. The ACL entries reference roles a bare target does not have.
#    Role ATTRIBUTES and MEMBERSHIPS are cluster-level and appear in no
#    schema-scoped dump, so they must be restated here, and they are not
#    cosmetic: chat_app NOINHERIT matches no policy written `to authenticated`,
#    and chat_service without BYPASSRLS reads nothing. Both restore "cleanly"
#    and then read zero rows.
#
#    This mirrors migrations 20260905091150 and 20260910120200. ALTER runs
#    unconditionally so a target carrying wrong attributes is corrected. No
#    password is set: the deployment does that out of band, exactly as for a
#    migrated database. If this ever diverges, the migrations win, and
#    db/tests/invariants.sql is what catches it.
if [ "$NO_PRIVILEGES" -eq 0 ]; then
  echo "Preparing target: runtime roles"
  target_sql "
    do \$\$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'chat_app') then
        create role chat_app login inherit nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'chat_service') then
        create role chat_service login inherit bypassrls;
      end if;
    end
    \$\$;

    alter role chat_app     nobypassrls inherit login;
    alter role chat_service bypassrls   inherit login;

    -- Membership is what makes a policy written \`to authenticated\` apply to
    -- the connection the API actually uses.
    grant authenticated to chat_app;
    grant service_role  to chat_service;" >/dev/null
fi

echo "Restoring $FILE"
if [ "$ENCRYPTED" -eq 1 ]; then
  # Decrypted straight into pg_restore's stdin. For the container, the stream
  # goes in over `docker run -i` and nothing is mounted.
  if [ "$USE_CONTAINER" -eq 0 ]; then
    backup_decrypt_from "$SOURCE" "$BACKUP_TAG_ITER" \
      | pg_restore "${ARGS[@]}" --dbname="$TARGET"
  else
    echo "  using pg_restore from ${PG_IMAGE:-postgres:17-alpine}"
    backup_decrypt_from "$SOURCE" "$BACKUP_TAG_ITER" \
      | docker run --rm -i --network host \
          --add-host=host.docker.internal:host-gateway \
          "${PG_IMAGE:-postgres:17-alpine}" \
          pg_restore "${ARGS[@]}" --dbname="$(host_url "$TARGET")"
  fi
elif [ "$USE_CONTAINER" -eq 0 ]; then
  pg_restore "${ARGS[@]}" --dbname="$TARGET" "$FILE"
else
  echo "  using pg_restore from ${PG_IMAGE:-postgres:17-alpine}"
  docker run --rm --network host \
    --add-host=host.docker.internal:host-gateway \
    -v "$(cd "$(dirname "$FILE")" && pwd)":/backup \
    "${PG_IMAGE:-postgres:17-alpine}" \
    pg_restore "${ARGS[@]}" \
      --dbname="$(host_url "$TARGET")" \
      "/backup/$(basename "$FILE")"
fi

echo
echo "Restore finished. A restore is not verified until you have checked that"
echo "the data is actually there -- see the drill checklist in"
echo "docs/infrastructure/backup-recovery.md."
