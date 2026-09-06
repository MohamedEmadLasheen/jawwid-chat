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
  {
    echo "begin;"
    cat "$file"
    echo ";"
    echo "insert into chat.schema_migrations (version) values ('$version');"
    echo "commit;"
  } | $PSQL -q >/dev/null
done

echo "migrations up to date"
