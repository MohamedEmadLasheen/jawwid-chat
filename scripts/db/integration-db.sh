#!/usr/bin/env bash
# Jawwid Chat — integration test database (QA-owned, AI #5).
#
# Plain `postgres:17`. NOT the Supabase image: docs/release/database-decision.md
# fixes that Jawwid Chat owns its own PostgreSQL database and does not depend on
# Jawwid Core's database or Supabase's `auth` schema. That coupling is now gone:
# identity resolves through chat.account, and 20260905091150 creates the three
# role names the RLS policies are written against, so a bare postgres:17 is
# sufficient.
#
#   scripts/db/integration-db.sh up       start + migrate
#   scripts/db/integration-db.sh reset    drop and rebuild from empty
#   scripts/db/integration-db.sh psql     interactive shell
#   scripts/db/integration-db.sh verify   run the structural gates
#   scripts/db/integration-db.sh down     remove
#
# MIGRATION SOURCE
# ----------------
# supabase/migrations is the SINGLE SQL authority and builds an empty database
# on its own. Red-team finding RT-023 was that it could not: 093000 referenced
# chat.family / chat.thread / chat.staff / chat.learner / chat.message, which
# existed only on feat/backend-foundation, so this script used to compose the
# set across branches with `git show`, and applied two stub files to supply an
# `auth` schema and Jawwid Core's tables.
#
# All three crutches are gone. Do not reintroduce them: a harness that can build
# a database the migration chain cannot is how RT-023 stayed invisible.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER=${JAWWID_INT_CONTAINER:-jawwid-chat-int}
IMAGE=postgres:17
DB=jawwid_chat_int
PORT=${JAWWID_INT_PORT:-55433}


export DATABASE_URL="postgres://postgres:postgres@localhost:${PORT}/${DB}"
# The least-privileged runtime role the API connects as. The suite that proves
# RLS is enforced uses this; everything else keeps using the owner connection.
export DATABASE_APP_URL="postgres://chat_app:chat_app@localhost:${PORT}/${DB}"

psql_q() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }

start() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$CONTAINER" \
      -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$DB" \
      -p "$PORT":5432 "$IMAGE" >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "postgres did not become ready" >&2; exit 1
}

migrate() {
  PSQL="docker exec -i $CONTAINER psql -v ON_ERROR_STOP=1 -U postgres -d $DB" \
    bash "$ROOT/scripts/db/apply.sh"
  grant_runtime_roles
}

# The two runtime roles, given a LOGIN and a throwaway local password.
#
# Migrations create chat_app and chat_service NOLOGIN on purpose -- a migration
# must never contain a credential -- so something has to grant the login, and in
# a deployed environment that something is the platform's secret store. Here it
# is this function, so the integration suite can connect exactly as production
# will: as chat_app, which is NOT the owner and cannot bypass RLS.
grant_runtime_roles() {
  psql_q -q -c "
    alter role chat_app     login password 'chat_app';
    alter role chat_service login password 'chat_service';
    grant connect on database ${DB} to chat_app, chat_service;
  " >/dev/null
}

# The two structural gates, runnable locally exactly as CI runs them.
verify() {
  psql_q -v ON_ERROR_STOP=1 -q < "$ROOT/db/tests/schema_acceptance.sql"
  psql_q -v ON_ERROR_STOP=1 -q < "$ROOT/db/tests/br1_invariants.sql"
}

case "${1:-up}" in
  up)     start; migrate; echo "ready: $DATABASE_URL"; echo "  app role: $DATABASE_APP_URL" ;;
  reset)  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; start; migrate;
          echo "reset: $DATABASE_URL"; echo "  app role: $DATABASE_APP_URL" ;;
  verify) verify ;;
  psql)  docker exec -it "$CONTAINER" psql -U postgres -d "$DB" ;;
  down)  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; echo "removed" ;;
  *)      echo "usage: $0 {up|reset|verify|psql|down}" >&2; exit 2 ;;
esac
