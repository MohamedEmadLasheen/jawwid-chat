#!/usr/bin/env bash
# Run the Jawwid Chat database test suites.
#
#   scripts/db/test.sh              all suites
#   scripts/db/test.sh coverage     only db/tests/coverage*.sql
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER=jawwid-chat-test
DB=jawwid_chat_test
FILTER="${1:-}"

psql_file() {
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$DB" -f - < "$1"
}

bash "$ROOT/scripts/db/test-db.sh" reset >/dev/null 2>&1 || {
  echo "could not prepare the test database" >&2; exit 1; }

for f in "$ROOT"/db/testkit/*.sql; do psql_file "$f" >/dev/null || {
  echo "failed loading testkit: $f" >&2; exit 1; }; done

failed=0 ran=0
for suite in "$ROOT"/db/tests/*.sql; do
  name="$(basename "$suite" .sql)"
  [[ -n "$FILTER" && "$name" != *"$FILTER"* ]] && continue
  ran=$((ran + 1))
  echo "=== $name ==="
  out="$(psql_file "$suite" 2>&1)"; rc=$?
  sed -n 's/^.*NOTICE:  //p' <<<"$out"
  if [[ $rc -ne 0 ]]; then
    grep -E '^(ERROR|psql:)' <<<"$out" | head -5
    failed=$((failed + 1))
  fi
done

if [[ $ran -eq 0 ]]; then echo "no suites matched '${FILTER}'" >&2; exit 64; fi
if [[ $failed -gt 0 ]]; then echo; echo "$failed suite(s) FAILED"; exit 1; fi
echo; echo "all $ran suite(s) passed"
