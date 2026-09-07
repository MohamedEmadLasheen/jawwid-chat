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
[ -n "$SCHEMA" ] && ARGS+=(--schema="$SCHEMA")
[ "$NO_PRIVILEGES" -eq 1 ] && ARGS+=(--no-privileges)

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
if [ -n "$SCHEMA" ]; then
  echo "Preparing target: schema \"$SCHEMA\""
  target_sql "create schema if not exists \"$SCHEMA\"" >/dev/null
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
