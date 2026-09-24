#!/usr/bin/env bash
# Jawwid Chat -- database role-capability preflight. Owner: AI #7.
#
#   scripts/db/preflight-role-capability.sh
#   PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL" scripts/db/preflight-role-capability.sh
#
# WHY THIS EXISTS
# ---------------
# Migration 20260910120200_chat_connection_roles.sql contains, unconditionally:
#
#     alter role chat_service bypassrls;
#
# BYPASSRLS is the attribute that lets the worker, the migration runner and the
# ingestion path act for the system rather than for a user -- see
# docs/security/RLS-STRATEGY.md section 3. Granting it requires a privilege that
# not every managed PostgreSQL gives the role it hands you.
#
# Without this check, a provider that withholds that privilege fails at
# 20260910120200 -- the SEVENTEENTH of the migrations. `apply.sh` runs with
# ON_ERROR_STOP=1, so the run halts there, and the deployment stops with the
# database PARTIALLY MIGRATED: sixteen migrations applied, the connection roles
# absent, and the error a raw PostgreSQL permission message a long way from its
# cause. That is the worst moment to discover a provider incompatibility.
#
# So this runs FIRST, changes nothing, and says exactly what is wrong.
#
# WHAT IT DOES NOT DO
# -------------------
# It does not weaken anything. It does not substitute a lesser role, it does not
# make the migration conditional, and it does not let a failed migration
# continue. If the capability is absent the correct outcome is a refused
# deployment and a provider conversation -- not a database whose security model
# quietly differs from the one the policies were written against.
#
# The probe is a real CREATE ROLE inside a transaction that is ALWAYS rolled
# back. Asking the catalogue instead (`rolsuper`, `rolcreaterole`) would encode
# a guess about how each provider and each PostgreSQL major version decides who
# may confer role attributes; actually attempting it asks the server.
set -euo pipefail

PSQL="${PSQL:-psql -v ON_ERROR_STOP=1 ${DATABASE_URL:-}}"

if [ -z "${DATABASE_URL:-}" ] && [ -z "${PSQL:-}" ]; then
  echo "preflight: DATABASE_URL is not set" >&2
  exit 2
fi

# A name no migration uses, so a leaked probe role is recognisable. It cannot
# leak -- the transaction is rolled back -- but naming matters if one ever does.
PROBE="jawwid_preflight_probe_$$"

probe_sql=$(cat <<SQL
begin;
create role ${PROBE} bypassrls nologin;
rollback;
SQL
)

echo "preflight: checking the database role can confer BYPASSRLS"

if output=$(printf '%s\n' "$probe_sql" | $PSQL -q -t -A 2>&1); then
  echo "preflight: ok -- BYPASSRLS can be granted; 20260910120200 will apply"
  exit 0
fi

cat >&2 <<EOF

========================================================================
PREFLIGHT FAILED -- this database cannot grant BYPASSRLS
========================================================================

The connecting role cannot create or alter a role with the BYPASSRLS
attribute. PostgreSQL said:

${output}

WHAT THIS BLOCKS
  supabase/migrations/20260910120200_chat_connection_roles.sql creates the
  two connection roles and asserts their attributes:

      chat_app      NOBYPASSRLS   the API request path, subject to RLS
      chat_service  BYPASSRLS     workers, migrations, ingestion, backups

  The second cannot be created here. Nothing has been migrated; the
  database is untouched.

WHY IT IS NOT SIMPLY REMOVED
  BYPASSRLS is the boundary between "acts for a user" and "acts for the
  system" (docs/security/RLS-STRATEGY.md section 3). Dropping it would put
  the worker and the ingestion path under per-actor policies they have no
  actor for, and the honest failure is this one -- not a weakened
  security model that still deploys.

WHAT TO DO
  1. Ask the provider whether a role may be granted BYPASSRLS, or whether
     a superuser-equivalent role can be issued for migrations only.
  2. If it cannot, this provider is incompatible with the current RLS
     design. That is a provider decision and an architecture decision, not
     a deployment fix.

========================================================================

EOF
exit 1
