#!/usr/bin/env bash
# G-20 meta-guard: prove the employee-name guard actually works.
#
# This does NOT scan this repository -- G-20 does that:
#
#   bash scripts/qa/guards.sh g20      # the guard, on this tree
#   bash scripts/qa/guards.sh          # every fast release gate
#
# It proves the guard itself, in both directions, on throwaway trees:
#
#   A. a clean tree passes, even with the guard's own definition present
#   B. a protected name planted in lib/ (tracked) is still detected
#   C. EVERY protected name, planted in an untracked fixture, is detected under
#      both the C locale and a UTF-8 locale
#   D. docs/ stays exempt: the brief may name staff
#
# Why C exists. G-20 used to be a GNU-grep one-liner in ci.yml, and this script
# ran that one-liner. On a Mac it fake-passed: zsh rewrites the `\|` inside
# $'...' to a literal pipe, and a different grep can read the same regex
# differently. On 2026-10-20 a fixture named a child after a protected name;
# every local check passed and only CI's GNU grep caught it (b160b1ac). B never
# noticed, because it planted only the FIRST name on the list. C plants every
# name in the shape of that fixture, so a guard that matches some names and not
# others -- the way a broken alternation fails -- cannot pass.
#
# It does NOT reimplement the scan. It copies the real scripts/qa/guards.sh into
# each tree and runs its `g20` gate, and reads the protected list back out of it
# (`guards.sh --g20-names`), so if someone edits the guard or the list this
# exercises whatever they wrote -- a copy would happily agree with itself while
# the real guard rotted. That is also why no protected name is spelled out here:
# this file is scanned by G-20 like any other.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARDS="$ROOT/scripts/qa/guards.sh"
CI="$ROOT/.github/workflows/ci.yml"
fail=0

for f in "$GUARDS" "$CI"; do
  if [ ! -f "$f" ]; then
    echo "::error::G-20 meta-guard — $f not found"
    exit 1
  fi
done

NAMES=()
while IFS= read -r n; do
  [ -n "$n" ] && NAMES+=("$n")
done < <(bash "$GUARDS" --g20-names)
if [ "${#NAMES[@]}" -eq 0 ]; then
  echo "::error::G-20 meta-guard — could not read the protected list from guards.sh --g20-names"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A throwaway git work tree holding the real guard and the real ci.yml, so the
# guard sees the same file set (tracked + untracked, not ignored) it sees here.
# It is called as $(new_tree) -- a subshell -- so every tree lives under $WORK
# and the one trap above removes them all.
new_tree() {
  local t
  t="$(mktemp -d "$WORK/tree.XXXXXX")"
  mkdir -p "$t/scripts/qa" "$t/.github/workflows" "$t/lib" "$t/docs"
  cp "$GUARDS" "$t/scripts/qa/guards.sh"
  cp "$CI" "$t/.github/workflows/ci.yml"
  git -C "$t" init -q
  printf '%s\n' "$t"
}

# Runs the g20 gate in a tree. Prints its output; returns the gate's status.
run_guard_in() {
  local tree="$1" locale="${2:-}"
  if [ -n "$locale" ]; then
    ( cd "$tree" && LC_ALL="$locale" bash scripts/qa/guards.sh g20 ) 2>&1
  else
    ( cd "$tree" && bash scripts/qa/guards.sh g20 ) 2>&1
  fi
}

# "Detected" means the gate failed BECAUSE of the planted file -- not merely
# that it exited non-zero, which a crashed scanner would also do.
detected() {
  local out="$1" path="$2"
  printf '%s\n' "$out" | grep -q 'G-20 FAIL — real employee names' &&
    printf '%s\n' "$out" | grep -qxF "$path"
}

# --- A. a clean tree passes, with the guard's definition present -------------
CLEAN="$(new_tree)"
printf "const learner = 'Layla';\n" > "$CLEAN/lib/fixture.dart"
git -C "$CLEAN" add lib/fixture.dart
if out="$(run_guard_in "$CLEAN")"; then
  echo "  ok  A · a clean tree passes even though guards.sh declares every name"
else
  printf '%s\n' "$out" | sed 's/^/      /'
  echo "::error::G-20 meta-guard A FAIL — the guard rejects a clean tree."
  echo "           It is almost certainly matching its own definition again;"
  echo "           scripts/qa/guards.sh must stay exempt from the scan."
  fail=1
fi

# --- B. a planted name in tracked application source still fails ------------
DIRTY="$(new_tree)"
printf "const learner = '%s';\n" "${NAMES[0]}" > "$DIRTY/lib/fixture.dart"
git -C "$DIRTY" add lib/fixture.dart
out="$(run_guard_in "$DIRTY")"
if detected "$out" "lib/fixture.dart"; then
  echo "  ok  B · a protected name planted in lib/ is still detected"
else
  printf '%s\n' "$out" | sed 's/^/      /'
  echo "::error::G-20 meta-guard B FAIL — a protected employee name in lib/ was NOT detected."
  echo "           The guard has been weakened; it must still scan application and test sources."
  fail=1
fi

# --- C. every name, untracked, in the shape of the 2026-10-20 fixture --------
missed=""
for locale in C en_US.UTF-8; do
  i=0
  for name in "${NAMES[@]}"; do
    i=$((i + 1))
    T="$(new_tree)"
    mkdir -p "$T/lib/core/data"
    printf "ChildProfile(id: 'learner-2', displayName: '%s', level: 'x'),\n" "$name" \
      > "$T/lib/core/data/fake_repositories.dart"
    out="$(run_guard_in "$T" "$locale")"
    detected "$out" "lib/core/data/fake_repositories.dart" ||
      missed="$missed name #$i under LC_ALL=$locale;"
    rm -rf "$T"
  done
done
if [ -z "$missed" ]; then
  echo "  ok  C · every protected name (${#NAMES[@]}) planted in an untracked fixture is detected, in C and UTF-8 locales"
else
  echo "::error::G-20 meta-guard C FAIL — the guard missed:$missed"
  echo "           A guard that catches some names and not others is a broken"
  echo "           pattern (this is how the 2026-10-20 fake pass looked)."
  fail=1
fi

# --- D. docs/ stays exempt -----------------------------------------------------
DOCS="$(new_tree)"
printf 'The brief names %s.\n' "${NAMES[0]}" > "$DOCS/docs/brief.md"
if out="$(run_guard_in "$DOCS")"; then
  echo "  ok  D · a name in docs/ is allowed"
else
  printf '%s\n' "$out" | sed 's/^/      /'
  echo "::error::G-20 meta-guard D FAIL — the guard rejects a name inside docs/, where the brief belongs."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "G-20 meta-guard: FAIL"
  exit 1
fi
echo "G-20 meta-guard: pass"
