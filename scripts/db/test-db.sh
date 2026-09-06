#!/usr/bin/env bash
# Local test database for Jawwid Chat.
#
#   scripts/db/test-db.sh up      start the container
#   scripts/db/test-db.sh reset   drop and rebuild: Core shim + all migrations
#   scripts/db/test-db.sh psql    interactive shell
#   scripts/db/test-db.sh down    remove the container
#
# Plain PostgreSQL: Jawwid Chat owns its entire schema and depends on no other
# product's database. The two application roles are created by
# db/testkit/00_bootstrap.sql.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER=jawwid-chat-test
IMAGE=postgres:17
DB=jawwid_chat_test
PORT=55432

psql_cmd() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }

case "${1:-reset}" in
  up)
    if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
      docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
      docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres \
        -e POSTGRES_DB="$DB" -p "$PORT":5432 "$IMAGE" >/dev/null
      for _ in $(seq 1 60); do
        docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
        sleep 1
      done
    fi
    echo "test database ready on localhost:$PORT"
    ;;
  reset)
    "$0" up
    psql_cmd -q -c "drop schema if exists chat cascade;"
    psql_cmd -q -f - < "$ROOT/db/testkit/00_bootstrap.sql"
    PSQL="docker exec -i $CONTAINER psql -v ON_ERROR_STOP=1 -U postgres -d $DB" \
      bash "$ROOT/scripts/db/apply.sh"
    ;;
  psql) psql_cmd ;;
  down) docker rm -f "$CONTAINER" >/dev/null 2>&1; echo "removed" ;;
  *) echo "usage: $0 {up|reset|psql|down}" >&2; exit 64 ;;
esac
