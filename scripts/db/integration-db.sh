#!/usr/bin/env bash
# Jawwid Chat — integration test database (QA-owned, AI #5).
#
# Plain `postgres:17`. NOT the Supabase image: docs/release/database-decision.md
# fixes that Jawwid Chat owns its own PostgreSQL database and does not depend on
# Jawwid Core's database or Supabase's `auth` schema. The only remaining coupling
# is one auth.uid() call, supplied by db/integration/00_identity_stub.sql, which
# is scaffolding that DB-1 deletes.
#
#   scripts/db/integration-db.sh up       start + migrate
#   scripts/db/integration-db.sh reset    drop and rebuild from empty
#   scripts/db/integration-db.sh psql     interactive shell
#   scripts/db/integration-db.sh down     remove
#
# MIGRATION SOURCE
# ----------------
# The working tree alone DOES NOT APPLY. 20260905093000_chat_communication
# references chat.family / chat.thread / chat.staff, which live only on
# feat/backend-foundation (090200-090800). Verified:
#
#   ERROR:  relation "chat.family" does not exist
#
# Until docs/release/branch-reconciliation.md is executed, this script composes
# the full set into a scratch directory by reading the missing migrations from
# that branch with `git show`. It does NOT merge, checkout, or modify the
# working tree -- composition is read-only and lives outside the repo.
#
# Set JAWWID_COMPOSE=0 once reconciliation has landed and the working tree is
# self-sufficient.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER=${JAWWID_INT_CONTAINER:-jawwid-chat-int}
IMAGE=postgres:17
DB=jawwid_chat_int
PORT=${JAWWID_INT_PORT:-55433}
COMPOSE=${JAWWID_COMPOSE:-1}
FOUNDATION_BRANCH=${JAWWID_FOUNDATION_BRANCH:-feat/backend-foundation}
STAGE="${TMPDIR:-/tmp}/jawwid-int-migrations"

# Migrations deliberately NOT applied to the integration database.
#
# 20260905090900_chat_core_integration creates chat.core_* VIEWS over Jawwid
# Core's public.profiles / children / subscriptions / payments. The fixed
# database decision (docs/release/database-decision.md DB-2) replaces those
# views with the approved integration boundary: Chat owns its database and does
# not read Core over SQL. Applying it here would require stubbing Core's tables
# and would validate an architecture that has been overruled.
#
# Excluding it is a QA position, not a deletion -- the migration is untouched on
# its branch. Tracked as JC-009 / defect log.
# Nothing excluded by default: 20260905091200_chat_rls depends on
# chat.sync_state from 090900, so the Core-coupled migration is not isolable.
# That non-isolability is itself recorded as a finding (JC-009).
EXCLUDE=${JAWWID_EXCLUDE_MIGRATIONS:-'^$'}

export DATABASE_URL="postgres://postgres:postgres@localhost:${PORT}/${DB}"

psql_q() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }

stage_migrations() {
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  cp "$ROOT"/supabase/migrations/*.sql "$STAGE"/
  if [ "$COMPOSE" = "1" ]; then
    local n=0
    while read -r f; do
      [ -z "$f" ] && continue
      local base; base="$(basename "$f")"
      if [ -n "$(printf '%s' "$base" | grep -E "$EXCLUDE" || true)" ]; then
        echo "  EXCLUDED $base -- see database-decision.md DB-2"
        continue
      fi
      if [ ! -f "$STAGE/$base" ]; then
        git -C "$ROOT" show "$FOUNDATION_BRANCH:$f" > "$STAGE/$base"
        n=$((n+1))
      fi
    done < <(git -C "$ROOT" ls-tree -r --name-only "$FOUNDATION_BRANCH" -- supabase/migrations 2>/dev/null || true)
    echo "  composed $n migration(s) from $FOUNDATION_BRANCH (pre-reconciliation)"
  fi
}

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
  psql_q -q < "$ROOT/db/integration/00_identity_stub.sql"
  psql_q -q < "$ROOT/db/integration/01_core_boundary_stub.sql"
  stage_migrations
  PSQL="docker exec -i $CONTAINER psql -v ON_ERROR_STOP=1 -U postgres -d $DB" \
    MIGRATIONS_DIR="$STAGE" bash "$ROOT/scripts/db/apply.sh"
}

case "${1:-up}" in
  up)    start; migrate; echo "ready: $DATABASE_URL" ;;
  reset) docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; start; migrate; echo "reset: $DATABASE_URL" ;;
  psql)  docker exec -it "$CONTAINER" psql -U postgres -d "$DB" ;;
  down)  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; echo "removed" ;;
  *)     echo "usage: $0 {up|reset|psql|down}" >&2; exit 2 ;;
esac
