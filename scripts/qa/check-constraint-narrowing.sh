#!/usr/bin/env bash
# A later migration must never silently DROP a value an earlier one allowed.
#
#   scripts/qa/check-constraint-narrowing.sh
#
# WHY THIS EXISTS
# ---------------
# Several migrations widen an enumerated CHECK constraint by restating it:
#
#   alter table X drop constraint if exists C;
#   alter table X add constraint C check (col in ('a','b','c'));
#
# The list is RETYPED each time, so forgetting an entry does not fail to add it
# -- it REMOVES it. That is not hypothetical. 20260908100000 retyped
# chat.auth_throttle's scope list and dropped 'reset_request_subject', the
# per-target axis of the forgot-password throttle, with two proven consequences:
#
#   * on a database where anyone had ever used forgot-password, ADD CONSTRAINT
#     failed with "is violated by some row" and the migration ABORTED;
#   * on a fresh one it applied cleanly, and then every forgot-password request
#     raised a check violation from inside chat.record_auth_attempt.
#
# It was caught by reading the two lists side by side. This does that
# mechanically, for every constraint, on every commit -- no database, no
# toolchain beyond git and awk, milliseconds.
#
# INTENTIONAL REMOVALS. Deprecating a value is legitimate, and this will flag it,
# which is the point: dropping an allowed value is a data-migration decision, not
# a typo, and it should be visible in review. To make one, remove the value AND
# add its name to ACKNOWLEDGED_REMOVALS below with a reason.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MIGRATIONS="${MIGRATIONS_DIR:-supabase/migrations}"

# '<constraint>:<value>' pairs whose removal has been reviewed and accepted.
ACKNOWLEDGED_REMOVALS=""

# Every value inside `add constraint <name> check ( ... )`, one per line.
# Reads from the constraint name to the first line ending the statement.
values_for() {
  local file="$1" name="$2"
  awk -v c="$name" '
    $0 ~ ("add constraint[[:space:]]+" c "([^a-z_]|$)") { inside = 1 }
    inside {
      buf = buf $0 " "
      if ($0 ~ /\);[[:space:]]*$/) { print buf; exit }
    }
  ' "$file" | grep -oE "'[a-zA-Z0-9_.-]+'" | sort -u
}

# Constraint names restated by more than one migration are the only ones at risk.
names=$(grep -ohE 'add constraint [a-z_]+' "$MIGRATIONS"/*.sql 2>/dev/null \
        | awk '{print $NF}' | sort | uniq -d)

findings=0
checked=0

for name in $names; do
  files=$(grep -lE "add constraint $name([^a-z_]|$)" "$MIGRATIONS"/*.sql | sort)
  [ "$(printf '%s\n' "$files" | wc -l)" -gt 1 ] || continue

  prev_file=""; prev_values=""
  for file in $files; do
    current=$(values_for "$file" "$name")
    # Only enumerated constraints have a value list; skip FK/unique restatements.
    [ -n "$current" ] || { prev_file="$file"; prev_values="$current"; continue; }

    if [ -n "$prev_values" ]; then
      checked=$((checked + 1))
      removed=$(comm -23 <(printf '%s\n' "$prev_values") <(printf '%s\n' "$current"))
      for value in $removed; do
        case " $ACKNOWLEDGED_REMOVALS " in
          *" ${name}:${value//\'/} "*) continue ;;
        esac
        echo "::error::$name lost $value"
        echo "    was allowed by: $(basename "$prev_file")"
        echo "    dropped by:     $(basename "$file")"
        findings=$((findings + 1))
      done
    fi
    prev_file="$file"; prev_values="$current"
  done
done

echo
if [ "$findings" -eq 0 ]; then
  echo "constraint narrowing: clean ($checked restatement(s) compared)"
else
  cat <<'MSG'

A later migration removed a value an earlier one allowed. Retyping the list is
how this happens; copy it from the previous migration instead.

If the removal is deliberate, it needs a data migration for existing rows -- ADD
CONSTRAINT fails outright on a database that already holds one -- and the
'<constraint>:<value>' pair added to ACKNOWLEDGED_REMOVALS in this script.
MSG
  exit 1
fi
