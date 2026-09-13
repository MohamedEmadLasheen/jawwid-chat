#!/usr/bin/env bash
# Does backup-db.sh run the pg_dump it was told to run?
#
# pg_dump refuses to dump from a server newer than itself, so choosing the
# client is a correctness decision. `PG_IMAGE` is how this repository names a
# client of a known major (backup-recovery.md §3), and local-development.md
# answers "pg_dump: server version mismatch" with "set PG_IMAGE" -- so the
# variable has to actually decide.
#
# It did not. Preferring whatever `pg_dump` was on PATH made PG_IMAGE inert on
# every GitHub runner, where postgresql-client 16 is installed for psql: the
# backup drill ran pg_dump 16 against the postgres:17 service and aborted on a
# version mismatch, with the documented remedy already applied and ignored.
#
# No database and no docker daemon: the client is stubbed, so this asserts the
# selection itself and stays in the fast guard job.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_UNDER_TEST="${1:-$ROOT/scripts/infra/backup-db.sh}"
FAILED=0

ok()   { echo "  ok  $1"; }
fail() { echo "  FAIL  $1"; FAILED=1; }

# A sandbox with a stub pg_dump and a stub docker, each of which records that it
# ran and produces a non-empty dump so the script's own checks are satisfied.
make_sandbox() {
  local dir="$1"
  mkdir -p "$dir/bin" "$dir/out"

  cat > "$dir/bin/pg_dump" <<'STUB'
#!/usr/bin/env bash
echo "host" > "$SELECTION_MARKER"
for a in "$@"; do
  case "$a" in --file=*) printf 'dump' > "${a#--file=}" ;; esac
done
exit "${STUB_PG_DUMP_EXIT:-0}"
STUB

  # Mirrors `docker run ... -v HOST:/backup IMAGE pg_dump --file=/backup/NAME`:
  # the dump lands on the host path the mount points at.
  cat > "$dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "container" > "$SELECTION_MARKER"
host_dir=""
file=""
for a in "$@"; do
  case "$a" in
    *:/backup) host_dir="${a%%:/backup}" ;;
    --file=/backup/*) file="${a#--file=/backup/}" ;;
  esac
done
[ -n "$host_dir" ] && [ -n "$file" ] && printf 'dump' > "$host_dir/$file"
exit "${STUB_DOCKER_EXIT:-0}"
STUB

  chmod +x "$dir/bin/pg_dump" "$dir/bin/docker"
}

# Runs the script with only the stub bin plus the system paths it genuinely
# needs, and reports which client was chosen.
run_case() {
  local dir="$1" want_pg_image="$2"
  export SELECTION_MARKER="$dir/selected"
  rm -f "$SELECTION_MARKER"

  local env_args=(
    "DATABASE_URL=postgres://backup:hunter2@localhost:5432/jawwid_chat_test"
    "PATH=$dir/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    "SELECTION_MARKER=$SELECTION_MARKER"
  )
  [ -n "$want_pg_image" ] && env_args+=("PG_IMAGE=$want_pg_image")
  [ -n "${STUB_PG_DUMP_EXIT:-}" ] && env_args+=("STUB_PG_DUMP_EXIT=$STUB_PG_DUMP_EXIT")

  env -i "${env_args[@]}" bash "$SCRIPT_UNDER_TEST" --out "$dir/out" >"$dir/stdout" 2>"$dir/stderr"
  echo $? > "$dir/exit"
}

selected() { cat "$1/selected" 2>/dev/null || echo "none"; }

# A · the regression. PG_IMAGE names the client, a host pg_dump also exists,
# and the named one must win -- this is the CI backup drill exactly.
A="$(mktemp -d)"; trap 'rm -rf "$A" "$B" "$C"' EXIT
make_sandbox "$A"
run_case "$A" "postgres:17-alpine"
if [ "$(selected "$A")" = "container" ]; then
  ok "A · PG_IMAGE wins over a host pg_dump"
else
  fail "A · PG_IMAGE was ignored; ran the $(selected "$A") client (this is the CI failure)"
fi

# B · the other direction. Without PG_IMAGE a local pg_dump is still preferred,
# so a developer and a deployment host keep the behaviour they had.
B="$(mktemp -d)"
make_sandbox "$B"
run_case "$B" ""
if [ "$(selected "$B")" = "host" ]; then
  ok "B · without PG_IMAGE a local pg_dump is still used"
else
  fail "B · a local pg_dump was bypassed; ran the $(selected "$B") client"
fi

# C · the DSN carries a password, and a failing client must not leak it.
C="$(mktemp -d)"
make_sandbox "$C"
STUB_PG_DUMP_EXIT=1 run_case "$C" ""
unset STUB_PG_DUMP_EXIT
if grep -q 'hunter2' "$C/stderr" "$C/stdout" 2>/dev/null; then
  fail "C · the DSN password reached the output"
elif [ "$(cat "$C/exit")" = "0" ]; then
  fail "C · a failing pg_dump was reported as success"
else
  ok "C · a failing client fails the backup without leaking the password"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "backup client selection: FAIL"; exit 1
fi
echo "backup client selection: pass"
