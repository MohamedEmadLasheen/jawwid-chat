#!/usr/bin/env bash
# JC-011 guard: fail if a protected security regression test is deleted or gutted.
#
# Deleting a test never fails a build. That is how JC-005 and JC-006 were
# silently reintroduced. This closes the hole.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$ROOT/docs/qa/protected-tests.tsv"
fail=0

while IFS=$'\t' read -r path floor reason; do
  case "$path" in ''|\#*) continue ;; esac

  if [ ! -f "$ROOT/$path" ]; then
    echo "::error::JC-011 — protected test DELETED: $path"
    echo "           guards: $reason"
    fail=1
    continue
  fi

  # Count assertions. Gutting a file to an empty shell is the same failure as
  # deleting it.
  #
  # SQL suites express assertions as pg_temp.expect_violation / expect_ok /
  # want_* / check calls rather than expect(), so they are counted on their own
  # idiom. Without this a .sql guard would count zero and fail every run, which
  # would get it removed from the manifest -- the exact outcome JC-011 exists to
  # stop. `check` was added for the Phase 1 suites, which use it as their single
  # assertion helper.
  case "$path" in
    *.sql) n=$(grep -cE 'pg_temp\.(expect_violation|expect_ok|want_|check\()' "$ROOT/$path" || true) ;;
    *)     n=$(grep -c 'expect(' "$ROOT/$path" || true) ;;
  esac
  if [ "$n" -lt "$floor" ]; then
    echo "::error::JC-011 — protected test GUTTED: $path has $n assertions, floor is $floor"
    echo "           guards: $reason"
    fail=1
    continue
  fi

  echo "  ok  $path ($n assertions, floor $floor)"
done < "$MANIFEST"

if [ "$fail" -ne 0 ]; then
  echo
  echo "A protected regression test was removed or weakened."
  echo "If a refactor moved it, update docs/qa/protected-tests.tsv in the same commit."
  echo "If it failed, fix the code — the test is guarding a confirmed defect."
  exit 1
fi
echo "JC-011 guard: pass"
