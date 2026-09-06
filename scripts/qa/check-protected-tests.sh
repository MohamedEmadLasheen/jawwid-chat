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
  n=$(grep -c 'expect(' "$ROOT/$path" || true)
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
