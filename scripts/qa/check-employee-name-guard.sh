#!/usr/bin/env bash
# G-20 meta-guard: prove the employee-name guard actually works.
#
# G-20 was red on every commit for a reason no source change could fix: the
# forbidden list is declared inline in ci.yml, and the scan covered .github, so
# the guard matched its own definition. It could never pass. Because one failing
# step collapses the whole `guards` job, and six other jobs declare
# `needs: guards`, that single self-match meant CI never ran at all.
#
# A guard that cannot pass is as useless as one that cannot fail, so this checks
# both directions:
#
#   A. a clean tree passes, even though ci.yml itself contains every name
#   B. a protected name planted in application source still fails
#
# It does NOT reimplement the scan. It extracts the real `run:` body of the G-20
# step from ci.yml and executes it, so if someone edits the guard, this exercises
# whatever they wrote -- a copy would happily agree with itself while the real
# guard rotted.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="$ROOT/.github/workflows/ci.yml"
fail=0

if [ ! -f "$CI" ]; then
  echo "::error::G-20 meta-guard — $CI not found"
  exit 1
fi

# The script body of the G-20 step, dedented so bash can run it.
extract_guard() {
  awk '
    /- name: G-20 · no real employee names/ { found = 1; next }
    found && /^      - name: /              { exit }
    found && /^        run: \|/             { inblock = 1; next }
    inblock                                 { sub(/^          /, ""); print }
  ' "$CI"
}

GUARD="$(extract_guard)"
if [ -z "$GUARD" ]; then
  echo "::error::G-20 meta-guard — could not extract the G-20 step from ci.yml"
  echo "           the step name or its indentation changed; update this script"
  exit 1
fi

# A name the guard must catch. Taken from the guard's own list so the two can
# never drift apart: if the list is rewritten, this reads the new first entry.
PROTECTED="$(printf '%s' "$GUARD" | grep -oE "\\\$'[^']+'" | head -1 | sed "s/^\\\$'//; s/'$//" | cut -d'|' -f1 | sed 's/\\\\$//')"
if [ -z "$PROTECTED" ]; then
  echo "::error::G-20 meta-guard — could not read a protected name out of the guard"
  exit 1
fi

run_guard_in() {
  ( cd "$1" && bash -c "$GUARD" >/dev/null 2>&1 )
}

# --- A. a clean tree passes, with ci.yml present and full of the names --------
CLEAN="$(mktemp -d)"
trap 'rm -rf "$CLEAN" "${DIRTY:-}"' EXIT
mkdir -p "$CLEAN/.github/workflows" "$CLEAN/lib"
cp "$CI" "$CLEAN/.github/workflows/ci.yml"
printf "const learner = 'Layla';\n" > "$CLEAN/lib/fixture.dart"

if run_guard_in "$CLEAN"; then
  echo "  ok  A · a clean tree passes even though ci.yml declares every name"
else
  echo "::error::G-20 meta-guard A FAIL — the guard rejects a clean tree."
  echo "           It is almost certainly matching its own definition again;"
  echo "           .github must stay excluded from the scan."
  fail=1
fi

# --- B. a planted name in application source still fails ---------------------
DIRTY="$(mktemp -d)"
mkdir -p "$DIRTY/.github/workflows" "$DIRTY/lib"
cp "$CI" "$DIRTY/.github/workflows/ci.yml"
printf "const learner = '%s';\n" "$PROTECTED" > "$DIRTY/lib/fixture.dart"

if run_guard_in "$DIRTY"; then
  echo "::error::G-20 meta-guard B FAIL — a protected employee name in lib/ was NOT detected."
  echo "           The guard has been weakened; it must still scan application and test sources."
  fail=1
else
  echo "  ok  B · a protected name planted in lib/ is still detected"
fi

if [ "$fail" -ne 0 ]; then
  echo "G-20 meta-guard: FAIL"
  exit 1
fi
echo "G-20 meta-guard: pass"
