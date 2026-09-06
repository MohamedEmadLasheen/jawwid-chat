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

FILE=""; TARGET=""; CONFIRM_PROD=0; SCHEMA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file)   FILE="${2:-}"; shift 2 ;;
    --into)   TARGET="${2:-}"; shift 2 ;;
    --schema) SCHEMA="${2:-}"; shift 2 ;;
    --i-understand-this-overwrites-production) CONFIRM_PROD=1; shift ;;
    *) echo "usage: $0 --file dump --into url [--schema name]" >&2; exit 64 ;;
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

ARGS=(--no-owner --no-privileges --exit-on-error --verbose)
[ -n "$SCHEMA" ] && ARGS+=(--schema="$SCHEMA")

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
