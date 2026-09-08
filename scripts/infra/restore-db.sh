#!/usr/bin/env bash
# Restore a Jawwid Chat backup. Owner: AI #7 (infrastructure).
#
#   scripts/infra/restore-db.sh --file backups/x.dump --into postgresql://.../scratch
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
set -euo pipefail

FILE=""; TARGET=""; CONFIRM_PROD=0; SCHEMA=""; NO_PRIVILEGES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file)   FILE="${2:-}"; shift 2 ;;
    --into)   TARGET="${2:-}"; shift 2 ;;
    --schema) SCHEMA="${2:-}"; shift 2 ;;
    # Escape hatch for a target cluster whose roles cannot be created (a shared
    # analytics box, a provider that forbids CREATE ROLE). It produces a
    # database the APPLICATION CANNOT WRITE TO -- fine for inspecting data,
    # never acceptable as a recovery. See the note by ARGS below.
    --no-privileges) NO_PRIVILEGES=1; shift ;;
    --i-understand-this-overwrites-production) CONFIRM_PROD=1; shift ;;
    *) echo "usage: $0 --file dump --into url [--schema name] [--no-privileges]" >&2; exit 64 ;;
  esac
done

[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "--file is required and must exist" >&2; exit 64; }
[ -n "$TARGET" ] || { echo "--into is required (no default target, by design)" >&2; exit 64; }

# DECRYPTION, before the checksum.
#
# The checksum describes the stored artefact -- the .enc -- so it is verified
# first, against the file as it sits on disk, and only then decrypted. Verifying
# the plaintext instead would check something the backup process never recorded.
#
# The plaintext lands in a private temp file that is removed on ANY exit,
# including a failure part-way through the restore: an unencrypted copy of every
# family's messages must not survive a crashed drill.
DECRYPTED=""
cleanup_decrypted() { [ -n "$DECRYPTED" ] && rm -f "$DECRYPTED"; }
trap cleanup_decrypted EXIT INT TERM

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

case "$FILE" in
  *.enc)
    : "${BACKUP_ENCRYPTION_PASSPHRASE:?this archive is encrypted; BACKUP_ENCRYPTION_PASSPHRASE is required}"
    command -v openssl >/dev/null 2>&1 || {
      echo "the archive is encrypted but openssl is not installed" >&2; exit 1; }
    echo "Decrypting..."
    # BESIDE THE ARCHIVE, not in the system temp directory.
    #
    # The containerised pg_restore fallback mounts the dump's own directory into
    # the container, and on macOS /tmp and /var/folders are NOT shared with the
    # Docker VM -- so a decrypted file in mktemp's directory is invisible to
    # pg_restore and the restore fails with "no such file". The archive's
    # directory is by construction one the host can reach, and for a dump taken
    # by backup-db.sh it is one Docker shares, because that is where the dump
    # itself was written.
    DECRYPTED="$(dirname "$FILE")/.jawwid-restore-$$.dump"
    if ! (umask 077 && : > "$DECRYPTED"); then
      echo "cannot write the decrypted copy next to the archive: $(dirname "$FILE")" >&2
      echo "Copy the archive somewhere writable and re-run." >&2
      exit 1
    fi
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
          -in "$FILE" -out "$DECRYPTED" -pass env:BACKUP_ENCRYPTION_PASSPHRASE 2>/dev/null; then
      # A wrong passphrase and a corrupt archive are indistinguishable to
      # openssl, and saying so is more useful than reporting one of them.
      echo "DECRYPTION FAILED -- wrong passphrase, or the archive is corrupt" >&2
      exit 1
    fi
    FILE="$DECRYPTED"
    echo "  decrypted"
    ;;
esac

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

# --schema is NOT passed to pg_restore, and that is the second half of a fix
# whose first half was not enough.
#
# pg_dump records the schema's own entries with the namespace "-", not "chat":
#
#     6;    2615 16385 SCHEMA - chat postgres
#     5289; 0    0     ACL    - SCHEMA chat postgres
#
# `pg_restore --schema=chat` keeps only entries whose namespace is "chat", so it
# discards BOTH. The first omission was loud -- the restore died on its first
# object with `schema "chat" does not exist` -- and pre-creating the schema
# silenced it. The second is silent and worse: the restored schema carries NO
# ACL, so chat_app has no USAGE on it and the application cannot read one row,
# while all six integrity suites still PASS, because table-level
# has_table_privilege() does not depend on schema USAGE.
#
# That is the same failure shape as the --no-privileges defect: a recovery that
# looks complete and is unusable. Verified: with --schema the restored schema
# has "(no ACL)" and `select from chat.config` as chat_app is "permission denied
# for schema chat"; without it the ACL is
# `authenticated=U | service_role=U | chat_app=U | chat_service=U` and the same
# query returns every row.
#
# Dropping the flag costs nothing, because backup-db.sh already scopes the dump
# with pg_dump --schema. Restoring one schema out of a FULL-cluster dump is the
# only case the flag would serve, and it is not a case this project's own
# archives produce.

# --no-privileges is no longer passed by default, and that is the fix for a
# restore that looked like it worked. GRANTs in this schema name chat_app,
# chat_service, authenticated and service_role -- all created by our own
# migration 20260905091150, so they exist wherever this schema does. Dropping
# them yielded a database whose own acceptance test says "chat_app cannot INSERT
# into chat.account, ... -- the application would fail closed".

# Same host/container translation the dump side does.
host_url() {
  printf '%s' "$1" | sed -e 's|@localhost:|@host.docker.internal:|' \
                          -e 's|@127\.0\.0\.1:|@host.docker.internal:|'
}

# Read ONE value from the target. Separate from target_sql because that one
# prints psql's table formatting -- headers, rules, "(1 row)" -- which is fine
# for a statement whose output is discarded and useless for a comparison. Using
# it for one made this script refuse every restore, on the grounds that a brand
# new empty database already had the schema.
target_scalar() {
  if command -v psql >/dev/null 2>&1; then
    psql -tAq -v ON_ERROR_STOP=1 -d "$TARGET" -c "$1"
  else
    docker run --rm --network host --add-host=host.docker.internal:host-gateway \
      "${PG_IMAGE:-postgres:17-alpine}" \
      psql -tAq -v ON_ERROR_STOP=1 -d "$(host_url "$TARGET")" -c "$1"
  fi
}

# Run one statement against the target, using local psql if present.
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
# Two things a schema-scoped dump cannot do for itself.
#
# 1. THE SCHEMA. pg_dump records `CREATE SCHEMA chat` as a TOC entry whose own
#    namespace is "-", not "chat" -- so `pg_restore --schema=chat` filters out
#    the one statement that creates the schema, and the restore dies on its
#    first object with `schema "chat" does not exist`. Creating it up front is
#    what makes --schema usable at all.
#
# 2. THE ROLES. The ACL entries reference roles a bare target does not have.
#    They are NOLOGIN and carry no password, so creating them grants nobody
#    access -- it only gives the GRANTs something to name.
#
#    Role ATTRIBUTES and MEMBERSHIPS are cluster-level and appear in no
#    schema-scoped dump, so they cannot be recovered from the archive and must
#    be restated here. The attributes are not cosmetic and a drill proved it:
#    creating chat_app NOINHERIT recovered a database that failed its own
#    acceptance test ("chat_app is NOINHERIT -- it would match no policy written
#    `to authenticated`"), and creating chat_service without BYPASSRLS failed
#    rls_enforcement A3. Both restore silently and read zero rows.
#
#    This mirrors the FINAL state of migration 20260907120000, which itself
#    corrects the NOINHERIT that 20260907100300 got wrong. ALTER runs
#    unconditionally so a target carrying the older, wrong attributes is
#    corrected rather than left broken. If this ever diverges, the migrations
#    win -- and db/tests/schema_acceptance.sql is what catches the divergence.
# The schema is NOT pre-created any more: the archive creates it together with
# its ACL, and an existing one would make that CREATE fail under --exit-on-error.
# Refusing early with the remedy beats failing half way through a restore.
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
        create role chat_app nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'chat_service') then
        create role chat_service nologin;
      end if;
    end
    \$\$;

    alter role chat_app     inherit nobypassrls;
    alter role chat_service inherit bypassrls;

    -- Membership is what makes a policy written \`to authenticated\` apply to
    -- the connection the API actually uses.
    grant authenticated to chat_app;
    grant service_role  to chat_service;" >/dev/null
fi

echo "Restoring $FILE"
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore "${ARGS[@]}" --dbname="$TARGET" "$FILE"
else
  echo "  pg_restore not installed; using ${PG_IMAGE:-postgres:17-alpine}"
  docker run --rm --network host \
    --add-host=host.docker.internal:host-gateway \
    -v "$(cd "$(dirname "$FILE")" && pwd)":/backup \
    "${PG_IMAGE:-postgres:17-alpine}" \
    pg_restore "${ARGS[@]}" \
      --dbname="$(printf '%s' "$TARGET" | sed -e 's|@localhost:|@host.docker.internal:|' -e 's|@127\.0\.0\.1:|@host.docker.internal:|')" \
      "/backup/$(basename "$FILE")"
fi

echo
echo "Restore finished. A restore is not verified until you have checked that"
echo "the data is actually there -- see the drill checklist in"
echo "docs/infrastructure/backup-recovery.md."
