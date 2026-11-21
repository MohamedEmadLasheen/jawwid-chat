#!/usr/bin/env bash
# Apply Jawwid Chat migrations in filename order.
#
# Jawwid Chat lives in the `chat` schema inside the Jawwid Core Supabase
# database. It therefore keeps its own migration ledger (chat.schema_migrations)
# rather than sharing Core's supabase_migrations.schema_migrations ledger --
# otherwise `supabase db push` from either repository would treat the other
# repository's migrations as missing. See docs/architecture/decisions.md ADR-002.
#
# Usage:
#   PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL" scripts/db/apply.sh
#   scripts/db/apply.sh                      # defaults to psql + $DATABASE_URL
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# MIGRATIONS_DIR lets the integration harness point at a composed set while
# branch reconciliation is pending (docs/release/branch-reconciliation.md).
# Defaults to the repository migrations, so existing callers are unaffected.
MIGRATIONS="${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"
PSQL="${PSQL:-psql -v ON_ERROR_STOP=1 ${DATABASE_URL:-}}"

run_sql() { echo "$1" | $PSQL -q -t -A; }

run_sql "
  create schema if not exists chat;
  create table if not exists chat.schema_migrations (
    version     text primary key,
    applied_at  timestamptz not null default now()
  );
"

applied="$(run_sql 'select version from chat.schema_migrations')"

for file in "$MIGRATIONS"/*.sql; do
  version="$(basename "$file" .sql)"
  if grep -qxF "$version" <<<"$applied"; then
    echo "  skip    $version"
    continue
  fi
  echo "  apply   $version"
  # Each migration runs in one transaction together with its ledger row, so a
  # failed migration is never recorded as applied.
  # `set local statement_timeout = 0`: a migration is never cancelled by the
  # RUNTIME's query timeout. Where a pooler drops the connection's `options`
  # (Supabase's, ADR-014), that timeout is set on the role instead, and the
  # migration runner connects as the same role. LOCAL ends with this
  # transaction, so nothing after it is affected.
  # APPLY_LOCK_TIMEOUT (optional, e.g. 5s): how long a migration may wait for a lock before it gives up
  # (and rolls back whole, ledger row unwritten, safe to retry) instead of queueing behind a long
  # transaction and blocking every other writer. Set as `set local` for the same reason as the
  # statement timeout above: a pooler that drops the connection's `options` (Supabase's, ADR-014)
  # would silently ignore PGOPTIONS='-c lock_timeout=...'. Unset = unchanged behaviour.
  lock_timeout_sql=""
  if [ -n "${APPLY_LOCK_TIMEOUT:-}" ]; then
    [[ "$APPLY_LOCK_TIMEOUT" =~ ^[0-9]+(ms|s|min)?$ ]] || { echo "APPLY_LOCK_TIMEOUT must look like 5s, 500ms or 1min" >&2; exit 2; }
    lock_timeout_sql="set local lock_timeout = '$APPLY_LOCK_TIMEOUT';"
  fi
  {
    echo "begin;"
    echo "set local statement_timeout = 0;"
    [ -z "$lock_timeout_sql" ] || echo "$lock_timeout_sql"
    cat "$file"
    echo ";"
    echo "insert into chat.schema_migrations (version) values ('$version');"
    echo "commit;"
  } | $PSQL -q >/dev/null
done

echo "migrations up to date"
