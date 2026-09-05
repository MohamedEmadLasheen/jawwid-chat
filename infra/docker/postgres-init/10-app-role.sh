#!/usr/bin/env bash
# Creates the application role used by the API.
#
# Runs once, on first initialisation of an empty data volume. It exists so a
# single Postgres container serves both database strategies currently in the
# tree: the `chat`-schema-inside-Core model (which needs the Supabase roles the
# image already provides) and the Prisma model (which connects as `jawwid`).
# See docs/infrastructure/decisions.md ADR-001.
#
# LOCAL ONLY. Staging and production use managed Postgres with credentials from
# the secret store; this file is never applied there.
set -euo pipefail

APP_USER="${APP_DB_USER:-jawwid}"
APP_PASSWORD="${APP_DB_PASSWORD:-jawwid}"
APP_DB="${POSTGRES_DB:-jawwid_chat}"

psql -v ON_ERROR_STOP=1 --username postgres --dbname "$APP_DB" <<EOSQL
  do \$\$
  begin
    if not exists (select 1 from pg_roles where rolname = '${APP_USER}') then
      create role ${APP_USER} login password '${APP_PASSWORD}';
    end if;
  end
  \$\$;

  -- Enough to own the application schema, not enough to be a superuser.
  grant all on database ${APP_DB} to ${APP_USER};
  grant all on schema public to ${APP_USER};
  alter schema public owner to ${APP_USER};
EOSQL

echo "app role '${APP_USER}' ready on database '${APP_DB}'"
